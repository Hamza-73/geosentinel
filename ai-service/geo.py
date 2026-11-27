"""Web Mercator math and polygon helpers.

Pixel coordinates here are *global* pixel coordinates at a zoom level for a
given tile size: (0, 0) is the top-left of the world, and the world is
2**zoom * tile_size pixels wide.
"""

import math
from dataclasses import dataclass

from shapely.geometry import Polygon, shape

MAX_LAT = 85.05112878


def lnglat_to_pixel(lng: float, lat: float, zoom: int, tile_size: int) -> tuple[float, float]:
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    world = tile_size * 2**zoom
    x = (lng + 180.0) / 360.0 * world
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * world
    return x, y


def pixel_to_lnglat(x: float, y: float, zoom: int, tile_size: int) -> tuple[float, float]:
    world = tile_size * 2**zoom
    lng = x / world * 360.0 - 180.0
    n = math.pi - 2.0 * math.pi * y / world
    lat = math.degrees(math.atan(math.sinh(n)))
    return lng, lat


def meters_per_pixel(lat: float, zoom: int, tile_size: int) -> float:
    """Ground resolution at a latitude."""
    return 40075016.686 * math.cos(math.radians(lat)) / (tile_size * 2**zoom)


@dataclass(frozen=True)
class TileRange:
    zoom: int
    min_x: int
    min_y: int
    max_x: int  # inclusive
    max_y: int  # inclusive

    @property
    def cols(self) -> int:
        return self.max_x - self.min_x + 1

    @property
    def rows(self) -> int:
        return self.max_y - self.min_y + 1

    @property
    def count(self) -> int:
        return self.cols * self.rows

    def tiles(self):
        for y in range(self.min_y, self.max_y + 1):
            for x in range(self.min_x, self.max_x + 1):
                yield x, y


def polygon_from_geojson(geometry: dict) -> Polygon:
    poly = shape(geometry)
    if not isinstance(poly, Polygon) or poly.is_empty:
        raise ValueError("Expected a non-empty GeoJSON Polygon")
    if not poly.is_valid:
        poly = poly.buffer(0)  # fix self-intersections
    return poly


def tile_range_for_polygon(
    poly: Polygon, zoom: int, tile_size: int, context_tiles: int = 1
) -> TileRange:
    """Tiles covering the polygon's bounding box, plus `context_tiles` rings
    of neighbouring tiles all around, so objects on the edge of the drawn
    area are seen whole and the model has surrounding context."""
    west, south, east, north = poly.bounds
    x0, y0 = lnglat_to_pixel(west, north, zoom, tile_size)
    x1, y1 = lnglat_to_pixel(east, south, zoom, tile_size)
    n = 2**zoom
    clamp = lambda v: max(0, min(n - 1, v))  # noqa: E731
    return TileRange(
        zoom=zoom,
        min_x=clamp(int(x0 // tile_size) - context_tiles),
        min_y=clamp(int(y0 // tile_size) - context_tiles),
        max_x=clamp(int(x1 // tile_size) + context_tiles),
        max_y=clamp(int(y1 // tile_size) + context_tiles),
    )
