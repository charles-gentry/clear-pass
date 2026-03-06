/**
 * app.js — Map UI and interaction logic for Clear Pass
 */

(function () {
  // ── State ──
  let selectedLat = null;
  let selectedLon = null;
  let marker = null;
  let lastHoveredPassIdx = null;

  // ── Swath layer IDs ──
  const SWATH_SOURCE = 'swath-source';
  const SWATH_FILL = 'swath-fill';
  const SWATH_LINE = 'swath-line';

  // ── DOM refs ──
  const coordsDisplay = document.getElementById('coords-display');
  const latDisplay = document.getElementById('lat-display');
  const lonDisplay = document.getElementById('lon-display');
  const thresholdInput = document.getElementById('threshold');
  const thresholdValue = document.getElementById('threshold-value');
  const daysInput = document.getElementById('days');
  const daysValue = document.getElementById('days-value');
  const predictBtn = document.getElementById('predict-btn');
  const loadingEl = document.getElementById('loading');
  const resultsContent = document.getElementById('results-content');
  const hintEl = document.querySelector('#location-info .hint');

  // ── Map setup ──
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [10, 45],
    zoom: 3,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // ── Map click → pick location ──
  map.on('click', (e) => {
    selectedLat = Math.round(e.lngLat.lat * 10000) / 10000;
    selectedLon = Math.round(e.lngLat.lng * 10000) / 10000;

    // Update marker
    if (marker) marker.remove();
    marker = new maplibregl.Marker({ color: '#4f8cff' })
      .setLngLat([selectedLon, selectedLat])
      .addTo(map);

    // Update sidebar
    latDisplay.textContent = selectedLat.toFixed(4);
    lonDisplay.textContent = selectedLon.toFixed(4);
    coordsDisplay.classList.remove('hidden');
    hintEl.classList.add('hidden');
    predictBtn.disabled = false;

    // Clear previous results and swaths
    resultsContent.innerHTML = '';
    clearSwaths();
  });

  // ── Slider controls ──
  thresholdInput.addEventListener('input', () => {
    thresholdValue.textContent = thresholdInput.value + '%';
  });

  daysInput.addEventListener('input', () => {
    daysValue.textContent = daysInput.value;
  });

  // ── Predict button ──
  predictBtn.addEventListener('click', async () => {
    if (selectedLat === null) return;

    const threshold = parseInt(thresholdInput.value, 10);
    const days = parseInt(daysInput.value, 10);

    predictBtn.disabled = true;
    resultsContent.innerHTML = '';
    loadingEl.classList.remove('hidden');

    try {
      const { passes, timezone } = await ClearPass.getClearPasses(
        selectedLat,
        selectedLon,
        threshold,
        days,
        (msg) => {
          const p = loadingEl.querySelector('p');
          if (p) p.textContent = msg;
        }
      );

      loadingEl.classList.add('hidden');
      renderResults(passes, threshold, days, timezone);
      renderSwaths(passes);
      attachPassHoverHandlers(passes);
    } catch (err) {
      loadingEl.classList.add('hidden');
      resultsContent.innerHTML = `<div class="error-msg">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      predictBtn.disabled = false;
    }
  });

  // ── Swath map layers ──
  function clearSwaths() {
    if (map.getLayer(SWATH_LINE)) map.removeLayer(SWATH_LINE);
    if (map.getLayer(SWATH_FILL)) map.removeLayer(SWATH_FILL);
    if (map.getSource(SWATH_SOURCE)) map.removeSource(SWATH_SOURCE);
    lastHoveredPassIdx = null;
  }

  function renderSwaths(passes) {
    clearSwaths();
    const features = passes
      .map((p, i) => (p.swath ? { ...p.swath, properties: { index: i } } : null))
      .filter(Boolean);
    if (features.length === 0) return;

    map.addSource(SWATH_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
      promoteId: 'index',
    });

    map.addLayer({
      id: SWATH_FILL,
      type: 'fill',
      source: SWATH_SOURCE,
      paint: {
        'fill-color': '#4f8cff',
        'fill-opacity': [
          'case', ['boolean', ['feature-state', 'hovered'], false], 0.30, 0.10,
        ],
      },
    });

    map.addLayer({
      id: SWATH_LINE,
      type: 'line',
      source: SWATH_SOURCE,
      paint: {
        'line-color': '#4f8cff',
        'line-width': ['case', ['boolean', ['feature-state', 'hovered'], false], 2, 1],
        'line-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 1.0, 0.35],
      },
    });
  }

  function highlightSwath(index) {
    if (!map.getSource(SWATH_SOURCE)) return;
    if (lastHoveredPassIdx !== null) {
      map.setFeatureState({ source: SWATH_SOURCE, id: lastHoveredPassIdx }, { hovered: false });
    }
    if (index !== null) {
      map.setFeatureState({ source: SWATH_SOURCE, id: index }, { hovered: true });
    }
    lastHoveredPassIdx = index;
  }

  function attachPassHoverHandlers() {
    resultsContent.querySelectorAll('.pass-card').forEach((card, i) => {
      card.addEventListener('mouseenter', () => highlightSwath(i));
      card.addEventListener('mouseleave', () => highlightSwath(null));
    });
  }

  // ── Render results ──
  function renderResults(passes, threshold, days, timezone) {
    if (passes.length === 0) {
      resultsContent.innerHTML = `
        <div class="no-results">
          No clear passes found with &le; ${threshold}% cloud cover
          in the next ${days} days.
        </div>`;
      return;
    }

    const summary = `<p class="result-summary">${passes.length} clear pass${passes.length !== 1 ? 'es' : ''} found</p>`;
    const items = passes
      .map((p) => {
        const d = p.time;
        const dateStr = d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone,
        });
        const timeParts = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
          timeZone: timezone,
        }).formatToParts(d);
        const timeStr = timeParts
          .filter((p) => p.type !== 'timeZoneName')
          .map((p) => p.value)
          .join('')
          .trim();
        const tzLabel = timeParts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        const cloudClass =
          p.cloudCover <= 10
            ? 'cloud-low'
            : p.cloudCover <= 40
              ? 'cloud-med'
              : 'cloud-high';

        return `
        <li class="pass-card">
          <div>
            <div class="pass-time">
              <span class="pass-date">${escapeHtml(dateStr)}</span>
              <span class="pass-hour">${escapeHtml(timeStr)} <span class="pass-tz">${escapeHtml(tzLabel)}</span></span>
            </div>
            <div class="pass-satellite">${escapeHtml(p.satellite)}</div>
          </div>
          <span class="cloud-badge ${cloudClass}">${p.cloudCover}%</span>
        </li>`;
      })
      .join('');

    resultsContent.innerHTML = `${summary}<ul class="pass-list">${items}</ul>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
