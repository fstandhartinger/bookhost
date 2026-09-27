#!/usr/bin/env python3
"""Publish the tracked fictional Northwind pages into only showcase-northwind."""
import fcntl
import json
import sys
from pathlib import Path

PROVISIONER = Path(__file__).resolve().parents[1] / 'provisioner'
sys.path.insert(0, str(PROVISIONER))
from tenant import ROOT, env_read, php  # noqa: E402

HERE = Path(__file__).resolve().parent
SLUG = 'showcase-northwind'
CANONICAL_APP_URL = f'https://{SLUG}.bookhost.co'


def valid_showcase_app_url(app_url):
    return app_url == CANONICAL_APP_URL
BOOKS = [
    ('Northwind Studio Handbook', 'Fictional studio agreements and onboarding.', [
        ('Studio handbook', 'handbook.md'),
        ('First week at Northwind', 'onboarding.md'),
    ]),
    ('Northwind Client Projects', 'Fictional client delivery references.', [
        ('Client FAQ', 'client-faq.md'),
        ('Website release checklist', 'release-checklist.md'),
    ]),
]

READ = r'''
$books=BookStack\Entities\Models\Book::all()->keyBy('id');
echo json_encode(BookStack\Entities\Models\Page::orderBy('id')->get()->map(fn($p)=>[
'id'=>$p->id,'book'=>$books[$p->book_id]->name,'name'=>$p->name,
'markdown'=>$p->markdown,'draft'=>$p->draft]));
'''

WRITE = r'''
$v=json_decode(stream_get_contents(STDIN),true);
$u=BookStack\Users\Models\User::where('email',$v['email'])->firstOrFail();
if (!$u->roles()->where('system_name','admin')->exists()) throw new Exception('Showcase owner is not admin');
auth()->setUser($u);
$changed=0;
Illuminate\Support\Facades\DB::transaction(function() use ($v,&$changed) {
  $bookRepo=app(BookStack\Entities\Repos\BookRepo::class);
  $pageRepo=app(BookStack\Entities\Repos\PageRepo::class);
  $books=[];
  foreach($v['books'] as [$name,$description]) {
    $book=BookStack\Entities\Models\Book::where('name',$name)->first();
    if (!$book) {$book=$bookRepo->create(compact('name','description'));$changed++;}
    elseif ($book->description!==$description) {$book=$bookRepo->update($book,compact('name','description'));$changed++;}
    $books[$name]=$book;
  }
  foreach($v['pages'] as $input) {
    $book=$books[$input['book']];
    $page=$input['id'] ? $book->pages()->findOrFail($input['id']) : $pageRepo->getNewDraftPage($book);
    $data=['name'=>$input['name'],'markdown'=>$input['markdown'],'editor'=>'markdown'];
    if ($page->draft) $pageRepo->publishDraft($page,$data); else $pageRepo->update($page,$data);
    $changed++;
  }
});
echo json_encode(['changed'=>$changed,'books'=>count($v['books']),'pages'=>count($v['pages'])]);
'''


def plan(existing):
    available = list(existing)
    pages = []
    books = []
    for book, description, definitions in BOOKS:
        books.append([book, description])
        for title, filename in definitions:
            match = next((page for page in available if page['book'] == book and page['name'] == title), None)
            markdown = (HERE / 'content' / filename).read_text(encoding='utf-8').strip()
            if match:
                available.remove(match)
            if not match or match.get('markdown') != markdown or match.get('draft'):
                pages.append({
                    'id': match['id'] if match else None,
                    'book': book,
                    'name': title,
                    'markdown': markdown,
                })
    return books, pages


def publish():
    path = ROOT / SLUG
    print(f'Exact showcase target: slug={SLUG} path={path}')
    if path.is_symlink() or not (path / '.initialized').is_file():
        raise RuntimeError('Initialized showcase tenant required')
    values = env_read(path / '.env')
    if not valid_showcase_app_url(values.get('APP_URL', '')):
        raise RuntimeError('Showcase URL mismatch')
    existing = json.loads(php(path, READ))
    books, pages = plan(existing)
    payload = {'email': values['BOOKSTACK_ADMIN_EMAIL'], 'books': books, 'pages': pages}
    print(php(path, WRITE, payload).decode('utf-8'))


def main():
    locks = ROOT / '.locks'
    locks.mkdir(exist_ok=True)
    with (locks / f'{SLUG}.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        publish()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'ERROR: {exc}' if isinstance(exc, (RuntimeError, ValueError)) else 'ERROR: showcase content update failed; inspect locally', file=sys.stderr)
        raise SystemExit(1)
