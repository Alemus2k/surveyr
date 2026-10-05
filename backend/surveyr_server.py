"""Surveyr backend entry point — used by the desktop app (as a bundled sidecar).

    surveyr_server.py --port 8123 [--data-dir DIR] [--parent-pid PID]

Projects live in the per-user app data folder by default
(``~/Library/Application Support/SurveyR/Projects`` on macOS, ``%APPDATA%/SurveyR/Projects``
on Windows), outside synced Documents folders, which the OS may offload. On first run the
bundled demo projects are copied in. With ``--parent-pid`` the server exits
when that process disappears, so a crashed app never leaves it running.

For development you can keep using:  ./.venv/bin/uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Mapping, Optional, Sequence

import uvicorn

from app import service, storage
from app.main import app

log = logging.getLogger("surveyr")
PARENT_POLL_SECONDS = 2.0


def default_data_dir(
    platform: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
    home: Optional[Path] = None,
) -> Path:
    """Per-user app data folder (never iCloud/OneDrive-synced Documents)."""
    platform = platform or sys.platform
    env = os.environ if env is None else env
    home = home or Path.home()
    # Folder keeps the original "SurveyR" spelling so existing installs keep their projects.
    if platform == "darwin":
        return home / "Library" / "Application Support" / "SurveyR" / "Projects"
    if platform.startswith("win"):
        return Path(env.get("APPDATA") or home / "AppData" / "Roaming") / "SurveyR" / "Projects"
    return Path(env.get("XDG_DATA_HOME") or home / ".local" / "share") / "SurveyR" / "Projects"


def demo_dir() -> Path:
    """Demo data: bundled next to the frozen binary, or backend/data in a checkout."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "demo"
    return Path(__file__).resolve().parent / "data"


def _win_process_alive(pid: int) -> bool:
    """Windows: query the process without touching it (os.kill would terminate it)."""
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _parent_alive(pid: int) -> bool:
    if sys.platform.startswith("win"):
        return _win_process_alive(pid)
    try:
        os.kill(pid, 0)  # signal 0: existence check only
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int) -> None:
    def loop() -> None:
        while _parent_alive(pid):
            time.sleep(PARENT_POLL_SECONDS)
        log.warning("parent process %s exited; shutting down", pid)
        os._exit(0)

    threading.Thread(target=loop, name="parent-watchdog", daemon=True).start()


def main(argv: Optional[Sequence[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Surveyr analysis server")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--parent-pid", type=int, default=None)
    args = parser.parse_args(argv)

    data_dir = args.data_dir or Path(os.environ.get("SURVEYR_DATA_DIR", default_data_dir()))
    storage.seed_demo_data(data_dir, demo_dir())
    service.DATA_DIR = str(data_dir)
    if args.parent_pid:
        watch_parent(args.parent_pid)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    log.info("serving projects from %s on %s:%s", data_dir, args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
