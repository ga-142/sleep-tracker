import json
import os
import httpx

OLLAMA_BASE_URL_DEFAULT = os.environ.get('OLLAMA_BASE_URL', 'http://ollama:11434')


_SLEEP_ASSISTANT_SYSTEM = """\
You are a compassionate sleep data assistant informed by Cognitive Behavioral \
Therapy for Insomnia (CBT-I). Your role is to help this person understand the \
sleep data they recorded and provide general educational context.

You have been provided with this person's sleep log data from their personal \
sleep tracking app.

When the conversation begins you should:
1. Warmly introduce yourself in one or two sentences
2. Present a clear, structured analysis of their data — highlight what is \
going well AND what most needs attention
3. Identify the 1–2 most significant issues based on the numbers
4. End with 1–2 specific clarifying questions before jumping to recommendations

Guidelines for the entire conversation:
- You are not a clinician and must not diagnose, prescribe treatment, or claim \
that your response replaces professional care
- Ground every observation in their actual numbers; reference specific values \
and dates when helpful
- Explain clinical terms (SE%, SOL, WASO, TIB, TST) in plain language the \
first time you use each one
- Explain relevant CBT-I concepts without presenting them as a personalized \
medical prescription
- Be direct but compassionate — do not sugarcoat significant problems, but \
always lead with empathy
- If nap data is present and napping is frequent, address it proactively \
since daytime napping fragments nighttime sleep
- If the user asks about sleep medication, acknowledge it briefly and refocus \
on behavioral approaches
- If you suspect something beyond typical insomnia (signs of sleep apnea, \
severe mood disturbance, etc.), gently recommend they consult a clinician
- Keep responses conversational — this is a chat, not a report

Clinical targets for reference:
- Sleep Efficiency (SE%): ≥85% is the target for healthy consolidated sleep
- Total Sleep Time (TST): 7–9 hours for most adults
- Sleep Onset Latency (SOL): <20 minutes is considered normal
- Wake After Sleep Onset (WASO): <30 minutes is considered normal
- Consistent bed and rise times are critical for circadian rhythm stability\
"""


def _fmt_minutes(mins):
    mins = int(mins or 0)
    h, m = divmod(mins, 60)
    return f'{h}h {m}m' if h else f'{m}m'


def build_system_prompt(entries, aggregates, period_start, period_end, user_profile=None):
    agg = aggregates
    n   = agg.get('count', 0)
    p   = user_profile or {}

    # ── User profile section ───────────────────────────────────────
    profile_lines = []
    if p.get('user_age'):
        profile_lines.append(f"Age: {p['user_age']}")
    if p.get('sleep_issue_duration'):
        duration_labels = {
            'weeks': 'a few weeks',
            'months': 'several months',
            'years': 'a year or more',
            'lifelong': 'most of their life',
        }
        label = duration_labels.get(p['sleep_issue_duration'], p['sleep_issue_duration'])
        profile_lines.append(f"Sleep issues for: {label}")
    if p.get('caffeine_cutoff'):
        profile_lines.append(f"Caffeine cutoff: {p['caffeine_cutoff']}")
    if p.get('user_context'):
        profile_lines.append(f"Additional context: {p['user_context']}")

    # ── Sleep targets section ──────────────────────────────────────
    target_lines = []
    if p.get('target_rise_time'):
        target_lines.append(f"Target rise time: {p['target_rise_time']}")
    if p.get('target_bedtime'):
        target_lines.append(f"Target bedtime: {p['target_bedtime']}")
    if p.get('target_tst_hours'):
        target_lines.append(f"Target total sleep time: {p['target_tst_hours']} hours")

    # ── Sleep data section ─────────────────────────────────────────
    summary = f"""
--- SLEEP LOG DATA ---
Period: {period_start} to {period_end} ({n} nights logged)

SUMMARY STATISTICS
Sleep Efficiency:     {agg.get('avg_se', 0)}% avg / {agg.get('period_se', 0)}% period-pooled  [target: ≥85%]
Total Sleep Time:     {_fmt_minutes(agg.get('avg_tst_min', 0))} avg  [target: 7–9h]
Sleep Onset Latency:  {agg.get('avg_sol_min', 0)} min avg  [target: <20 min]
Wake After Sleep:     {agg.get('avg_waso_min', 0)} min avg  [target: <30 min]
Terminal Wakefulness: {agg.get('avg_tw_min', 0)} min avg
Time in Bed:          {_fmt_minutes(agg.get('avg_tib_min', 0))} avg
Sleep Quality:        {agg.get('avg_quality', 0)}/4 avg
""".strip()

    if entries:
        header = 'NIGHTLY DATA\nDate       Bed    Rise   SOL   WASO  TW    TST     SE%    Q  Nap     Notes'
        sep    = '-' * len(header)
        rows   = []
        for e in entries:
            nap   = _fmt_minutes(e.get('nap_minutes', 0)) if e.get('nap_minutes') else '—'
            notes = (e.get('comments') or '—')[:40]
            rows.append(
                f"{e.get('date','?'):<10} "
                f"{e.get('bedtime','?'):<6} "
                f"{e.get('rise_time','?'):<6} "
                f"{e.get('sol_minutes', 0):>4}m "
                f"{e.get('waso_minutes', 0):>4}m "
                f"{e.get('tw_minutes', 0):>4}m "
                f"{_fmt_minutes(e.get('tst_minutes', 0)):>8} "
                f"{e.get('sleep_efficiency', 0):>5.1f}% "
                f"{e.get('sleep_quality', 0):>2}  "
                f"{nap:<6}  "
                f"{notes}"
            )
        table = '\n'.join([header, sep] + rows)
        summary = summary + '\n\n' + table

    # ── Assemble full context ──────────────────────────────────────
    parts = [_SLEEP_ASSISTANT_SYSTEM]
    if profile_lines:
        parts.append('--- USER PROFILE ---\n' + '\n'.join(profile_lines))
    if target_lines:
        parts.append('--- SLEEP TARGETS ---\n' + '\n'.join(target_lines))
    parts.append(summary)

    return '\n\n'.join(parts)


def get_ollama_models(base_url=None):
    url = (base_url or OLLAMA_BASE_URL_DEFAULT).rstrip('/')
    try:
        resp = httpx.get(f'{url}/api/tags', timeout=5)
        resp.raise_for_status()
        models = resp.json().get('models', [])
        return [m['name'] for m in models]
    except Exception:
        return []


def stream_anthropic(messages, system_prompt, api_key, model):
    from anthropic import Anthropic
    client = Anthropic(api_key=api_key)
    with client.messages.stream(
        model=model,
        max_tokens=2048,
        system=system_prompt,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield {'text': text}
    yield {'done': True}


def stream_ollama(messages, system_prompt, base_url, model):
    url = (base_url or OLLAMA_BASE_URL_DEFAULT).rstrip('/')
    payload = {
        'model': model,
        'messages': [{'role': 'system', 'content': system_prompt}] + messages,
        'stream': True,
    }
    with httpx.stream('POST', f'{url}/api/chat', json=payload, timeout=300) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = data.get('message', {}).get('content', '')
            if text:
                yield {'text': text}
            if data.get('done'):
                yield {'done': True}
                return
    yield {'done': True}
