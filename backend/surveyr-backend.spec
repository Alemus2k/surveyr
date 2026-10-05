# PyInstaller spec for the Surveyr backend sidecar.
#
#   ./.venv/bin/pyinstaller surveyr-backend.spec --noconfirm
#
# Produces dist/surveyr-backend/ (a folder build: starts faster than one-file,
# which would unpack numpy/scipy to a temp dir on every launch). The Tauri app
# ships that folder as a resource and launches dist/surveyr-backend/surveyr-backend.
# -*- mode: python ; coding: utf-8 -*-

DEMO = ["data/synthetic_topo.xyz", "data/scan_a.las", "data/scan_b.las"]

a = Analysis(
    ["surveyr_server.py"],
    pathex=["."],
    datas=[(path, "demo") for path in DEMO],
    hiddenimports=[
        # uvicorn picks these by name at runtime, so static analysis misses them
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        "multipart",
        "python_multipart",
        # laspy picks its LAZ backend at runtime; pyproj has a contrib hook for its data
        "lazrs",
        "pyproj",
        "send2trash",
    ],
    excludes=["matplotlib", "tkinter", "pytest", "IPython", "PIL"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="surveyr-backend",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="surveyr-backend", upx=False)
