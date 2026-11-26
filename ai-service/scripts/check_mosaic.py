"""Build a mosaic for a polygon and save it with the polygon drawn on top.

Checks that tile download, stitching and lng/lat <-> pixel conversion line
up. Run from ai-service/:

    .venv/bin/python scripts/check_mosaic.py            # default DC test area
    .venv/bin/python scripts/check_mosaic.py --zoom 19
"""

import argparse
import json
import sys
import time
from pathlib import Path

from PIL import ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from geo import lnglat_to_pixel, meters_per_pixel, pixel_to_lnglat, polygon_from_geojson  # noqa: E402
from tiles import build_mosaic  # noqa: E402

# ~150 m x 100 m block near the map's default centre (Washington DC).
DEFAULT_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-77.0295, 38.8857],
            [-77.0275, 38.8857],
            [-77.0275, 38.8866],
            [-77.0295, 38.8866],
            [-77.0295, 38.8857],
        ]
    ],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=18)
    ap.add_argument("--polygon", help="GeoJSON Polygon (string or path)")
    ap.add_argument("--out", default="output/mosaic.png")
    args = ap.parse_args()

    geom = DEFAULT_POLYGON
    if args.polygon:
        p = Path(args.polygon)
        geom = json.loads(p.read_text() if p.exists() else args.polygon)
    poly = polygon_from_geojson(geom)

    # 1. Projection round-trip sanity check.
    for lng, lat in poly.exterior.coords:
        x, y = lnglat_to_pixel(lng, lat, args.zoom, 512)
        lng2, lat2 = pixel_to_lnglat(x, y, args.zoom, 512)
        assert abs(lng - lng2) < 1e-9 and abs(lat - lat2) < 1e-9, "round-trip failed"
    print("projection round-trip: OK")

    # 2. Download + stitch.
    t0 = time.time()
    last = [0]

    def progress(done: int, total: int) -> None:
        if done == total or done - last[0] >= max(1, total // 5):
            last[0] = done
            print(f"  tiles {done}/{total}")

    mosaic = build_mosaic(poly, args.zoom, on_progress=progress)
    dt = time.time() - t0
    r = mosaic.tiles
    lat = poly.centroid.y
    print(
        f"mosaic: {mosaic.image.width}x{mosaic.image.height}px, "
        f"{r.cols}x{r.rows} tiles at z{r.zoom}, missing={mosaic.missing}, {dt:.1f}s"
    )
    print(f"ground resolution: {meters_per_pixel(lat, args.zoom, 512) * 100:.1f} cm/px")

    # 3. Draw the polygon using mosaic pixel coords.
    img = mosaic.image.copy()
    draw = ImageDraw.Draw(img)
    pts = [mosaic.to_pixel(lng, lat) for lng, lat in poly.exterior.coords]
    draw.line(pts, fill=(168, 85, 247), width=4)
    for x, y in pts[:-1]:
        draw.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255), width=3)

    # Round-trip through the mosaic too.
    lng, lat = poly.exterior.coords[0]
    x, y = mosaic.to_pixel(lng, lat)
    lng2, lat2 = mosaic.to_lnglat(x, y)
    assert abs(lng - lng2) < 1e-9 and abs(lat - lat2) < 1e-9
    print("mosaic pixel round-trip: OK")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
