"""Regression tests for the calculation engine and public API."""

import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
TEST_DATA = tempfile.TemporaryDirectory()
os.environ['DB_PATH'] = str(Path(TEST_DATA.name) / 'test.db')
sys.path.insert(0, str(BACKEND))

import database  # noqa: E402
from app import app  # noqa: E402
from email_sender import generate_csv, generate_txt  # noqa: E402


def entry_for(day, **overrides):
    entry = {
        'date': day,
        'bedtime': '22:30',
        'sleep_attempt_time': '23:00',
        'sol_minutes': 20,
        'wakeup_count': 2,
        'waso_minutes': 25,
        'final_awakening': '06:15',
        'rise_time': '06:30',
        'sleep_quality': 3,
        'nap_minutes': 0,
        'comments': '',
        'morning_energy': 3,
        'daytime_mood': 3,
        'substances': '',
    }
    entry.update(overrides)
    return entry


class SleepTrackerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        app.config.update(TESTING=True)
        cls.client = app.test_client()

    def setUp(self):
        with database.get_conn() as conn:
            conn.execute('DELETE FROM chat_messages')
            conn.execute('DELETE FROM chat_sessions')
            conn.execute('DELETE FROM sleep_entries')
            conn.execute('DELETE FROM settings')

    def create_entry(self, day, **overrides):
        response = self.client.post('/api/entries', json=entry_for(day, **overrides))
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_health_endpoint(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'status': 'ok'})

    def test_time_parsing_and_overnight_duration(self):
        self.assertEqual(database.time_to_minutes('945'), 9 * 60 + 45)
        self.assertEqual(database.time_to_minutes('22'), 22 * 60)
        self.assertIsNone(database.time_to_minutes('25:00'))
        self.assertEqual(database.minutes_between('23:30', '06:30'), 420)

    def test_derived_sleep_metrics_include_pre_sleep_and_terminal_wake(self):
        result = database.calculate_derived(entry_for(
            '2026-01-01',
            bedtime='22:00',
            sleep_attempt_time='23:00',
            sol_minutes=30,
            waso_minutes=20,
            final_awakening='06:00',
            rise_time='06:30',
        ))
        self.assertEqual(result['tib_minutes'], 510)
        self.assertEqual(result['psib_minutes'], 60)
        self.assertEqual(result['tw_minutes'], 30)
        self.assertEqual(result['tst_minutes'], 370)
        self.assertEqual(result['sleep_efficiency'], 72.5)

    def test_entries_are_filtered_inclusively(self):
        for day in ('2026-01-01', '2026-01-02', '2026-01-03'):
            self.create_entry(day)
        response = self.client.get('/api/entries?start=2026-01-02&end=2026-01-03')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['date'] for item in response.get_json()], ['2026-01-02', '2026-01-03'])

    def test_entry_api_rejects_malformed_or_out_of_range_values(self):
        invalid_entries = (
            entry_for('01/01/2026'),
            entry_for('2026-01-01', bedtime='25:00'),
            entry_for('2026-01-01', sleep_quality=5),
            entry_for('2026-01-01', sol_minutes='many'),
        )
        for payload in invalid_entries:
            with self.subTest(payload=payload):
                response = self.client.post('/api/entries', json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.get_json())

        response = self.client.post('/api/entries', data='[]', content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_period_efficiency_uses_pooled_totals(self):
        entries = [
            database.calculate_derived(entry_for('2026-01-01', bedtime='22:00', rise_time='06:00')),
            database.calculate_derived(entry_for('2026-01-02', bedtime='00:00', rise_time='06:00')),
        ]
        result = database.calculate_aggregates(entries)
        expected = round(sum(item['tst_minutes'] for item in entries) / sum(item['tib_minutes'] for item in entries) * 100, 1)
        self.assertEqual(result['period_se'], expected)

    def test_download_supports_ranges_and_all_time(self):
        self.create_entry('2026-01-01')
        self.create_entry('2026-02-01')

        all_time = self.client.get('/api/download?format=csv')
        self.assertEqual(all_time.status_code, 200)
        self.assertIn('sleep_log_all_time.csv', all_time.headers['Content-Disposition'])
        self.assertIn('Sleep Log Export: All time', all_time.get_data(as_text=True))

        january = self.client.get('/api/download?format=txt&start=2026-01-01&end=2026-01-31')
        report = january.get_data(as_text=True)
        self.assertEqual(january.status_code, 200)
        self.assertIn('Period: 2026-01-01 to 2026-01-31', report)
        self.assertIn('2026-01-01', report)
        self.assertNotIn('2026-02-01', report)

    def test_download_rejects_invalid_options(self):
        invalid_urls = (
            '/api/download?format=pdf',
            '/api/download?format=csv&start=2026-01-01',
            '/api/download?format=csv&start=2026-02-01&end=2026-01-01',
            '/api/download?format=csv&start=not-a-date&end=2026-01-01',
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 400)

    def test_saved_secrets_are_masked(self):
        response = self.client.put('/api/settings', json={
            'saved_email': 'person@example.com',
            'smtp_password': 'not-a-real-password',
            'anthropic_api_key': 'not-a-real-key',
        })
        self.assertEqual(response.status_code, 200)

        settings = self.client.get('/api/settings').get_json()
        self.assertEqual(settings['saved_email'], 'person@example.com')
        self.assertEqual(settings['smtp_password'], '')
        self.assertEqual(settings['anthropic_api_key'], '')
        self.assertTrue(settings['smtp_password_set'])
        self.assertTrue(settings['anthropic_api_key_set'])

    def test_sleep_window_requires_seven_nights(self):
        start = date(2026, 1, 1)
        for offset in range(6):
            self.create_entry((start + timedelta(days=offset)).isoformat())
        unavailable = self.client.get('/api/sleep-restriction?start=2026-01-01&end=2026-01-07')
        self.assertFalse(unavailable.get_json()['available'])

        self.create_entry('2026-01-07')
        available = self.client.get('/api/sleep-restriction?start=2026-01-01&end=2026-01-07')
        self.assertTrue(available.get_json()['available'])

    def test_report_generators_handle_all_time_label(self):
        aggregates = database.calculate_aggregates([])
        self.assertIn('Sleep Log Export: All time', generate_csv([], aggregates, None, None))
        self.assertIn('Period: All time', generate_txt([], aggregates, None, None))


if __name__ == '__main__':
    unittest.main()
