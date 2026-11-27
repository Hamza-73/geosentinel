"""SAM 2.1 outlines for boxes (box-prompted segmentation).

The detector finds and names objects; SAM 2.1 traces the exact outline
inside each box. SAM doesn't need to recognise the object, so it works on
aerial imagery without training.

Runs on ~1024 px windows of the mosaic (SAM 2.1's input size) so small
objects like cars aren't shrunk first. All boxes in a window share one
image encoding, which is the expensive part on CPU.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image

from config import Settings, settings as default_settings

log = logging.getLogger(__name__)

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in mosaic pixels
Ring = list[tuple[float, float]]
ProgressFn = Callable[[int, int], None]

MIN_CONTOUR_AREA_PX = 20


@lru_cache(maxsize=1)
def load_sam(model_path: str):
    from ultralytics import SAM  # slow import; only when segmenting

    log.info("Loading SAM %s", model_path)
    return SAM(model_path)


def _mask_rings(mask: np.ndarray, offset: tuple[int, int]) -> list[Ring]:
    """Outer contours of a mask, shifted into mosaic pixels."""
    m = (mask > 0.5).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    ox, oy = offset
    rings = []
    for c in contours:
        if cv2.contourArea(c) < MIN_CONTOUR_AREA_PX or len(c) < 3:
            continue
        rings.append([(float(x + ox), float(y + oy)) for x, y in c.reshape(-1, 2)])
    return rings


def outline_boxes(
    image: Image.Image,
    boxes: list[Box],
    *,
    cfg: Settings = default_settings,
    on_progress: ProgressFn | None = None,
) -> list[list[Ring]]:
    """One list of rings per input box (empty if SAM had no confident mask)."""
    if not boxes:
        return []
    model = load_sam(cfg.sam_model)
    W = cfg.sam_window
    margin = W // 8  # context around each window's core cell
    step = W - 2 * margin
    img_w, img_h = image.size

    # Group boxes by the window whose core contains the box centre.
    groups: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        groups[(int(cx // step), int(cy // step))].append(i)

    out: list[list[Ring]] = [[] for _ in boxes]
    for n, ((gx, gy), idxs) in enumerate(sorted(groups.items()), start=1):
        # Crop: the core cell plus margin, grown to fit any box that sticks
        # out, clamped to the image.
        left, top = gx * step - margin, gy * step - margin
        right, bottom = left + W, top + W
        for i in idxs:
            x0, y0, x1, y1 = boxes[i]
            left, top = min(left, int(x0)), min(top, int(y0))
            right, bottom = max(right, int(np.ceil(x1))), max(bottom, int(np.ceil(y1)))
        left, top = max(0, left), max(0, top)
        right, bottom = min(img_w, right), min(img_h, bottom)

        crop = image.crop((left, top, right, bottom))
        local = [
            [boxes[i][0] - left, boxes[i][1] - top, boxes[i][2] - left, boxes[i][3] - top]
            for i in idxs
        ]
        res = model.predict(crop, bboxes=local, verbose=False)[0]
        if res.masks is not None and res.boxes is not None:
            # Low-quality masks are dropped by Ultralytics; `cls` holds the
            # index of the prompt box each remaining mask belongs to.
            masks = res.masks.data.cpu().numpy()
            prompt_idx = res.boxes.cls.cpu().numpy().astype(int)
            for mask, k in zip(masks, prompt_idx):
                if 0 <= k < len(idxs):
                    out[idxs[k]] = _mask_rings(mask, (left, top))
        if on_progress:
            on_progress(n, len(groups))
    return out
