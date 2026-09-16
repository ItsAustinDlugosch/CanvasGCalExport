import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import call, patch


spec = importlib.util.spec_from_file_location(
    "canvas_setup", Path(__file__).resolve().parents[1] / "local" / "setup.py"
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_timer_install_uses_templates_and_quotes_checkout_path(self):
        with tempfile.TemporaryDirectory() as directory:
            user_dir = Path(directory) / "systemd" / "user"
            service_file = user_dir / "canvas-sync.service"
            timer_file = user_dir / "canvas-sync.timer"
            run_script = Path(directory) / 'My Project 100% $sync' / "local" / "run_canvas_sync.sh"
            with patch.multiple(
                setup,
                SYSTEMD_USER_DIR=user_dir,
                SERVICE_FILE=service_file,
                TIMER_FILE=timer_file,
                RUN_SCRIPT=run_script,
            ), patch.object(setup, "run") as run:
                setup.install_systemd_timer()

            service = service_file.read_text()
            self.assertIn(
                f'ExecStart="{directory}/My Project 100%% $$sync/local/run_canvas_sync.sh"',
                service,
            )
            self.assertNotIn("@RUN_SCRIPT@", service)
            self.assertEqual(
                timer_file.read_text(),
                (setup.PROJECT_DIR / "systemd" / "canvas-sync.timer").read_text(),
            )
            self.assertEqual(run.call_args_list, [
                call(["systemctl", "--user", "daemon-reload"]),
                call(["systemctl", "--user", "enable", "--now", "canvas-sync.timer"]),
            ])


if __name__ == "__main__":
    unittest.main()
