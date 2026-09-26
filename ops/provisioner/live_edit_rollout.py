#!/usr/bin/env python3
"""Install the Live Edit BookStack theme route for a tenant that enabled the beta.

BookStack has no API for the Logical Theme System or its own env vars, so this
worker step (like agent_tokens.py for API tokens) applies the change with the
tenant's own PHP runtime and a surgical docker-compose.yml edit, then restarts
just the bookstack service. Every step is read-verify-apply-verify; any
failure restores the original .env and docker-compose.yml and leaves the
tenant running on its old configuration, never half-migrated.
"""
import json
import re
import shlex
import urllib.request
from pathlib import Path

from tenant import ROOT, compose, env_read, php, ready_internal, valid_slug
from bookstack_api_token import decrypt, kms_key

THEME_SOURCE = Path(__file__).resolve().parent / 'themes' / 'live-edit' / 'functions.php'
STALE_MINUTES = 20

SET_CUSTOM_HEAD = r"""
$v=json_decode(stream_get_contents(STDIN),true);
app('BookStack\Settings\SettingService')->put('app-custom-head', $v['html']);
echo json_encode(['ok'=>true]);
"""

# Wrapped in markers so a future feature that also needs app-custom-head can
# find and preserve this block instead of overwriting it wholesale, the way
# ops/provisioner/demo-publish.py currently does for the (separate, demo-only)
# banner.
def _head_snippet():
    return (
        '<!-- bookhost-live-edit:start -->'
        '<script src="https://bookhost.co/live-edit/embed.js" async></script>'
        '<!-- bookhost-live-edit:end -->'
    )


def _tenant_ready(slug):
    if not valid_slug(slug):
        return False
    path = ROOT / slug
    return not path.is_symlink() and (path / '.initialized').exists() and (path / 'docker-compose.yml').exists()


def _env_write(path, updates):
    ef = path / '.env'
    lines = ef.read_text().splitlines(keepends=True)
    seen = set()
    out = []
    for line in lines:
        match = re.match(r'^([A-Z_][A-Z0-9_]*)=', line)
        if match and match.group(1) in updates:
            out.append(match.group(1) + '=' + shlex.quote(updates[match.group(1)]) + '\n')
            seen.add(match.group(1))
        else:
            out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(key + '=' + shlex.quote(value) + '\n')
    ef.write_text(''.join(out))


def _probe_ticket_route(url):
    """Confirm the theme route is really registered, not just that BookStack answers.

    An anonymous request must never see ticket JSON: BookStack's own `auth`
    middleware should redirect it to the login page first (urllib follows
    redirects transparently, same as tenant.py's public_ready() check), and a
    request to a URL BookStack doesn't recognise at all would 404 instead —
    both distinguishable from a real "did the theme route register" success.
    """
    request = urllib.request.Request(url.rstrip('/') + '/live-edit/ticket/999999999')
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read()
            return response.status == 200 and b'name="_token"' in body and b'/login"' in body
    except Exception:
        return False


def install(path, secret, *, compose_fn=compose, ready_fn=ready_internal, php_fn=php, probe_fn=_probe_ticket_route):
    slug = path.name
    original_env = (path / '.env').read_bytes()
    original_compose = (path / 'docker-compose.yml').read_bytes()
    try:
        theme_dir = path / 'bookstack' / 'www' / 'themes' / 'live-edit'
        theme_dir.mkdir(parents=True, exist_ok=True)
        (theme_dir / 'functions.php').write_text(THEME_SOURCE.read_text())

        _env_write(path, {
            'APP_THEME': 'live-edit',
            'LIVE_EDIT_TENANT_SLUG': slug,
            'LIVE_EDIT_HMAC_SECRET': secret,
        })
        document = json.loads((path / 'docker-compose.yml').read_text())
        environment = document['services']['bookstack']['environment']
        for key in ('APP_THEME', 'LIVE_EDIT_TENANT_SLUG', 'LIVE_EDIT_HMAC_SECRET'):
            environment[key] = '${' + key + '}'
        (path / 'docker-compose.yml').write_text(json.dumps(document, indent=2) + '\n')

        # --no-deps: db must never be touched by this; recreate only picks up
        # the new environment because docker compose diffs the resolved config.
        compose_fn(path, 'up', '-d', '--no-deps', '--force-recreate', 'bookstack')
        ready_fn(path)

        url = env_read(path / '.env')['APP_URL']
        if not probe_fn(url):
            raise RuntimeError('Live Edit theme route did not come up')

        php_fn(path, SET_CUSTOM_HEAD, {'html': _head_snippet()})
        return True
    except BaseException:
        (path / '.env').write_bytes(original_env)
        (path / 'docker-compose.yml').write_bytes(original_compose)
        try:
            compose_fn(path, 'up', '-d', '--no-deps', '--force-recreate', 'bookstack')
            ready_fn(path)
        except Exception:
            print('LIVE-EDIT ROLLBACK RECOVERY FAILED ' + slug, flush=True)
        raise


def reconcile_live_edit(db, instance, run_php=php):
    pending = db.execute(
        "SELECT s.tenant_id,n.slug,s.hmac_secret_enc FROM live_edit_settings s JOIN tenants n ON n.id=s.tenant_id "
        "WHERE s.rollout_status='pending' AND n.status='running' AND COALESCE(n.provisioner_instance,'production')=%s "
        "ORDER BY s.updated_at LIMIT 5", (instance,)).fetchall()
    for tenant_id, slug, secret_enc in pending:
        path = ROOT / slug
        if not _tenant_ready(slug):
            continue
        try:
            secret = decrypt(secret_enc, slug, kms_key())
            install(path, secret)
            db.execute(
                "UPDATE live_edit_settings SET rollout_status='ready',rollout_error=NULL,updated_at=now() WHERE tenant_id=%s AND rollout_status='pending'",
                (tenant_id,))
        except Exception as exc:
            print('LIVE-EDIT ROLLOUT FAILED ' + slug, flush=True)
            db.execute(
                "UPDATE live_edit_settings SET rollout_status='failed',rollout_error=%s,updated_at=now() WHERE tenant_id=%s AND rollout_status='pending'",
                ('Turning on Live Edit failed; it was rolled back safely and your workspace is unaffected. Try again or contact support.', tenant_id))
    db.execute(
        "UPDATE live_edit_settings s SET rollout_status='failed',rollout_error=%s,updated_at=now() FROM tenants n "
        "WHERE n.id=s.tenant_id AND COALESCE(n.provisioner_instance,'production')=%s AND s.rollout_status='pending' AND s.updated_at<now()-make_interval(mins => %s)",
        ('Turning on Live Edit took too long. Try again.', instance, STALE_MINUTES))
