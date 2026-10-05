"""Project storage for the desktop app: importing scans and first-run demo data.

Imported scans are written into the projects folder under a sanitised, unique
filename and parsed once to prove they are readable point clouds; anything
that fails is deleted again, so a bad upload never shows up as a project.
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import BinaryIO, Optional, Union

from . import io

SUPPORTED_EXTENSIONS = (".ply", ".las", ".laz", ".xyz")
MAX_IMPORT_BYTES = 1024 * 1024 * 1024  # 1 GiB; phone scans are typically 5–100 MB
DEMO_FILES = ("synthetic_topo.xyz", "scan_a.las", "scan_b.las")
SEED_MARKER = ".surveyr-seeded"
_CHUNK = 1024 * 1024
_STEM_MAX = 60

PathLike = Union[str, os.PathLike]


class ImportRejected(ValueError):
    """The uploaded file cannot become a project (bad name, too big, unreadable)."""


def safe_filename(raw: str) -> str:
    """Basename only, lower-case, [a-z0-9_-] stem, supported extension."""
    base = os.path.basename(raw.replace("\\", "/"))
    dot = base.rfind(".")  # not splitext: it ignores leading dots ("....ply" has no ext)
    stem, ext = (base[:dot], base[dot:].lower()) if dot >= 0 else (base, "")
    if ext not in SUPPORTED_EXTENSIONS:
        raise ImportRejected(
            f"unsupported file type '{ext or base}'; expected one of {', '.join(SUPPORTED_EXTENSIONS)}"
        )
    stem = re.sub(r"[^a-z0-9_-]+", "_", stem.lower()).strip("_-")[:_STEM_MAX]
    return f"{stem or 'scan'}{ext}"


def _unique_path(folder: Path, name: str) -> Path:
    stem, ext = os.path.splitext(name)
    candidate = folder / name
    n = 2
    while candidate.exists():
        candidate = folder / f"{stem}_{n}{ext}"
        n += 1
    return candidate


def import_scan(
    folder: PathLike, filename: str, stream: BinaryIO, max_bytes: int = MAX_IMPORT_BYTES
) -> str:
    """Save ``stream`` as a new project file in ``folder``; return its filename."""
    target_dir = Path(folder)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_path(target_dir, safe_filename(filename))
    written = 0
    try:
        with open(dest, "xb") as out:
            while chunk := stream.read(_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise ImportRejected(f"file is larger than the {max_bytes // (1024 * 1024)} MB limit")
                out.write(chunk)
        try:
            cloud = io.load_point_cloud(str(dest))
        except Exception as exc:  # any parse failure means "not a point cloud we can read"
            raise ImportRejected(f"could not read this file as a point cloud ({exc})") from exc
        if cloud.size == 0:
            raise ImportRejected("could not read this file as a point cloud (it has no points)")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return dest.name


class SystemTrashUnavailable(RuntimeError):
    """No recycle-bin support on this system (send2trash missing or refused)."""


def _send_to_system_trash(path: str) -> None:
    """Windows Recycle Bin / Linux desktop trash, via send2trash."""
    try:
        from send2trash import send2trash
    except ImportError as exc:
        raise SystemTrashUnavailable from exc
    try:
        send2trash(path)
    except OSError as exc:
        raise SystemTrashUnavailable from exc


def move_to_trash(path: PathLike, trash_dir: Optional[PathLike]) -> None:
    """Move ``path`` into ``trash_dir`` (never overwriting); with no trash folder
    (Windows/Linux) use the system recycle bin, deleting only as a last resort.

    Uses Finder-style "name 2.ext" numbering when the Trash already has the name.
    """
    src = Path(path)
    if trash_dir is None:
        try:
            _send_to_system_trash(str(src))
        except SystemTrashUnavailable:
            src.unlink()
        return
    stem, ext = os.path.splitext(src.name)
    dest = Path(trash_dir) / src.name
    n = 2
    while dest.exists():
        dest = Path(trash_dir) / f"{stem} {n}{ext}"
        n += 1
    shutil.move(str(src), dest)


def seed_demo_data(target: PathLike, demo_dir: PathLike) -> None:
    """Copy the bundled demo projects into a new projects folder — once, ever.

    A marker file records that seeding happened, so deleting every project
    (demos included) doesn't bring the demos back on the next launch.
    """
    target_dir = Path(target)
    target_dir.mkdir(parents=True, exist_ok=True)
    marker = target_dir / SEED_MARKER
    if marker.exists():
        return
    has_projects = any(p.suffix.lower() in SUPPORTED_EXTENSIONS for p in target_dir.iterdir())
    if not has_projects:
        for name in DEMO_FILES:
            src = Path(demo_dir) / name
            if src.exists():
                shutil.copy2(src, target_dir / name)
    marker.touch()
