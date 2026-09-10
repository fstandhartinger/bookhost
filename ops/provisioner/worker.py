#!/usr/bin/env python3
"""Serialized lifecycle reconciliation; diagnostics never contain credentials."""
import argparse
import fcntl
import os
import signal
import subprocess
import time
import sys
from pathlib import Path
from urllib.parse import urlsplit
import psycopg
from tenant import HERE, ROOT, env_read, valid_slug, compose
from bookstack_api_token import store_token
from capacity import disk_state, running_tenants, thresholds, CUSTOMER_ERROR

DEFAULT_RESERVED_TEST_PREFIXES = ('rc-', 'fb-', 'nh-', 'dom-', 'bh-', 'tmp-', 'test-')

def limits():
    """Operator config is untracked; a missing file must fall back to defaults."""
    path=HERE/'limits.env'
    return env_read(path) if path.exists() else {}


def reserved_test_prefixes():
    raw = limits().get('RESERVED_TEST_PREFIXES', ','.join(DEFAULT_RESERVED_TEST_PREFIXES))
    return tuple(prefix.strip() for prefix in raw.split(',') if prefix.strip())

def is_reserved_test_slug(slug):
    return slug.startswith(reserved_test_prefixes())


def command(action, slug, email=None):
    args=[sys.executable,str(HERE/'tenant.py'),action,slug]
    if email: args.append(email)
    process=subprocess.Popen(['timeout','--kill-after=20s','1100s',*args],
                             start_new_session=True, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        code=process.wait(timeout=1130)
        if code: raise RuntimeError('Lifecycle command failed')
    except BaseException:
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL); process.wait()
        raise


def capacity():
    try:
        config=thresholds(limits())
        disk=disk_state(ROOT)
        count=running_tenants()
        if (disk['free_gib'] >= config['MIN_FREE_DISK_GB']
                and disk['used_percent'] < config['MAX_DISK_PERCENT']
                and count < config['MAX_TENANTS']):
            return True
        print(f"Capacity: new workspace refused; running={count}, MAX_TENANTS={config['MAX_TENANTS']:g}, "
              f"free_GiB={disk['free_gib']:.2f}, MIN_FREE_DISK_GB={config['MIN_FREE_DISK_GB']:g}, "
              f"used_percent={disk['used_percent']:.2f}, MAX_DISK_PERCENT={config['MAX_DISK_PERCENT']:g}",flush=True)
    except Exception:
        # Fail closed without exposing command output or configuration secrets.
        print('Capacity: new workspace refused; disk/count/configuration check unavailable',flush=True)
    return False


def sync_destroy_marker(path, contract_ended_at, desired):
    """Couple contract retention to the tenant lifecycle lock."""
    if not path.is_dir() or path.is_symlink(): return
    locks=path.parent/'.locks'; locks.mkdir(exist_ok=True)
    with (locks/(path.name+'.lock')).open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        # Purge may have removed the tenant while we waited for its lock.
        if not path.is_dir() or path.is_symlink(): return
        marker=path/'.destroy_requested_at'; ownership=path/'.contract_end_destroy'
        if desired == 'running':
            if ownership.exists():
                marker.unlink(missing_ok=True); ownership.unlink(missing_ok=True)
                directory=os.open(path,os.O_RDONLY)
                try: os.fsync(directory)
                finally: os.close(directory)
            return
        # A pre-existing operator marker remains operator-owned and is never
        # removed by a later paid resume.
        if contract_ended_at is None or desired != 'suspended' or (marker.exists() and not ownership.exists()): return
        timestamp=contract_ended_at.timestamp() if hasattr(contract_ended_at,'timestamp') else float(contract_ended_at)
        stamp=str(int(timestamp)) if timestamp.is_integer() else str(timestamp)
        # Ownership goes first: a crash can leave an inert companion, whereas a
        # marker written first could be mistaken for an operator request.
        for target in (ownership,marker):
            temporary=target.with_name(target.name+'.tmp')
            with temporary.open('w') as output:
                output.write(stamp); output.flush(); os.fsync(output.fileno())
            os.replace(temporary,target)
        directory=os.open(path,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)


def once():
    instance = os.environ.get('PROVISIONER_INSTANCE', 'production')
    dsn=env_read(Path('/home/flori/ventures2/bookstack/work/.app.env'))['DATABASE_URL_LOCAL']
    with psycopg.connect(dsn,autocommit=True) as db:
        # Schema bootstrap is operator/production work, never a test queue mutation.
        if instance == 'production':
            db.execute((HERE/'schema.sql').read_text())
        # run-worker.sh flock spans the whole command: no live worker is reclaimed.
        stale=db.execute("SELECT id,slug FROM tenants WHERE COALESCE(provisioner_instance,'production')=%s AND status='provisioning' AND updated_at < now()-interval '20 minutes'",(instance,)).fetchall()
        for ident,slug in stale:
            if (ROOT/slug/'.import-quarantine.json').exists():
                db.execute("UPDATE tenants SET status='failed',error='import_quarantined',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='provisioning'",(instance,ident,))
                print('Stale tenant skipped; import quarantine requires operator validation: '+slug,flush=True)
                continue
            try:
                if valid_slug(slug) or slug=='demo':
                    if (ROOT/slug/'docker-compose.yml').exists(): command('deprovision',slug)
            except Exception:
                print('Timeout cleanup failed; retry next run',flush=True); continue
            db.execute("UPDATE tenants SET status='failed',error='timeout',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='provisioning'",(instance,ident,))
        rows=db.execute("SELECT n.id,n.slug,n.admin_email,n.status,n.desired_state,n.provisioner_instance,s.contract_ended_at FROM tenants n LEFT JOIN effective_subscriptions s ON s.team_id=n.team_id WHERE COALESCE(provisioner_instance,'production')=%s AND n.status IN ('pending','running','suspended','failed') ORDER BY n.created_at",(instance,)).fetchall()
        for tenant_row in rows:
            ident,slug,email,status,desired = tenant_row[:5]
            provisioner_instance = tenant_row[5] if len(tenant_row) > 5 else None
            if (provisioner_instance or 'production') != instance:
                print('Tenant skipped; provisioner instance mismatch: '+slug,flush=True)
                continue
            if status == 'pending' and is_reserved_test_slug(slug):
                db.execute("UPDATE tenants SET status='failed',error='Reserved test slug; provision manually in an isolated checkout',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='pending'",(instance,ident,))
                print('Tenant rejected; reserved test slug: '+slug,flush=True)
                continue
            existing=(ROOT/slug/'.initialized').exists() if valid_slug(slug) or slug=='demo' else False
            # Existing operator-owned demo is allowed only for lifecycle actions.
            if not valid_slug(slug) and not (slug=='demo' and existing and status!='pending'):
                if status=='pending':
                    db.execute("UPDATE tenants SET status='failed',error='Invalid or reserved slug: use 3-30 lowercase letters/digits, single hyphens, no restore prefix',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='pending'",(instance,ident,))
                continue
            path=ROOT/slug
            # An import quarantine records a failed recovery. Do not make any
            # automatic lifecycle change while the on-disk state is uncertain.
            if (path/'.import-quarantine.json').exists():
                db.execute("UPDATE tenants SET status='failed',error='import_quarantined',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s",(instance,ident,))
                print('Tenant skipped; import quarantine requires operator validation: '+slug,flush=True)
                continue
            contract_ended_at = tenant_row[6] if len(tenant_row) > 6 else None
            sync_destroy_marker(path, contract_ended_at, desired)
            if status == 'failed': continue
            # A paid resume must never silently create an empty replacement or
            # loop forever against a durable destruction tombstone.
            destroyed=((path/'.destroy_requested_at').exists() and not (path/'.contract_end_destroy').exists()) or (ROOT/'.destroy-requests'/slug).exists()
            missing_resume=status=='suspended' and desired=='running' and (
                not existing or not (path/'.env').exists() or not (path/'docker-compose.yml').exists())
            if destroyed or missing_resume:
                try:
                    if (path/'docker-compose.yml').exists(): command('deprovision',slug)
                    db.execute("UPDATE tenants SET status='failed',error='workspace_unavailable',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s",(instance,ident,))
                except Exception: print('Unavailable workspace cleanup failed; retry next run',flush=True)
                continue
            if desired=='suspended':
                try:
                    if (path/'docker-compose.yml').exists(): command('deprovision',slug)
                    db.execute("UPDATE tenants SET status='suspended',error=NULL,updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status IN ('running','pending','suspended')",(instance,ident,))
                except Exception: print('Suspend failed; retry next run',flush=True)
                continue
            # Honor legacy status=suspended before resume, also stopping any remnants.
            if status=='suspended' and (path/'docker-compose.yml').exists(): command('deprovision',slug)
            if status not in ('pending','suspended'): continue
            # Only new workspaces consume admission capacity. Existing lifecycle
            # operations (including pending recovery) must remain available.
            if not existing and not capacity():
                db.execute("UPDATE tenants SET status='failed',error=%s,updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status=%s",
                           (CUSTOMER_ERROR,instance,ident,status))
                continue
            row=db.execute("UPDATE tenants SET status='provisioning',error=NULL,updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status=%s AND desired_state='running' RETURNING id",(instance,ident,status)).fetchone()
            if not row: continue
            try:
                command('provision',slug,email)
                try:
                    store_token(db, ident, slug, instance=instance)
                except Exception:
                    print("Intake token setup failed; healthy tenant remains available", flush=True)
                values=env_read(path/'.env')
                # The persisted APP_URL also preserves legacy hosts on resume.
                host=urlsplit(values['APP_URL']).hostname
                if existing:
                    db.execute("UPDATE tenants SET status='running',host=%s,bookstack_url=%s,error=NULL,updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='provisioning'",(host,values['APP_URL'],instance,ident))
                else:
                    db.execute("UPDATE tenants SET status='running',host=%s,bookstack_url=%s,initial_password=%s,error=NULL,updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='provisioning'",(host,values['APP_URL'],values['BOOKSTACK_ADMIN_PASSWORD'],instance,ident))
                # Billing may change desired_state while provision runs; next pass reconciles.
                print('Tenant running: '+slug,flush=True)
            except Exception:
                try:
                    if (path/'docker-compose.yml').exists(): command('deprovision',slug)
                finally:
                    db.execute("UPDATE tenants SET status='failed',error='Provisioning failed; inspect tenant locally and retry pending',updated_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s AND status='provisioning'",(instance,ident,))
                print('Tenant failed; diagnostics withheld',flush=True)
            return


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--once',action='store_true'); p.add_argument('--cron',action='store_true'); args=p.parse_args()
    start=time.monotonic()
    while True:
        try:
            once()
            print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " Worker check completed", flush=True)
        except Exception:
            print('Worker database/configuration failure; details withheld',flush=True); raise SystemExit(1)
        if args.once or (args.cron and time.monotonic()-start>=30): break
        time.sleep(30)
