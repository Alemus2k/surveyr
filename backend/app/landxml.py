"""LandXML surfaces (TINs): the design files civil engineers deliver.

A LandXML file holds one or more ``<Surface>`` elements, each a triangulated
irregular network: points (``<P id>northing easting elevation</P>``) and
triangles (``<F>p1 p2 p3</F>``; ``i="1"`` marks a hidden face, e.g. a hole).
Grading files often carry both existing ground and finished grade.

Surveyr works on point clouds, so a surface is *sampled*: a regular lattice of
points across the TIN, each at the TIN's linearly interpolated elevation. The
lattice is fine enough (about 800 points across the surface's long side) that
every downstream grid sees the TIN, not the sampling. Coordinates stay in the
file's units; the scan settings convert them like any other scan.
"""
from __future__ import annotations

import os
import threading
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple

import numpy as np

LATTICE_ACROSS = 800  # sample points along the surface's longer side
# LandXML linearUnit names -> our unit codes (see scan_settings.UNIT_TO_M)
_UNITS = {
    "meter": "m", "metre": "m", "millimeter": "mm", "centimeter": "cm",
    "foot": "ft", "internationalfoot": "ft", "ussurveyfoot": "us_ft", "inch": "in",
}
# names that usually mean the design (finished) surface rather than existing ground
_DESIGN_HINTS = ("fg", "finish", "final", "design", "proposed", "prop", "grading", "dsgn")
_EXISTING_HINTS = ("eg", "exist", "ogl", "og", "original", "survey", "topo")


class LandXMLError(ValueError):
    """The file isn't a LandXML file with a usable surface."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]  # drop the XML namespace


_info_cache: Dict[tuple, dict] = {}


def read_info(path: str) -> dict:
    """Units, coordinate system name and the surfaces (name, point/face counts). Cached per file version."""
    key = (os.path.abspath(path), os.path.getmtime(path))
    if key not in _info_cache:
        info = _read_info(path)
        if len(_info_cache) > 16:
            _info_cache.clear()  # stale versions of edited files; cheap to rebuild
        _info_cache[key] = info
    return _info_cache[key]


def _read_info(path: str) -> dict:
    units: Optional[str] = None
    crs_name: Optional[str] = None
    surfaces: List[dict] = []
    current: Optional[dict] = None
    seen = 0  # every <Surface>, so unnamed ones get the same "Surface N" as in read_tin
    try:
        for event, el in ET.iterparse(path, events=("start", "end")):
            tag = _local(el.tag)
            if event == "start":
                if tag in ("Metric", "Imperial") and units is None:
                    units = _UNITS.get((el.get("linearUnit") or "").replace(" ", "").lower())
                elif tag == "CoordinateSystem" and crs_name is None:
                    crs_name = el.get("name") or el.get("desc")
                elif tag == "Surface":
                    seen += 1
                    current = {"name": el.get("name") or f"Surface {seen}", "desc": el.get("desc") or "",
                               "points": 0, "faces": 0}
                continue
            if current is not None and tag == "P":
                current["points"] += 1
            elif current is not None and tag == "F" and el.get("i") != "1":
                current["faces"] += 1
            elif tag == "Surface" and current is not None:
                surfaces.append(current)
                current = None
            if tag in ("P", "F"):
                el.clear()  # keep memory flat on large files
    except ET.ParseError as exc:
        raise LandXMLError(f"not a readable XML file ({exc})") from exc
    usable = [s for s in surfaces if s["points"] >= 3 and s["faces"] >= 1]
    if not usable:
        raise LandXMLError("no TIN surface (points and faces) found in this LandXML file")
    return {"units": units, "crs_name": crs_name, "surfaces": usable}


def default_surface(names: List[str]) -> str:
    """The surface most likely to be the design: named like finished grade, else the last one."""
    def words(n: str) -> List[str]:
        return [w for w in "".join(c if c.isalnum() else " " for c in n.lower()).split() if w]

    for name in names:
        w = words(name)
        if any(h == x or (len(h) > 2 and x.startswith(h)) for h in _DESIGN_HINTS for x in w):
            return name
    not_existing = [n for n in names if not any(h == x or (len(h) > 2 and x.startswith(h)) for h in _EXISTING_HINTS for x in words(n))]
    return (not_existing or names)[-1]


def read_tin(path: str, surface: Optional[str] = None) -> Tuple[np.ndarray, np.ndarray, str]:
    """Points (N, 3: easting, northing, elevation) and visible triangles (M, 3) of one surface."""
    info = read_info(path)
    names = [s["name"] for s in info["surfaces"]]
    name = surface if surface in names else default_surface(names)
    ids: Dict[str, int] = {}
    pts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[str, str, str]] = []
    inside = False
    seen = 0
    for event, el in ET.iterparse(path, events=("start", "end")):
        tag = _local(el.tag)
        if tag == "Surface":
            if event == "start":
                seen += 1
                inside = (el.get("name") or f"Surface {seen}") == name
            elif inside:
                break
            continue
        if event != "end" or not inside:
            continue
        if tag == "P":
            vals = (el.text or "").split()
            if len(vals) >= 3:
                n, e, z = (float(v) for v in vals[:3])  # LandXML order: northing easting elevation
                ids[el.get("id") or str(len(pts) + 1)] = len(pts)
                pts.append((e, n, z))
            el.clear()
        elif tag == "F":
            vals = (el.text or "").split()
            if len(vals) >= 3 and el.get("i") != "1":
                faces.append((vals[0], vals[1], vals[2]))
            el.clear()
    tri = np.array([[ids[a], ids[b], ids[c]] for a, b, c in faces if a in ids and b in ids and c in ids], dtype=np.int64)
    if len(pts) < 3 or len(tri) == 0:
        raise LandXMLError(f"surface '{name}' has no usable triangles")
    return np.array(pts, dtype=float), tri, name


_CHUNK_CANDIDATES = 4_000_000  # lattice-point/triangle pairs tested per batch (bounds memory)


def sample_tin(pts: np.ndarray, tri: np.ndarray, across: int = LATTICE_ACROSS) -> np.ndarray:
    """A regular lattice of points on the TIN (linear interpolation inside each triangle).

    Pure NumPy (the bundled engine leaves Matplotlib out): each triangle tests
    the lattice points inside its bounding box with barycentric coordinates.
    Lattice points no triangle covers (outside the TIN, or in a hole) are dropped.
    """
    used = np.unique(tri)
    lo, hi = pts[used, :2].min(axis=0), pts[used, :2].max(axis=0)
    step = float(np.max(hi - lo)) / across or 1.0
    x0, y0 = lo[0] + step / 2, lo[1] + step / 2
    nx = max(1, int(np.ceil((hi[0] - x0) / step)))
    ny = max(1, int(np.ceil((hi[1] - y0) / step)))
    z = np.full(nx * ny, np.nan)

    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    txy = np.stack([a[:, :2], b[:, :2], c[:, :2]], axis=1)  # (M, 3 corners, 2)
    c0 = np.clip(np.ceil((txy[:, :, 0].min(axis=1) - x0) / step), 0, nx).astype(np.int64)
    c1 = np.clip(np.floor((txy[:, :, 0].max(axis=1) - x0) / step), -1, nx - 1).astype(np.int64)
    r0 = np.clip(np.ceil((txy[:, :, 1].min(axis=1) - y0) / step), 0, ny).astype(np.int64)
    r1 = np.clip(np.floor((txy[:, :, 1].max(axis=1) - y0) / step), -1, ny - 1).astype(np.int64)
    w = np.maximum(c1 - c0 + 1, 0)
    counts = w * np.maximum(r1 - r0 + 1, 0)

    start = 0
    while start < len(tri):
        # a batch of triangles whose bounding boxes hold at most _CHUNK_CANDIDATES lattice points
        end = start + max(1, int(np.searchsorted(np.cumsum(counts[start:]), _CHUNK_CANDIDATES)))
        t = np.repeat(np.arange(start, end), counts[start:end])
        if len(t):
            first = np.repeat(np.cumsum(counts[start:end]) - counts[start:end], counts[start:end])
            off = np.arange(len(t)) - first
            col = c0[t] + off % w[t]
            row = r0[t] + off // w[t]
            px, py = x0 + col * step, y0 + row * step
            ax, ay = a[t, 0], a[t, 1]
            v0x, v0y = b[t, 0] - ax, b[t, 1] - ay
            v1x, v1y = c[t, 0] - ax, c[t, 1] - ay
            v2x, v2y = px - ax, py - ay
            den = v0x * v1y - v1x * v0y
            ok = np.abs(den) > 1e-12  # skip degenerate (zero-area) triangles
            with np.errstate(divide="ignore", invalid="ignore"):
                wb = (v2x * v1y - v1x * v2y) / den
                wc = (v0x * v2y - v2x * v0y) / den
            wa = 1.0 - wb - wc
            eps = -1e-9  # points on an edge belong to both neighbours; either value is the same
            inside = ok & (wa >= eps) & (wb >= eps) & (wc >= eps)
            idx = (row * nx + col)[inside]
            z[idx] = (wa * a[t, 2] + wb * b[t, 2] + wc * c[t, 2])[inside]
        start = end

    keep = ~np.isnan(z)
    rows, cols = np.divmod(np.nonzero(keep)[0], nx)
    return np.column_stack([x0 + cols * step, y0 + rows * step, z[keep]])


_cache: Dict[tuple, Tuple[np.ndarray, str]] = {}
_lock = threading.Lock()


def load_surface(path: str, surface: Optional[str] = None) -> Tuple[np.ndarray, str]:
    """Sampled points of a surface and its name. Cached until the file changes."""
    key = (os.path.abspath(path), os.path.getmtime(path), surface)
    with _lock:
        if key in _cache:
            return _cache[key]
    pts, tri, name = read_tin(path, surface)
    result = (sample_tin(pts, tri), name)
    with _lock:
        _cache.clear()  # one surface at a time is plenty: they're cheap to rebuild
        _cache[key] = result
    return result


def write(path: str, surfaces: List[Tuple[str, np.ndarray, np.ndarray]], unit: str = "meter",
          crs_name: Optional[str] = None) -> None:
    """Write TIN surfaces (name, points[E, N, Z], triangles) as LandXML 1.2.

    Used by the demo generators, tests and the LandXML surface export. Values are
    written as given (already in ``unit``) with four decimals.
    """
    from xml.sax.saxutils import quoteattr

    metric = unit in ("meter", "millimeter", "centimeter")
    system = "Metric" if metric else "Imperial"
    area, volume = ("squareMeter", "cubicMeter") if metric else ("squareFoot", "cubicYard")
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">\n')
        f.write(f'  <Units><{system} linearUnit="{unit}" areaUnit="{area}" volumeUnit="{volume}"/></Units>\n')
        if crs_name:
            f.write(f'  <CoordinateSystem name={quoteattr(crs_name)}/>\n')
        f.write("  <Surfaces>\n")
        for name, pts, tri in surfaces:
            f.write(f'    <Surface name={quoteattr(name)}>\n      <Definition surfType="TIN">\n        <Pnts>\n')
            for k, (e, n, z) in enumerate(pts, 1):
                f.write(f'          <P id="{k}">{n:.4f} {e:.4f} {z:.4f}</P>\n')
            f.write("        </Pnts>\n        <Faces>\n")
            for a, b, c in tri:
                f.write(f"          <F>{a + 1} {b + 1} {c + 1}</F>\n")
            f.write("        </Faces>\n      </Definition>\n    </Surface>\n")
        f.write("  </Surfaces>\n</LandXML>\n")
