# Clear Pass — Field Sampling Application Plan

## Vision

Extend Clear Pass from a Sentinel-2 overpass predictor into an **agriculture-based field sampling planner and navigator**. The app helps agronomists, crop scouts, and researchers **design statistically robust sampling schemes and navigate to sample points as efficiently as possible** — timed to coincide with cloud-free satellite overpasses. The app does not collect or record sample data; it gets the person to the right places, in the right order, at the right time.

---

## 1. Current State

| Capability | Detail |
|---|---|
| Satellite pass prediction | Sentinel-2A/B overpass times via TLE + SGP4 propagation |
| Cloud cover filtering | Open-Meteo forecast, adjustable threshold 0–100 % |
| Swath visualisation | 290 km footprint rendered on MapLibre GL map |
| Location picker | Click-to-select coordinates on interactive map |
| Deployment | Static site on Vercel, no backend required |
| Offline compute | Client-side orbital maths via satellite.js |

---

## 2. Proposed Feature Set

### 2.1 Field Boundary Management

- **Draw or import field boundaries** — draw polygons on the map or upload GeoJSON / Shapefile / KML files defining field extents.
- **Field metadata** — name, crop type, area (auto-calculated).
- **Persist boundaries** in IndexedDB so they survive page reloads and work offline.

### 2.2 Sampling Point Generation

Generate statistically valid sampling layouts within a field boundary:

| Method | Description | When to use |
|---|---|---|
| **Simple random** | N points placed uniformly at random inside the polygon | General-purpose, unbiased estimate of field-level means |
| **Stratified random** | Divide the field into a grid of equal cells; one random point per cell | Ensures spatial coverage; reduces variance vs simple random |
| **Systematic grid** | Regular grid at user-defined spacing (e.g. 50 m) clipped to the boundary | Soil sampling, uniform coverage, easy to reproduce |
| **W-pattern walk** | Classic agronomic W-shaped transect with configurable number of stops | Quick crop scouting with good spatial spread |
| **Clustered** | Random cluster centres with M sub-samples within a radius around each | When travel between areas is costly; nested variance estimation |

**Configuration options**

- Number of points (or grid spacing)
- Minimum separation distance between points
- Random seed for reproducibility
- Exclusion zones (headlands, waterways, obstacles) drawn on the map

**Implementation notes**

- Use [Turf.js](https://turfjs.org/) for point-in-polygon tests, random point generation, grid creation, and polygon area/centroid calculations.
- Display points on the map with numbered markers and a summary panel showing point count, average spacing, and spatial coverage metrics.

### 2.3 NDVI-Zone Variant Sampling

Enable targeted sampling driven by vegetation index zones:

1. **Ingest NDVI raster** — accept a GeoTIFF upload (e.g. from a drone or downloaded Sentinel-2 product) or fetch NDVI via an open API (see Section 3).
2. **Classify into zones** — segment the field into N zones (e.g. low / medium / high vigour) using equal-interval or quantile breaks.
3. **Allocate sample points per zone** — proportional to zone area, or user-defined weighting (e.g. over-sample low-vigour areas for targeted scouting).
4. **Visualise zones** — render classified NDVI as a colour-ramp overlay on the map with a legend.
5. **Within-zone placement** — apply any of the methods from 2.2 within each zone independently.

**Implementation notes**

- Use [geotiff.js](https://geotiffjs.github.io/) to parse uploaded GeoTIFFs client-side.
- Run classification in a Web Worker to keep the UI responsive.
- Pair sampling dates with upcoming clear overpasses so ground-truth aligns with satellite capture.

### 2.4 Navigation to Sample Points

Guide the user to each sampling location as efficiently as possible:

- **GPS tracking** — use the browser Geolocation API (`watchPosition`) to show the user's live position on the map.
- **Bearing and distance** — display a compass-style indicator showing direction and straight-line distance to the next point.
- **Route optimisation** — solve a nearest-neighbour or greedy TSP to minimise total walking/driving distance across all points. Show the optimised route as a polyline on the map with total estimated distance.
- **Arrival detection** — auto-advance to the next point when the user is within a configurable radius (default 3 m).
- **Audio/vibration alert** — notify the user on arrival via the Vibration API and an audio tone.
- **Progress tracker** — show points visited vs remaining, estimated distance left, and elapsed time.
- **Skip / reorder** — allow the user to skip a point (e.g. waterlogged area) or manually reorder the route.

### 2.5 Satellite-Pass Integration

Leverage the existing Clear Pass engine:

- **Schedule sampling sessions** around upcoming clear overpasses so field visits are temporally matched to satellite imagery.
- **Calendar view** — show a week/month view with clear-pass predictions, helping users plan which day to go out.
- **Notifications** — optional push notifications (via the Notifications API) the day before a clear overpass.
- **Session timing guidance** — show the overpass time for the selected day so the user knows when the satellite will capture their field.

---

## 3. Open APIs That Add Value

| API | Use Case | Auth | Cost |
|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | Weather forecast, soil temperature/moisture — helps decide if conditions are suitable for field access | None | Free |
| [Copernicus Data Space](https://dataspace.copernicus.eu/) | Download Sentinel-2 L2A scenes, NDVI products for zone sampling | OAuth2 (free registration) | Free |
| [SentinelHub Statistical API](https://www.sentinel-hub.com/) | On-the-fly NDVI statistics and tiles per polygon — avoids manual GeoTIFF upload | API key (free trial tier) | Freemium |
| [Agromonitoring (OpenWeather)](https://agromonitoring.com/) | Lightweight NDVI per polygon, soil data | API key | Free tier (1 polygon) |
| [ISRIC SoilGrids](https://rest.isric.org/) | Global soil property maps (pH, organic carbon, texture) — inform sampling density for soil surveys | None | Free |
| [OpenFreeMap / OpenStreetMap](https://openfreemap.org/) | Base map tiles (already integrated) | None | Free |
| [What3Words](https://developer.what3words.com/) | Human-readable location references for communicating sample point locations | API key | Free tier |
| [CelesTrak](https://celestrak.org/) | TLE orbital data for Sentinel-2 (already integrated) | None | Free |

### Recommended priority integrations

1. **Open-Meteo** — already in use; extend to show field-access conditions (rain forecast, soil moisture) alongside overpass predictions.
2. **Copernicus Data Space / SentinelHub** — fetch NDVI tiles or statistics per field polygon to drive zone sampling without requiring a manual GeoTIFF upload.
3. **ISRIC SoilGrids** — overlay soil type on the map to inform sampling density for soil surveys.
4. **Agromonitoring** — lightweight alternative for NDVI if SentinelHub is too heavy.

---

## 4. Data Export

The app exports the **sampling plan** — the field boundary, the generated sample points, and their optimised route — not collected observations.

### 4.1 Export formats

| Format | Purpose |
|---|---|
| **CSV** | Point ID, latitude, longitude, route order, zone (if NDVI-based) — importable into any spreadsheet or handheld GPS |
| **GeoJSON** | Sample points and field boundary as a FeatureCollection — importable into QGIS, ArcGIS, Google Earth |
| **Shapefile (zipped)** | For legacy GIS workflows — generated client-side with [shp-write](https://github.com/mapbox/shp-write) |
| **KML** | For Google Earth or handheld GPS devices that accept KML |
| **GPX** | Waypoints in GPX format for import into dedicated GPS handhelds (Garmin, Trimble) or phone GPS apps |

### 4.2 Export content

Each exported sampling plan includes:

- Field boundary polygon
- Point ID, coordinates (WGS84), and route sequence number
- NDVI zone label (if zone-based sampling was used)
- Sampling method metadata (method name, point count, spacing, seed)
- Associated satellite overpass (date, time, satellite ID) if a session was scheduled

### 4.3 Sharing

- **Copy link** — generate a shareable URL encoding the field boundary and sample points (using URL hash or query parameters for small plans).
- **Download as file** — one-click download in any of the above formats.

---

## 5. Offline and Low-Connectivity Strategy

Field sampling frequently occurs in areas with poor or no mobile signal. The application must work fully offline once a sampling plan has been prepared.

### 5.1 Progressive Web App (PWA)

- Add a **Service Worker** to cache the application shell (HTML, CSS, JS, map style) so the app loads fully offline.
- Use a **Web App Manifest** so the app can be installed to the home screen on Android/iOS.

### 5.2 Offline map tiles

- **Pre-cache map tiles** for the field area before going into the field.
  - On the field setup screen, offer a **"Download map area"** button that fetches tiles for the bounding box at zoom levels 12–18 and stores them in IndexedDB or Cache API.
  - Use the MapLibre GL `transformRequest` hook to serve tiles from the local cache when the network is unavailable.
- Estimated storage: ~50 MB per typical farm at zoom 12–18.

### 5.3 Offline workflow

```
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│  PREPARE (online)    │      │  EXECUTE (offline)   │      │  EXPORT (either)     │
│                      │      │                      │      │                      │
│  • Define field      │      │  • Open saved plan   │      │  • Download CSV /    │
│  • Fetch NDVI        │─────▶│  • Navigate to       │─────▶│    GeoJSON / GPX     │
│  • Generate points   │      │    each point via    │      │  • Share link         │
│  • Optimise route    │      │    GPS               │      │                      │
│  • Cache map tiles   │      │  • Mark points       │      │                      │
│  • Save plan locally │      │    visited           │      │                      │
└──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

- All plan data (field boundaries, sample points, routes) is persisted in **IndexedDB** — the local store is the source of truth.
- NDVI rasters fetched via API are cached locally so zone overlays render offline.
- Satellite pass predictions and weather forecasts are cached at preparation time with a staleness indicator.

### 5.4 Offline-capable features

| Feature | Online | Offline |
|---|---|---|
| Map display | Live tiles | Pre-cached tiles |
| GPS navigation | Full | Full (GPS is satellite-based, independent of mobile signal) |
| Point visit tracking | Full | Full (stored locally) |
| Pass predictions | Live TLE + weather | Cached predictions from last sync |
| NDVI overlay | API-fetched | Cached raster or pre-loaded GeoTIFF |
| Plan export | Full (all formats generated client-side) | Full |
| Weather / access conditions | Live | Last-fetched forecast (with staleness warning) |

### 5.5 Pre-departure checklist

Before heading to the field, the app should prompt:

- Map tiles downloaded for the area?
- Satellite pass predictions cached?
- Weather forecast current?
- Sampling plan saved?
- Device GPS functioning?

---

## 6. Technical Architecture

```
clear-pass/
├── index.html                  # App shell
├── manifest.json               # PWA manifest
├── sw.js                       # Service worker
├── css/
│   └── style.css
├── js/
│   ├── app.js                  # Map UI, routing, state management
│   ├── passes.js               # Satellite pass engine (existing)
│   ├── fields.js               # Field boundary draw / import / persist
│   ├── sampling.js             # Point generation algorithms
│   ├── ndvi.js                 # NDVI ingest, classification, zone allocation
│   ├── navigation.js           # GPS tracking, bearing/distance, route optimisation
│   ├── export.js               # CSV, GeoJSON, Shapefile, KML, GPX generation
│   └── db.js                   # IndexedDB wrapper (Dexie.js or idb)
├── lib/
│   ├── turf.min.js             # Geospatial operations
│   ├── geotiff.min.js          # GeoTIFF parsing
│   └── shp-write.min.js        # Shapefile export
└── api/                        # Optional serverless functions (Vercel)
    └── proxy.js                # CORS proxy for external APIs
```

### Key libraries

| Library | Purpose |
|---|---|
| [Turf.js](https://turfjs.org/) | Point-in-polygon, random points, grids, area, centroid, convex hull |
| [geotiff.js](https://geotiffjs.github.io/) | Client-side GeoTIFF reading for NDVI rasters |
| [Dexie.js](https://dexie.org/) | IndexedDB wrapper for persisting plans and cached data |
| [shp-write](https://github.com/mapbox/shp-write) | Client-side Shapefile generation |
| [satellite.js](https://github.com/shashwatak/satellite-js) | Orbital propagation (already in use) |
| [MapLibre GL JS](https://maplibre.org/) | Map rendering (already in use) |

---

## 7. Implementation Phases

### Phase 1 — Foundation (field management + sampling design)

- [ ] Field boundary drawing and GeoJSON import
- [ ] IndexedDB persistence layer (db.js)
- [ ] Sampling point generation — simple random, stratified random, systematic grid, W-pattern
- [ ] Display sample points on map with numbered markers
- [ ] Route optimisation (nearest-neighbour TSP)
- [ ] Basic CSV and GeoJSON export of sampling plans

### Phase 2 — Navigation

- [ ] Live GPS tracking on map
- [ ] Bearing/distance compass indicator to next point
- [ ] Optimised route polyline on map
- [ ] Arrival detection with auto-advance
- [ ] Audio/vibration alerts
- [ ] Progress tracker (visited / remaining / distance left)
- [ ] Skip and reorder controls

### Phase 3 — NDVI zone sampling

- [ ] GeoTIFF upload and client-side parsing
- [ ] NDVI classification into zones (equal-interval and quantile)
- [ ] Zone-weighted sample point allocation
- [ ] NDVI overlay on map with legend
- [ ] API integration (SentinelHub or Agromonitoring) for on-demand NDVI fetch

### Phase 4 — Offline resilience

- [ ] Service Worker + PWA manifest
- [ ] Offline map tile caching with "Download area" button
- [ ] Cache satellite pass predictions and weather at preparation time
- [ ] Pre-departure readiness checklist
- [ ] Connectivity status indicator

### Phase 5 — Satellite integration + polish

- [ ] Calendar view of upcoming clear overpasses per field
- [ ] Session scheduling linked to specific passes
- [ ] Push notifications for upcoming clear passes
- [ ] GPX and KML export
- [ ] Shapefile export
- [ ] Open-Meteo field-access conditions (rain, soil moisture) alongside pass predictions
- [ ] ISRIC SoilGrids overlay for soil survey planning
- [ ] Shareable plan links

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GPS accuracy in dense crop canopy | User may be 5–10 m from true point | Show accuracy circle on map; make arrival radius configurable; allow manual "I'm here" confirmation |
| Large GeoTIFF files on mobile | Memory pressure, slow parsing | Process in Web Worker; downsample to field extent; set file-size limit (e.g. 50 MB) |
| IndexedDB storage limits | Plans lost if quota exceeded | Monitor usage; warn user; offer export-and-clear for old plans |
| Browser Geolocation API inconsistency | Navigation unreliable on some devices | Show accuracy metric; fallback to lower-accuracy mode; recommend GPS-capable devices |
| CORS restrictions on external APIs | NDVI / soil API calls fail from browser | Use Vercel serverless proxy (api/proxy.js) |
| Service Worker cache invalidation | Users stuck on old version | Use versioned cache names; prompt user to refresh |
| TSP route optimisation performance | Slow for large point sets (>200 points) | Use nearest-neighbour heuristic (O(n²)); for >200 points, offer grid sub-sectioning |

---

## 9. Success Criteria

1. A user can define a field, generate a statistically valid sampling plan, and navigate to every point — **entirely offline**.
2. Sampling plans can be exported as CSV, GeoJSON, or GPX and loaded into third-party tools.
3. Route optimisation measurably reduces total walking distance vs sequential point order.
4. NDVI-zone sampling produces spatially stratified point layouts that reflect vegetation variability.
5. Sampling sessions can be timed to coincide with clear Sentinel-2 overpasses.
6. The app installs as a PWA and loads in under 3 seconds on a mid-range phone.
