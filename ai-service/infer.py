"""YOLO + SAHI sliced inference, shared by detection (OBB) and segmentation.

SAHI cuts the mosaic into overlapping slices, runs YOLO on each at full
resolution and merges the results, which matters for small objects like
cars. Both OBB corners and segmentation masks come back from SAHI as
polygons (`pred.mask.segmentation`) in mosaic pixel coordinates.
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

from config import Settings, settings as default_settings

log = logging.getLogger(__name__)

ProgressFn = Callable[[int, int], None]


@dataclass
class Detection:
    label: str
    confidence: float
    # One or more rings (a seg mask can be split), each [(x, y), ...] in
    # mosaic pixels. OBB detections have exactly one 4-point ring.
    rings: list[list[tuple[float, float]]]


def device() -> str:
    return "cuda:0" if torch.cuda.is_available() else "cpu"


@lru_cache(maxsize=4)
def load_model(model_path: str, conf: float) -> AutoDetectionModel:
    """Load once per process (each Modal container / local run)."""
    log.info("Loading %s on %s", model_path, device())
    return AutoDetectionModel.from_pretrained(
        model_type="ultralytics",
        model_path=model_path,
        confidence_threshold=conf,
        device=device(),
    )


def _rings(flat_polys: list[list[float]]) -> list[list[tuple[float, float]]]:
    rings = []
    for flat in flat_polys:
        if len(flat) < 6:  # need at least 3 points
            continue
        pts = np.asarray(flat, dtype=float).reshape(-1, 2)
        rings.append([(float(x), float(y)) for x, y in pts])
    return rings


def predict(
    image: Image.Image,
    model_path: str,
    *,
    cfg: Settings = default_settings,
    on_progress: ProgressFn | None = None,
) -> list[Detection]:
    model = load_model(model_path, cfg.conf_threshold)
    result = get_sliced_prediction(
        image,
        model,
        slice_height=cfg.slice_size,
        slice_width=cfg.slice_size,
        overlap_height_ratio=cfg.slice_overlap,
        overlap_width_ratio=cfg.slice_overlap,
        # The mosaic is large; a single downscaled full-image pass would only
        # add low-res duplicates.
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
            rings = _rings(pred.mask.segmentation)
        else:
            # Fallback for plain (axis-aligned) detection models.
            b = pred.bbox
            rings = [[(b.minx, b.miny), (b.maxx, b.miny), (b.maxx, b.maxy), (b.minx, b.maxy)]]
        if not rings:
            continue
        detections.append(
            Detection(
                label=pred.category.name,
                confidence=round(float(pred.score.value), 4),
                rings=rings,
            )
        )
    return detections
