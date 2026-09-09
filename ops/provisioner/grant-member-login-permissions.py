#!/usr/bin/env python3
"""Grant only member-login permissions to an existing intake role; safe to repeat.
Run manually during rollout. Does not create users, rotate tokens or restart services.
"""
import fcntl
import sys
from tenant import ROOT, valid_slug, php


def grant(slug):
    if not valid_slug(slug) and slug != 'demo':
        raise ValueError('Invalid tenant slug')
    path = ROOT / slug
    if path.is_symlink() or not (path / '.initialized').is_file():
        raise ValueError('Tenant is not initialized')
    locks = ROOT / '.locks'
    locks.mkdir(exist_ok=True)
    with (locks / (slug + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # tenant.php() runs PHP as uid/gid 1000:1000 and bootstraps Laravel.
        php(path, r'''
Illuminate\Support\Facades\DB::transaction(function() {
$role=BookStack\Users\Models\Role::where('system_name','wissen-intake')->first()
    ?? BookStack\Users\Models\Role::whereIn('display_name',['BookHost Intake','Wissen Intake'])->first();
if (!$role) throw new RuntimeException('Intake role not found');
$names=['users-manage','user-roles-manage'];
$permissions=BookStack\Permissions\Models\RolePermission::whereIn('name',$names)->pluck('id');
if (count($permissions)!==count($names)) throw new RuntimeException('Member login permissions not found');
$role->permissions()->syncWithoutDetaching($permissions);
});
app(BookStack\Permissions\JointPermissionBuilder::class)->rebuildForAll();
''')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: grant-member-login-permissions.py <slug>')
        grant(sys.argv[1])
        print('Member login permissions granted; existing permissions preserved.')
    except Exception:
        print('Grant failed. Check the tenant slug, initialization and intake role locally. Credentials withheld.', file=sys.stderr)
        sys.exit(1)
