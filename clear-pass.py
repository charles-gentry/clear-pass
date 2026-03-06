#!/usr/bin/env python3
"""
sentinel2_clear_pass.py

Predict all clear Sentinel-2A/B overpasses for a given latitude/longitude,
using TLE-based pass predictions and a single OpenWeatherMap 5-day/3-hour forecast API
call (compatible with the free tier).

Requires:
    pip install skyfield requests pytz

Usage:
    export OWM_API_KEY=your_openweathermap_api_key
    python sentinel2_clear_pass.py 51.5074 -0.1278 --threshold 20 --days 10
"""
import os
import math
import logging
import requests
from datetime import datetime, timedelta
from skyfield.api import load, wgs84, EarthSatellite, utc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('sentinel2')

# Sentinel-2 names in CelesTrak dynamic TLE feed
SAT_NAMES = ['SENTINEL-2A', 'SENTINEL-2B']
SWATH_RADIUS_KM = 145.0  # half-swath width in kilometers


def haversine(lat1, lon1, lat2, lon2):
    """Compute great-circle distance (km) between two lat/lon points."""
    R = 6371.0
    phi1, phi2 = map(math.radians, (lat1, lat2))
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_sentinel_satellites():
    """
    Fetch the dynamic 'active' TLE feed and extract Sentinel-2A/B satellites.
    """
    ts = load.timescale()
    url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE'
    logger.info(f"Fetching dynamic TLE feed: {url}")
    resp = requests.get(url)
    resp.raise_for_status()
    lines = [l.strip() for l in resp.text.splitlines() if l.strip()]
    sats = []
    for i in range(0, len(lines), 3):
        try:
            name, tle1, tle2 = lines[i], lines[i+1], lines[i+2]
        except IndexError:
            break
        if name in SAT_NAMES:
            try:
                sat = EarthSatellite(tle1, tle2, name, ts)
                sats.append(sat)
                logger.info(f"Loaded TLE for {name}")
            except Exception as e:
                logger.error(f"Failed to parse TLE for {name}: {e}")
    if not sats:
        logger.critical("No Sentinel-2 TLEs loaded; aborting.")
        raise RuntimeError('Failed to load any Sentinel-2 TLEs from feed')
    return sats


def find_passes(lat, lon, days=10):
    """
    Identify overpass culmination times within 'days' where swath covers lat/lon.
    """
    logger.info(f"Finding passes for ({lat}, {lon}) over {days} days")
    sats = load_sentinel_satellites()
    observer = wgs84.latlon(lat, lon)

    # Use timezone-aware now to avoid deprecation warning
    now = datetime.now(utc)
    ts = load.timescale()
    t0 = ts.utc(now)
    t1 = ts.utc(now + timedelta(days=days))
    pass_times = []

    for sat in sats:
        times, events = sat.find_events(observer, t0, t1, altitude_degrees=0)
        for t, ev in zip(times, events):
            if ev == 1:  # culmination
                geo = sat.at(t)
                sub = wgs84.subpoint(geo)
                dist = haversine(lat, lon, sub.latitude.degrees, sub.longitude.degrees)
                if dist <= SWATH_RADIUS_KM:
                    dt = t.utc_datetime().replace(tzinfo=None)
                    pass_times.append(dt)
    pass_times.sort()
    logger.info(f"Identified {len(pass_times)} passes within swath")
    return pass_times


def get_forecasts(lat, lon, api_key):
    """
    Fetch the 5-day/3-hour forecast once and return the list of entries.
    """
    url = 'https://api.openweathermap.org/data/2.5/forecast'
    params = {'lat': lat, 'lon': lon, 'appid': api_key, 'units': 'metric'}
    logger.info(f"Fetching 5-day/3-hour forecasts: {url}")
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    data = resp.json()
    entries = data.get('list', [])
    if not entries:
        logger.error("No forecast entries returned")
        raise RuntimeError('Forecast call returned no data')
    return entries


def select_cloud_cover(forecasts, timestamp):
    """
    Select the cloud cover percentage from the forecast entry nearest `timestamp`.

    Uses timezone-aware datetime.fromtimestamp to avoid deprecation warning.
    """
    best = min(
        forecasts,
        key=lambda f: abs(
            datetime.fromtimestamp(f['dt'], utc).replace(tzinfo=None) - timestamp
        )
    )
    dt_fore = datetime.fromtimestamp(best['dt'], utc).replace(tzinfo=None)
    clouds = best.get('clouds', {}).get('all')
    if clouds is None:
        logger.error("Missing clouds.all in forecast data at %s", dt_fore)
        raise KeyError('Missing clouds.all in forecast data')
    return clouds


def get_clear_passes(lat, lon, cloud_threshold=20, days=10, api_key=None):
    """
    Return a list of all pass datetimes that have cloud cover <= threshold.
    """
    if api_key is None:
        api_key = os.getenv('OWM_API_KEY')
    if not api_key:
        raise ValueError('Set OWM_API_KEY environment variable')

    passes = find_passes(lat, lon, days)
    if not passes:
        logger.warning('No passes found; verify coordinates or TLE feed')
        return []

    forecasts = get_forecasts(lat, lon, api_key)
    clear_passes = []

    for p in passes:
        try:
            clouds = select_cloud_cover(forecasts, p)
        except Exception as e:
            logger.warning(f"Skipping pass at {p}: {e}")
            continue
        logger.info(f"Pass {p} UTC has {clouds}% clouds")
        if clouds <= cloud_threshold:
            clear_passes.append((p, clouds))
    return clear_passes


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='List all clear Sentinel-2 passes')
    parser.add_argument('lat', type=float, help='Latitude')
    parser.add_argument('lon', type=float, help='Longitude')
    parser.add_argument('-t', '--threshold', type=int, default=20,
                        help='Max cloud cover percent')
    parser.add_argument('-d', '--days', type=int, default=10,
                        help='Search window in days')
    parser.add_argument('-k', '--api_key', type=str,
                        help='OpenWeatherMap API key')
    args = parser.parse_args()
    try:
        clears = get_clear_passes(
            args.lat, args.lon,
            args.threshold, args.days,
            args.api_key
        )
        if clears:
            print("Cloud-free passes:")
            for dt, clouds in clears:
                print(f"  {dt.isoformat()} UTC — {clouds}% clouds")
        else:
            print(f"No clear passes ≤ {args.threshold}% clouds in next {args.days} days.")
    except Exception as e:
        logger.critical(f"Fatal: {e}")
        exit(1)
