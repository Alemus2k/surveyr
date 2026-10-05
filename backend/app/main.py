"""Surveyr API — Phase 1.

Exposes the Phase 0 analytics over HTTP so the dashboard can show colorized
terrain and construction metrics. CORS is open for local development (Vite dev
server on a different port).

Run with:  ./.venv/bin/uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import compare, scan_settings, service, storage

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
