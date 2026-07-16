import smtplib
import csv
import io
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime

QUALITY_LABELS = {0: 'Very Poor', 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good'}


def period_label(start, end):
    return f'{start} to {end}' if start and end else 'All time'


def fmt_min(minutes):
    """Convert minutes to 'Xh Ym' string."""
    if not minutes:
        return '0h 0m'
    h = int(minutes) // 60
    m = int(minutes) % 60
    return f'{h}h {m}m'


def quality_label(q):
    try:
        return QUALITY_LABELS.get(int(q), str(q))
    except (TypeError, ValueError):
        return ''


def generate_csv(entries, aggregates, start, end):
    output = io.StringIO()
    w = csv.writer(output)

    w.writerow([f'Sleep Log Export: {period_label(start, end)}'])
    w.writerow([])
    w.writerow(['--- Summary ---'])
    w.writerow(['Entries logged', aggregates.get('count', 0)])
    w.writerow(['Avg Sleep Efficiency (daily avg)', f"{aggregates.get('avg_se', 0)}%"])
    w.writerow(['Period Sleep Efficiency (clinical pooled)', f"{aggregates.get('period_se', 0)}%"])
    w.writerow(['Avg Total Sleep Time', fmt_min(aggregates.get('avg_tst_min'))])
    w.writerow(['Avg Time in Bed', fmt_min(aggregates.get('avg_tib_min'))])
    w.writerow(['Avg Sleep Onset Latency', f"{aggregates.get('avg_sol_min', 0)} min"])
    w.writerow(['Avg Wake After Sleep Onset', f"{aggregates.get('avg_waso_min', 0)} min"])
    w.writerow(['Avg Terminal Wakefulness', f"{aggregates.get('avg_tw_min', 0)} min"])
    avg_q = aggregates.get('avg_quality', 0)
    w.writerow(['Avg Sleep Quality', f"{avg_q} ({quality_label(round(avg_q))})"])
    w.writerow([])

    w.writerow([
        'Date', 'Bedtime', 'Sleep Attempt', 'SOL (min)', 'Wakeups',
        'WASO (min)', 'Final Awakening', 'Rise Time',
        'TIB (min)', 'TIB', 'TW (min)', 'TST (min)', 'TST',
        'SE %', 'Quality Score', 'Quality Label', 'Nap (min)', 'Comments'
    ])

    for e in entries:
        w.writerow([
            e.get('date', ''),
            e.get('bedtime', ''),
            e.get('sleep_attempt_time', ''),
            e.get('sol_minutes', 0),
            e.get('wakeup_count', 0),
            e.get('waso_minutes', 0),
            e.get('final_awakening', ''),
            e.get('rise_time', ''),
            e.get('tib_minutes', 0),
            fmt_min(e.get('tib_minutes')),
            e.get('tw_minutes', 0),
            e.get('tst_minutes', 0),
            fmt_min(e.get('tst_minutes')),
            e.get('sleep_efficiency', 0),
            e.get('sleep_quality', ''),
            quality_label(e.get('sleep_quality')),
            e.get('nap_minutes', 0),
            e.get('comments', ''),
        ])

    return output.getvalue()


def generate_txt(entries, aggregates, start, end):
    lines = []
    sep = '=' * 72

    lines.append(sep)
    lines.append('  SLEEP LOG REPORT')
    lines.append(f'  Period: {period_label(start, end)}')
    lines.append(sep)
    lines.append('')

    lines.append('SUMMARY')
    lines.append('-' * 40)
    lines.append(f"  Entries logged:                  {aggregates.get('count', 0)}")
    lines.append(f"  Avg Sleep Efficiency:            {aggregates.get('avg_se', 0)}%")
    lines.append(f"  Period SE (clinical pooled):     {aggregates.get('period_se', 0)}%")
    lines.append(f"  Avg Total Sleep Time:            {fmt_min(aggregates.get('avg_tst_min'))}")
    lines.append(f"  Avg Time in Bed:                 {fmt_min(aggregates.get('avg_tib_min'))}")
    lines.append(f"  Avg Sleep Onset Latency:         {aggregates.get('avg_sol_min', 0)} min")
    lines.append(f"  Avg Wake After Sleep Onset:      {aggregates.get('avg_waso_min', 0)} min")
    lines.append(f"  Avg Terminal Wakefulness:        {aggregates.get('avg_tw_min', 0)} min")
    avg_q = aggregates.get('avg_quality', 0)
    lines.append(f"  Avg Sleep Quality:               {avg_q} ({quality_label(round(avg_q))})")
    lines.append('')

    lines.append('DAILY LOG')
    col_header = (
        f"{'Date':<12} {'Bed':<6} {'Rise':<6} "
        f"{'TIB':>5} {'SOL':>4} {'WASO':>5} {'TW':>4} "
        f"{'TST':>5} {'SE%':>5} {'Q':>2} {'Nap':>4}"
    )
    lines.append(col_header)
    lines.append('-' * 72)

    for e in entries:
        line = (
            f"{str(e.get('date','')):<12} "
            f"{str(e.get('bedtime','')):<6} "
            f"{str(e.get('rise_time','')):<6} "
            f"{e.get('tib_minutes', 0):>5} "
            f"{e.get('sol_minutes', 0):>4} "
            f"{e.get('waso_minutes', 0):>5} "
            f"{e.get('tw_minutes', 0):>4} "
            f"{e.get('tst_minutes', 0):>5} "
            f"{e.get('sleep_efficiency', 0.0):>5.1f} "
            f"{e.get('sleep_quality', 0):>2} "
            f"{e.get('nap_minutes', 0):>4}"
        )
        lines.append(line)
        if e.get('comments'):
            lines.append(f"  Note: {e['comments']}")

    lines.append('')
    lines.append(sep)
    lines.append(f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    lines.append(sep)

    return '\n'.join(lines)


def send_email(smtp_sender, smtp_password, recipient, subject, body, attachment_content, filename):
    msg = MIMEMultipart()
    msg['From'] = smtp_sender
    msg['To'] = recipient
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    part = MIMEBase('application', 'octet-stream')
    part.set_payload(attachment_content.encode('utf-8'))
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
    msg.attach(part)

    with smtplib.SMTP('smtp.gmail.com', 587) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp_sender, smtp_password)
        server.sendmail(smtp_sender, recipient, msg.as_string())


def test_connection(smtp_sender, smtp_password):
    with smtplib.SMTP('smtp.gmail.com', 587) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp_sender, smtp_password)
    return True
