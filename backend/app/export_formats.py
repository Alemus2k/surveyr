"""File formats Surveyr writes for a contractor's partners: pure functions, no I/O policy.

Every writer takes metres (the engine's unit) and an output ``unit`` — "m",
"us_ft" (US survey foot, 1200/3937 m) or "ft" (international foot, 0.3048 m) —
and scales coordinates *and* elevations together. Coordinates stay float64 and
are written with at least four decimals, so state-plane / UTM values in the
millions keep sub-millimetre precision.

- DXF (ASCII, AutoCAD R12 / AC1009 — opens in every CAD package)
- LandXML TIN surface (two triangles per measured grid square)
- CSV points, PNEZD
- ESRI ASCII grid (.asc) with an optional .prj
- GeoJSON FeatureCollection
"""
from __future__ import annotations

import json
import math
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

UNIT_TO_M = {"m": 1.0, "us_ft": 1200 / 3937, "ft": 0.3048}
UNIT_LABEL = {"m": "m", "us_ft": "US ft", "ft": "ft"}
# $INSUNITS codes: 6 = metres, 2 = feet, 21 = US survey feet (AutoCAD 2017+; older CAD reads it as unitless)
DXF_INSUNITS = {"m": 6, "ft": 2, "us_ft": 21}
LANDXML_UNIT = {"m": "meter", "ft": "foot", "us_ft": "USSurveyFoot"}
NODATA = -9999.0

# DXF layers: name -> ACI colour
DXF_LAYERS = {
    "CONTOUR_MAJOR": 7,  # white / black
    "CONTOUR_MINOR": 8,  # grey
    "CONTOUR_LABELS": 7,
    "SPOT": 3,  # green
    "ZONES": 2,  # yellow
    "LOD": 1,  # red
    "ALIGNMENTS": 4,  # cyan
}


def scale_of(unit: str) -> float:
    """Multiply metres by this to get ``unit``."""
    return 1.0 / UNIT_TO_M[unit]


def label_decimals(step: float) -> int:
    """Fewest decimals (0–3) that show a value that is a multiple of ``step`` exactly."""
    for d in range(4):
        if abs(round(step, d) - step) < 1e-6:
            return d
    return 3


# ------------------------------------------------------------------ grid helpers


def cell_centres(nx: int, ny: int, x0: float, y0: float, cell: float) -> Tuple[np.ndarray, np.ndarray]:
    return x0 + (np.arange(nx) + 0.5) * cell, y0 + (np.arange(ny) + 0.5) * cell


def spot_grid(z: np.ndarray, x0: float, y0: float, cell: float, spacing_m: float,
              inside: Optional[np.ndarray] = None) -> Tuple[np.ndarray, float]:
    """Spot elevations on a regular lattice of cell centres: ``((N, 3) E, N, Z, actual spacing)``.

    The lattice takes every ``k``-th cell (``k`` = spacing / cell, at least 1),
    so each spot is a real measured cell value — nothing is interpolated. Rows
    are ordered south to north, west to east. Unmeasured cells (NaN) and cells
    outside ``inside`` (a boolean mask) are skipped.
    """
    ny, nx = z.shape
    k = max(1, int(round(spacing_m / cell)))
    rows = np.arange(min(k // 2, ny - 1), ny, k)
    cols = np.arange(min(k // 2, nx - 1), nx, k)
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    rr, cc = rr.ravel(), cc.ravel()
    vals = z[rr, cc]
    ok = np.isfinite(vals)
    if inside is not None:
        ok &= inside[rr, cc]
    rr, cc = rr[ok], cc[ok]
    xs, ys = cell_centres(nx, ny, x0, y0, cell)
    return np.column_stack([xs[cc], ys[rr], z[rr, cc]]), k * cell


def polygon_mask(poly: Sequence[Sequence[float]], nx: int, ny: int, x0: float, y0: float, cell: float) -> np.ndarray:
    """Cells whose centre is inside ``poly`` (even–odd ray casting, as the app's zoneCells)."""
    xs, ys = cell_centres(nx, ny, x0, y0, cell)
    gx, gy = np.meshgrid(xs, ys)
    inside = np.zeros((ny, nx), dtype=bool)
    p = np.asarray(poly, dtype=float)
    for (x1, y1), (x2, y2) in zip(p, np.roll(p, -1, axis=0)):
        if y1 == y2:
            continue  # a horizontal edge never changes the crossing count
        cross = (y1 > gy) != (y2 > gy)
        inside ^= cross & (gx < x1 + (gy - y1) * (x2 - x1) / (y2 - y1))
    return inside


def grid_tin(z: np.ndarray, x0: float, y0: float, cell: float) -> Tuple[np.ndarray, np.ndarray]:
    """A TIN from a grid: nodes at measured cell centres, two triangles per square
    whose four corners were all measured. Returns ``(points (N, 3), triangles (M, 3))``."""
    ny, nx = z.shape
    valid = np.isfinite(z)
    if ny < 2 or nx < 2:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    quad = valid[:-1, :-1] & valid[:-1, 1:] & valid[1:, 1:] & valid[1:, :-1]
    used = np.zeros_like(valid)
    used[:-1, :-1] |= quad
    used[:-1, 1:] |= quad
    used[1:, 1:] |= quad
    used[1:, :-1] |= quad
    index = np.full(z.shape, -1, dtype=np.int64)
    index[used] = np.arange(int(used.sum()))
    rr, cc = np.nonzero(used)
    xs, ys = cell_centres(nx, ny, x0, y0, cell)
    pts = np.column_stack([xs[cc], ys[rr], z[rr, cc]])
    qr, qc = np.nonzero(quad)
    sw, se, ne, nw = index[qr, qc], index[qr, qc + 1], index[qr + 1, qc + 1], index[qr + 1, qc]
    tri = np.concatenate([np.column_stack([sw, se, ne]), np.column_stack([sw, ne, nw])])  # counter-clockwise
    return pts, tri


# ------------------------------------------------------------------ DXF (R12)


class DxfWriter:
    """Minimal ASCII DXF R12 (AC1009): HEADER, TABLES (LTYPE, LAYER), ENTITIES.

    Entities: 3D POLYLINE (every vertex carries its elevation), 2D POLYLINE for
    plan outlines, POINT and TEXT. No handles, no OBJECTS section — the subset
    every CAD program since the 1990s reads.
    """

    def __init__(self, unit: str = "m"):
        self.unit = unit
        self.k = scale_of(unit)
        self._body: List[str] = []
        self._lo = np.array([np.inf, np.inf, np.inf])
        self._hi = -self._lo

    def _g(self, code: int, value) -> None:
        self._body.append(f"{code}\n{value}\n")

    @staticmethod
    def _num(v: float) -> str:
        return f"{v:.4f}"

    def _extend(self, pts: np.ndarray) -> None:
        if len(pts):
            self._lo = np.minimum(self._lo, pts.min(axis=0))
            self._hi = np.maximum(self._hi, pts.max(axis=0))

    def polyline3d(self, layer: str, pts_m: np.ndarray, closed: bool = False) -> None:
        """A 3D polyline through (E, N, Z) metres. A closed ring may repeat its first point; it is dropped."""
        p = np.asarray(pts_m, dtype=float) * self.k
        if closed and len(p) > 1 and np.all(p[0] == p[-1]):
            p = p[:-1]
        self._extend(p)
        self._g(0, "POLYLINE")
        self._g(8, layer)
        self._g(66, 1)
        for c, v in ((10, 0.0), (20, 0.0), (30, 0.0)):
            self._g(c, self._num(v))
        self._g(70, 8 | (1 if closed else 0))
        for x, y, z in p:
            self._g(0, "VERTEX")
            self._g(8, layer)
            self._g(10, self._num(x))
            self._g(20, self._num(y))
            self._g(30, self._num(z))
            self._g(70, 32)
        self._g(0, "SEQEND")
        self._g(8, layer)

    def polyline2d(self, layer: str, pts_m: Sequence[Sequence[float]], closed: bool = False) -> None:
        """A flat polyline (plan outline) at elevation 0."""
        p = np.asarray(pts_m, dtype=float)[:, :2] * self.k
        if closed and len(p) > 1 and np.all(p[0] == p[-1]):
            p = p[:-1]
        self._extend(np.column_stack([p, np.zeros(len(p))]))
        self._g(0, "POLYLINE")
        self._g(8, layer)
        self._g(66, 1)
        for c in (10, 20, 30):
            self._g(c, self._num(0.0))
        self._g(70, 1 if closed else 0)
        for x, y in p:
            self._g(0, "VERTEX")
            self._g(8, layer)
            self._g(10, self._num(x))
            self._g(20, self._num(y))
            self._g(30, self._num(0.0))
        self._g(0, "SEQEND")
        self._g(8, layer)

    def point(self, layer: str, x: float, y: float, z: float) -> None:
        p = np.array([x, y, z]) * self.k
        self._extend(p[None])
        self._g(0, "POINT")
        self._g(8, layer)
        for c, v in zip((10, 20, 30), p):
            self._g(c, self._num(v))

    def text(self, layer: str, x: float, y: float, z: float, height_m: float, value: str, rotation: float = 0.0) -> None:
        """Text with its insertion point at (x, y, z) metres; height in metres; rotation in degrees."""
        # R12 files are read in the drawing's code page: spell anything outside ASCII as \U+XXXX
        clean = "".join(ch if 32 <= ord(ch) < 127 else f"\\U+{ord(ch):04X}" if ord(ch) > 127 else " "
                        for ch in value)
        self._g(0, "TEXT")
        self._g(8, layer)
        for c, v in zip((10, 20, 30), np.array([x, y, z]) * self.k):
            self._g(c, self._num(v))
        self._g(40, self._num(height_m * self.k))
        self._g(1, clean)
        if rotation:
            self._g(50, f"{rotation:.3f}")

    def render(self) -> str:
        lo = np.where(np.isfinite(self._lo), self._lo, 0.0)
        hi = np.where(np.isfinite(self._hi), self._hi, 0.0)
        out: List[str] = []
        g = lambda c, v: out.append(f"{c}\n{v}\n")  # noqa: E731
        g(0, "SECTION"); g(2, "HEADER")
        g(9, "$ACADVER"); g(1, "AC1009")
        g(9, "$INSUNITS"); g(70, DXF_INSUNITS[self.unit])
        g(9, "$MEASUREMENT"); g(70, 1 if self.unit == "m" else 0)
        g(9, "$EXTMIN"); g(10, self._num(lo[0])); g(20, self._num(lo[1])); g(30, self._num(lo[2]))
        g(9, "$EXTMAX"); g(10, self._num(hi[0])); g(20, self._num(hi[1])); g(30, self._num(hi[2]))
        g(0, "ENDSEC")
        g(0, "SECTION"); g(2, "TABLES")
        g(0, "TABLE"); g(2, "LTYPE"); g(70, 1)
        g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, "0.0")
        g(0, "ENDTAB")
        g(0, "TABLE"); g(2, "LAYER"); g(70, len(DXF_LAYERS) + 1)
        for name, colour in (("0", 7), *DXF_LAYERS.items()):
            g(0, "LAYER"); g(2, name); g(70, 0); g(62, colour); g(6, "CONTINUOUS")
        g(0, "ENDTAB")
        g(0, "ENDSEC")
        g(0, "SECTION"); g(2, "ENTITIES")
        out.extend(self._body)
        g(0, "ENDSEC")
        g(0, "EOF")
        return "".join(out)


def _label_spot(line: np.ndarray) -> Optional[Tuple[float, float, float]]:
    """Where to put a contour label: the point halfway along the line, and the
    text angle along it (kept between −90° and 90° so it reads left to right)."""
    seg = np.diff(line, axis=0)
    lengths = np.hypot(seg[:, 0], seg[:, 1])
    total = float(lengths.sum())
    if total <= 0:
        return None
    cum = np.cumsum(lengths)
    i = int(np.searchsorted(cum, total / 2))
    i = min(i, len(seg) - 1)
    before = cum[i] - lengths[i]
    t = (total / 2 - before) / lengths[i] if lengths[i] > 0 else 0.0
    x, y = line[i] + seg[i] * t
    angle = math.degrees(math.atan2(seg[i, 1], seg[i, 0]))
    if angle > 90:
        angle -= 180
    elif angle < -90:
        angle += 180
    return float(x), float(y), angle


def add_contours(dxf: DxfWriter, result: dict, labels: bool = True, text_height_m: float = 1.0) -> Dict[str, int]:
    """Contour levels (from ``contours.contours``) as 3D polylines, majors labelled.

    Returns counts per layer. Labels go on major lines at least 8 text heights long.
    """
    counts = {"CONTOUR_MAJOR": 0, "CONTOUR_MINOR": 0, "CONTOUR_LABELS": 0}
    decimals = label_decimals(result["interval"] * result["major_every"] * dxf.k)
    for lv in result["levels"]:
        layer = "CONTOUR_MAJOR" if lv["major"] else "CONTOUR_MINOR"
        z = lv["elevation"]
        for line in lv["lines"]:
            closed = len(line) > 3 and bool(np.all(line[0] == line[-1]))
            dxf.polyline3d(layer, np.column_stack([line, np.full(len(line), z)]), closed=closed)
            counts[layer] += 1
            if labels and lv["major"]:
                length = float(np.hypot(*np.diff(line, axis=0).T).sum())
                spot = _label_spot(line) if length >= 8 * text_height_m else None
                if spot:
                    dxf.text("CONTOUR_LABELS", spot[0], spot[1], z, text_height_m, f"{z * dxf.k:.{decimals}f}", spot[2])
                    counts["CONTOUR_LABELS"] += 1
    return counts


def add_spots(dxf: DxfWriter, spots: np.ndarray, text_height_m: float) -> int:
    """Spot elevations: a POINT and its elevation as TEXT just north-east of it."""
    for x, y, z in spots:
        dxf.point("SPOT", x, y, z)
        dxf.text("SPOT", x + text_height_m * 0.4, y + text_height_m * 0.4, z, text_height_m, f"{z * dxf.k:.2f}")
    return len(spots)


# ------------------------------------------------------------------ CSV (PNEZD)


def write_pnezd(spots: np.ndarray, unit: str, description: str = "GROUND", header: bool = True) -> str:
    """``Point,Northing,Easting,Elevation,Description`` rows, numbered from 1, in ``unit``."""
    k = scale_of(unit)
    desc = description.replace(",", " ").replace("\n", " ")
    rows = ["Point,Northing,Easting,Elevation,Description"] if header else []
    for i, (e, n, z) in enumerate(spots, 1):
        rows.append(f"{i},{n * k:.4f},{e * k:.4f},{z * k:.4f},{desc}")
    return "\r\n".join(rows) + "\r\n"


# ------------------------------------------------------------------ ESRI ASCII grid


def write_asc(z: np.ndarray, x0: float, y0: float, cell: float, unit: str) -> str:
    """ESRI ASCII grid: corner-registered, first data row is the *north* edge, NODATA = −9999."""
    k = scale_of(unit)
    ny, nx = z.shape
    lines = [
        f"ncols {nx}",
        f"nrows {ny}",
        f"xllcorner {x0 * k:.4f}",
        f"yllcorner {y0 * k:.4f}",
        f"cellsize {cell * k:.6f}",
        f"NODATA_value {NODATA:.0f}",
    ]
    for row in z[::-1]:
        lines.append(" ".join(f"{v * k:.4f}" if np.isfinite(v) else f"{NODATA:.0f}" for v in row))
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ GeoJSON


def _ring(poly: Sequence[Sequence[float]], k: float) -> List[List[float]]:
    ring = [[round(float(x) * k, 4), round(float(y) * k, 4)] for x, y in poly]
    if ring and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    if len(ring) >= 4 and _signed_area(ring) < 0:
        ring.reverse()  # RFC 7946: exterior rings counter-clockwise
    return ring


def _signed_area(ring: List[List[float]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def site_features(site, k: float = 1.0) -> List[dict]:
    """Zones, limits of disturbance and alignments of a site as GeoJSON features.

    ``k`` scales metres to the target coordinate unit.
    """
    feats = []
    for z in site.zones:
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [_ring(z.polygon, k)]},
            "properties": {"layer": "zone", "id": z.id, "name": z.name, "kind": z.kind, "color": z.color,
                           "start": z.start, "finish": z.finish, "target_elevation_m": z.target_elevation_m,
                           "design_offset_m": z.design_offset_m},
        })
    if site.lod:
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [_ring(site.lod, k)]},
            "properties": {"layer": "lod", "id": "lod", "name": "Limits of disturbance"},
        })
    for a in site.alignments:
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[round(float(x) * k, 4), round(float(y) * k, 4)] for x, y in a.points]},
            "properties": {"layer": "alignment", "id": a.id, "name": a.name, "interval_m": a.interval_m,
                           "half_width_m": a.half_width_m},
        })
    return feats


def transform_features(feats: List[dict], fn) -> List[dict]:
    """A copy of ``feats`` with every coordinate pair mapped through ``fn(xs, ys) -> (xs, ys)``."""
    def conv(coords):
        arr = np.asarray(coords, dtype=float)
        x, y = fn(arr[:, 0], arr[:, 1])
        return [[round(float(a), 8), round(float(b), 8)] for a, b in zip(x, y)]

    out = []
    for f in feats:
        geom = f["geometry"]
        if geom["type"] == "Polygon":
            coords = [conv(r) for r in geom["coordinates"]]
        else:
            coords = conv(geom["coordinates"])
        out.append({**f, "geometry": {"type": geom["type"], "coordinates": coords}})
    return out


def feature_collection(feats: List[dict], name: str, crs_name: Optional[str], extra: Optional[dict] = None) -> str:
    doc = {"type": "FeatureCollection", "name": name}
    if crs_name:
        doc["crs"] = {"type": "name", "properties": {"name": crs_name}}
    if extra:
        doc.update(extra)
    doc["features"] = feats
    return json.dumps(doc, indent=1)
