/**
 * passes.js — Sentinel-2 clear-sky overpass prediction
 *
 * Uses satellite.js for SGP4 orbital propagation and Open-Meteo for weather.
 * All computation runs client-side.
 */

const ClearPass = (() => {
  const SAT_NAMES = ['SENTINEL-2A', 'SENTINEL-2B'];
  const SWATH_RADIUS_KM = 145.0;
  const EARTH_RADIUS_KM = 6371.0;
  const DEG2RAD = Math.PI / 180;
  const TLE_URL =
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE';
  const METEO_URL = 'https://api.open-meteo.com/v1/forecast';

  /** Great-circle distance in km between two lat/lon points. */
  function haversine(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * DEG2RAD;
    const phi2 = lat2 * DEG2RAD;
    const dphi = (lat2 - lat1) * DEG2RAD;
    const dlam = (lon2 - lon1) * DEG2RAD;
    const a =
      Math.sin(dphi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Great-circle bearing (degrees, 0=N, 90=E) from point 1 to point 2. */
  function trackBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * DEG2RAD, φ2 = lat2 * DEG2RAD;
    const Δλ = (lon2 - lon1) * DEG2RAD;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return Math.atan2(y, x) / DEG2RAD;
  }

  /**
   * Point at distKm from (lat, lon) along bearingDeg.
   * Returns GeoJSON-order [lon, lat] in degrees.
   */
  function destinationPoint(lat, lon, bearingDeg, distKm) {
    const d = distKm / EARTH_RADIUS_KM;
    const φ1 = lat * DEG2RAD;
    const λ1 = lon * DEG2RAD;
    const θ = bearingDeg * DEG2RAD;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ)
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
        Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
      );
    return [λ2 / DEG2RAD, φ2 / DEG2RAD];
  }

  /**
   * Sample the ground track ±halfDurSec seconds around a culmination.
   * Longitudes are unwrapped so the track is continuous across the anti-meridian.
   */
  function computeGroundTrack(satrec, culminationDate, halfDurSec = 480, stepSec = 30) {
    const t0 = culminationDate.getTime();
    const points = [];
    for (let dt = -halfDurSec * 1000; dt <= halfDurSec * 1000; dt += stepSec * 1000) {
      const sp = subpoint(satrec, new Date(t0 + dt));
      if (sp) points.push(sp);
    }
    // Unwrap longitudes to prevent ±180° jumps
    for (let i = 1; i < points.length; i++) {
      let lon = points[i].lon;
      const prev = points[i - 1].lon;
      while (lon - prev > 180) lon -= 360;
      while (prev - lon > 180) lon += 360;
      points[i] = { lat: points[i].lat, lon };
    }
    return points;
  }

  /**
   * Build a GeoJSON Polygon Feature for the 290 km-wide satellite swath.
   * The polygon is constructed by offsetting each ground-track point 145 km
   * perpendicularly left and right of the direction of travel.
   */
  function swathPolygon(groundTrack) {
    if (groundTrack.length < 2) return null;
    const leftEdge = [];
    const rightEdge = [];
    for (let i = 0; i < groundTrack.length; i++) {
      const p = groundTrack[i];
      const brg =
        i < groundTrack.length - 1
          ? trackBearing(p.lat, p.lon, groundTrack[i + 1].lat, groundTrack[i + 1].lon)
          : trackBearing(groundTrack[i - 1].lat, groundTrack[i - 1].lon, p.lat, p.lon);
      leftEdge.push(destinationPoint(p.lat, p.lon, brg - 90, SWATH_RADIUS_KM));
      rightEdge.push(destinationPoint(p.lat, p.lon, brg + 90, SWATH_RADIUS_KM));
    }
    const ring = [...leftEdge, ...[...rightEdge].reverse(), leftEdge[0]];
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    };
  }

  /** Fetch TLE data and return parsed satellite records for Sentinel-2A/B. */
  async function loadTLEs() {
    const resp = await fetch(TLE_URL);
    if (!resp.ok) throw new Error(`TLE fetch failed: ${resp.status}`);
    const text = await resp.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const sats = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i];
      if (SAT_NAMES.includes(name)) {
        const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
        sats.push({ name, satrec });
      }
    }
    if (sats.length === 0) {
      throw new Error('No Sentinel-2 TLEs found in feed');
    }
    return sats;
  }

  /**
   * Compute sub-satellite lat/lon at a given Date.
   * Returns { lat, lon } in degrees.
   */
  function subpoint(satrec, date) {
    const gmst = satellite.gstime(date);
    const pv = satellite.propagate(satrec, date);
    if (!pv.position) return null;
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    return {
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
    };
  }

  /**
   * Check if the satellite is above the horizon from a ground location.
   * Returns elevation angle in degrees, or null on error.
   */
  function elevation(satrec, date, obsLat, obsLon) {
    const gmst = satellite.gstime(date);
    const pv = satellite.propagate(satrec, date);
    if (!pv.position) return null;
    const observerGd = {
      longitude: obsLon * DEG2RAD,
      latitude: obsLat * DEG2RAD,
      height: 0,
    };
    const posEcf = satellite.eciToEcf(pv.position, gmst);
    const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);
    return lookAngles.elevation / DEG2RAD;
  }

  /**
   * Find passes for a single satellite over a time window.
   * Scans in 30-second steps, detects when satellite rises above 0 deg,
   * finds the culmination point, and checks if the sub-satellite point
   * is within swath range.
   */
  function findSatPasses(sat, obsLat, obsLon, startDate, endDate) {
    const passes = [];
    const stepMs = 30 * 1000; // 30-second scan step
    const fineStepMs = 5 * 1000; // 5-second fine step for culmination
    let t = startDate.getTime();
    const end = endDate.getTime();
    let wasAbove = false;
    let riseTime = null;
    let maxElev = -Infinity;
    let maxElevTime = null;

    while (t <= end) {
      const date = new Date(t);
      const elev = elevation(sat.satrec, date, obsLat, obsLon);

      if (elev !== null && elev > 0) {
        if (!wasAbove) {
          // satellite just rose
          riseTime = t;
          maxElev = elev;
          maxElevTime = t;
        }
        if (elev > maxElev) {
          maxElev = elev;
          maxElevTime = t;
        }
        wasAbove = true;
      } else if (wasAbove) {
        // satellite just set — refine culmination with finer steps
        let bestElev = maxElev;
        let bestTime = maxElevTime;
        const scanStart = Math.max(riseTime, maxElevTime - 60000);
        const scanEnd = Math.min(t, maxElevTime + 60000);
        for (let ft = scanStart; ft <= scanEnd; ft += fineStepMs) {
          const fd = new Date(ft);
          const fe = elevation(sat.satrec, fd, obsLat, obsLon);
          if (fe !== null && fe > bestElev) {
            bestElev = fe;
            bestTime = ft;
          }
        }

        // Check if sub-satellite point is within swath
        const culminationDate = new Date(bestTime);
        const sp = subpoint(sat.satrec, culminationDate);
        if (sp) {
          const dist = haversine(obsLat, obsLon, sp.lat, sp.lon);
          if (dist <= SWATH_RADIUS_KM) {
            const groundTrack = computeGroundTrack(sat.satrec, culminationDate);
            passes.push({
              time: culminationDate,
              satellite: sat.name,
              elevation: bestElev,
              distKm: Math.round(dist),
              swath: swathPolygon(groundTrack),
            });
          }
        }

        wasAbove = false;
        maxElev = -Infinity;
        maxElevTime = null;
        riseTime = null;
      }

      t += stepMs;
    }
    return passes;
  }

  /**
   * Fetch hourly cloud cover forecast from Open-Meteo, plus daily
   * sunrise/sunset times.
   * Returns { forecasts, timezone, sunEvents } where sunEvents is an array of
   * { sunrise, sunset } timestamps (ms since epoch, UTC) for each forecast day.
   */
  async function fetchForecasts(lat, lon, days) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'cloud_cover',
      daily: 'sunrise,sunset',
      forecast_days: Math.min(days, 16),
      timezone: 'auto',
    });
    const resp = await fetch(`${METEO_URL}?${params}`);
    if (!resp.ok) throw new Error(`Weather fetch failed: ${resp.status}`);
    const data = await resp.json();
    const times = data.hourly?.time ?? [];
    const covers = data.hourly?.cloud_cover ?? [];
    if (times.length === 0) throw new Error('No forecast data returned');
    // utc_offset_seconds is the pin's UTC offset; used to convert local time
    // strings (returned by Open-Meteo when timezone≠UTC) back to UTC Date objects
    // so they can be matched against the UTC-based pass times.
    const utcOffsetMs = (data.utc_offset_seconds ?? 0) * 1000;
    const forecasts = times.map((t, i) => ({
      time: new Date(new Date(t + 'Z').getTime() - utcOffsetMs),
      cover: covers[i],
    }));
    const sunriseTimes = data.daily?.sunrise ?? [];
    const sunsetTimes = data.daily?.sunset ?? [];
    const sunEvents = sunriseTimes.map((sr, i) => ({
      sunrise: new Date(new Date(sr + 'Z').getTime() - utcOffsetMs).getTime(),
      sunset: new Date(new Date(sunsetTimes[i] + 'Z').getTime() - utcOffsetMs).getTime(),
    }));
    return { forecasts, timezone: data.timezone ?? 'UTC', sunEvents };
  }

  /** Return true if passTime falls between sunrise and sunset on any forecast day. */
  function isDaytime(passTime, sunEvents) {
    const t = passTime.getTime();
    for (const ev of sunEvents) {
      if (t >= ev.sunrise && t <= ev.sunset) return true;
    }
    return false;
  }

  /** Find the nearest forecast entry to a given date and return cloud cover. */
  function nearestCloudCover(forecasts, date) {
    let best = null;
    let bestDiff = Infinity;
    for (const f of forecasts) {
      const diff = Math.abs(f.time.getTime() - date.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        best = f;
      }
    }
    return best ? best.cover : null;
  }

  /**
   * Main entry point: find all clear Sentinel-2 passes.
   * @param {number} lat
   * @param {number} lon
   * @param {number} cloudThreshold — max cloud cover percent
   * @param {number} days — forecast window
   * @param {function} onProgress — optional progress callback
   * @returns {Promise<Array>} array of { time, satellite, elevation, cloudCover }
   */
  async function getClearPasses(
    lat,
    lon,
    cloudThreshold = 20,
    days = 10,
    onProgress
  ) {
    onProgress?.('Loading satellite TLE data...');
    const sats = await loadTLEs();

    const now = new Date();
    const end = new Date(now.getTime() + days * 86400000);

    onProgress?.('Computing orbital passes...');
    let allPasses = [];
    for (const sat of sats) {
      const passes = findSatPasses(sat, lat, lon, now, end);
      allPasses = allPasses.concat(passes);
    }
    allPasses.sort((a, b) => a.time - b.time);

    onProgress?.('Fetching weather forecasts...');
    const { forecasts, timezone, sunEvents } = await fetchForecasts(lat, lon, days);

    if (allPasses.length === 0) {
      return { passes: [], timezone };
    }

    onProgress?.('Matching passes with cloud cover...');
    const results = [];
    for (const pass of allPasses) {
      if (sunEvents.length > 0 && !isDaytime(pass.time, sunEvents)) continue;
      const cloud = nearestCloudCover(forecasts, pass.time);
      if (cloud !== null && cloud <= cloudThreshold) {
        results.push({
          time: pass.time,
          satellite: pass.satellite,
          elevation: pass.elevation,
          cloudCover: cloud,
          distKm: pass.distKm,
          swath: pass.swath,
        });
      }
    }
    return { passes: results, timezone };
  }

  return { getClearPasses, haversine };
})();
