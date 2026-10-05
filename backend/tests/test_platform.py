"""Cross-platform behaviour of the packaged engine (Windows/Linux as well as macOS)."""
from __future__ import annotations

from pathlib import Path

import pytest

import surveyr_server
from app import storage


# ---------------------------------------------------------------- projects folder

def test_projects_folder_on_macos():
    home = Path("/Users/al")
    assert surveyr_server.default_data_dir("darwin", {}, home) == home / "Library/Application Support/SurveyR/Projects"


def test_projects_folder_on_windows_uses_appdata():
    got = surveyr_server.default_data_dir("win32", {"APPDATA": r"C:\Users\al\AppData\Roaming"}, Path("C:/Users/al"))
    assert got == Path(r"C:\Users\al\AppData\Roaming") / "SurveyR" / "Projects"


def test_projects_folder_on_windows_without_appdata():
    home = Path("C:/Users/al")
    assert surveyr_server.default_data_dir("win32", {}, home) == home / "AppData/Roaming/SurveyR/Projects"


def test_projects_folder_on_linux_follows_xdg():
    home = Path("/home/al")
    assert surveyr_server.default_data_dir("linux", {}, home) == home / ".local/share/SurveyR/Projects"
    assert surveyr_server.default_data_dir("linux", {"XDG_DATA_HOME": "/data"}, home) == Path("/data/SurveyR/Projects")


# ---------------------------------------------------------------- parent watchdog

def test_windows_watchdog_never_signals_the_parent(monkeypatch):
    # On Windows, os.kill(pid, 0) would TERMINATE the app; it must not be used.
    def forbidden(*_):
        raise AssertionError("os.kill must not be called on Windows")

    monkeypatch.setattr(surveyr_server.sys, "platform", "win32")
    monkeypatch.setattr(surveyr_server.os, "kill", forbidden)
    monkeypatch.setattr(surveyr_server, "_win_process_alive", lambda pid: pid == 42)

    assert surveyr_server._parent_alive(42) is True
    assert surveyr_server._parent_alive(7) is False


# ---------------------------------------------------------------- recycle bin

def test_without_a_trash_folder_files_go_to_the_system_recycle_bin(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(storage, "_send_to_system_trash", lambda p: sent.append(p))
    src = tmp_path / "garden.xyz"
    src.write_text("x")

    storage.move_to_trash(src, None)

    assert sent == [str(src)]


def test_falls_back_to_deleting_when_no_recycle_bin_support(tmp_path, monkeypatch):
    def unavailable(_):
        raise storage.SystemTrashUnavailable

    monkeypatch.setattr(storage, "_send_to_system_trash", unavailable)
    src = tmp_path / "garden.xyz"
    src.write_text("x")

    storage.move_to_trash(src, None)

    assert not src.exists()
