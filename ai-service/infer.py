"""YOLO + SAHI sliced inference, shared by detection (OBB) and segmentation.

SAHI cuts the mosaic into overlapping slices, runs YOLO on each at full
resolution and merges the results, which matters for small objects like
cars. Both OBB corners and segmentation masks come back from SAHI as
polygons (`pred.mask.segmentation`) in mosaic pixel coordinates.

Large objects (an airliner is ~470 px at z19) don't fit in one slice and
would come back in pieces, so detection can add a second, zoomed-out pass
for large classes; its whole-object boxes replace the fragments. A
real-world size check (we know metres per pixel) then removes impossible
detections, e.g. a 4 m "plane" that is really a rooftop marking.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import torch
from PIL import Image
from sahi import AutoDetectionModel
from sahi.predict import get_sliced_prediction
from shapely.geometry import Polygon

from config import Settings, settings as default_settings

log = logging.getLogger(__name__)

ProgressFn = Callable[[int, int], None]

# DOTA classes that can be bigger than one full-resolution slice; taken
# from the zoomed-out pass when it finds them.
LARGE_CLASSES = {
    "plane",
    "ship",
    "storage tank",
    "baseball diamond",
    "tennis court",
    "basketball court",
    "ground track field",
    "harbor",
    "bridge",
    "helicopter",
    "roundabout",
    "soccer ball field",
    "swimming pool",
}

# Plausible real-world size of the longest side, in metres: (min, max).
# Anything outside is dropped. Generous on purpose; only catches nonsense.
SIZE_LIMITS_M: dict[str, tuple[float, float]] = {
    "plane": (8, 90),
    "helicopter": (7, 40),
    "ship": (6, 500),
    "small vehicle": (1.5, 9),
    "large vehicle": (4, 40),
    "storage tank": (3, 150),
}


@dataclass
class Detection:
    label: str
    confidence: float
    # One or more rings (a seg mask can be split), each [(x, y), ...] in
    # mosaic pixels. OBB detections have exactly one 4-point ring.
    rings: list[list[tuple[float, float]]]

    def polygon(self) -> Polygon:
        p = Polygon(max(self.rings, key=len))
        return p if p.is_valid else p.buffer(0)


def device() -> str:
    return "cuda:0" if torch.cuda.is_available() else "cpu"


@lru_cache(maxsize=4)
def load_model(model_path: str, conf: float, imgsz: int) -> AutoDetectionModel:
    """Load once per process."""
    log.info("Loading %s on %s (imgsz %d)", model_path, device(), imgsz)
    return AutoDetectionModel.from_pretrained(
        model_type="ultralytics",
        model_path=model_path,
        confidence_threshold=conf,
        device=device(),
        image_size=imgsz,
    )


def _rings(flat_polys: list[list[float]], scale: float) -> list[list[tuple[float, float]]]:
    rings = []
    for flat in flat_polys:
        if len(flat) < 6:  # need at least 3 points
            continue
        pts = np.asarray(flat, dtype=float).reshape(-1, 2) / scale
        rings.append([(float(x), float(y)) for x, y in pts])
    return rings


def _sliced(
    image: Image.Image,
    model: AutoDetectionModel,
    cfg: Settings,
    scale: float = 1.0,
    on_progress: ProgressFn | None = None,
) -> list[Detection]:
    """One SAHI pass; results in full-resolution mosaic pixels."""
    img = image
    if scale != 1.0:
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        img = image.resize(size, Image.Resampling.LANCZOS)

    result = get_sliced_prediction(
        img,
        model,
        slice_height=cfg.slice_size,
        slice_width=cfg.slice_size,
        overlap_height_ratio=cfg.slice_overlap,
        overlap_width_ratio=cfg.slice_overlap,
        # Whole-image passes are handled by the coarse pass instead.
        perform_standard_pred=False,
        # NMS keeps the best of overlapping duplicates instead of merging
        # shapes (merging would distort rotated boxes and masks). IOS also
        # removes a box cut at a slice edge when it sits inside a whole one.
        postprocess_type="NMS",
        postprocess_match_metric="IOS",
        postprocess_match_threshold=0.5,
        auto_slice_resolution=False,
        verbose=0,
        progress_callback=on_progress,
    )

    detections: list[Detection] = []
    for pred in result.object_prediction_list:
        if pred.mask is not None and pred.mask.segmentation:
            rings = _rings(pred.mask.segmentation, scale)
        else:
            # Fallback for plain (axis-aligned) detection models.
            b = pred.bbox
            rings = [
                [(b.minx / scale, b.miny / scale), (b.maxx / scale, b.miny / scale),
                 (b.maxx / scale, b.maxy / scale), (b.minx / scale, b.maxy / scale)]
            ]
        if rings:
            detections.append(
                Detection(pred.category.name, round(float(pred.score.value), 4), rings)
            )
    return detections


def _ios(a: Polygon, b: Polygon) -> float:
    """Intersection over the smaller area."""
    smaller = min(a.area, b.area)
    return a.intersection(b).area / smaller if smaller > 0 else 0.0


def _merge_scales(fine: list[Detection], coarse: list[Detection]) -> list[Detection]:
    """Large classes: prefer whole objects from the coarse pass and drop
    full-res fragments that overlap them. Everything else: full-res."""
    whole = [d for d in coarse if d.label in LARGE_CLASSES]
    whole_polys = [d.polygon() for d in whole]
    merged = list(whole)
    for det in fine:
        if det.label in LARGE_CLASSES:
            p = det.polygon()
            if any(w.label == det.label and _ios(p, wp) > 0.3 for w, wp in zip(whole, whole_polys)):
                continue  # a fragment (or duplicate) of a whole object
        merged.append(det)
    return merged


def _longest_side(poly: Polygon) -> float:
    rect = poly.minimum_rotated_rectangle
    xs = np.asarray(rect.exterior.coords)
    return float(max(np.hypot(*(xs[i + 1] - xs[i])) for i in range(len(xs) - 1)))


def _plausible(det: Detection, metres_per_px: float) -> bool:
    limits = SIZE_LIMITS_M.get(det.label)
    if not limits:
        return True
    size_m = _longest_side(det.polygon()) * metres_per_px
    return limits[0] <= size_m <= limits[1]


def predict(
    image: Image.Image,
    model_path: str,
    *,
    cfg: Settings = default_settings,
    metres_per_px: float | None = None,
    multiscale: bool = False,
    on_progress: ProgressFn | None = None,
) -> list[Detection]:
    """Detections in mosaic pixels.

    multiscale: add the zoomed-out pass for large classes (OBB detection).
    metres_per_px: enables the real-world size check.
    """
    model = load_model(model_path, cfg.conf_threshold, cfg.model_imgsz)
    detections = _sliced(image, model, cfg, on_progress=on_progress)

    if multiscale and 0 < cfg.coarse_scale < 1:
        coarse = _sliced(image, model, cfg, scale=cfg.coarse_scale)
        detections = _merge_scales(detections, coarse)

    if metres_per_px:
        before = len(detections)
        detections = [d for d in detections if _plausible(d, metres_per_px)]
        if before != len(detections):
            log.info("size check removed %d implausible detection(s)", before - len(detections))
    return detections
