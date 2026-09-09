import importlib.util
import unittest
spec = importlib.util.spec_from_file_location('demo_publish', __file__.replace('test_demo_publish.py', 'demo-publish.py'))
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)

class DemoPublishTests(unittest.TestCase):
    def test_second_run_has_no_content_mutations(self):
        first = demo.content_plan([])
        self.assertEqual(len(first), 10)
        state = [dict(page, id=i+1) for i, page in enumerate(first)]
        self.assertEqual(demo.content_plan(state), [])
        state[0]['markdown'] += '\nOutdated instruction'
        self.assertEqual(len(demo.content_plan(state)), 1)

    def test_duplicate_legacy_pages_reused_once_without_touching_unrelated_content(self):
        state = [dict(id=i, book='Wissen product guide', name='Reviewed document intake: a team checklist', markdown='') for i in range(1,4)]
        state.append(dict(id=99, book='Team handbook', name='Unrelated page', markdown='Keep me'))
        plan = demo.content_plan(state)
        self.assertEqual([p['id'] for p in plan if p['id']], [1,2,3])
        self.assertEqual(len(state),4)

if __name__ == '__main__': unittest.main()
