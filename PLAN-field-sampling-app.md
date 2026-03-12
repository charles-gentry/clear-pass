# Clear Pass — Field Sampling Application Plan

## Vision

Extend Clear Pass from a Sentinel-2 overpass predictor into a full **agriculture-based field sampling application**. The existing satellite-pass and cloud-cover engine becomes one layer in a broader tool that helps agronomists, crop scouts, and researchers **plan, navigate, and record** in-field sample collection — timed to coincide with cloud-free satellite overpasses so that ground-truth data can be paired with imagery.

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

- **Draw or import field boundaries** — allow users to draw polygons on the map or upload GeoJSON / Shapefile / KML files defining field extents.
- **Field metadata** — name, crop type, planting date, growth stage, area (auto-calculated).
- **Persist boundaries** in IndexedDB so they survive page reloads and work offline.

### 2.2 Random Sampling Point Generation

Generate statistically valid sampling layouts within a field boundary:

| Method | Description |
|---|---|
| **Simple random** | N points placed uniformly at random inside the polygon |
| **Stratified random** | Divide the field into a grid of equal cells; place one random point per cell |
| **Systematic grid** | Regular grid at user-defined spacing (e.g. 50 m) clipped to the boundary |
| **W-pattern walk** | Classic agronomic W-shaped transect with configurable number of stops |
| **Clustered** | Random cluster centres with M sub-samples within a radius around each centre |

**Implementation notes**

- Use [Turf.js](https://turfjs.org/) for point-in-polygon tests, random point generation, grid creation, and polygon area/centroid calculations.
- Let the user set the number of points, minimum separation distance, and a seed for reproducibility.
- Display points on the map with numbered markers.

### 2.3 NDVI-Zone Variant Sampling

Enable targeted sampling driven by vegetation index zones:

1. **Ingest NDVI raster** — accept a GeoTIFF upload (e.g. from a drone or downloaded Sentinel-2 product) or fetch NDVI via an open API (see Section 3).
2. **Classify into zones** — segment the field into N zones (e.g. low / medium / high vigour) using equal-interval or quantile breaks.
3. **Allocate sample points per zone** — proportional to zone area, or user-defined weighting (e.g. over-sample low-vigour areas).
4. **Visualise zones** — render classified NDVI as a colour-ramp overlay on the map with a legend.

**Implementation notes**

- Use [geotiff.js](https://geotiffjs.github.io/) to parse uploaded GeoTIFFs client-side.
- Rasterise the NDVI within the field polygon and run classification in a Web Worker to keep the UI responsive.
- Pair sampling dates with upcoming clear overpasses so ground-truth aligns with satellite capture.

### 2.4 Navigation to Sample Points

Guide the user to each sampling location in the field:

- **GPS tracking** — use the browser Geolocation API (`watchPosition`) to show the user's live position on the map.
- **Bearing and distance** — display a compass-style indicator showing direction and straight-line distance to the next point.
- **Ordered route** — solve a nearest-neighbour or greedy TSP to suggest an efficient walking order through all points.
- **Arrival detection** — auto-advance to the next point when the user is within a configurable radius (default 3 m).
- **Audio/vibration alert** — notify the user on arrival via the Vibration API and an audio tone.

### 2.5 Sample Data Collection

At each point, capture observations:

| Field | Type | Notes |
|---|---|---|
| Photo | Camera API | Geotagged, timestamped |
| Growth stage | Select list | BBCH or Zadoks scale |
| Plant count | Numeric | Per unit area |
| Pest / disease | Multi-select + notes | Common pests for the crop type |
| Soil condition | Select | Wet / moist / dry |
| Tissue sample ID | Barcode / text | Link physical sample to digital record |
| Free-text notes | Textarea | |
| Height / LAI | Numeric | Optional measurements |

- Store all records in IndexedDB, keyed by field + session + point ID.
- Attach GPS coordinates (device position at time of recording, not just the target point).

### 2.6 Satellite-Pass Integration

Leverage the existing Clear Pass engine:

- **Schedule sampling sessions** around upcoming clear overpasses so field observations are temporally matched to satellite imagery.
- **Calendar view** — show a week/month view with clear-pass predictions, allowing users to plan trips.
- **Notifications** — optional push notifications (via the Notifications API) the day before a clear overpass.

---

## 3. Open APIs That Add Value

| API | Use Case | Auth | Cost |
|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | Weather forecast, historical weather, soil temperature/moisture | None | Free |
| [Copernicus Data Space](https://dataspace.copernicus.eu/) | Download Sentinel-2 L2A scenes, NDVI products | OAuth2 (free registration) | Free |
| [SentinelHub Statistical API](https://www.sentinel-hub.com/) | On-the-fly NDVI statistics per polygon, time-series | API key (free trial tier) | Freemium |
| [NASA AppEEARS](https://appeears.earthdatacloud.nasa.gov/) | MODIS/VIIRS vegetation indices, land surface temperature | Earthdata login (free) | Free |
| [OpenEO](https://openeo.cloud/) | Cloud-based processing of Sentinel/Landsat imagery | Free tier available | Freemium |
| [Agromonitoring (OpenWeather)](https://agromonitoring.com/) | Satellite NDVI per polygon, soil data, weather | API key | Free tier (1 polygon) |
| [ISRIC SoilGrids](https://rest.isric.org/) | Global soil property maps (pH, organic carbon, texture) | None | Free |
| [OpenFreeMap / OpenStreetMap](https://openfreemap.org/) | Base map tiles (already integrated) | None | Free |
| [What3Words](https://developer.what3words.com/) | Human-readable location references for sample points | API key | Free tier |
| [CelesTrak](https://celestrak.org/) | TLE orbital data for Sentinel-2 (already integrated) | None | Free |

### Recommended priority integrations

1. **Open-Meteo** — already in use; extend to pull soil moisture and historical weather for sampling context.
2. **Copernicus Data Space / SentinelHub** — fetch NDVI tiles or statistics per field polygon to drive zone sampling without requiring a manual GeoTIFF upload.
3. **ISRIC SoilGrids** — overlay soil type on the map to inform sampling density.
4. **Agromonitoring** — lightweight alternative for NDVI if SentinelHub is too heavy.

---

## 4. Data Export

### 4.1 Export formats

| Format | Purpose |
|---|---|
| **CSV** | Flat table of all sample observations — importable into Excel, R, QGIS |
| **GeoJSON** | Sample points with properties — importable into any GIS |
| **Shapefile (zipped)** | For legacy GIS workflows — generated client-side with [shp-write](https://github.com/mapbox/shp-write) |
| **KML** | For Google Earth visualisation |
| **PDF report** | Summary per field — map thumbnail, sample table, weather conditions at time of sampling |

### 4.2 Export content

Each exported record includes:

- Point ID, target coordinates, actual GPS coordinates at collection
- Timestamp (UTC and local)
- All observation fields (see 2.5)
- Photos as base64-embedded (GeoJSON/PDF) or as separate files (CSV + photo folder in a zip)
- Satellite pass metadata — which Sentinel overpass the session was timed to
- Weather conditions at the time of sampling (temperature, wind, cloud cover)

### 4.3 Cloud sync (optional future phase)

- Integrate with a lightweight backend (e.g. Supabase or Firebase) for multi-device sync and team collaboration.
- Export directly to Google Drive or Dropbox via their browser SDKs.

---

## 5. Offline and Low-Connectivity Strategy

Field sampling frequently occurs in areas with poor or no mobile signal. The application must degrade gracefully.

### 5.1 Progressive Web App (PWA)

- Add a **Service Worker** to cache the application shell (HTML, CSS, JS, map style) so the app loads fully offline.
- Use a **Web App Manifest** so the app can be installed to the home screen on Android/iOS.

### 5.2 Offline map tiles

- **Pre-cache map tiles** for the field area before going into the field.
  - On the field setup screen, offer a "Download map area" button that fetches tiles for the bounding box at zoom levels 12–18 and stores them in IndexedDB or Cache API.
  - Use the MapLibre GL `transformRequest` hook to serve tiles from the local cache when the network is unavailable.
- Estimated storage: ~50 MB per typical farm at zoom 12–18.

### 5.3 Offline data pipeline

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Collect     │     │  IndexedDB   │     │  Sync queue     │
│  samples     │────▶│  (local)     │────▶│  (background    │
│  in field    │     │              │     │   sync)          │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          Network restored
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │  Cloud / export  │
                                         └─────────────────┘
```

- All sample data is written to **IndexedDB first** — the local database is the source of truth.
- A **sync queue** (using the Background Sync API where supported) batches pending uploads.
- When connectivity returns, the queue drains automatically.
- A **sync status indicator** in the UI shows: online / offline / syncing / N items pending.

### 5.4 Offline-capable features

| Feature | Online | Offline |
|---|---|---|
| Map display | Live tiles | Pre-cached tiles |
| GPS navigation | Full | Full (GPS is satellite-based, independent of mobile signal) |
| Sample collection | Full | Full (stored locally) |
| Pass predictions | Live TLE + weather | Cached predictions from last sync |
| NDVI overlay | API-fetched | Cached raster or pre-loaded GeoTIFF |
| Data export | Full (CSV/GeoJSON generated client-side) | Full |
| Cloud sync | Real-time | Queued, auto-syncs on reconnect |
| Weather forecast | Live | Last-fetched forecast (with staleness warning) |

### 5.5 Conflict resolution

- Use **last-write-wins** with timestamps for simple fields.
- Photos and new sample points are append-only — no conflicts possible.
- If the same point is edited on two devices before sync, surface both versions for manual merge.

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
│   ├── fields.js               # Field boundary CRUD
│   ├── sampling.js             # Point generation algorithms
│   ├── ndvi.js                 # NDVI ingest, classification, zone sampling
│   ├── navigation.js           # GPS tracking, bearing/distance, route ordering
│   ├── collection.js           # Sample data forms, photo capture, local storage
│   ├── export.js               # CSV, GeoJSON, Shapefile, KML, PDF generation
│   ├── sync.js                 # Offline queue, background sync
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
| [Dexie.js](https://dexie.org/) | IndexedDB wrapper with sync-friendly design |
| [shp-write](https://github.com/mapbox/shp-write) | Client-side Shapefile generation |
| [jsPDF](https://github.com/parallax/jsPDF) | PDF report generation |
| [satellite.js](https://github.com/shashwatak/satellite-js) | Orbital propagation (already in use) |
| [MapLibre GL JS](https://maplibre.org/) | Map rendering (already in use) |

---

## 7. Implementation Phases

### Phase 1 — Foundation (field management + random sampling)

- [ ] Field boundary drawing and GeoJSON import
- [ ] IndexedDB persistence layer (db.js)
- [ ] Random and stratified sampling point generation
- [ ] Display sample points on map with numbered markers
- [ ] Basic CSV and GeoJSON export of points

### Phase 2 — Navigation + collection

- [ ] Live GPS tracking on map
- [ ] Bearing/distance indicator to next sample point
- [ ] Route optimisation (nearest-neighbour)
- [ ] Sample data collection form at each point
- [ ] Photo capture with geotag
- [ ] Export collected data as CSV / GeoJSON

### Phase 3 — NDVI zone sampling

- [ ] GeoTIFF upload and parsing
- [ ] NDVI classification into zones
- [ ] Zone-weighted sample point allocation
- [ ] NDVI overlay on map with legend
- [ ] API integration (SentinelHub or Agromonitoring) for on-demand NDVI

### Phase 4 — Offline resilience

- [ ] Service Worker + PWA manifest
- [ ] Offline map tile caching
- [ ] Background sync queue
- [ ] Sync status indicator
- [ ] Cache satellite pass predictions and weather

### Phase 5 — Satellite integration + polish

- [ ] Calendar view of upcoming clear overpasses
- [ ] Schedule sampling sessions linked to passes
- [ ] Push notifications for upcoming clear passes
- [ ] PDF report generation
- [ ] Shapefile and KML export
- [ ] Open-Meteo soil moisture and weather context in exports
- [ ] ISRIC SoilGrids overlay

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GPS accuracy in dense crop canopy | Points may be off by 5–10 m | Show accuracy circle on map; allow manual position adjustment |
| Large GeoTIFF files on mobile | Memory pressure, slow parsing | Process in Web Worker; downsample to field extent; set file-size limit |
| IndexedDB storage limits | Data loss if quota exceeded | Monitor usage; warn user; prioritise text over photos; offer export-and-clear |
| Browser Geolocation API inconsistency | Navigation unreliable on some devices | Fallback to lower-accuracy mode; test on target devices |
| CORS restrictions on external APIs | API calls fail from browser | Use Vercel serverless proxy (api/proxy.js) |
| Service Worker cache invalidation | Users stuck on old version | Use versioned cache names; prompt user to refresh |

---

## 9. Success Criteria

1. A user can define a field, generate sample points, navigate to them, and collect data — **entirely offline**.
2. Collected data can be exported as CSV or GeoJSON with full metadata.
3. Sampling sessions can be timed to coincide with clear Sentinel-2 overpasses.
4. NDVI-zone sampling produces statistically meaningful stratification.
5. The app installs as a PWA and loads in under 3 seconds on a mid-range phone.
