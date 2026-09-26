#!/usr/bin/env python3
"""Install and revoke dashboard-created agent API tokens inside tenant BookStack.

BookStack has no API for creating API tokens, so the control plane queues the
request in `agents` and this worker step applies it with the tenant's own PHP
runtime. The secret travels only encrypted (tenant-bound AES-GCM) through the
database and is removed as soon as the token is installed. Diagnostics never
contain names, tokens or secrets.
"""
from tenant import ROOT, valid_slug, php
from bookstack_api_token import decrypt, kms_key

FORBIDDEN_ROLES = ('admin', 'public', 'wissen-intake', 'bookhost-agent-api')
STALE_MINUTES = 15

INSTALL = r"""
$v=json_decode(stream_get_contents(STDIN),true);
$forbidden=['admin','public','wissen-intake','bookhost-agent-api'];
$role=BookStack\Users\Models\Role::find($v['role_id']);
if(!$role || in_array((string)$role->system_name,$forbidden,true) || $role->display_name==='BookHost Intake'){ echo json_encode(['error'=>'role']); return; }
$api=BookStack\Users\Models\Role::where('system_name','bookhost-agent-api')->first();
$fresh=!$api;
if($fresh){ $api=new BookStack\Users\Models\Role(); }
$api->forceFill(['system_name'=>'bookhost-agent-api','display_name'=>'BookHost agent API access','description'=>'Lets BookHost agent users call the BookStack API. Grants no content access by itself; content access comes from the agent\'s other role.']); $api->save();
$perm=BookStack\Permissions\Models\RolePermission::where('name','access-api')->pluck('id');
if(count($perm)!==1) throw new RuntimeException('Missing access-api permission');
$api->permissions()->sync($perm);
if($fresh){ app(BookStack\Permissions\JointPermissionBuilder::class)->rebuildForRole($api); }
$out=Illuminate\Support\Facades\DB::transaction(function() use ($v,$role,$api) {
  $u=BookStack\Users\Models\User::where('email',$v['email'])->first();
  if(!$u){ $u=new BookStack\Users\Models\User(); $u->slug='agent-'.bin2hex(random_bytes(6)); }
  $u->forceFill(['name'=>$v['name'],'email'=>$v['email'],'password'=>'','email_confirmed'=>true]); $u->save();
  $u->roles()->sync([$role->id,$api->id]);
  BookStack\Api\ApiToken::where('token_id',$v['token_id'])->delete();
  $t=(new BookStack\Api\ApiToken())->forceFill(['name'=>'BookHost agent access','token_id'=>$v['token_id'],'secret'=>Illuminate\Support\Facades\Hash::make($v['secret']),'user_id'=>$u->id,'expires_at'=>BookStack\Api\ApiToken::defaultExpiry()]); $t->save();
  return ['user_id'=>$u->id];
});
echo json_encode($out);
"""

REVOKE = r"""
$v=json_decode(stream_get_contents(STDIN),true);
BookStack\Api\ApiToken::where('token_id',$v['token_id'])->delete();
echo json_encode(['ok'=>true]);
"""


def _tenant_ready(slug):
    if not (valid_slug(slug) or slug == 'demo'):
        return False
    path = ROOT / slug
    return not path.is_symlink() and (path / '.initialized').exists() and (path / 'docker-compose.yml').exists()


def _json(raw):
    import json
    return json.loads(raw.decode().strip().splitlines()[-1])


def install(db, row, key, run_php=php):
    ident, slug, name, role_id, token_id, secret_enc = row
    if not _tenant_ready(slug):
        return 'skip'
    secret = decrypt(secret_enc, slug, key)
    result = _json(run_php(ROOT / slug, INSTALL, {
        'role_id': int(role_id),
        'name': (name + ' (agent)')[:100],
        'email': 'agent-' + str(ident).replace('-', '')[:16] + '@agents.bookhost.invalid',
        'token_id': token_id,
        'secret': secret,
    }))
    if result.get('error') == 'role':
        db.execute("UPDATE agents SET status='failed',pending_secret_enc=NULL,error=%s,updated_at=now() WHERE id=%s AND status='pending'",
                   ('The chosen BookStack role cannot be given to an agent. Create the agent again with another role.', ident))
        return 'failed'
    user_id = int(result['user_id'])
    updated = db.execute("UPDATE agents SET status='active',pending_secret_enc=NULL,bookstack_user_id=%s,error=NULL,updated_at=now() WHERE id=%s AND status='pending' RETURNING id",
                         (user_id, ident)).fetchone()
    if not updated:
        # Revoked while we installed it: never leave a live token behind.
        run_php(ROOT / slug, REVOKE, {'token_id': token_id})
        return 'revoked'
    return 'active'


def revoke(db, row, run_php=php):
    ident, slug, token_id = row
    if _tenant_ready(slug):
        run_php(ROOT / slug, REVOKE, {'token_id': token_id})
    elif (ROOT / slug).exists():
        return 'skip'
    # A workspace without an instance has no token left to delete.
    db.execute("UPDATE agents SET status='revoked',pending_secret_enc=NULL,revoked_at=now(),updated_at=now() WHERE id=%s AND status='revoke_requested'", (ident,))
    return 'revoked'


def reconcile_agents(db, instance, run_php=php):
    """One pass: install pending tokens, then delete revoked ones."""
    try:
        exists = db.execute("SELECT to_regclass('public.agents')").fetchone()[0]
    except Exception:
        return
    if not exists:
        return
    pending = db.execute(
        "SELECT a.id,t.slug,a.name,a.role_id,a.token_id,a.pending_secret_enc FROM agents a JOIN tenants t ON t.id=a.tenant_id "
        "WHERE a.status='pending' AND a.pending_secret_enc IS NOT NULL AND t.status='running' AND COALESCE(t.provisioner_instance,'production')=%s "
        "ORDER BY a.created_at LIMIT 20", (instance,)).fetchall()
    key = kms_key() if pending else None
    for row in pending:
        try:
            install(db, row, key, run_php)
        except Exception:
            print('Agent token install failed; retry next run', flush=True)
    db.execute(
        "UPDATE agents SET status='failed',pending_secret_enc=NULL,error=%s,updated_at=now() WHERE status='pending' AND created_at<now()-make_interval(mins => %s)",
        ('Setting up this agent took too long. Revoke it and create a new one.', STALE_MINUTES))
    revoking = db.execute(
        "SELECT a.id,t.slug,a.token_id FROM agents a JOIN tenants t ON t.id=a.tenant_id "
        "WHERE a.status='revoke_requested' AND t.status='running' AND COALESCE(t.provisioner_instance,'production')=%s ORDER BY a.updated_at LIMIT 50", (instance,)).fetchall()
    for row in revoking:
        try:
            revoke(db, row, run_php)
        except Exception:
            print('Agent token revoke failed; retry next run', flush=True)
