"""Point-cloud IO: load `.las`/`.laz`, `.ply`, `.xyz` and LandXML `.xml` into a PointCloud.

Formats supported with free/open-source tooling only:
  - LAS / LAZ  -> laspy (pure Python + numpy; LAZ needs the optional `lazrs` backend)
  - PLY        -> small built-in reader (ASCII + binary_little_endian, vertex element)
  - XYZ        -> whitespace-delimited "x y z" text
  - LandXML    -> a TIN surface, sampled on a fine lattice (see landxml.py)

Wherever the source provides extra per-point channels (intensity, echo return
info, GPS time, classification, scan angle, colour) they are copied into the
PointCloud channel map so downstream code can use them when present. Colour is
always stored as red/green/blue in 0..1, whatever the file's bit depth.
"""
from __future__ import annotations

import os
from typing import Dict, Optional

import numpy as np

from .pcd import PointCloud

_LAS_CHANNELS = (
    "intensity",
    "return_number",
    "number_of_returns",
    "gps_time",
    "classification",
    "scan_angle",
)


def load_point_cloud(path: str, surface: Optional[str] = None) -> PointCloud:
    """Read a scan. ``surface`` picks one surface of a LandXML file (default: the design-looking one)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xml":
        from . import landxml

        return PointCloud(landxml.load_surface(path, surface)[0])
    if ext == ".xyz":
        return _load_xyz(path)
    if ext in (".las", ".laz"):
        return _load_las(path)
    if ext == ".ply":
        return _load_ply(path)
    raise ValueError(f"unsupported point-cloud format: {ext!r}")


def _colour_channels(r, g, b) -> Dict[str, np.ndarray]:
    """red/green/blue scaled to 0..1 from 8-bit, 16-bit or already-normalised values."""
    rgb = np.column_stack([r, g, b]).astype(float)
    top = float(rgb.max()) if rgb.size else 0.0
    if top <= 0:
        return {}  # colour fields present but empty: the scan has no colour
    scale = 1.0 if top <= 1.0 else 255.0 if top <= 255.0 else 65535.0
    return {name: rgb[:, i] / scale for i, name in enumerate(("red", "green", "blue"))}


def _load_xyz(path: str) -> PointCloud:
    pts = np.loadtxt(path)
    if pts.ndim == 1:
        pts = pts.reshape(1, -1)
    if pts.shape[1] < 3:
        raise ValueError("XYZ file must have at least x, y, z columns")
    # "x y z r g b" is a common export: keep the colour
    channels = _colour_channels(pts[:, 3], pts[:, 4], pts[:, 5]) if pts.shape[1] >= 6 else {}
    return PointCloud(pts[:, :3], channels)


def _load_las(path: str) -> PointCloud:
    import laspy  # local import keeps the module usable without laspy installed

    with laspy.open(path) as f:
        las = f.read()
    pts = np.column_stack(
        [np.asarray(las.x, dtype=float),
         np.asarray(las.y, dtype=float),
         np.asarray(las.z, dtype=float)]
    )
    channels: Dict[str, np.ndarray] = {}
    dims = set(las.point_format.dimension_names)
    for name in _LAS_CHANNELS:
        if name in dims:
            channels[name] = np.asarray(las[name], dtype=float)
    if {"red", "green", "blue"} <= dims:
        channels.update(_colour_channels(las.red, las.green, las.blue))
    return PointCloud(pts, channels)


# --------------------------------------------------------------------------
# Minimal PLY reader (vertex-only; ASCII and binary_little_endian)
# --------------------------------------------------------------------------
_PLY_TYPES = {
    "char": "i1", "int8": "i1",
    "uchar": "u1", "uint8": "u1",
    "short": "i2", "int16": "i2",
    "ushort": "u2", "uint16": "u2",
    "int": "i4", "int32": "i4",
    "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4",
    "double": "f8", "float64": "f8",
}


def _parse_ply_header(data: bytes):
    """Return (format, vertex_props [(name, np_dtype)], vertex_count, header_len)."""
    lines = data.split(b"\n")
    fmt = None
    vertex_props = []
    vertex_count = 0
    header_len = 0
    in_vertex = False
    for raw in lines:
        header_len += len(raw) + 1  # +1 for the newline
        text = raw.decode("ascii", "ignore").strip()
        if not text or text == "ply":
            continue
        parts = text.split()
        if parts[0] == "format":
            fmt = parts[1]
        elif parts[0] == "element":
            in_vertex = parts[1] == "vertex"
            if in_vertex:
                vertex_count = int(parts[2])
        elif parts[0] == "property" and in_vertex:
            if parts[1] == "list":
                raise ValueError("PLY list properties are not supported")
            vertex_props.append((parts[2], _PLY_TYPES[parts[1]]))
        elif parts[0] == "end_header":
            break
    return fmt, vertex_props, vertex_count, header_len


def _load_ply(path: str) -> PointCloud:
    with open(path, "rb") as f:
        data = f.read()
    fmt, props, count, header_len = _parse_ply_header(data)
    names = [p[0] for p in props]
    for req in ("x", "y", "z"):
        if req not in names:
            raise ValueError(f"PLY vertex is missing required property {req!r}")
    idx = {n: i for i, n in enumerate(names)}

    if fmt == "ascii":
        text = data[header_len:].decode("ascii", "ignore")
        arr = np.loadtxt(text.splitlines()) if text.strip() else np.zeros((0, len(props)))
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        pts = np.column_stack([arr[:, idx["x"]], arr[:, idx["y"]], arr[:, idx["z"]]]).astype(float)

    elif fmt == "binary_little_endian":
        dt = np.dtype([(n, t) for n, t in props])
        recs = np.frombuffer(data, dtype=dt, count=count, offset=header_len)
        pts = np.column_stack([recs["x"], recs["y"], recs["z"]]).astype(float)

    else:
        raise ValueError(f"unsupported PLY format: {fmt!r}")

    column = (lambda n: arr[:, idx[n]]) if fmt == "ascii" else (lambda n: recs[n])
    channels: Dict[str, np.ndarray] = {}
    for n in ("intensity", "classification", "return_number"):
        if n in names:
            channels[n] = np.asarray(column(n), dtype=float)
    for r, g, b in (("red", "green", "blue"), ("r", "g", "b"), ("diffuse_red", "diffuse_green", "diffuse_blue")):
        if {r, g, b} <= set(names):  # phone scanning apps colour their PLYs
            channels.update(_colour_channels(column(r), column(g), column(b)))
            break
    return PointCloud(pts, channels)


# --------------------------------------------------------------------------
# PLY writer (used to generate fixtures without extra dependencies)
# --------------------------------------------------------------------------
def write_ply(path: str, points: np.ndarray) -> None:
    """Write vertices as binary_little_endian float32 PLY (vertex-only)."""
    pts = np.asarray(points, dtype=np.float32)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {pts.shape[0]}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "end_header\n"
    ).encode("ascii")
    raw = np.ascontiguousarray(pts).tobytes()
    with open(path, "wb") as f:
        f.write(header)
        f.write(raw)