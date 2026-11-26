"""End-to-end analysis for one job: polygon in, GeoJSON out.

    mosaic (tiles) → YOLO/SAHI → pixel shapes → lng/lat → keep what's inside
    the user's polygon → FeatureCollection + per-class counts

No database or Modal code here, so it runs the same locally and on Modal.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

import infer
from config import Settings, settings as default_settings
from geo import polygon_from_geojson
from tiles import Mosaic, build_mosaic

Kind = Literal["detect", "segment"]

# (fraction 0..1, message)
ReportFn = Callable[[float, str], None]

# Progress budget per stage.
TILES_END = 0.35
INFER_END = 0.9

# Segmentation: drop slivers left after clipping to the user's polygon, and
# simplify mask outlines (tolerance in mosaic pixels).
MIN_SEG_AREA_PX = 40
SIMPLIFY_PX = 1.0


@dataclass
class AnalysisResult:
    geojson: dict  # FeatureCollection
    stats: dict[str, int]  # label → count
    mosaic: Mosaic
    detections: int  # before filtering to the polygon


def _model_and_zoom(kind: Kind, cfg: Settings) -> tuple[str, int]:
    if kind == "detect":
        return cfg.detect_model, cfg.detect_zoom
    return cfg.segment_model, cfg.segment_zoom


def _to_lnglat(geom, mosaic: Mosaic):
    """Shapely geometry in mosaic pixels → same geometry in lng/lat."""

    def ring(coords):
        return [mosaic.to_lnglat(x, y) for x, y in coords]

    if isinstance(geom, Polygon):
        return Polygon(ring(geom.exterior.coords), [ring(i.coords) for i in geom.interiors])
    if isinstance(geom, MultiPolygon):
        return MultiPolygon([_to_lnglat(p, mosaic) for p in geom.geoms])
    raise TypeError(f"Unexpected geometry {geom.geom_type}")


def run_analysis(
    kind: Kind,
    polygon_geojson: dict,
    *,
    cfg: Settings = default_settings,
    report: ReportFn | None = None,
) -> AnalysisResult:
    report = report or (lambda _p, _m: None)
    area = polygon_from_geojson(polygon_geojson)
    model_path, zoom = _model_and_zoom(kind, cfg)

    # 1. Imagery
    report(0.0, "Downloading imagery")

    def on_tiles(done: int, total: int) -> None:
        report(TILES_END * done / total, f"Downloading imagery ({done}/{total} tiles)")

    mosaic = build_mosaic(area, zoom, cfg=cfg, on_progress=on_tiles)

    # 2. Inference
    verb = "Detecting objects" if kind == "detect" else "Segmenting objects"
    report(TILES_END, verb)

    def on_slices(done: int, total: int) -> None:
        frac = TILES_END + (INFER_END - TILES_END) * done / max(total, 1)
        report(frac, f"{verb} (slice {done}/{total})")

    detections = infer.predict(mosaic.image, model_path, cfg=cfg, on_progress=on_slices)

    # 3. Pixels → lng/lat, keep what's inside the user's polygon
    report(INFER_END, "Preparing results")
    area_px = Polygon([mosaic.to_pixel(lng, lat) for lng, lat in area.exterior.coords])

    features = []
    counts: Counter[str] = Counter()
    for det in detections:
        parts = [Polygon(r) for r in det.rings if len(r) >= 3]
        parts = [p if p.is_valid else p.buffer(0) for p in parts]
        shape_px = unary_union(parts)
        if shape_px.is_empty:
            continue

        if kind == "detect":
            # Whole object, counted once: keep it if its centre is inside.
            if not area_px.contains(shape_px.centroid):
                continue
        else:
            # Outlines are clipped to the drawn area.
            shape_px = shape_px.intersection(area_px).simplify(SIMPLIFY_PX)
            if shape_px.is_empty or shape_px.area < MIN_SEG_AREA_PX:
                continue
            if shape_px.geom_type == "GeometryCollection":
                polys = [g for g in shape_px.geoms if isinstance(g, Polygon)]
                if not polys:
                    continue
                shape_px = MultiPolygon(polys) if len(polys) > 1 else polys[0]

        geom = _to_lnglat(shape_px, mosaic)
        counts[det.label] += 1
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {"label": det.label, "confidence": det.confidence},
            }
        )

    report(1.0, f"Done: {len(features)} object(s)")
    return AnalysisResult(
        geojson={"type": "FeatureCollection", "features": features},
        stats=dict(counts.most_common()),
        mosaic=mosaic,
        detections=len(detections),
    )
