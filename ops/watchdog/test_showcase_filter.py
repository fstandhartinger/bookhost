"""Showcase workspaces must not appear in customer lifecycle alarms."""
import pathlib
import unittest


class ShowcaseWatchdogFilterTests(unittest.TestCase):
    def test_every_tenant_lifecycle_alarm_excludes_marked_workspaces(self):
        source = pathlib.Path(__file__).with_name('watchdog.py').read_text(encoding='utf-8')
        query = source.split('query = """', 1)[1].split('"""', 1)[0]
        fields = (
            'running', 'provisioning', 'pending', 'drafting', 'stranded',
            'unsuspended', 'unpaid_running', 'cancellations', 'unreminded',
        )
        positions = [query.index(f"'{field}',") for field in fields]
        for index, field in enumerate(fields):
            end = positions[index + 1] if index + 1 < len(positions) else len(query)
            clause = query[positions[index]:end]
            with self.subTest(field=field):
                if field in {'running', 'provisioning', 'pending', 'stranded', 'unsuspended', 'unpaid_running'}:
                    self.assertIn('LEFT JOIN teams team', clause)
                    self.assertIn('COALESCE(team.is_showcase,false)=false', clause)
                elif field == 'drafting':
                    self.assertIn('NOT team.is_showcase', clause)
                elif field == 'cancellations':
                    self.assertIn('NOT EXISTS', clause)
                    self.assertIn('team.is_showcase', clause)
                else:
                    self.assertIn('NOT t.is_showcase', clause)


if __name__ == '__main__':
    unittest.main()
