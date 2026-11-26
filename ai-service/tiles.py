"""Download MapTiler satellite tiles and stitch them into one mosaic.

The mosaic covers the job polygon's bounding box (plus a margin) at a fixed
zoom. Mosaic pixel (0, 0) is the top-left of tile (min_x, min_y), so
converting between mosaic pixels and lng/lat is a simple offset on top of
the global Web Mercator pixel math in geo.py.
"""

from __future__ import annotations

import io
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests
from PIL import Image
from shapely.geometry import Polygon

from config import Settings, settings as default_settings
from geo import TileRange, lnglat_to_pixel, pixel_to_lnglat, tile_range_for_polygon

# Neutral grey for tiles that are missing (404) or failed to download.
FILL = (114, 114, 114)

ProgressFn = Callable[[int, int], None]


class TileError(RuntimeError):
    pass


@dataclass
class Mosaic:
    image: Image.Image
    tiles: TileRange
    tile_size: int
    missing: int  # tiles that couldn't be fetched (filled grey)

    @property
    def zoom(self) -> int:
        return self.tiles.zoom

    @property
    def origin(self) -> tuple[int, int]:
        """Global pixel coordinates of the mosaic's top-left corner."""
        return self.tiles.min_x * self.tile_size, self.tiles.min_y * self.tile_size

    def to_lnglat(self, x: float, y: float) -> tuple[float, float]:
        ox, oy = self.origin
        return pixel_to_lnglat(ox + x, oy + y, self.zoom, self.tile_size)

    def to_pixel(self, lng: float, lat: float) -> tuple[float, float]:
        ox, oy = self.origin
        gx, gy = lnglat_to_pixel(lng, lat, self.zoom, self.tile_size)
        return gx - ox, gy - oy


class TileClient:
    def __init__(self, cfg: Settings = default_settings):
        if not cfg.maptiler_key:
            raise TileError("MAPTILER_KEY is not set")
        self.cfg = cfg
        self.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_maxsize=cfg.tile_workers)
        self.session.mount("https://", adapter)
        self.cache = Path(cfg.tile_cache_dir) if cfg.tile_cache_dir else None

    def _cache_path(self, z: int, x: int, y: int) -> Path | None:
        return self.cache / f"{z}/{x}/{y}.jpg" if self.cache else None

    def fetch(self, z: int, x: int, y: int, attempts: int = 3) -> Image.Image | None:
        """One tile as RGB, or None if the server has no tile there (404)."""
        cached = self._cache_path(z, x, y)
        if cached and cached.exists():
            return Image.open(cached).convert("RGB")

        url = self.cfg.tile_url.format(z=z, x=x, y=y, key=self.cfg.maptiler_key)
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                resp = self.session.get(url, timeout=self.cfg.tile_timeout_s)
                if resp.status_code in (204, 404):
                    return None
                if resp.status_code in (401, 403):
                    # Bad key / origin restriction: retrying won't help.
                    raise TileError(f"MapTiler refused the request (HTTP {resp.status_code})")
                resp.raise_for_status()
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                if cached:
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    cached.write_bytes(resp.content)
                return img
            except TileError:
                raise
            except Exception as exc:  # network / HTTP 5xx / decode
                last_error = exc
                time.sleep(0.5 * 2**attempt)
        raise TileError(f"Tile z{z}/{x}/{y} failed after {attempts} attempts: {last_error}")


def build_mosaic(
    polygon: Polygon,
    zoom: int,
    *,
    margin_px: int = 128,
    cfg: Settings = default_settings,
    client: TileClient | None = None,
    on_progress: ProgressFn | None = None,
) -> Mosaic:
    """Download every tile under the polygon's bbox (+margin) and stitch."""
    size = cfg.tile_size
    rng = tile_range_for_polygon(polygon, zoom, size, margin_px)
    if rng.count > cfg.max_tiles:
        raise TileError(
            f"Area needs {rng.count} tiles at z{zoom} (max {cfg.max_tiles}). Draw a smaller area."
        )

    client = client or TileClient(cfg)
    canvas = Image.new("RGB", (rng.cols * size, rng.rows * size), FILL)
    missing = 0
    done = 0

    with ThreadPoolExecutor(max_workers=cfg.tile_workers) as pool:
        futures = {pool.submit(client.fetch, zoom, x, y): (x, y) for x, y in rng.tiles()}
        for fut in as_completed(futures):
            x, y = futures[fut]
            img = fut.result()  # TileError propagates and fails the job
            if img is None:
                missing += 1
            else:
                if img.size != (size, size):
                    img = img.resize((size, size), Image.Resampling.LANCZOS)
                canvas.paste(img, ((x - rng.min_x) * size, (y - rng.min_y) * size))
            done += 1
            if on_progress:
                on_progress(done, rng.count)

    if missing == rng.count:
        raise TileError("No imagery available for this area")

    return Mosaic(image=canvas, tiles=rng, tile_size=size, missing=missing)
