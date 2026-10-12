"""Comparisons: several scans overlaid in one view, each with its own colour,
opacity, render mode and placement. Saved as ``<id>.compare.json`` beside the
scans; the scans themselves are never modified.
"""
from __future__ import annotations

import json
import os
import re
from typing import List, Literal

from pydantic import BaseModel, Field, ValidationError

from . import service

SUFFIX = service.COMPARE_SUFFIX
MAX_LAYERS = 12
# Distinct layer colours, chosen to stay apart from each other and from the
# blue→red elevation ramp's busiest band.
LAYER_PALETTE = ("#ef8a3d", "#4db5cf", "#c27ad6", "#8ebd4c", "#e2bd48", "#e56a7c", "#6d95ee", "#d6dae0")


class CompositionInvalid(ValueError):
    """Requested comparison content can't be saved (unknown scans, bad values)."""


class LayerTransform(BaseModel):
    """Placement in metres/degrees: rotate about the layer's own centre, then shift."""

    tx: float = 0.0
    ty: float = 0.0
    tz: float = 0.0
    yaw_deg: float = Field(0.0, ge=-360, le=360)


class Layer(BaseModel):
    project_id: str
    color: str = Field(pattern=r"^#[0-9a-f]{6}$")
    opacity: float = Field(1.0, ge=0.0, le=1.0)
    visible: bool = True
    locked: bool = False
    render: Literal["points", "surface"] = "points"
    color_mode: Literal["layer", "elevation"] = "layer"
    transform: LayerTransform = Field(default_factory=LayerTransform)


class Composition(BaseModel):
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=80)
    layers: List[Layer] = Field(max_length=MAX_LAYERS)


def _path(comp_id: str) -> str:
    return os.path.join(service.DATA_DIR, comp_id + SUFFIX)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "_", name.lower()).strip("_-")[:60] or "comparison"


def _check_members(project_ids: List[str]) -> None:
    registry = service.discover_projects()
    for pid in project_ids:
        info = registry.get(pid)
        if info is None:
            raise CompositionInvalid(f"unknown project '{pid}'")
        if info["type"] in service.GROUP_TYPES:
            raise CompositionInvalid("a comparison can only contain scans")


def _write(comp_id: str, comp: Composition) -> None:
    path = _path(comp_id)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(comp.model_dump_json(indent=2))
    os.replace(tmp, path)  # atomic: a crash never leaves a half-written file


def create(name: str, project_ids: List[str]) -> dict:
    """Make a new comparison from existing scans; returns its project entry."""
    if not 1 <= len(project_ids) <= MAX_LAYERS:
        raise CompositionInvalid(f"a comparison needs 1–{MAX_LAYERS} scans")
    _check_members(project_ids)
    try:
        comp = Composition(
            name=name.strip(),
            layers=[
                Layer(project_id=pid, color=LAYER_PALETTE[i % len(LAYER_PALETTE)])
                for i, pid in enumerate(project_ids)
            ],
        )
    except ValidationError as exc:
        raise CompositionInvalid(str(exc)) from exc
    base = _slug(comp.name)
    comp_id, n = base, 2
    while comp_id in service.discover_projects():
        comp_id, n = f"{base}_{n}", n + 1
    _write(comp_id, comp)
    return service.discover_projects()[comp_id]


def load(comp_id: str) -> Composition:
    """Read a comparison, dropping layers whose scan no longer exists."""
    info = service.discover_projects().get(comp_id)
    if info is None or info["type"] != "compare":
        raise service.ProjectNotFound(comp_id)
    with open(_path(comp_id)) as f:
        comp = Composition.model_validate(json.load(f))
    registry = service.discover_projects()
    comp.layers = [layer for layer in comp.layers if layer.project_id in registry]
    return comp


def save(comp_id: str, comp: Composition) -> Composition:
    info = service.discover_projects().get(comp_id)
    if info is None or info["type"] != "compare":
        raise service.ProjectNotFound(comp_id)
    _check_members([layer.project_id for layer in comp.layers])
    _write(comp_id, comp)
    return comp
