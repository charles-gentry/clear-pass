/**
 * api/tle.js — Vercel serverless proxy for CelesTrak TLE data.
 *
 * Fetching TLEs directly from the browser fails with 403 because CelesTrak
 * blocks cross-origin requests. This function fetches on the server side and
 * relays the plain-text TLE data to the client.
 *
 * Cached for 1 hour at the CDN edge (TLEs are updated daily at most).
 */
const TLE_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE';

module.exports = async function handler(req, res) {
  try {
    const upstream = await fetch(TLE_URL, {
      headers: { 'User-Agent': 'clear-pass/1.0 (+https://github.com)' },
    });
    if (!upstream.ok) {
      res.status(502).send(`CelesTrak returned ${upstream.status}`);
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send(`TLE proxy error: ${err.message}`);
  }
};
