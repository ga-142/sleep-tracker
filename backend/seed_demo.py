"""Populate an empty Sleep Tracker database with deterministic fictional data."""

import argparse
from datetime import date, timedelta

from database import create_entry, get_conn, init_db


def as_time(total_minutes):
    total_minutes %= 24 * 60
    return f'{total_minutes // 60:02d}:{total_minutes % 60:02d}'


def build_entries(days=28):
    """Create a believable improving trend without representing a real person."""
    first_day = date.today() - timedelta(days=days - 1)
    entries = []
    for index in range(days):
        bedtime = 22 * 60 + 35 + (index % 5) * 7
        attempt = bedtime + 15
        sol = max(12, 42 - index)
        waso = max(15, 48 - index)
        rise = 6 * 60 + 30 + (index % 3) * 5
        final_wake = rise - (10 + index % 4 * 5)
        entries.append({
            'date': (first_day + timedelta(days=index)).isoformat(),
            'bedtime': as_time(bedtime),
            'sleep_attempt_time': as_time(attempt),
            'sol_minutes': sol,
            'wakeup_count': 3 if index < 10 else 2,
            'waso_minutes': waso,
            'final_awakening': as_time(final_wake),
            'rise_time': as_time(rise),
            'sleep_quality': min(4, 2 + index // 10),
            'nap_minutes': 25 if index in (2, 8, 15) else 0,
            'comments': 'Fictional demo entry',
            'morning_energy': min(4, 2 + index // 12),
            'daytime_mood': min(4, 2 + index // 14),
            'substances': 'Coffee before noon',
        })
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='replace existing diary entries')
    args = parser.parse_args()

    init_db()
    with get_conn() as conn:
        existing = conn.execute('SELECT COUNT(*) FROM sleep_entries').fetchone()[0]
        if existing and not args.force:
            parser.error('database already contains entries; use --force to replace them')
        if args.force:
            conn.execute('DELETE FROM sleep_entries')

    entries = build_entries()
    for entry in entries:
        create_entry(entry)
    print(f'Created {len(entries)} fictional sleep entries.')


if __name__ == '__main__':
    main()
