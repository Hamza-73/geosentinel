import type { StyleSpecification } from "maplibre-gl";

/**
 * MapTiler key for the browser. Set it in `.env.local`:
 *   NEXT_PUBLIC_MAPTILER_KEY=...
 * It is inlined into the client bundle at build time, so restrict it to
 * your domains in the MapTiler dashboard.
 */
export const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";

/**
 * MapTiler "satellite-v2" raster imagery (up to ~8 cm/px in cities).
 * 512 px JPEG tiles, Web Mercator, XYZ scheme, zoom 0–22.
 * The AI service should fetch the same tiles so results line up with
 * what the user sees:
 *   https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}?key=KEY
 */
export const SATELLITE_TILEJSON_URL = (key: string) =>
  `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${key}`;

/** Map style with only the satellite imagery: no labels or vector layers. */
export function satelliteStyle(key: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        // TileJSON supplies the tile URL, max zoom and attribution.
        url: SATELLITE_TILEJSON_URL(key),
        tileSize: 512,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
    projection: { type: "globe" },
  };
}
