"""Surveyr API — Phase 1.

Exposes the Phase 0 analytics over HTTP so the dashboard can show colorized
terrain and construction metrics. CORS is open for local development (Vite dev
server on a different port).

Run with:  ./.venv/bin/uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import compare, control, scan_settings, service, sites, storage

app = FastAPI(title="Surveyr API", version="0.2.0", description="Land surveying terrain analytics")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only; restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "projects": service.list_projects()}


@app.get("/api/projects")
def projects() -> list:
    return service.list_projects()


@app.get("/api/analysis/{project_id}")
def analysis(
    project_id: str,
    cell: Optional[float] = Query(None, ge=service.MIN_CELL, le=50.0),
) -> dict:
    """Full terrain analytics + grid surfaces for a project.

    Omit ``cell`` to size the raster from the scan footprint.
    """
    try:
        return service.analyze(project_id, cell_size=cell)
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="comparisons have no single terrain; open a layer's own project")
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown project '{project_id}'")

@app.get("/api/points/{project_id}")
def points(
    project_id: str,
    limit: int = Query(service.DEFAULT_POINT_LIMIT, ge=1, le=1_000_000),
) -> Response:
    """Cleaned, thinned point cloud in metres (manual adjustments applied).

    Binary layout: 3 little-endian float64 (origin x, y, z) followed by
    float32 x, y, z triples relative to that origin. The split keeps
    millimetre precision for survey-grid coordinates (millions of metres).
    """
    try:
        origin, rel = service.sample_points_with_origin(project_id, limit=limit)
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="request each layer's points by its own project id")
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown project '{project_id}'")
    return Response(
        content=origin.astype("<f8").tobytes() + rel.astype("<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Point-Count": str(len(rel))},
    )


@app.post("/api/scans", status_code=201)
def import_scan(file: UploadFile = File(...)) -> dict:
    """Import a scan (.ply/.las/.laz/.xyz) as a new project; returns the project."""
    try:
        saved = storage.import_scan(service.DATA_DIR, file.filename or "scan", file.file)
    except storage.ImportRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    detected = scan_settings.apply_detected_on_import(saved)
    return {**service.discover_projects()[os.path.splitext(saved)[0]], "detected": detected}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    """Move a project's scan file(s) to the Trash."""
    try:
        removed = service.delete_project(project_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown project '{project_id}'")
    return {"id": project_id, "removed": removed}


class NewComposition(compare.BaseModel):
    name: str
    project_ids: list[str]


@app.post("/api/compositions", status_code=201)
def create_composition(body: NewComposition) -> dict:
    """Create a comparison overlaying existing scans; returns its project entry."""
    try:
        return compare.create(body.name, body.project_ids)
    except compare.CompositionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/compositions/{comp_id}")
def get_composition(comp_id: str) -> compare.Composition:
    try:
        return compare.load(comp_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown comparison '{comp_id}'")


@app.put("/api/compositions/{comp_id}")
def put_composition(comp_id: str, body: compare.Composition) -> compare.Composition:
    """Save layer settings (colours, opacity, placement…)."""
    try:
        return compare.save(comp_id, body)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown comparison '{comp_id}'")
    except compare.CompositionInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _settings_response(project_id: str) -> dict:
    return {"settings": scan_settings.load(project_id), "detected": scan_settings.detect(project_id)}


@app.get("/api/projects/{project_id}/settings")
def get_scan_settings(project_id: str) -> dict:
    """A scan's manual adjustments plus what its units appear to be."""
    try:
        return _settings_response(project_id)
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="comparisons have no scan settings")
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown project '{project_id}'")


@app.put("/api/projects/{project_id}/settings")
def put_scan_settings(project_id: str, body: scan_settings.ScanSettings) -> dict:
    try:
        scan_settings.save(project_id, body)
        return _settings_response(project_id)
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="comparisons have no scan settings")
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown project '{project_id}'")


# ------------------------------------------------------------------ job sites


class NewSite(sites.BaseModel):
    name: str
    scans: list[sites.SiteScan]
    design_id: Optional[str] = None


@app.post("/api/sites", status_code=201)
def create_site(body: NewSite) -> dict:
    """Create a progress-tracking site from dated scans; returns its project entry."""
    try:
        return sites.create(body.name, [s.model_dump() for s in body.scans], body.design_id)
    except sites.SiteInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/sites/{site_id}")
def get_site(site_id: str) -> sites.Site:
    try:
        return sites.load(site_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")


@app.put("/api/sites/{site_id}")
def put_site(site_id: str, body: sites.Site) -> sites.Site:
    """Save zones, pay apps, scan dates and tolerances."""
    try:
        return sites.save(site_id, body)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")
    except sites.SiteInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/sites/{site_id}/grids")
def site_grids(site_id: str) -> dict:
    """Every scan of the site and its design on one shared elevation grid."""
    try:
        return sites.grids(site_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")


@app.get("/api/sites/{site_id}/qa")
def site_qa(site_id: str) -> list:
    """Each flight's vertical accuracy against the site's control points."""
    try:
        return sites.qa(site_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")


# ------------------------------------------------------------------ control points


@app.get("/api/control")
def list_control() -> list:
    return control.list_sets()


@app.post("/api/control", status_code=201)
def import_control(
    file: UploadFile = File(...),
    name: str = Form(""),
    unit: str = Form("m"),
    order: control.Order = Form("PNEZD"),
) -> dict:
    """Import check points from a CSV / text file (PNEZD by default, or a header row)."""
    raw = file.file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="control point files are limited to 5 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    default_name = os.path.splitext(file.filename or "control")[0]
    try:
        return control.create(name or default_name, text, unit, order)
    except control.ControlInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/control/{control_id}")
def get_control(control_id: str) -> control.ControlSet:
    try:
        return control.load(control_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown control set '{control_id}'")


@app.delete("/api/control/{control_id}")
def delete_control(control_id: str) -> dict:
    try:
        control.delete(control_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown control set '{control_id}'")
    return {"id": control_id}


@app.get("/api/projects/{project_id}/control-check")
def control_check(project_id: str, control_id: str = Query(..., alias="control")) -> dict:
    """A scan's ground compared with each control point, plus accuracy statistics."""
    try:
        return control.check(project_id, control_id)
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="check a scan, not a comparison or site")
    except service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=f"unknown project or control set '{exc.args[0]}'")
