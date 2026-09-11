"""Rehearsing an upgrade must hit the BookStack service and nothing else."""
import unittest

import tenant


CURRENT = 'lscr.io/linuxserver/bookstack:v26.05.4-ls283'
NEXT = 'lscr.io/linuxserver/bookstack:v26.06.0-ls290'


def compose():
    return {'services': {
        'app': {'image': CURRENT, 'environment': {}},
        'db': {'image': 'lscr.io/linuxserver/mariadb:11.4', 'environment': {}},
    }}


class RetargetImageTests(unittest.TestCase):
    def test_replaces_only_the_bookstack_service(self):
        spec = compose()
        self.assertEqual(tenant.retarget_image(spec, NEXT), 'app')
        self.assertEqual(spec['services']['app']['image'], NEXT)
        self.assertEqual(spec['services']['db']['image'],
                         'lscr.io/linuxserver/mariadb:11.4')

    def test_rejects_an_image_that_is_not_bookstack(self):
        # A rehearsal runs customer data; it must not run an arbitrary image.
        for bad in ['alpine:latest', 'lscr.io/linuxserver/mariadb:11.4',
                    'evil.example/bookstack:v1', '', None]:
            with self.assertRaises(ValueError):
                tenant.retarget_image(compose(), bad)

    def test_refuses_when_the_service_is_ambiguous(self):
        spec = compose()
        spec['services']['second'] = {'image': CURRENT}
        with self.assertRaises(ValueError):
            tenant.retarget_image(spec, NEXT)

    def test_refuses_when_no_bookstack_service_exists(self):
        with self.assertRaises(ValueError):
            tenant.retarget_image({'services': {'db': {'image': 'mariadb:11.4'}}}, NEXT)


if __name__ == '__main__':
    unittest.main()
