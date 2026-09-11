#!/usr/bin/env python3
"""Read-only service checks; Python standard library plus the host psql client."""
import argparse
import base64
import datetime as dt
import hashlib
import hmac
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from urllib.parse import urlsplit

sys.path.append(str(Path(__file__).resolve().parents[1] / 'provisioner'))
from capacity import capacity_limits, thresholds, running_tenants, disk_state

ROOT = Path('/home/flori/ventures2/bookstack/tenants')
LOG = ROOT / 'watchdog.log'
LABELS = ['Control-Plane', 'Demo', 'Tenant-Logins', 'Bereitstellung', 'Backups', 'Host und Worker', 'Dokument-Eingang']


def background_state(db):
    """Stuck drafts, and whether the hourly in-application job is still running.

    That job lives in a setInterval inside the application, logs its failures to
    the console and swallows them. It deletes expired rate limits on every pass,
    so a row still present two hours after it expired is the only sign from
    outside that it stopped — otherwise the first evidence would be a trial
    ending without its notice.
    """
    stale = db.get('stale_cleanup') or 0
    detail = (f"drafting >30min: {db['drafting']}; "
              f'abgelaufene Ratenlimits aelter als 2 h: {stale}')
    if stale:
        detail += ' — der stuendliche Job in der Anwendung raeumt nicht mehr auf'
    return db['drafting'] == 0 and not stale, detail


def provisioning_state(db):
    """Overdue work plus tenants whose actual state contradicts what was ordered.

    A failed provisioning is terminal: the worker skips such rows, and every
    other watchdog query looks at running tenants only. Without this the tenant
    of a paying customer could vanish from all lists, and an earlier alert would
    even be followed by "recovered" although nothing had recovered.
    """
    stranded = db.get('stranded') or []
    unsuspended = db.get('unsuspended') or []
    detail = f"überfällig: provisioning={db['provisioning']}, pending={db['pending']}"
    if stranded:
        detail += '; GESTRANDET (soll laufen, tut es nicht): ' + ', '.join(stranded)
    if unsuspended:
        detail += '; nicht ausgesetzt (soll ausgesetzt sein, laeuft weiter): ' + ', '.join(unsuspended)
    # Within two days of a trial running out, a team without a payment method
    # must already hold a trial_ending notice. If the hourly job stopped, this
    # is the only place it shows before the workspace suspends itself.
    unreminded = db.get('unreminded') or []
    detail += '; Testphase ohne Erinnerung: ' + (', '.join(unreminded) if unreminded else 'keine')
    # We promise the customer two working days in the receipt. One day open is
    # the point at which somebody still has time to keep that promise.
    unpaid = db.get('unpaid_running') or []
    # Say "keine" like the neighbouring clauses: a silent check cannot be told
    # apart from one that is not running at all.
    detail += '; Bezahlung beendet, Workspace laeuft weiter: ' + (
        ', '.join(unpaid) if unpaid else 'keine')
    cancellations = db.get('cancellations') or []
    detail += '; Kuendigungen offen >24 h: ' + (
        ', '.join(str(c) for c in cancellations) if cancellations else 'keine')
    ok = (db['provisioning'] == 0 and db['pending'] == 0
          and not stranded and not unsuspended and not unreminded
          and not cancellations and not unpaid)
    return ok, detail


def stamp(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec='seconds')


def transition(previous, ok, now):
    """Return candidate state and optional notification. Commit only after delivery."""
    old = previous or {'status': 'ok', 'since': stamp(now), 'failures': 0, 'alerted': False}
    status = 'ok' if ok else 'fail'
    state = {'status': status, 'since': old['since'] if old['status'] == status else stamp(now),
             'failures': 0 if ok else old.get('failures', 0) + 1,
             'alerted': old.get('alerted', False)}
    event = None
    if ok:
        if state['alerted']:
            event = 'recovery'
        state['alerted'] = False
    elif state['failures'] >= 2 and not state['alerted']:
        event = 'failure'
        state['alerted'] = True
    return state, event


def message(label, state, event):
    first = (f'BookHost: {label} ausgefallen seit {state["since"]}' if event == 'failure'
             else f'BookHost: {label} wieder ok seit {state["since"]}')
    return first + '\n' + ('Bitte Ursache prüfen.' if event == 'failure' else 'Störung beendet.') + f'\nLog: {LOG}'


def send(text):
    # Never include API URL, response body, credentials or exception text in logs.
    token, chat = os.environ['TG_BOT_TOKEN'], os.environ['TG_CHAT_ID']
    data = urllib.parse.urlencode({'chat_id': chat, 'text': text}).encode()
    request = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=data)
    with urllib.request.urlopen(request, timeout=15) as response:
        if not json.load(response).get('ok'):
            raise RuntimeError('Delivery rejected')


def database():
    url = urllib.parse.urlsplit(os.environ['DATABASE_URL_LOCAL'])
    env = os.environ.copy()
    # Force verified TLS, irrespective of URL query defaults. No DSN in argv.
    env.update(PGHOST=os.environ['DATABASE_SSL_SERVERNAME'], PGHOSTADDR=url.hostname,
               PGPORT=str(url.port or 5432), PGUSER=urllib.parse.unquote(url.username or ''),
               PGPASSWORD=urllib.parse.unquote(url.password or ''),
               PGDATABASE=urllib.parse.unquote(url.path.lstrip('/')), PGSSLMODE='verify-full',
               PGCONNECT_TIMEOUT='8')
    env.pop('PGOPTIONS', None)
    query = """BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
 'running', COALESCE((SELECT json_agg(json_build_object('slug',slug,'host',COALESCE(to_jsonb(tenants)->>'host',slug||'.wissen.app.mintapis.com'),'created',extract(epoch from created_at)) ORDER BY slug) FROM tenants WHERE status='running'), '[]'::json),
 'provisioning', (SELECT count(*) FROM tenants WHERE status='provisioning' AND @OVERDUE_PROVISIONING@),
 'pending', (SELECT count(*) FROM tenants WHERE status='pending' AND @OVERDUE_PENDING@),
 'drafting', (SELECT count(*) FROM intake_items WHERE status='drafting' AND @OVERDUE_DRAFTING@),
 'stranded', COALESCE((SELECT json_agg(slug ORDER BY slug) FROM tenants
   WHERE desired_state='running' AND status NOT IN ('running','pending','provisioning')), '[]'::json),
 'unsuspended', COALESCE((SELECT json_agg(slug ORDER BY slug) FROM tenants
   WHERE desired_state='suspended' AND status='running'
     AND updated_at < now()-interval '30 minutes'), '[]'::json),
 -- The hourly in-application job deletes expired rate limits on every pass.
 -- A row still here two hours after it expired means that job is not running,
 -- which is otherwise invisible until a trial ends unreminded.
 'stale_cleanup', (SELECT count(*) FROM rate_limits WHERE expires_at < now()-interval '2 hours'),
 -- The mirror of 'unsuspended': that one catches a tenant contradicting what was
 -- ordered, this one catches the order itself never being updated. If the
 -- webhook that ends a subscription never arrives, desired_state stays running
 -- and somebody who cancelled keeps a workspace, with nothing contradicting
 -- itself for the other check to notice. Only unambiguous cases, and only after
 -- an hour, so the gap between webhook and sync is not reported as a fault.
 'unpaid_running', COALESCE((SELECT json_agg(te.slug ORDER BY te.slug) FROM tenants te
   JOIN subscriptions s ON s.team_id=te.team_id
   WHERE te.desired_state='running'
     AND (s.status IN ('canceled','incomplete_expired')
          OR (s.status='trialing' AND s.trial_end IS NOT NULL AND s.trial_end < now()))
     AND s.updated_at < now()-interval '1 hour'), '[]'::json),
 -- The cancellation form issues a receipt promising action within two working
 -- days. Nothing has ever read that table; an unhandled row is a promise we are
 -- already breaking, and the customer has a legal claim to it being kept.
 'cancellations', COALESCE((SELECT json_agg(id ORDER BY created_at) FROM cancellation_requests
   WHERE handled_at IS NULL AND created_at < now()-interval '24 hours'), '[]'::json),
 -- A trial that runs out while nobody was told is a customer lost in silence.
 -- The hourly job writes the notice; nothing until now checked that it did.
 'unreminded', COALESCE((SELECT json_agg(t.name ORDER BY t.name) FROM subscriptions s
   JOIN teams t ON t.id=s.team_id
   WHERE s.status='trialing' AND NOT s.has_payment_method
     AND s.trial_end IS NOT NULL
     AND s.trial_end BETWEEN now() AND now()+interval '2 days'
     AND NOT EXISTS (SELECT 1 FROM notifications n
       WHERE n.user_id=t.owner_user_id AND n.kind LIKE 'trial_ending%')), '[]'::json));
ROLLBACK;
"""
    query = (query
             .replace('@OVERDUE_PROVISIONING@', overdue('updated_at', 20))
             .replace('@OVERDUE_PENDING@', overdue('created_at', 15))
             .replace('@OVERDUE_DRAFTING@', overdue('updated_at', 30)))
    with tempfile.TemporaryDirectory(prefix='wissen-watchdog-tls-') as tmp:
        ca = Path(tmp) / 'ca.pem'
        ca.write_bytes(base64.b64decode(os.environ['DATABASE_SSL_CA_BASE64'], validate=True))
        ca.chmod(0o600)
        env['PGSSLROOTCERT'] = str(ca)
        result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
                                input=query, text=True, capture_output=True, env=env, timeout=30)
        if result.returncode:
            raise RuntimeError('Database check unavailable')
        return json.loads(result.stdout)


def http(url, health=False, contains=None):
    """A page counts as healthy only if it is still ours and shows its content.

    Status 200 alone proved too little: urlopen follows redirects, so a proxy
    could answer with a maintenance page, a different workspace or another site
    entirely and the check stayed green. The final host must therefore match the
    one we asked for, and the body must carry a marker only the real page has.
    """
    start = time.monotonic()
    request = urllib.request.Request(url, headers={'User-Agent': 'BookHost-Operator-Watchdog/1.0'})
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            return False
        if urlsplit(response.geturl()).hostname != urlsplit(url).hostname:
            return False
        if health:
            body = json.loads(response.read(65536))
            return body.get('db') is True and time.monotonic() - start < 5
        if contains is not None:
            body = response.read(262144).decode('utf-8', 'replace')
            return contains in body
        return True


# A backup that the watchdog counts must look like a backup, not merely carry
# the name of one. Before this check an empty file, a truncated archive, a
# directory called something.age or an archive whose signature had gone missing
# all reported "Backups: ok". The age comes from the timestamp in the file name,
# because a copy or a touch gives an old archive a fresh mtime.
BACKUP_KEY = Path('/home/flori/ventures2/bookstack/work/.backup.key')


def backup_key(path=BACKUP_KEY):
    """The key the provisioner signs archives with, or None if unreadable."""
    try:
        key = path.read_bytes()
    except OSError:
        return None
    return key or None


def authentic(archive, key):
    """Does the archive still match the signature written beside it?"""
    signature = archive.with_name(archive.name + '.hmac')
    try:
        expected = signature.read_text(errors='replace').strip()
        actual = hmac.new(key, archive.read_bytes(), hashlib.sha256).hexdigest()
    except OSError:
        return False
    return hmac.compare_digest(actual, expected)


MIN_BACKUP_BYTES = 4096
BACKUP_NAME = re.compile(r'^(\d{8}T\d{6}Z)\.age$')


def backup_time(path, now):
    """Seconds since this archive was taken, or None if it cannot be trusted."""
    match = BACKUP_NAME.match(path.name)
    if match:
        try:
            taken = dt.datetime.strptime(match.group(1), '%Y%m%dT%H%M%SZ').replace(
                tzinfo=dt.timezone.utc).timestamp()
        except ValueError:
            taken = None
        if taken is not None:
            # A timestamp in the future is not evidence of a fresh backup.
            return None if taken > now + 300 else now - taken
    # No usable timestamp in the name. The mtime is not a substitute: copying or
    # touching an archive would make it look like it was taken seconds ago.
    return None


def usable_backups(directory, now, key=None):
    """Archives that carry content and a signature, newest age first.

    With a key the signature is not merely present but verified, so a corrupted
    or swapped archive stops counting as a backup. Without one the check stays
    where it was; a missing operator key must not look like a backup failure.
    """
    ages = []
    for path in directory.glob('*.age'):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            if path.stat().st_size < MIN_BACKUP_BYTES:
                continue
            signature = path.with_name(path.name + '.hmac')
            if not signature.is_file() or signature.stat().st_size == 0:
                continue
        except OSError:
            continue
        if key is not None and not authentic(path, key):
            continue
        age = backup_time(path, now)
        if age is not None:
            ages.append(age)
    return sorted(ages)


def overdue(column, minutes):
    """SQL for "stuck for too long, or we cannot tell how long".

    A NULL timestamp never satisfies `<`, so a hung row with no timestamp used
    to be invisible; the provisioner schema allows NULL (default now(), no NOT
    NULL). A timestamp in the future is not evidence of progress either — it
    pushes detection out for as long as the clock is wrong. Both count as overdue.
    """
    return (f"({column} IS NULL OR {column} > now() "
            f"OR {column} < now()-interval '{minutes} minutes')")


def log_age(path, now, skew=300):
    """Seconds since this log was last written, or None if that cannot be trusted.

    The worker liveness check compares the log's age against three minutes. A
    modification time in the future makes that age negative, so the check would
    pass forever and a worker that had stopped would keep reading as healthy —
    the same trap backup_time already refuses for archive timestamps. Small
    skew is normal and tolerated; a stamp genuinely ahead of us is not evidence
    that anything ran.
    """
    try:
        written = path.stat().st_mtime
    except OSError:
        return None
    return None if written > now + skew else now - written


def tenant_capacity_state(count, limit, warn_at=0.8):
    """How close we are to refusing the next customer a workspace.

    The capacity guard lives in the worker, so it refuses *after* someone has
    been through checkout: their workspace simply queues while the dashboard
    says it will be ready shortly. The watchdog counted running tenants but
    never compared that count with the limit, so the first sign would have been
    a customer already waiting. Warn while there is still room to raise the
    limit or add disk; go red at the ceiling, because from there the next
    signup queues without anybody having decided that.
    """
    if not limit or limit <= 0:
        return True, f'laufende Tenants={count} (Grenze unbekannt)'
    text = f'laufende Tenants={count}/{limit:g}'
    if count >= limit:
        return False, text + ' — VOLL: die naechste Anmeldung wartet in der Schlange'
    if count >= limit * warn_at:
        return True, text + ' — WARNUNG: Kapazitaet fast erschoepft'
    return True, text


def stripe_config_state(log, now, stale=36 * 3600):
    """Whether the daily Stripe configuration check last passed.

    It guards three things nobody would otherwise notice: that every webhook
    event the code handles is subscribed, that the billing portal uses our own
    configuration rather than the shared account default, and that live
    subscriptions carry the VAT the pricing page promises. The run appends its
    exit code; a log that stopped growing is reported as such rather than as ok.
    """
    try:
        text = log.read_text(errors='replace').strip()
        age = now - log.stat().st_mtime
    except OSError:
        return 'Stripe-Konfiguration: nie geprueft'
    codes = [line for line in text.splitlines() if line.startswith('EXIT=')]
    stunden = int(age // 3600)
    if not codes:
        return 'Stripe-Konfiguration: ohne Ergebniszeile'
    if age >= stale:
        return f'Stripe-Konfiguration: seit {stunden} h nicht geprueft'
    if codes[-1] != 'EXIT=0':
        return f'Stripe-Konfiguration: BEANSTANDET ({codes[-1]})'
    return f'Stripe-Konfiguration: ok, geprueft vor {stunden} h'


def version_state(log, now, stale=36 * 3600):
    """Whether the BookStack we run is still the current release.

    The landing page promises we handle security updates. The image tag is
    pinned in one line and nothing bumps it, so a release could pass unnoticed.
    The daily check writes its verdict into its own file; this puts that verdict
    into the line an operator actually reads. Like the offsite line it does not
    turn the check red — a lag needs a decision, not an alarm every ten minutes
    — but a check that stopped running is reported as such rather than as ok.
    """
    try:
        text = log.read_text(errors='replace').strip()
        age = now - log.stat().st_mtime
    except OSError:
        return 'BookStack-Version: nie geprueft'
    if not text:
        return 'BookStack-Version: ohne Ausgabe'
    last = text.splitlines()[-1]
    stunden = int(age // 3600)
    if age >= stale:
        return f'BookStack-Version: seit {stunden} h nicht geprueft'
    if 'ZURUECK' in last:
        return f'BookStack-Version: ZURUECK ({last.strip()[:90]})'
    if 'FEHLER' in last:
        return f'BookStack-Version: Pruefung fehlgeschlagen ({last.strip()[:70]})'
    return f'BookStack-Version: aktuell, geprueft vor {stunden} h'


def offsite_state(log, now):
    """What the nightly offsite copy last did — it logs where nobody looks.

    All archives live on the same host as the workspaces. The offsite job runs
    every night and writes its outcome into its own file, so "Backups: ok" could
    be true every ten minutes while no copy had ever left the machine. This
    surfaces that fact in the line an operator actually reads. It deliberately
    does not turn the check red: a known, accepted gap must stay visible without
    crying wolf every ten minutes.
    """
    try:
        text = log.read_text(errors='replace').strip()
        age = now - log.stat().st_mtime
    except OSError:
        return 'Offsite: nie gelaufen'
    if not text:
        return 'Offsite: ohne Ausgabe'
    last = text.splitlines()[-1]
    stunden = int(age // 3600)
    # "Never set up" and "set up and broken" are different situations and need
    # different reactions: one waits for a decision about where the copies go,
    # the other is an incident. Reporting both as FEHLER every ten minutes
    # trains an operator to scroll past the line that would matter.
    if 'not configured' in last:
        return 'Offsite: nicht eingerichtet — kein Ziel gewaehlt (offenes Gate, kein Ausfall)'
    if 'ERROR' in last:
        return f'Offsite: FEHLER seit {stunden} h ({last[:80]})'
    return f'Offsite: ok vor {stunden} h'


def first_backup_grace(marker_age, tenant_age=None, grace=30 * 60):
    """Is a workspace still allowed to have no backup at all?

    Only while it is genuinely new. The rule used to look at the .initialized
    marker alone, and that file can be renewed: a workspace that had never been
    backed up stayed excused for as long as something kept touching it. The
    workspace's own age comes from the database row and cannot be touched from
    the file system; where it is unknown the marker still decides, so an older
    snapshot does not turn every workspace red.
    """
    if marker_age is None or marker_age > grace:
        return False
    return tenant_age is None or tenant_age <= grace


def recent_backup_errors(path, now):
    # Timestamped new logs; legacy un-timestamped lines use file mtime conservatively.
    modified = path.stat().st_mtime
    with path.open(errors='replace') as stream:
        for line in stream:
            if 'ERROR' not in line:
                continue
            try:
                when = dt.datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
            except (ValueError, IndexError):
                when = modified
            if now - when < 86400:
                return True
    return False


def recent_backup_fallbacks(path, now):
    """Count cold fallbacks in timestamped or conservatively mtime-stamped logs."""
    modified = path.stat().st_mtime
    count = 0
    with path.open(errors='replace') as stream:
        for line in stream:
            if 'BACKUP FALLBACK' not in line:
                continue
            try:
                when = dt.datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
            except (ValueError, IndexError):
                when = modified
            if now - when < 86400:
                count += 1
    return count


def checks():
    now = time.time()
    results = {}
    def check(label, fn):
        try:
            ok, detail = fn()
            results[label] = {'ok': bool(ok), 'detail': detail}
        except Exception:
            results[label] = {'ok': False, 'detail': 'Prüfung fehlgeschlagen; Verbindung/Konfiguration lokal prüfen'}
    base = os.environ.get('WATCHDOG_TEST_URL', 'https://bookhost.co/healthz')
    # healthz only runs SELECT 1, so it says nothing about whether customers can
    # actually sign in. The sign-in page has to render its form as well.
    login_probe = base.replace('/healthz', '/login')
    check(LABELS[0], lambda: (
        http(base, True) and http(login_probe, contains='name="password"'),
        'HTTP 200, db=true, <5s, Anmeldeformular vorhanden'))
    # The public demo is what visitors see; follow its configured host, not a fixed one.
    demo_url = os.environ.get('DEMO_URL', 'https://demo.bookhost.co')
    check(LABELS[1], lambda: (
        http(demo_url, contains='Read-only demo of BookHost'),
        'HTTP 200 mit Demo-Banner ' + demo_url))
    try:
        db = database()
        rows = [row if isinstance(row, dict) else {'slug': row} for row in db['running']]
        running = [row['slug'] for row in rows]
        hosts = {row['slug']: row.get('host') or row['slug'] + '.wissen.app.mintapis.com' for row in rows}
        # Age of the workspace itself, from the database. A file marker can be
        # renewed; the row's creation time cannot be touched from the file system.
        created = {row['slug']: row.get('created') for row in rows}
        if any(len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', host) for host in hosts.values()):
            raise ValueError('Invalid host')
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', slug) for slug in running):
            raise ValueError('Invalid slug')
    except Exception:
        db = None
        running = []
        created = {}
    def tenants():
        failed = []
        for slug in running:
            try:
                if http(f'https://{hosts[slug]}/login', contains='name="password"'):
                    continue
            except Exception:
                pass
            failed.append(slug)
        return db is not None and not failed, f'{len(running)} running; fehlgeschlagen: ' + (', '.join(failed) or 'keine')
    check(LABELS[2], tenants)
    check(LABELS[3], lambda: provisioning_state(db))
    def backups():
        failed = []
        pending = []
        key = backup_key()
        for slug in running:
            tenant = ROOT / slug
            ages = usable_backups(tenant / 'backups', now, key)
            if not ages:
                marker = tenant / '.initialized'
                age = now - marker.stat().st_mtime if marker.exists() else None
                born = created.get(slug)
                if first_backup_grace(age, None if born is None else now - float(born)):
                    pending.append(f'{slug} (erstbackup ausstehend ({max(0, int((age or 0) // 60))} min))')
                else:
                    failed.append(slug)
            elif ages[0] >= 26 * 3600:
                failed.append(slug)
        errors = recent_backup_errors(ROOT / 'backup.log', now)
        fallbacks = recent_backup_fallbacks(ROOT / 'backup.log', now)
        detail = ('signaturgeprueft; ' if key else 'Signatur UNGEPRUEFT (Schluessel nicht lesbar); ')
        detail += f'fehlend/veraltet: {", ".join(failed) or "keine"}'
        detail += '; ' + offsite_state(ROOT / 'offsite.log', now)
        if pending:
            detail += '; ausstehend: ' + ', '.join(pending)
        return db is not None and not failed and not errors, detail + f'; ERROR letzte 24h={errors}; fallback cold letzte 24h={fallbacks}'
    check(LABELS[4], backups)
    def host():
        config = thresholds(capacity_limits())
        disk = disk_state(ROOT)
        percent = disk['used_percent']
        count = running_tenants()
        age = log_age(ROOT / 'worker.log', now)
        capacity_ok, capacity = tenant_capacity_state(count, config.get('MAX_TENANTS'))
        warning = 'WARNUNG: Plattenreserve knapp; ' if percent >= config['DISK_WARN_PERCENT'] else ''
        if age is None:
            return False, (warning + f"Platte={percent:.1f}%; frei={disk['free_gib']:.1f} GiB; "
                           + capacity + '; Worker-Log: Alter nicht vertrauenswuerdig '
                           '(fehlt oder Zeitstempel in der Zukunft); '
                           + version_state(ROOT / 'bookstack-version.log', now) + '; '
            + stripe_config_state(ROOT / 'stripe-config.log', now))
        return percent < config['DISK_FAIL_PERCENT'] and age < 180 and capacity_ok, (
            warning + f"Platte={percent:.1f}%; frei={disk['free_gib']:.1f} GiB; "
            + capacity + f'; Worker-Log={age:.0f}s alt; '
            + version_state(ROOT / 'bookstack-version.log', now) + '; '
            + stripe_config_state(ROOT / 'stripe-config.log', now))
    check(LABELS[5], host)
    check(LABELS[6], lambda: background_state(db))
    return results


def save(path, state):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        json.dump(state, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def simulate():
    state = None
    deliveries = []
    now = time.time()
    for index, ok in enumerate([True, False, False, False, True, True]):
        state, event = transition(state, ok, now + index * 600)
        print(f'SIMULATION Lauf {index + 1}: {state["status"]}; Ereignis={event or "keines"}')
        if event:
            text = message('Test-Prüfung', state, event)
            deliveries.append(event)
            print('TEST-Empfänger (nur stdout):\n' + text)
    assert deliveries == ['failure', 'recovery']
    print('SIMULATION OK: genau eine Fehlermeldung beim zweiten Fehlerlauf und eine Erholung; keine Telegram-Anfrage')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--simulate', action='store_true')
    args = parser.parse_args()
    if args.simulate and not args.dry_run:
        parser.error('--simulate requires --dry-run')
    if os.environ.get('WATCHDOG_TEST_URL') and not args.dry_run:
        parser.error('WATCHDOG_TEST_URL requires --dry-run')
    os.umask(0o077)
    if args.dry_run:
        results = checks()
        for label, result in results.items():
            print(f'{label}: {"ok" if result["ok"] else "fail"} — {result["detail"]}')
        if args.simulate:
            simulate()
        return 0 if all(r['ok'] for r in results.values()) else 1
    ROOT.mkdir(exist_ok=True)
    with (ROOT / '.watchdog.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        path = ROOT / '.watchdog-state.json'
        # Fail closed on corrupt state: do not silently reset and duplicate alerts.
        state = json.loads(path.read_text()) if path.exists() else {}
        results = checks()
        for label, result in results.items():
            candidate, event = transition(state.get(label), result['ok'], time.time())
            print(f'{stamp(time.time())} {label}: {"ok" if result["ok"] else "fail"} — {result["detail"]}', flush=True)
            if event:
                try:
                    send(message(label, candidate, event))
                except Exception:
                    print(f'{stamp(time.time())} Telegram-Zustellung fehlgeschlagen: {label}; nächster Lauf versucht erneut', flush=True)
                    continue
            state[label] = candidate
            save(path, state)
        return 0 if all(r['ok'] for r in results.values()) else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(f'{stamp(time.time())} Watchdog konnte nicht abgeschlossen werden; lokale Konfiguration/Zustandsdatei prüfen', flush=True)
        raise SystemExit(2)
