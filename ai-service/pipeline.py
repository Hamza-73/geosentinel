"""End-to-end analysis for one job: polygon in, GeoJSON out.

Both tasks start from the same imagery: tiles under the area + 1 ring of
neighbour tiles, stitched into one mosaic.

detect:  YOLO-OBB (1024 px SAHI slices + zoomed-out pass for large objects)
         → real-world size check → rotated boxes of objects centred inside
         the polygon, with class names.
segment: no detector. Like the old ai-segmenter's bbox mode: the drawn
         area's bounding box is one SAM 2.1 prompt and SAM outlines the
         object inside it (labelled "object").

Output: GeoJSON FeatureCollection (label + confidence per feature) and
per-label counts. No database or hosting code here.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from shapely.geometry import MultiPolygon, Polygon, box as shapely_box, mapping
from shapely.ops import unary_union

import infer
import segment
from config import Settings, settings as default_settings
from geo import meters_per_pixel, polygon_from_geojson
from tiles import Mosaic, build_mosaic

Kind = Literal["detect", "segment"]

# Progress fraction 0..1.
ReportFn = Callable[[float], None]

# Simplify outlines (tolerance in mosaic pixels) and drop slivers.
SIMPLIFY_PX = 1.0
MIN_AREA_PX = 40
# Breathing room around detector boxes for SAM prompts; SAM outlines are
# also cut back to this padded box so they can't bleed into neighbours.
BOX_PAD_PX = 6


@dataclass
class AnalysisResult:
    geojson: dict  # FeatureCollection
    stats: dict[str, int]  # label → count
    mosaic: Mosaic
    detections: int  # detector hits on the whole mosaic, before filtering


def _to_lnglat(geom, mosaic: Mosaic):
    """Shapely geometry in mosaic pixels → same geometry in lng/lat."""

    def ring(coords):
        return [mosaic.to_lnglat(x, y) for x, y in coords]

    if isinstance(geom, Polygon):
        return Polygon(ring(geom.exterior.coords), [ring(i.coords) for i in geom.interiors])
    if isinstance(geom, MultiPolygon):
        return MultiPolygon([_to_lnglat(p, mosaic) for p in geom.geoms])
    raise TypeError(f"Unexpected geometry {geom.geom_type}")


def _polygonal(geom) -> Polygon | MultiPolygon | None:
    """Keep only the polygon parts of a geometry (or None)."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]
    if not polys:
        return None
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def _shape(rings) -> Polygon | MultiPolygon | None:
    parts = [Polygon(r) for r in rings if len(r) >= 3]
    parts = [p if p.is_valid else p.buffer(0) for p in parts]
    return _polygonal(unary_union(parts)) if parts else None


def run_analysis(
    kind: Kind,
    polygon_geojson: dict,
    *,
    cfg: Settings = default_settings,
    report: ReportFn | None = None,
) -> AnalysisResult:
    report = report or (lambda _p: None)
    area = polygon_from_geojson(polygon_geojson)
    zoom = cfg.detect_zoom if kind == "detect" else cfg.segment_zoom

    # Progress budget per stage.
    tiles_end = 0.3 if kind == "detect" else 0.5
    detect_end = 0.9

    # 1. Imagery: area tiles + neighbour ring, stitched.
    report(0.0)

    def on_tiles(done: int, total: int) -> None:
        report(tiles_end * done / total)

    mosaic = build_mosaic(area, zoom, cfg=cfg, on_progress=on_tiles)
    area_px = Polygon([mosaic.to_pixel(lng, lat) for lng, lat in area.exterior.coords])

    if kind == "segment":
        objects = _segment_area(mosaic, area_px, cfg, report, start=tiles_end)
        return _finish(objects, mosaic, report, detections=len(objects))

    # 2. Find and name objects.
    report(tiles_end)

    def on_slices(done: int, total: int) -> None:
        frac = tiles_end + (detect_end - tiles_end) * done / max(total, 1)
        report(frac)

    detections = infer.predict(
        mosaic.image,
        cfg.detect_model,
        cfg=cfg,
        metres_per_px=meters_per_pixel(area.centroid.y, zoom, cfg.tile_size),
        multiscale=True,
        on_progress=on_slices,
    )

    # Whole objects, counted once: keep those centred inside the area.
    kept: list[tuple[infer.Detection, Polygon | MultiPolygon]] = []
    for det in detections:
        shape_px = _shape(det.rings)
        if shape_px is not None and area_px.contains(shape_px.centroid):
            kept.append((det, shape_px))

    objects = [(d.label, d.confidence, s) for d, s in kept]
    return _finish(objects, mosaic, report, detections=len(detections))


def _segment_area(
    mosaic: Mosaic,
    area_px: Polygon,
    cfg: Settings,
    report: ReportFn,
    start: float,
) -> list[tuple[str, float, Polygon | MultiPolygon]]:
    """Segmentation, as in the old ai-segmenter's bbox mode: the drawn area's
    bounding box is one SAM prompt, and SAM outlines the object inside it.
    No detector, no class names."""
    report(start)

    def on_windows(done: int, total: int) -> None:
        report(start + (0.95 - start) * done / max(total, 1))

    x0, y0, x1, y1 = area_px.bounds
    prompt = (x0, y0, x1, y1)
    outlines = segment.outline_boxes(mosaic.image, [prompt], cfg=cfg, on_progress=on_windows)
    outline = _shape(outlines[0]) if outlines else None
    if outline is None:
        return []
    # SAM can spill slightly past its prompt; keep it within the (padded) box.
    padded = shapely_box(x0 - BOX_PAD_PX, y0 - BOX_PAD_PX, x1 + BOX_PAD_PX, y1 + BOX_PAD_PX)
    outline = _polygonal(outline.intersection(padded))
    return [("object", 1.0, outline)] if outline is not None else []


def _finish(
    objects: list[tuple[str, float, Polygon | MultiPolygon]],
    mosaic: Mosaic,
    report: ReportFn,
    detections: int,
) -> AnalysisResult:
    """Pixels → lng/lat GeoJSON + per-label counts."""
    report(0.95)
    features = []
    counts: Counter[str] = Counter()
    for label, conf, geom_px in objects:
        geom_px = _polygonal(geom_px.simplify(SIMPLIFY_PX))
        if geom_px is None or geom_px.area < MIN_AREA_PX:
            continue
        counts[label] += 1
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(_to_lnglat(geom_px, mosaic)),
                "properties": {"label": label, "confidence": conf},
            }
        )

    report(1.0)
    return AnalysisResult(
        geojson={"type": "FeatureCollection", "features": features},
        stats=dict(counts.most_common()),
        mosaic=mosaic,
        detections=detections,
    )
