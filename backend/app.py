import json
import os
from datetime import datetime
from flask import Flask, jsonify, request, Response, stream_with_context
from database import (
    init_db, get_entries, create_entry, update_entry,
    delete_entry, calculate_aggregates, get_aggregates, get_settings, save_settings,
    create_chat_session, get_chat_sessions, get_chat_session,
    delete_chat_session, get_chat_messages, add_chat_message,
    time_to_minutes, ENTRY_FIELDS,
)
from email_sender import generate_csv, generate_txt, send_email, test_connection
from ai import (
    build_system_prompt, stream_anthropic, stream_ollama, get_ollama_models,
    OLLAMA_BASE_URL_DEFAULT,
)

app = Flask(__name__)
init_db()


class ApiValidationError(ValueError):
    """A client error that should be returned as a JSON 400 response."""


@app.errorhandler(ApiValidationError)
def handle_validation_error(error):
    return jsonify({'error': str(error)}), 400


def _json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiValidationError('Request body must be a JSON object.')
    return data


def _entry_payload():
    data = _json_object()
    normalized = {field: data.get(field) for field in ENTRY_FIELDS}

    raw_date = normalized.get('date')
    try:
        parsed_date = datetime.strptime(raw_date, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        raise ApiValidationError('Date must use YYYY-MM-DD format.')
    normalized['date'] = parsed_date.isoformat()

    for field in ('bedtime', 'sleep_attempt_time', 'final_awakening', 'rise_time'):
        value = normalized.get(field)
        if value not in (None, '') and time_to_minutes(value) is None:
            raise ApiValidationError(f'{field.replace("_", " ").title()} must be a valid 24-hour time.')

    ranges = {
        'sol_minutes': (0, 1440),
        'wakeup_count': (0, 100),
        'waso_minutes': (0, 1440),
        'sleep_quality': (0, 4),
        'nap_minutes': (0, 1440),
        'morning_energy': (0, 4),
        'daytime_mood': (0, 4),
    }
    for field, (minimum, maximum) in ranges.items():
        value = normalized.get(field)
        if value is None and field in ('morning_energy', 'daytime_mood'):
            continue
        try:
            value = int(value or 0)
        except (TypeError, ValueError):
            raise ApiValidationError(f'{field.replace("_", " ").title()} must be a number.')
        if not minimum <= value <= maximum:
            raise ApiValidationError(
                f'{field.replace("_", " ").title()} must be between {minimum} and {maximum}.'
            )
        normalized[field] = value

    for field, maximum in (('comments', 2000), ('substances', 500)):
        value = normalized.get(field) or ''
        if not isinstance(value, str):
            raise ApiValidationError(f'{field.title()} must be text.')
        normalized[field] = value.strip()[:maximum]

    return normalized


def _export_options(fmt, start, end):
    """Validate and normalize options shared by download and email exports."""
    if fmt not in ('csv', 'txt'):
        raise ValueError('Format must be csv or txt.')
    if bool(start) != bool(end):
        raise ValueError('Both start and end dates are required for a date range.')
    if start and end:
        try:
            start_date = datetime.strptime(start, '%Y-%m-%d').date()
            end_date = datetime.strptime(end, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            raise ValueError('Dates must use YYYY-MM-DD format.')
        if start_date > end_date:
            raise ValueError('Start date must be on or before end date.')
        start, end = start_date.isoformat(), end_date.isoformat()
    return fmt, start or None, end or None


def _export_label(start, end):
    return f'{start} to {end}' if start and end else 'All time'


def _export_filename(start, end, extension):
    period = f'{start}_{end}' if start and end else 'all_time'
    return f'sleep_log_{period}.{extension}'


@app.route('/api/health', methods=['GET'])
def health():
    """Lightweight container and uptime probe."""
    return jsonify({'status': 'ok'})


# ── Entries ────────────────────────────────────────────────────────────────

@app.route('/api/entries', methods=['GET'])
def list_entries():
    start = request.args.get('start')
    end   = request.args.get('end')
    return jsonify(get_entries(start, end))


@app.route('/api/entries', methods=['POST'])
def add_entry():
    data  = _entry_payload()
    entry = create_entry(data)
    return jsonify(entry), 201


@app.route('/api/entries/<int:entry_id>', methods=['PUT'])
def edit_entry(entry_id):
    data  = _entry_payload()
    entry = update_entry(entry_id, data)
    if not entry:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(entry)


@app.route('/api/entries/<int:entry_id>', methods=['DELETE'])
def remove_entry(entry_id):
    delete_entry(entry_id)
    return jsonify({'ok': True})


# ── Aggregates ─────────────────────────────────────────────────────────────

@app.route('/api/aggregates', methods=['GET'])
def aggregates():
    start = request.args.get('start')
    end   = request.args.get('end')
    return jsonify(get_aggregates(start, end))


# ── Settings ───────────────────────────────────────────────────────────────

@app.route('/api/settings', methods=['GET'])
def get_all_settings():
    s = get_settings()
    for masked_key in ('smtp_password', 'anthropic_api_key'):
        if s.get(masked_key):
            s[f'{masked_key}_set'] = True
            s[masked_key] = ''
        else:
            s[f'{masked_key}_set'] = False
    return jsonify(s)


@app.route('/api/settings', methods=['PUT'])
def update_settings():
    data = _json_object()
    for masked_key in ('smtp_password', 'anthropic_api_key'):
        if masked_key in data and data[masked_key] == '':
            data.pop(masked_key)
    return jsonify(save_settings(data))


# ── Download ───────────────────────────────────────────────────────────────

@app.route('/api/download', methods=['GET'])
def download_report():
    fmt   = request.args.get('format', 'csv')
    start = request.args.get('start')
    end   = request.args.get('end')

    try:
        fmt, start, end = _export_options(fmt, start, end)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    entries = get_entries(start, end)
    aggs    = calculate_aggregates(entries)

    if fmt == 'csv':
        content  = generate_csv(entries, aggs, start, end)
        filename = _export_filename(start, end, 'csv')
        mimetype = 'text/csv'
    else:
        content  = generate_txt(entries, aggs, start, end)
        filename = _export_filename(start, end, 'txt')
        mimetype = 'text/plain'

    return Response(
        content,
        mimetype=mimetype,
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )


# ── Email ──────────────────────────────────────────────────────────────────

@app.route('/api/email', methods=['POST'])
def send_report():
    data      = _json_object()
    fmt       = data.get('format', 'csv')
    start     = data.get('start')
    end       = data.get('end')
    recipient = str(data.get('recipient') or '').strip()

    try:
        fmt, start, end = _export_options(fmt, start, end)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if not recipient:
        return jsonify({'error': 'No recipient email address provided.'}), 400

    settings      = get_settings()
    smtp_sender   = settings.get('smtp_sender', '').strip()
    smtp_password = settings.get('smtp_password', '').strip()

    if not smtp_sender or not smtp_password:
        return jsonify({'error': 'SMTP not configured. Set sender email and app password in Settings.'}), 400

    entries = get_entries(start, end)
    aggs    = calculate_aggregates(entries)

    if fmt == 'csv':
        content  = generate_csv(entries, aggs, start, end)
        filename = _export_filename(start, end, 'csv')
        body     = f'Your sleep log (CSV) for {_export_label(start, end)} is attached.'
    else:
        content  = generate_txt(entries, aggs, start, end)
        filename = _export_filename(start, end, 'txt')
        body     = f'Your sleep log (text report) for {_export_label(start, end)} is attached.'

    try:
        send_email(smtp_sender, smtp_password, recipient,
                   f'Sleep Log: {_export_label(start, end)}', body, content, filename)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/email/test', methods=['POST'])
def test_smtp():
    settings      = get_settings()
    smtp_sender   = settings.get('smtp_sender', '').strip()
    smtp_password = settings.get('smtp_password', '').strip()
    if not smtp_sender or not smtp_password:
        return jsonify({'error': 'SMTP credentials not configured.'}), 400
    try:
        test_connection(smtp_sender, smtp_password)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Sleep restriction window ───────────────────────────────────────────────

def _min_diff(a, b):
    """Signed circular difference a − b in minutes, adjusted for midnight."""
    if a is None or b is None:
        return None
    diff = a - b
    if diff >  720: diff -= 1440
    if diff < -720: diff += 1440
    return diff


@app.route('/api/sleep-restriction', methods=['GET'])
def sleep_restriction():
    start = request.args.get('start')
    end   = request.args.get('end')

    entries  = get_entries(start, end)
    aggs     = calculate_aggregates(entries)
    settings = get_settings()

    count = aggs.get('count', 0)
    if count < 7:
        return jsonify({
            'available': False,
            'reason': f'Need at least 7 nights of data (have {count})',
        })

    avg_tst_min    = aggs.get('avg_tst_min', 0)
    prescribed_tib = max(int(avg_tst_min) + 30, 330)   # CBT-I: TST + 30 min, floor 5.5 h

    target_rise        = (settings.get('target_rise_time') or '').strip()
    prescribed_bedtime = None
    compliance_rise    = None
    compliance_bed     = None

    if target_rise:
        rise_mins = time_to_minutes(target_rise)
        if rise_mins is not None:
            bed_mins           = (rise_mins - prescribed_tib) % 1440
            prescribed_bedtime = f"{bed_mins // 60:02d}:{bed_mins % 60:02d}"

            entries_with_rise = [e for e in entries if e.get('rise_time')]
            if entries_with_rise:
                compliant_rise = sum(
                    1 for e in entries_with_rise
                    if (d := _min_diff(time_to_minutes(e['rise_time']), rise_mins)) is not None
                    and abs(d) <= 30
                )
                compliance_rise = round(compliant_rise / len(entries_with_rise) * 100)

            entries_with_bed = [e for e in entries if e.get('bedtime')]
            if entries_with_bed:
                compliant_bed = sum(
                    1 for e in entries_with_bed
                    if (d := _min_diff(time_to_minutes(e['bedtime']), bed_mins)) is not None
                    and d >= -30
                )
                compliance_bed = round(compliant_bed / len(entries_with_bed) * 100)

    return jsonify({
        'available':        True,
        'avg_tst_min':      avg_tst_min,
        'prescribed_tib_min': prescribed_tib,
        'prescribed_bedtime': prescribed_bedtime,
        'target_rise_time': target_rise or None,
        'compliance_rise':  compliance_rise,
        'compliance_bed':   compliance_bed,
        'entry_count':      count,
    })


# ── Chat sessions ──────────────────────────────────────────────────────────

@app.route('/api/chat/sessions', methods=['GET'])
def list_chat_sessions():
    return jsonify(get_chat_sessions())


@app.route('/api/chat/sessions', methods=['POST'])
def new_chat_session():
    data         = _json_object()
    period_start = data.get('period_start', '')
    period_end   = data.get('period_end', '')

    try:
        _, period_start, period_end = _export_options('csv', period_start, period_end)
    except ValueError as exc:
        raise ApiValidationError(str(exc))
    if not period_start:
        raise ApiValidationError('A date range is required to start an analysis.')

    settings = get_settings()
    provider = settings.get('ai_provider', 'anthropic')
    if provider == 'ollama':
        model = settings.get('ollama_model', 'llama3.2:3b')
    else:
        model    = settings.get('anthropic_model', 'claude-sonnet-4-6')
        provider = 'anthropic'

    title   = f'{period_start} → {period_end}'
    session = create_chat_session(title, provider, model, period_start, period_end)
    return jsonify(session), 201


@app.route('/api/chat/sessions/<int:session_id>', methods=['GET'])
def get_session(session_id):
    session = get_chat_session(session_id)
    if not session:
        return jsonify({'error': 'Not found'}), 404
    messages = get_chat_messages(session_id, include_hidden=False)
    return jsonify({'session': session, 'messages': messages})


@app.route('/api/chat/sessions/<int:session_id>', methods=['DELETE'])
def remove_chat_session(session_id):
    delete_chat_session(session_id)
    return jsonify({'ok': True})


@app.route('/api/chat/sessions/<int:session_id>/stream', methods=['POST'])
def chat_stream(session_id):
    session = get_chat_session(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    data       = _json_object()
    content    = str(data.get('content') or '')
    is_initial = data.get('is_initial', False)

    settings = get_settings()

    # Resolve provider credentials from settings, fall back to env vars
    provider = session['provider']
    model    = session['model']

    if provider == 'anthropic':
        api_key = settings.get('anthropic_api_key') or os.environ.get('ANTHROPIC_API_KEY', '')
        if not api_key:
            return jsonify({'error': 'Anthropic API key not configured. Add it in Settings → AI Provider.'}), 400
    else:
        ollama_url = settings.get('ollama_base_url') or OLLAMA_BASE_URL_DEFAULT

    # Persist the user message
    if is_initial:
        trigger = f'Please analyze my sleep data for the period {session["period_start"]} to {session["period_end"]} and introduce yourself.'
        add_chat_message(session_id, 'user', trigger, hidden=True)
    else:
        if not content.strip():
            return jsonify({'error': 'Empty message'}), 400
        add_chat_message(session_id, 'user', content)

    # Build context: current sleep data + user profile + full message history
    entries = get_entries(session['period_start'], session['period_end'])
    aggs    = calculate_aggregates(entries)
    profile_keys = (
        'target_rise_time', 'target_bedtime', 'target_tst_hours',
        'user_age', 'sleep_issue_duration', 'caffeine_cutoff', 'user_context',
    )
    user_profile = {k: settings.get(k) for k in profile_keys if settings.get(k)}
    sys_prompt = build_system_prompt(
        entries, aggs, session['period_start'], session['period_end'], user_profile
    )

    all_msgs   = get_chat_messages(session_id, include_hidden=True)
    api_messages = [{'role': m['role'], 'content': m['content']} for m in all_msgs]

    # Stream the response and buffer for DB save
    def generate():
        full_response = []
        try:
            if provider == 'anthropic':
                chunks = stream_anthropic(api_messages, sys_prompt, api_key, model)
            else:
                chunks = stream_ollama(api_messages, sys_prompt, ollama_url, model)

            for chunk in chunks:
                if chunk.get('text'):
                    full_response.append(chunk['text'])
                yield f'data: {json.dumps(chunk)}\n\n'
        except Exception as exc:
            yield f'data: {json.dumps({"error": str(exc)})}\n\n'
        finally:
            if full_response:
                add_chat_message(session_id, 'assistant', ''.join(full_response))

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )


# ── Ollama model list ──────────────────────────────────────────────────────

@app.route('/api/chat/ollama/models', methods=['GET'])
def ollama_models():
    settings   = get_settings()
    ollama_url = settings.get('ollama_base_url') or OLLAMA_BASE_URL_DEFAULT
    models     = get_ollama_models(ollama_url)
    return jsonify({'models': models})


# ── Boot ───────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print('\n  Sleep Tracker running at http://localhost:5000\n')
    app.run(debug=False, host='0.0.0.0', port=5000)
