#!/usr/bin/env python3
"""Publish only the dedicated demo. Repeat runs preserve unchanged rows/revisions."""
import fcntl
import json
from pathlib import Path
from tenant import ROOT, php, env_read

HERE = Path(__file__).resolve().parent
BOOKS = [
    ('Team handbook', 'Practical working agreements for our fictional eight-person team. Start with onboarding.',
     [('Onboarding', 'How to use this wiki'), ('Team rituals', None), ('Deploy process', None), ('Time off', None), ('Expenses', None)]),
    ('Wissen product guide', 'Explore hosted BookStack and the human review step that turns documents into useful team knowledge.',
     [('What Wissen is', 'What Wissen does'), ('Document intake', 'Review before publishing'), ('Backups and restore', 'Reviewed document intake: a team checklist'), ('Permissions and roles', 'Reviewed document intake: a team checklist'), ('FAQ', 'Reviewed document intake: a team checklist')]),
]

def content_plan(existing):
    """Match named pages first; reuse only known legacy seed pages, once each."""
    remaining = list(existing)
    result = []
    for book, description, pages in BOOKS:
        for title, legacy in pages:
            matches = [p for p in remaining if p['book'] == book and p['name'] == title]
            if not matches and legacy:
                matches = [p for p in remaining if p['book'] == book and p['name'] == legacy]
            old = matches[0] if matches else None
            if old:
                remaining.remove(old)
            markdown = (HERE / 'demo-content' / (title.lower().replace(' ', '-') + '.md')).read_text().strip()
            if not old or old['name'] != title or old['markdown'] != markdown or old.get('draft', False):
                result.append(dict(id=old['id'] if old else None, book=book, name=title, markdown=markdown))
    return result

BANNER = '''<style>
#wissen-demo-banner{background:#173f3b;color:#fff;padding:12px 20px;text-align:center;font-size:15px;line-height:1.6}
#wissen-demo-banner a{color:#fff;text-decoration:underline;font-weight:600}
</style><script>
document.addEventListener('DOMContentLoaded',function(){
if(document.getElementById('wissen-demo-banner'))return;
var banner=document.createElement('aside');banner.id='wissen-demo-banner';
banner.setAttribute('aria-label','Demo workspace');
banner.append(document.createTextNode('Read-only demo of Wissen — start your own workspace at '));
var link=document.createElement('a');link.href='https://wissen.app.mintapis.com';link.textContent='https://wissen.app.mintapis.com';
banner.append(link);document.body.prepend(banner);
});</script>'''

READ = r'''
$books=BookStack\Entities\Models\Book::all()->keyBy('id');
echo json_encode(BookStack\Entities\Models\Page::orderBy('id')->get()->map(fn($p)=>[
'id'=>$p->id,'book'=>$books[$p->book_id]->name==='Welcome to Wissen'?'Wissen product guide':$books[$p->book_id]->name,
'name'=>$p->name,'markdown'=>$p->markdown,'draft'=>$p->draft]));
'''
WRITE = r'''
$v=json_decode(stream_get_contents(STDIN),true);
$u=BookStack\Users\Models\User::where('email',$v['email'])->firstOrFail();
if (!$u->roles()->where('system_name','admin')->exists()) throw new Exception('Demo owner is not admin');
auth()->setUser($u);
$changed=0;
Illuminate\Support\Facades\DB::transaction(function() use ($v,&$changed) {
$bookRepo=app(BookStack\Entities\Repos\BookRepo::class);
$pageRepo=app(BookStack\Entities\Repos\PageRepo::class);
$books=[];
foreach($v['books'] as [$name,$description]) {
$b=BookStack\Entities\Models\Book::where('name',$name)->first();
if (!$b && $name==='Wissen product guide') $b=BookStack\Entities\Models\Book::where('name','Welcome to Wissen')->first();
if (!$b) {$b=$bookRepo->create(compact('name','description'));$changed++;}
elseif ($b->name!==$name || $b->description!==$description) {$b=$bookRepo->update($b,compact('name','description'));$changed++;}
$books[$name]=$b;
}
foreach($v['pages'] as $input) {
$b=$books[$input['book']];
$p=$input['id'] ? $b->pages()->findOrFail($input['id']) : $pageRepo->getNewDraftPage($b);
$data=['name'=>$input['name'],'markdown'=>$input['markdown'],'editor'=>'markdown'];
if($p->draft) $pageRepo->publishDraft($p,$data); else $pageRepo->update($p,$data);
$changed++;
}
$names=['book-view-all','bookshelf-view-all','chapter-view-all','page-view-all','content-export'];
$ids=BookStack\Permissions\Models\RolePermission::whereIn('name',$names)->pluck('id')->all();
if(count($ids)!==count($names)) throw new Exception('Missing read permissions');
BookStack\Users\Models\Role::where('system_name','public')->firstOrFail();
foreach(BookStack\Users\Models\Role::where('system_name','!=','admin')->get() as $role) {
$before=$role->permissions()->pluck('id')->all();sort($before);$after=$ids;sort($after);
if($before!==$after) {$role->permissions()->sync($ids);$changed++;}
}
// Remove demo-only per-entity overrides, so no inherited write grants survive.
$n=BookStack\Permissions\Models\EntityPermission::query()->delete();$changed+=$n;
foreach(BookStack\Entities\Models\Book::all()->concat(BookStack\Entities\Models\Chapter::all())->concat(BookStack\Entities\Models\Page::all()) as $entity) {
if($entity->restricted) {$entity->restricted=false;$entity->save();$changed++;}
}
foreach($v['settings'] as $key=>$value) {
$desired=$value==='true'?true:($value==='false'?false:$value);
if(setting($key)!==$desired) {setting()->put($key,$value);$changed++;}
}
if($changed) setting()->put('wissen-demo-permissions-pending','true');
});
// The rebuild truncates its table (implicit MariaDB commit): run outside the transaction.
if(setting('wissen-demo-permissions-pending')) {
if(Illuminate\Support\Facades\Artisan::call('bookstack:regenerate-permissions')!==0) throw new Exception('Permission rebuild failed');
setting()->remove('wissen-demo-permissions-pending');
}
echo json_encode(['changed'=>$changed,'books'=>BookStack\Entities\Models\Book::count(),'pages'=>BookStack\Entities\Models\Page::where('draft',false)->count()]);
'''

def publish():
    path = ROOT / 'demo'
    if path.is_symlink() or not (path / '.initialized').exists():
        raise RuntimeError('Initialized demo tenant required')
    values = env_read(path / '.env')
    if values['APP_URL'] != 'https://demo.wissen.app.mintapis.com':
        raise RuntimeError('Demo URL mismatch')
    existing = json.loads(php(path, READ))
    payload = dict(email=values['BOOKSTACK_ADMIN_EMAIL'], books=[b[:2] for b in BOOKS], pages=content_plan(existing), settings={
        'app-public':'true', 'registration-enabled':'false', 'app-homepage-type':'books',
        'app-name':'Wissen demo', 'app-custom-head':BANNER})
    print(php(path, WRITE, payload).decode())

def main():
    locks = ROOT / '.locks'
    locks.mkdir(exist_ok=True)
    with (locks / 'demo.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        publish()

if __name__ == '__main__':
    main()
