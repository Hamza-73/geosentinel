"""Run the full pipeline (tiles → YOLO → GeoJSON) locally, without the DB.

Saves the GeoJSON and a PNG with the results drawn on the mosaic. Run from
ai-service/:

    .venv/bin/python scripts/check_analysis.py detect
    .venv/bin/python scripts/check_analysis.py segment
    .venv/bin/python scripts/check_analysis.py detect --polygon area.geojson
"""

import argparse
import colorsys
import json
import sys
import time
from pathlib import Path

from PIL import ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infer import device  # noqa: E402
from pipeline import run_analysis  # noqa: E402
from scripts.check_mosaic import DEFAULT_POLYGON  # noqa: E402


def color_for(label: str) -> tuple[int, int, int]:
    h = (hash(label) % 360) / 360
    r, g, b = colorsys.hsv_to_rgb(h, 0.85, 1.0)
    return int(r * 255), int(g * 255), int(b * 255)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["detect", "segment"])
    ap.add_argument("--polygon", help="GeoJSON Polygon (string or path)")
    args = ap.parse_args()

    geom = DEFAULT_POLYGON
    if args.polygon:
        p = Path(args.polygon)
        geom = json.loads(p.read_text() if p.exists() else args.polygon)

    last = [-1.0]

    def report(frac: float) -> None:
        if frac - last[0] >= 0.1 or frac >= 1.0:
            last[0] = frac
            print(f"  {frac * 100:5.1f}%")

    print(f"device: {device()}")
    t0 = time.time()
    res = run_analysis(args.kind, geom, report=report)
    dt = time.time() - t0

    print(f"\n{args.kind}: {res.detections} raw detection(s) on mosaic, "
          f"{len(res.geojson['features'])} kept inside the polygon, {dt:.1f}s total")
    for label, n in res.stats.items():
        print(f"  {label:20s} {n}")

    out_dir = Path("output")
    out_dir.mkdir(exist_ok=True)
    gj_path = out_dir / f"{args.kind}.geojson"
    gj_path.write_text(json.dumps(res.geojson))

    # Draw: user polygon in purple, results coloured by label.
    img = res.mosaic.image.copy()
    draw = ImageDraw.Draw(img)
    area = [res.mosaic.to_pixel(*c) for c in geom["coordinates"][0]]
    draw.line(area, fill=(168, 85, 247), width=4)
    for f in res.geojson["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        col = color_for(f["properties"]["label"])
        for poly in polys:
            pts = [res.mosaic.to_pixel(lng, lat) for lng, lat in poly[0]]
            draw.line(pts + [pts[0]], fill=col, width=2)
    png_path = out_dir / f"{args.kind}.png"
    img.save(png_path)
    print(f"\nsaved {gj_path} and {png_path}")


if __name__ == "__main__":
    main()
