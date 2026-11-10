const GRID_API = 'https://api.carbondata.dev/v1/emission-factors/table/ember.json';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODE_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const GRID_CACHE_KEY = 'fieldnote-grid-data-v1';
const INPUT_PREFIX = 'fieldnote-input-';
const FALLBACK_WORLD_FACTOR = 0.473043;

const CAR_FACTORS = {
  petrol: 0.16152,
  diesel: 0.17265,
  hybrid: 0.12961,
};
const FLIGHT_FACTORS = {
  shortHaulPerPassengerKm: 0.22928,
  longHaulPerPassengerKm: 0.14253,
  shortHaulReturnKm: 2000,
  longHaulReturnKm: 12000,
};

const elements = {
  searchForm: document.querySelector('#location-form'),
  searchInput: document.querySelector('#location-search'),
  searchResults: document.querySelector('#search-results'),
  locateButton: document.querySelector('#locate-button'),
  locationStatus: document.querySelector('#location-status'),
  placeName: document.querySelector('#place-name'),
  placeDetail: document.querySelector('#place-detail'),
  areaEyebrow: document.querySelector('#area-eyebrow'),
  gridIntensity: document.querySelector('#grid-intensity'),
  gridYear: document.querySelector('#grid-year'),
  gridComparison: document.querySelector('#grid-comparison'),
  mapLink: document.querySelector('#map-link'),
  mapCoordinates: document.querySelector('#map-coordinates'),
  dataStatus: document.querySelector('#data-status'),
  footprintTotal: document.querySelector('#footprint-total'),
  footprintKilos: document.querySelector('#footprint-kilos'),
  footprintSummary: document.querySelector('#footprint-summary'),
  breakdownRing: document.querySelector('#breakdown-ring'),
  dietFactor: document.querySelector('#diet-factor'),
  shareButton: document.querySelector('#share-button'),
  shareStatus: document.querySelector('#share-status'),
  installButton: document.querySelector('#install-button'),
};

const inputIds = ['electricity', 'residents', 'driving', 'vehicle', 'short-flights', 'long-flights', 'diet'];
const categoryColors = ['#b5d77b', '#76aa84', '#d89061', '#5f7c62'];
let countryCodes = {};
let selectedPlace = null;
let gridData = {
  year: 2024,
  worldFactor: FALLBACK_WORLD_FACTOR,
  countries: {},
  ready: false,
};
let searchTimer = 0;
let lastSearchResults = [];
let installPrompt = null;

function safeNumber(element, fallback = 0) {
  const value = Number(element?.value);
  if (!Number.isFinite(value)) return fallback;
  const min = Number(element?.min || 0);
  const max = Number(element?.max || Number.MAX_SAFE_INTEGER);
  return Math.min(Math.max(value, min), max);
}

function formatInteger(value) {
  return Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatCoordinates(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? 'W' : 'E'}`;
  return `${lat} · ${lon}`;
}

function updateGridDisplay() {
  const countryCode = selectedPlace?.alpha3;
  const countryFactor = countryCode ? gridData.countries[countryCode] : null;
  const factor = countryFactor?.value ?? gridData.worldFactor;
  const dataYear = countryFactor?.year ?? gridData.year;
  const isGlobalFallback = !countryFactor;

  elements.gridIntensity.textContent = formatInteger(factor * 1000);
  elements.gridYear.textContent = `${isGlobalFallback ? 'world average' : `data year ${dataYear}`}`;

  if (!selectedPlace) {
    elements.areaEyebrow.textContent = 'GLOBAL REFERENCE';
    elements.placeName.textContent = 'Around the world';
    elements.placeDetail.textContent = 'Select your area to use its national electricity mix.';
    elements.gridComparison.textContent = 'A global reference while you choose a place.';
    elements.mapCoordinates.innerHTML = 'GLOBAL VIEW <span>↗</span>';
    elements.mapLink.href = 'https://www.openstreetmap.org/';
  } else {
    elements.areaEyebrow.textContent = 'YOUR SELECTED AREA';
    elements.placeName.textContent = selectedPlace.title;
    const detailBits = [selectedPlace.admin1, selectedPlace.country].filter((value, index, list) => value && list.indexOf(value) === index && value !== selectedPlace.title);
    elements.placeDetail.textContent = detailBits.length ? detailBits.join(' · ') : (selectedPlace.country || 'Selected location');
    const globalDelta = ((factor / gridData.worldFactor) - 1) * 100;
    if (isGlobalFallback) {
      elements.gridComparison.textContent = 'Country data is unavailable; using the world-average grid factor.';
    } else if (Math.abs(globalDelta) < 4) {
      elements.gridComparison.textContent = 'Close to the current world-average grid factor.';
    } else {
      const direction = globalDelta < 0 ? 'below' : 'above';
      elements.gridComparison.textContent = `${Math.abs(Math.round(globalDelta))}% ${direction} the world-average grid factor.`;
    }
    if (Number.isFinite(selectedPlace.latitude) && Number.isFinite(selectedPlace.longitude)) {
      const lat = selectedPlace.latitude;
      const lon = selectedPlace.longitude;
      elements.mapCoordinates.innerHTML = `${formatCoordinates(lat, lon)} <span>↗</span>`;
      elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=10/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
    } else {
      elements.mapCoordinates.innerHTML = 'AREA VIEW <span>↗</span>';
      elements.mapLink.href = 'https://www.openstreetmap.org/';
    }
  }

  calculateFootprint();
}

function calculateFootprint() {
  const residents = Math.max(1, safeNumber(document.querySelector('#residents'), 1));
  const monthlyElectricity = safeNumber(document.querySelector('#electricity'));
  const personalDriving = safeNumber(document.querySelector('#driving'));
  const carType = document.querySelector('#vehicle')?.value || 'petrol';
  const shortFlights = safeNumber(document.querySelector('#short-flights'));
  const longFlights = safeNumber(document.querySelector('#long-flights'));
  const foodPattern = safeNumber(document.querySelector('#diet'), 2100);
  const countryFactor = selectedPlace?.alpha3 ? gridData.countries[selectedPlace.alpha3]?.value : null;
  const electricityFactor = countryFactor ?? gridData.worldFactor;

  const electricity = (monthlyElectricity * 12 * electricityFactor) / residents;
  const carFactor = carType === 'electric' ? 0.18 * electricityFactor : CAR_FACTORS[carType] ?? CAR_FACTORS.petrol;
  const driving = personalDriving * 52 * carFactor;
  const flights = shortFlights * FLIGHT_FACTORS.shortHaulReturnKm * FLIGHT_FACTORS.shortHaulPerPassengerKm
    + longFlights * FLIGHT_FACTORS.longHaulReturnKm * FLIGHT_FACTORS.longHaulPerPassengerKm;
  const food = foodPattern;
  const categories = [electricity, driving, flights, food];
  const total = categories.reduce((sum, value) => sum + value, 0);
  const safeTotal = Math.max(0, total);
  const shares = safeTotal > 0 ? categories.map((value) => value / safeTotal) : [0.25, 0.25, 0.25, 0.25];

  elements.footprintTotal.textContent = (safeTotal / 1000).toFixed(1);
  elements.footprintKilos.textContent = `${formatInteger(safeTotal)} kg CO₂e / year`;
  elements.footprintSummary.textContent = selectedPlace
    ? `Based on your entries and the ${countryFactor ? 'local national-grid' : 'world-average'} electricity factor.`
    : 'A starting estimate using the world-average grid factor. Choose a place to personalise it.';
  elements.dietFactor.textContent = `~${(foodPattern / 1000).toFixed(1)} t / year`;

  const ids = ['electricity', 'driving', 'flights', 'food'];
  categories.forEach((value, index) => {
    const amount = document.querySelector(`#${ids[index]}-amount`);
    const bar = document.querySelector(`#${ids[index]}-bar`);
    amount.textContent = `${formatInteger(value)} kg`;
    bar.style.width = `${Math.max(value > 0 ? 1.5 : 0, shares[index] * 100)}%`;
  });

  let cursor = 0;
  const stops = shares.map((share, index) => {
    const start = cursor;
    cursor += share * 100;
    return `${categoryColors[index]} ${start}% ${cursor}%`;
  });
  elements.breakdownRing.style.background = `conic-gradient(${stops.join(', ')})`;
}

function setLocationStatus(message, isError = false) {
  elements.locationStatus.textContent = message;
  elements.locationStatus.classList.toggle('error', isError);
}

function getAlpha3(alpha2) {
  if (!alpha2) return null;
  return countryCodes[String(alpha2).toUpperCase()] || null;
}

function normalizePlace(place) {
  const city = place.name || place.city || place.locality || 'Selected area';
  const alpha2 = String(place.country_code || place.countryCode || '').toUpperCase();
  return {
    title: city,
    admin1: place.admin1 || place.principalSubdivision || '',
    country: place.country || place.countryName || '',
    alpha2,
    alpha3: getAlpha3(alpha2),
    latitude: Number.isFinite(Number(place.latitude)) ? Number(place.latitude) : null,
    longitude: Number.isFinite(Number(place.longitude)) ? Number(place.longitude) : null,
  };
}

function choosePlace(place, source = 'search') {
  selectedPlace = normalizePlace(place);
  elements.searchInput.value = source === 'search'
    ? [selectedPlace.title, selectedPlace.country].filter(Boolean).join(', ')
    : '';
  elements.searchResults.hidden = true;
  elements.searchInput.setAttribute('aria-expanded', 'false');
  setLocationStatus(source === 'gps' ? 'Your nearby grid context is ready.' : 'Place selected. Your estimate now uses its national grid data.');
  updateGridDisplay();
}

function locationResultDetail(place) {
  return [place.admin1, place.country].filter(Boolean).join(', ') || place.country || 'Location';
}

function renderSearchResults(results) {
  lastSearchResults = results;
  elements.searchResults.replaceChildren();
  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'No places found. Try a larger city or add a country.';
    elements.searchResults.append(empty);
    elements.searchResults.hidden = false;
    elements.searchInput.setAttribute('aria-expanded', 'true');
    return;
  }

  results.forEach((place, index) => {
    const button = document.createElement('button');
    button.className = 'search-result';
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.dataset.index = String(index);

    const pin = document.createElement('span');
    pin.className = 'result-pin';
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg>';
    const copy = document.createElement('span');
    copy.className = 'search-result-copy';
    const name = document.createElement('strong');
    name.textContent = place.name;
    const detail = document.createElement('small');
    detail.textContent = locationResultDetail(place);
    copy.append(name, detail);
    button.append(pin, copy);
    elements.searchResults.append(button);
  });
  elements.searchResults.hidden = false;
  elements.searchInput.setAttribute('aria-expanded', 'true');
}

async function searchPlaces(query) {
  const url = new URL(GEOCODING_API);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Place search is temporarily unavailable.');
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

function queueSearch() {
  window.clearTimeout(searchTimer);
  const query = elements.searchInput.value.trim();
  lastSearchResults = [];
  if (query.length < 2) {
    elements.searchResults.hidden = true;
    elements.searchInput.setAttribute('aria-expanded', 'false');
    return;
  }
  elements.searchResults.replaceChildren();
  elements.searchResults.hidden = true;
  elements.searchInput.setAttribute('aria-expanded', 'false');
  searchTimer = window.setTimeout(async () => {
    try {
      const results = await searchPlaces(query);
      if (elements.searchInput.value.trim() === query) renderSearchResults(results);
    } catch (error) {
      setLocationStatus(error.message || 'Place search is temporarily unavailable.', true);
    }
  }, 280);
}

async function detectLocation() {
  if (!navigator.geolocation) {
    setLocationStatus('Location is not available in this browser. Search for a city instead.', true);
    return;
  }
  if (!window.isSecureContext) {
    setLocationStatus('GPS detection needs HTTPS or localhost. Search for your area instead.', true);
    return;
  }

  elements.locateButton.disabled = true;
  elements.locateButton.classList.add('is-loading');
  setLocationStatus('Waiting for location permission…');

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
    setLocationStatus('Identifying your nearby area…');
    const url = new URL(REVERSE_GEOCODE_API);
    url.searchParams.set('latitude', String(position.coords.latitude));
    url.searchParams.set('longitude', String(position.coords.longitude));
    url.searchParams.set('localityLanguage', 'en');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not identify this location. Search for your area instead.');
    const location = await response.json();
    choosePlace({
      name: location.city || location.locality || location.principalSubdivision || 'Your current area',
      admin1: location.principalSubdivision || '',
      country: location.countryName || '',
      countryCode: location.countryCode || '',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }, 'gps');
  } catch (error) {
    const denied = error && typeof error.code === 'number' && error.code === 1;
    setLocationStatus(denied ? 'Location permission was not granted. Search for any place instead.' : (error.message || 'Could not detect your area. Search for it instead.'), true);
  } finally {
    elements.locateButton.disabled = false;
    elements.locateButton.classList.remove('is-loading');
  }
}

function chooseCoverageYear(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    if (row.region_type !== 'country') return;
    const year = Number(row.valid_year);
    if (!Number.isFinite(year)) return;
    if (!counts.has(year)) counts.set(year, new Set());
    counts.get(year).add(row.region);
  });
  const maxCoverage = Math.max(0, ...Array.from(counts.values(), (set) => set.size));
  if (!maxCoverage) return 2024;
  return Math.max(...Array.from(counts.entries())
    .filter(([, regions]) => regions.size >= maxCoverage * 0.9)
    .map(([year]) => year));
}

function buildGridData(rows) {
  const gridRows = rows.filter((row) => row.category === 'electricity'
    && row.activity === 'Grid electricity, lifecycle intensity of generation'
    && row.unit === 'kg CO2e/kWh');
  const coverageYear = chooseCoverageYear(gridRows);
  const byRegion = new Map();
  gridRows.forEach((row) => {
    const region = String(row.region || '').toLowerCase();
    const year = Number(row.valid_year);
    if (!region || !Number.isFinite(year) || year > coverageYear) return;
    const previous = byRegion.get(region);
    if (!previous || year > previous.year) {
      byRegion.set(region, { value: Number(row.value), year });
    }
  });
  const world = byRegion.get('world');
  const countries = {};
  byRegion.forEach((value, region) => {
    if (region !== 'world') countries[region] = value;
  });
  return {
    year: world?.year ?? coverageYear,
    worldFactor: world?.value ?? FALLBACK_WORLD_FACTOR,
    countries,
    ready: true,
  };
}

function useGridData(data) {
  gridData = data;
  if (data.ready) {
    const coverageText = Object.keys(data.countries).length
      ? `Grid factors ready · ${data.year} is the latest broadly covered year.`
      : `Using the world-average grid reference · ${data.year}.`;
    elements.dataStatus.textContent = coverageText;
  }
  updateGridDisplay();
}

async function loadGridData() {
  try {
    const cachedText = localStorage.getItem(GRID_CACHE_KEY);
    if (cachedText) {
      const cached = JSON.parse(cachedText);
      const isFresh = Date.now() - cached.savedAt < 14 * 24 * 60 * 60 * 1000;
      if (isFresh && cached.data?.countries) useGridData(cached.data);
    }
  } catch {
    // The estimate can continue with the global reference if local storage is unavailable.
  }

  try {
    const response = await fetch(GRID_API, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Grid data could not be reached.');
    const payload = await response.json();
    if (!Array.isArray(payload.rows)) throw new Error('Grid data format was unexpected.');
    const data = buildGridData(payload.rows);
    useGridData(data);
    try {
      localStorage.setItem(GRID_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {
      // Storage is optional; the live result remains available for this visit.
    }
  } catch {
    if (!gridData.ready) {
      elements.dataStatus.textContent = 'Grid data is offline. The estimate is using the world-average reference.';
    } else {
      elements.dataStatus.textContent = `Showing cached grid data · ${gridData.year}.`;
    }
    updateGridDisplay();
  }
}

async function loadCountryCodes() {
  try {
    const response = await fetch('./data/country-codes.json');
    if (!response.ok) return;
    countryCodes = await response.json();
    if (selectedPlace) {
      // Re-resolve if the place was selected before the code map finished loading.
      selectedPlace.alpha3 = getAlpha3(selectedPlace.alpha2);
      updateGridDisplay();
    }
  } catch {
    // Search and footprint calculations still work with the global grid reference.
  }
}

function restoreInputs() {
  inputIds.forEach((id) => {
    const input = document.getElementById(id);
    try {
      const saved = localStorage.getItem(`${INPUT_PREFIX}${id}`);
      if (saved !== null && saved !== '') input.value = saved;
    } catch {
      // The controls remain editable when storage is disabled.
    }
    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      try { localStorage.setItem(`${INPUT_PREFIX}${id}`, input.value); } catch { /* Optional. */ }
      calculateFootprint();
    });
    if (input.tagName === 'SELECT') input.addEventListener('change', calculateFootprint);
  });
}

async function shareEstimate() {
  const tonnes = elements.footprintTotal.textContent;
  const place = selectedPlace ? ` in ${selectedPlace.title}${selectedPlace.country ? `, ${selectedPlace.country}` : ''}` : '';
  const message = `My estimated carbon footprint${place} is ${tonnes} tonnes CO₂e per person per year. Estimate made with Fieldnote.`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'My Fieldnote estimate', text: message });
      elements.shareStatus.textContent = 'Ready to share.';
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(message);
      elements.shareStatus.textContent = 'Estimate copied.';
    } else {
      elements.shareStatus.textContent = message;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') elements.shareStatus.textContent = 'Could not open sharing on this device.';
  }
  window.setTimeout(() => { elements.shareStatus.textContent = ''; }, 3500);
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    elements.installButton.hidden = true;
  });
}

function setupSearch() {
  elements.searchInput.addEventListener('input', () => {
    setLocationStatus('');
    queueSearch();
  });
  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (lastSearchResults.length) choosePlace(lastSearchResults[0], 'search');
    else queueSearch();
  });
  elements.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (!button) return;
    const place = lastSearchResults[Number(button.dataset.index)];
    if (place) choosePlace(place, 'search');
  });
  elements.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      elements.searchResults.hidden = true;
      elements.searchInput.setAttribute('aria-expanded', 'false');
    }
    if (event.key === 'Enter' && !elements.searchResults.hidden && lastSearchResults.length) {
      event.preventDefault();
      choosePlace(lastSearchResults[0], 'search');
    }
  });
  document.addEventListener('click', (event) => {
    if (!elements.searchForm.contains(event.target)) {
      elements.searchResults.hidden = true;
      elements.searchInput.setAttribute('aria-expanded', 'false');
    }
  });
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
}

function start() {
  restoreInputs();
  setupSearch();
  setupInstallPrompt();
  setupServiceWorker();
  elements.locateButton.addEventListener('click', detectLocation);
  elements.shareButton.addEventListener('click', shareEstimate);
  elements.dietFactor = document.querySelector('#diet-factor');
  document.querySelector('#diet').addEventListener('change', () => {
    elements.dietFactor.textContent = `~${(safeNumber(document.querySelector('#diet')) / 1000).toFixed(1)} t / year`;
  });
  calculateFootprint();
  Promise.all([loadCountryCodes(), loadGridData()]);
}

start();
