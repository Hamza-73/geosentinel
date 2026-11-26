"""Service settings, read from environment variables.

Locally they come from ai-service/.env (see .env.example); on Modal they
come from a Modal secret.
"""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    # Imagery: same MapTiler satellite-v2 tiles the web map shows.
    maptiler_key: str = field(default_factory=lambda: os.environ.get("MAPTILER_KEY", ""))
    tile_url: str = "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}?key={key}"
    tile_size: int = 512  # MapTiler satellite-v2 serves 512 px tiles
    tile_timeout_s: int = field(default_factory=lambda: _int("TILE_TIMEOUT_SECONDS", 20))
    tile_workers: int = field(default_factory=lambda: _int("TILE_WORKERS", 8))
    # Optional on-disk tile cache (useful locally; empty = disabled).
    tile_cache_dir: str = field(default_factory=lambda: os.environ.get("TILE_CACHE_DIR", ""))
    # Hard cap on tiles per job, independent of the API's area limit.
    max_tiles: int = field(default_factory=lambda: _int("MAX_TILES", 400))

    # Zoom levels per task (512 px tiles → ~23 cm/px at z18, ~12 cm/px at
    # z19 around 39° latitude).
    detect_zoom: int = field(default_factory=lambda: _int("DETECT_ZOOM", 19))
    segment_zoom: int = field(default_factory=lambda: _int("SEGMENT_ZOOM", 19))

    # Models (YOLO for both tasks).
    detect_model: str = field(
        default_factory=lambda: os.environ.get("DETECT_MODEL_PATH", "models/yolo26s-obb.pt")
    )
    segment_model: str = field(
        default_factory=lambda: os.environ.get("SEGMENT_MODEL_PATH", "models/yolo26s-seg.pt")
    )
    conf_threshold: float = field(default_factory=lambda: _float("YOLO_CONF", 0.25))

    # SAHI sliced inference.
    slice_size: int = field(default_factory=lambda: _int("SAHI_SLICE_SIZE", 640))
    slice_overlap: float = field(default_factory=lambda: _float("SAHI_OVERLAP", 0.2))

    # Database (Neon, pooled URL is fine for short UPDATEs).
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))


settings = Settings()
