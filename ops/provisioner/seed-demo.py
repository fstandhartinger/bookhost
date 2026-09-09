#!/usr/bin/env python3
from tenant import ROOT, php, env_read
p=ROOT/'demo'
v=env_read(p/'.env')
code=r'''
$v=json_decode(stream_get_contents(STDIN),true);
$u=BookStack\Users\Models\User::where('email',$v['email'])->firstOrFail();
if (BookStack\Users\Models\User::where('email','admin@admin.com')->exists() || Illuminate\Support\Facades\Hash::check('password',$u->password)) {throw new Exception('Default credentials still active');}
if (!Illuminate\Support\Facades\Hash::check($v['secret'],$u->password)) {throw new Exception('Generated credential mismatch');}
auth()->setUser($u);
$b=BookStack\Entities\Models\Book::where('name','Welcome to BookHost')->first();
if (!$b) {$b=app(BookStack\Entities\Repos\BookRepo::class)->create(['name'=>'Welcome to BookHost','description'=>'Your team knowledge, reviewed and organized.']);}
$repo=app(BookStack\Entities\Repos\PageRepo::class);
foreach ([['What BookHost does','<h1>Your team knowledge in one place</h1><p>BookHost hosts BookStack for your team: organize knowledge into books and pages, collaborate with controlled access, and keep daily backups.</p>'],['Review before publishing','<h1>Keep people in control</h1><p>The planned document intake workflow accepts uploads and email, prepares an AI-assisted content proposal, and asks a human to review and approve it before publication in BookStack. Treat suggestions as drafts and verify facts and sensitive information.</p>']] as [$name,$html]) {
if (!$b->pages()->where('name',$name)->exists()) {$draft=$repo->getNewDraftPage($b); $repo->publishDraft($draft,['name'=>$name,'html'=>$html,'editor'=>'wysiwyg']);}
}
echo 'ADMIN VERIFIED: default rejected, generated hash matches; DEMO pages='.$b->pages()->count().PHP_EOL;
'''
print(php(p,code,{'email':v['BOOKSTACK_ADMIN_EMAIL'],'secret':v['BOOKSTACK_ADMIN_PASSWORD']}).decode(),end='')
