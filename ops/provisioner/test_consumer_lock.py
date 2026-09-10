"""Isolated shell integration tests: no Docker or production tenants."""
import pathlib
import subprocess
import unittest


class ConsumerLockTests(unittest.TestCase):
    def run_case(self, name):
        result = subprocess.run(
            ["bash", str(pathlib.Path(__file__).with_suffix(".sh")), name],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_maintenance(self):
        self.run_case("maintenance")

    def test_shared_drain(self):
        self.run_case("shared_drain")

    def test_rollback(self):
        self.run_case("rollback")

    def test_nightly(self):
        self.run_case("nightly")
