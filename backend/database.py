import sqlite3
import os

DB_PATH = os.environ.get(
    'DB_PATH',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sleep.db')
)


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def _add_column_if_missing(conn, table, column, col_type):
    cols = [r['name'] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    if column not in cols:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}')


def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sleep_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                bedtime TEXT,
                sleep_attempt_time TEXT,
                sol_minutes INTEGER DEFAULT 0,
                wakeup_count INTEGER DEFAULT 0,
                waso_minutes INTEGER DEFAULT 0,
                final_awakening TEXT,
                rise_time TEXT,
                sleep_quality INTEGER DEFAULT 2,
                nap_minutes INTEGER DEFAULT 0,
                comments TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        _add_column_if_missing(conn, 'sleep_entries', 'morning_energy', 'INTEGER')
        _add_column_if_missing(conn, 'sleep_entries', 'daytime_mood',   'INTEGER')
        _add_column_if_missing(conn, 'sleep_entries', 'substances',     'TEXT')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'anthropic',
                model TEXT NOT NULL,
                period_start TEXT,
                period_end TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')
        conn.commit()


# ── Sleep entries ──────────────────────────────────────────────────────────

def time_to_minutes(t):
    if not t:
        return None
    s = str(t).strip()
    if not s:
        return None
    try:
        if ':' in s:
            parts = s.split(':')
            h, m = int(parts[0]), int(parts[1])
        elif len(s) <= 2 and s.isdigit():
            h, m = int(s), 0
        elif len(s) == 3 and s.isdigit():
            h, m = int(s[0]), int(s[1:])
        elif len(s) == 4 and s.isdigit():
            h, m = int(s[:2]), int(s[2:])
        else:
            return None
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h * 60 + m
        return None
    except (ValueError, IndexError, AttributeError):
        return None


def minutes_between(start_time, end_time):
    start = time_to_minutes(start_time)
    end = time_to_minutes(end_time)
    if start is None or end is None:
        return 0
    diff = end - start
    if diff < 0:
        diff += 1440
    return diff


def calculate_derived(entry):
    d = dict(entry)
    tib  = minutes_between(d.get('bedtime'), d.get('rise_time'))
    psib = minutes_between(d.get('bedtime'), d.get('sleep_attempt_time'))
    tw   = minutes_between(d.get('final_awakening'), d.get('rise_time'))
    sol  = int(d.get('sol_minutes') or 0)
    waso = int(d.get('waso_minutes') or 0)
    tst  = max(0, tib - psib - sol - waso - tw)
    se   = round(tst / tib * 100, 1) if tib > 0 else 0.0
    d['tib_minutes']      = tib
    d['psib_minutes']     = psib
    d['tw_minutes']       = tw
    d['tst_minutes']      = tst
    d['sleep_efficiency'] = se
    return d


def get_entries(start=None, end=None):
    with get_conn() as conn:
        if start and end:
            rows = conn.execute(
                'SELECT * FROM sleep_entries WHERE date >= ? AND date <= ? ORDER BY date ASC',
                (start, end)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM sleep_entries ORDER BY date ASC'
            ).fetchall()
    return [calculate_derived(r) for r in rows]


def get_entry(entry_id):
    with get_conn() as conn:
        row = conn.execute(
            'SELECT * FROM sleep_entries WHERE id = ?', (entry_id,)
        ).fetchone()
    return calculate_derived(row) if row else None


ENTRY_FIELDS = [
    'date', 'bedtime', 'sleep_attempt_time', 'sol_minutes', 'wakeup_count',
    'waso_minutes', 'final_awakening', 'rise_time', 'sleep_quality',
    'nap_minutes', 'comments', 'morning_energy', 'daytime_mood', 'substances',
]


def create_entry(data):
    with get_conn() as conn:
        cols = ', '.join(ENTRY_FIELDS)
        placeholders = ', '.join(['?' for _ in ENTRY_FIELDS])
        values = [data.get(f) for f in ENTRY_FIELDS]
        cur = conn.execute(
            f'INSERT INTO sleep_entries ({cols}) VALUES ({placeholders})', values
        )
        conn.commit()
        return get_entry(cur.lastrowid)


def update_entry(entry_id, data):
    with get_conn() as conn:
        sets = ', '.join([f'{f} = ?' for f in ENTRY_FIELDS])
        values = [data.get(f) for f in ENTRY_FIELDS] + [entry_id]
        conn.execute(
            f'UPDATE sleep_entries SET {sets} WHERE id = ?', values
        )
        conn.commit()
    return get_entry(entry_id)


def delete_entry(entry_id):
    with get_conn() as conn:
        conn.execute('DELETE FROM sleep_entries WHERE id = ?', (entry_id,))
        conn.commit()


def calculate_aggregates(entries):
    """Calculate summary metrics from an already-loaded entry collection."""
    if not entries:
        return {
            'count': 0,
            'avg_se': 0, 'period_se': 0,
            'avg_tst_min': 0, 'avg_tib_min': 0,
            'avg_sol_min': 0, 'avg_waso_min': 0, 'avg_tw_min': 0,
            'avg_quality': 0,
            'total_tib_min': 0, 'total_tst_min': 0,
        }

    count      = len(entries)
    total_tib  = sum(e['tib_minutes'] for e in entries)
    total_sol  = sum(int(e.get('sol_minutes') or 0) for e in entries)
    total_waso = sum(int(e.get('waso_minutes') or 0) for e in entries)
    total_tw   = sum(e['tw_minutes'] for e in entries)
    total_tst  = sum(e['tst_minutes'] for e in entries)
    total_q    = sum(int(e.get('sleep_quality') or 0) for e in entries)

    period_se = round(total_tst / total_tib * 100, 1) if total_tib > 0 else 0.0

    return {
        'count': count,
        'avg_se':       round(sum(e['sleep_efficiency'] for e in entries) / count, 1),
        'period_se':    period_se,
        'avg_tst_min':  round(total_tst  / count),
        'avg_tib_min':  round(total_tib  / count),
        'avg_sol_min':  round(total_sol  / count),
        'avg_waso_min': round(total_waso / count),
        'avg_tw_min':   round(total_tw   / count),
        'avg_quality':  round(total_q    / count, 1),
        'total_tib_min': total_tib,
        'total_tst_min': total_tst,
    }


def get_aggregates(start=None, end=None):
    return calculate_aggregates(get_entries(start, end))


# ── Settings ───────────────────────────────────────────────────────────────

def get_settings():
    with get_conn() as conn:
        rows = conn.execute('SELECT key, value FROM settings').fetchall()
    return {r['key']: r['value'] for r in rows}


def save_settings(data):
    with get_conn() as conn:
        for k, v in data.items():
            conn.execute(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (k, v)
            )
        conn.commit()
    return get_settings()


# ── Chat sessions ──────────────────────────────────────────────────────────

def create_chat_session(title, provider, model, period_start, period_end):
    with get_conn() as conn:
        cur = conn.execute(
            '''INSERT INTO chat_sessions (title, provider, model, period_start, period_end)
               VALUES (?, ?, ?, ?, ?)''',
            (title, provider, model, period_start, period_end)
        )
        conn.commit()
        return get_chat_session(cur.lastrowid)


def get_chat_sessions():
    with get_conn() as conn:
        rows = conn.execute('''
            SELECT s.*,
                   (SELECT COUNT(*) FROM chat_messages m
                    WHERE m.session_id = s.id AND m.hidden = 0) AS message_count
            FROM chat_sessions s
            ORDER BY s.updated_at DESC
        ''').fetchall()
    return [dict(r) for r in rows]


def get_chat_session(session_id):
    with get_conn() as conn:
        row = conn.execute(
            'SELECT * FROM chat_sessions WHERE id = ?', (session_id,)
        ).fetchone()
    return dict(row) if row else None


def delete_chat_session(session_id):
    with get_conn() as conn:
        conn.execute('DELETE FROM chat_sessions WHERE id = ?', (session_id,))
        conn.commit()


def get_chat_messages(session_id, include_hidden=False):
    with get_conn() as conn:
        if include_hidden:
            rows = conn.execute(
                'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
                (session_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM chat_messages WHERE session_id = ? AND hidden = 0 ORDER BY id ASC',
                (session_id,)
            ).fetchall()
    return [dict(r) for r in rows]


def add_chat_message(session_id, role, content, hidden=False):
    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO chat_messages (session_id, role, content, hidden) VALUES (?, ?, ?, ?)',
            (session_id, role, content, 1 if hidden else 0)
        )
        conn.execute(
            "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
            (session_id,)
        )
        conn.commit()
        return cur.lastrowid
