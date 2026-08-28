#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
CONFIG_FILE = PROJECT_DIR / "config.json"
CONFIG_EXAMPLE_FILE = PROJECT_DIR / "config.example.json"
REQUIREMENTS_FILE = PROJECT_DIR / "requirements.txt"
RUN_SCRIPT = PROJECT_DIR / "run_canvas_sync.sh"
SYSTEMD_USER_DIR = Path.home() / ".config" / "systemd" / "user"
SERVICE_FILE = SYSTEMD_USER_DIR / "canvas-sync.service"
TIMER_FILE = SYSTEMD_USER_DIR / "canvas-sync.timer"


def run(command: list[str]):
    print("+ " + " ".join(command))
    subprocess.run(command, check=True)


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def load_example_config() -> dict:
    with open(CONFIG_EXAMPLE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_config(force: bool):
    if CONFIG_FILE.exists() and not force:
        print(f"{CONFIG_FILE} already exists; leaving it unchanged.")
        return

    config = load_example_config()
    config["canvas_ical_url"] = ask("Canvas calendar feed URL")
    excluded = ask("Excluded course prefixes, comma-separated", ",".join(config["excluded_courses"]))
    config["excluded_courses"] = [course.strip() for course in excluded.split(",") if course.strip()]
    config["active_calendar_title"] = ask("Active Google Calendar title", config["active_calendar_title"])
    config["completed_calendar_title"] = ask("Completed Google Calendar title", config["completed_calendar_title"])
    config["local_timezone"] = ask("Local timezone", config["local_timezone"])
    duration = ask("Visible event duration in minutes", str(config["event_duration_minutes"]))
    config["event_duration_minutes"] = int(duration)

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
        f.write("\n")
    CONFIG_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
    print(f"Wrote {CONFIG_FILE}")


def create_venv(skip_deps: bool):
    venv_dir = PROJECT_DIR / ".venv"
    python = venv_dir / "bin" / "python3"
    pip = venv_dir / "bin" / "pip"

    if not venv_dir.exists():
        run([sys.executable, "-m", "venv", str(venv_dir)])

    if not skip_deps:
        run([str(pip), "install", "-r", str(REQUIREMENTS_FILE)])

    return python


def install_systemd_timer():
    SYSTEMD_USER_DIR.mkdir(parents=True, exist_ok=True)

    SERVICE_FILE.write_text(
        "\n".join(
            [
                "[Unit]",
                "Description=Sync Canvas assignments to Google Calendar",
                "",
                "[Service]",
                "Type=oneshot",
                f"ExecStart={RUN_SCRIPT}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    TIMER_FILE.write_text(
        "\n".join(
            [
                "[Unit]",
                "Description=Run Canvas sync daily",
                "",
                "[Timer]",
                "OnCalendar=*-*-* 07:00:00",
                "Persistent=true",
                "Unit=canvas-sync.service",
                "",
                "[Install]",
                "WantedBy=timers.target",
                "",
            ]
        ),
        encoding="utf-8",
    )

    run(["systemctl", "--user", "daemon-reload"])
    run(["systemctl", "--user", "enable", "--now", "canvas-sync.timer"])


def protect_local_files():
    for path in [
        PROJECT_DIR / "credentials.json",
        PROJECT_DIR / "token.json",
        PROJECT_DIR / "canvasExport.log",
        PROJECT_DIR / "cron.log",
        PROJECT_DIR / "canvas.ics",
        CONFIG_FILE,
    ]:
        if path.exists():
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)

    if RUN_SCRIPT.exists():
        RUN_SCRIPT.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)


def check_prerequisites():
    if not shutil.which("flock"):
        print("Warning: flock was not found. Install util-linux or edit run_canvas_sync.sh to remove locking.")
    if not (PROJECT_DIR / "credentials.json").exists():
        print("Warning: credentials.json not found. Download an OAuth Desktop client JSON from Google Cloud Console.")


def parse_args():
    parser = argparse.ArgumentParser(description="Set up Canvas-to-Google-Calendar sync.")
    parser.add_argument("--force-config", action="store_true", help="overwrite config.json")
    parser.add_argument("--skip-deps", action="store_true", help="do not install Python dependencies")
    parser.add_argument("--install-systemd", action="store_true", help="install and enable the user systemd timer")
    parser.add_argument("--no-install-systemd", action="store_true", help="skip user systemd timer installation")
    return parser.parse_args()


def main():
    args = parse_args()
    check_prerequisites()
    write_config(force=args.force_config)
    create_venv(skip_deps=args.skip_deps)
    protect_local_files()

    install_timer = args.install_systemd
    if not args.install_systemd and not args.no_install_systemd:
        install_timer = ask("Install the user systemd timer?", "yes").lower() in {"y", "yes"}

    if install_timer:
        install_systemd_timer()
    else:
        print("Skipped systemd timer installation.")

    print("Setup complete.")
    print(f"Run once with: {PROJECT_DIR / '.venv' / 'bin' / 'python3'} {PROJECT_DIR / 'main.py'}")


if __name__ == "__main__":
    main()
