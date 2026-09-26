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
import os
import re
import shlex
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from tenant import ROOT, compose, env_read, php, ready_internal, valid_slug
from bookstack_api_token import decrypt, kms_key

THEME_SOURCE = Path(__file__).resolve().parent / 'themes' / 'live-edit' / 'functions.php'
STALE_MINUTES = 20

# Read-modify-write, not a blind overwrite: preserves any pre-existing
# app-custom-head content (a tenant could already use Custom HTML Head
# Content for something else). Idempotent re-runs replace only our own
# marked block instead of appending a duplicate.
SET_CUSTOM_HEAD = r"""
$v=json_decode(stream_get_contents(STDIN),true);
$service=app('BookStack\Settings\SettingService');
$existing=(string)$service->get('app-custom-head','');
$start='<!-- bookhost-live-edit:start -->';
$end='<!-- bookhost-live-edit:end -->';
$startPos=strpos($existing,$start);
$endPos=strpos($existing,$end);
if($startPos!==false && $endPos!==false && $endPos>$startPos){
$next=substr($existing,0,$startPos).$v['html'].substr($existing,$endPos+strlen($end));
}else{
$next=rtrim($existing)."\n".$v['html'];
}
$service->put('app-custom-head', ltrim($next));
echo json_encode(['ok'=>true]);
"""

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


def _compose_environment(document):
    value = document.get('services', {}).get('bookstack', {}).get('environment', {})
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        result = {}
        for item in value:
            if not isinstance(item, str):
                continue
            key, separator, setting = item.partition('=')
            if key:
                result[key] = setting if separator else None
        return result
    return {}


def _resolve_compose_value(value, env_values):
    """Resolve the Compose interpolation forms relevant to APP_THEME.

    Unknown or malformed interpolation is kept as a non-empty value so the
    caller fails closed instead of replacing a theme it cannot identify.
    """
    if value is None:
        value = ''
    if not isinstance(value, str):
        return str(value)

    def variable(match):
        name, operator, default = match.groups()
        configured = env_values.get(name)
        if configured is None:
            configured = os.environ.get(name)
        if operator == ':-':
            return configured if configured else (default or '')
        if operator == '-':
            return configured if configured is not None else (default or '')
        if configured is not None:
            return configured
        return '' if name == 'APP_THEME' else '__unresolved_compose_value__'

    resolved = re.sub(
        r'\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-)([^}]*))?\}', variable, value)
    # Bare $VARIABLE interpolation is also valid Compose syntax.
    resolved = re.sub(
        r'\$([A-Za-z_][A-Za-z0-9_]*)',
        lambda match: env_values.get(
            match.group(1),
            os.environ.get(
                match.group(1),
                '' if match.group(1) == 'APP_THEME' else '__unresolved_compose_value__',
            ),
        ),
        resolved,
    )
    return resolved


def _configured_themes(path):
    env_values = env_read(path / '.env')
    env_theme = env_values.get('APP_THEME', '').strip()
    try:
        compose_doc = json.loads((path / 'docker-compose.yml').read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError('Could not safely inspect the existing BookStack theme configuration') from exc
    compose_env = _compose_environment(compose_doc)
    compose_theme = ''
    if 'APP_THEME' in compose_env:
        compose_theme = _resolve_compose_value(compose_env['APP_THEME'], env_values).strip()
    return env_theme, compose_theme


def _probe_ticket_route(url):
    """Confirm the theme route is really registered, not just that BookStack answers.

    An anonymous request must never see ticket JSON: BookStack's own `auth`
    middleware redirects it to the login page (urllib follows redirects).
    BookStack 26.05's login page no longer includes the `_token` form field
    used by older versions, so identify the redirect by its final URL and
    login-page markers. An unregistered path remains an HTTP 404.
    """
    request = urllib.request.Request(url.rstrip('/') + '/live-edit/ticket/999999999')
    # ready_internal() confirms migrations but not that nginx and the public
    # proxy have finished switching to the recreated service. Retry transient
    # 404/502/network responses for a bounded window while the service starts.
    for attempt in range(12):
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                body = response.read()
                if (
                    response.status == 200
                    and urlparse(response.geturl()).path.rstrip('/') == '/login'
                    and b'<title>BookStack' in body
                    and b'>Log in<' in body
                ):
                    return True
        except Exception:
            pass
        if attempt < 11:
            time.sleep(2)
    return False


def install(path, secret, *, compose_fn=compose, ready_fn=ready_internal, php_fn=php, probe_fn=_probe_ticket_route):
    slug = path.name
    original_env = (path / '.env').read_bytes()
    original_compose = (path / 'docker-compose.yml').read_bytes()
    # BookStack supports exactly one active theme; refuse before changing
    # anything rather than silently replacing a tenant's own customization.
    existing_themes = _configured_themes(path)
    existing_theme = next(
        (theme for theme in existing_themes if theme and theme != 'live-edit'),
        '',
    )
    if existing_theme:
        raise RuntimeError(
            'This workspace already uses a custom BookStack theme (APP_THEME=%s); '
            'Live Edit cannot be enabled automatically. Contact support.' % existing_theme)
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
