// state.js — Central app state with simple event emitter
// No framework needed: pub/sub + plain objects

import { Storage } from './storage.js';
import { Search } from './search.js';

// ── App State ─────────────────────────────────────────────────────────────────

const state = {
  // Persisted
  categories: [],
  specificPlaces: [],
  favorites: [],
  settings: {},

  // Session
  currentLocation: null,       // { lat, lon, accuracy, timestamp }
  nearbyResults: [],
  isSearching: false,
  locationStatus: 'idle',      // 'idle' | 'requesting' | 'success' | 'denied' | 'error'
  locationError: null,
  locationStale: false,        // true if location is from a previous session

  // UI
  activeTab: 'map',            // 'map' | 'setup'
  activeFilters: [],           // category IDs to show (empty = show all)
  selectedPlace: null,         // NearbyResult or SpecificPlaceItem
  bottomSheetOpen: false,
  setupSection: 'categories',  // 'categories' | 'places' | 'favorites' | 'settings' | 'import-export'
  onboarded: false,
  mapRadius: 1200,
};

// ── Event Emitter ─────────────────────────────────────────────────────────────

const listeners = {};

function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
  return () => off(event, fn);
}

function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}

function emit(event, data) {
  (listeners[event] || []).forEach(fn => fn(data));
  (listeners['*'] || []).forEach(fn => fn(event, data));
}

// ── State Mutations ───────────────────────────────────────────────────────────

function loadFromStorage() {
  state.categories     = Storage.getCategories();
  state.specificPlaces = Storage.getSpecificPlaces();
  state.favorites      = Storage.getFavorites();
  state.settings       = Storage.getSettings();
  state.onboarded      = Storage.isOnboarded();
  state.mapRadius      = state.settings.defaultRadiusMeters || 800;
  const ui = Storage.getUIState();
  state.activeTab      = ui.lastTab || 'map';
  state.activeFilters  = ui.activeFilters || [];
  // Restore last known location from previous session
  const lastLoc = Storage.getLastLocation();
  if (lastLoc) {
    state.currentLocation = lastLoc;
    state.locationStale = true;
    state.locationStatus = 'stale';
  }
  emit('loaded', { ...state });
}

function setTab(tab) {
  state.activeTab = tab;
  Storage.saveUIState({ ...Storage.getUIState(), lastTab: tab });
  emit('tab:changed', tab);
}

function setSetupSection(section) {
  state.setupSection = section;
  emit('setup:section', section);
}

function setLocationStatus(status, error = null) {
  state.locationStatus = status;
  state.locationError = error;
  emit('location:status', { status, error });
}

function setCurrentLocation(coords) {
  state.currentLocation = coords;
  state.locationStatus = 'success';
  state.locationStale = false;
  Storage.saveLastLocation(coords);
  emit('location:updated', coords);
}

// Clear manual pin and revert to GPS mode
function clearManualLocation() {
  if (state.currentLocation) {
    state.currentLocation = { ...state.currentLocation, manual: false };
    Storage.saveLastLocation(state.currentLocation);
    emit('location:updated', state.currentLocation);
  }
  // Trigger a fresh GPS fix
  refreshLocation();
}

function setNearbyResults(results) {
  state.nearbyResults = results;
  state.isSearching = false;
  emit('nearby:updated', results);
}

function setIsSearching(val) {
  state.isSearching = val;
  emit('search:state', val);
}

function setSelectedPlace(place) {
  state.selectedPlace = place;
  emit('place:selected', place);
}

function setBottomSheet(open) {
  state.bottomSheetOpen = open;
  emit('sheet:toggle', open);
}

function setActiveFilters(filters) {
  state.activeFilters = filters;
  Storage.saveUIState({ ...Storage.getUIState(), activeFilters: filters });
  emit('filters:changed', filters);
}

function setMapRadius(meters) {
  state.mapRadius = meters;
  emit('radius:changed', meters);
}

function completeOnboarding() {
  state.onboarded = true;
  Storage.setOnboarded();
  emit('onboarded');
}

// ── Category Actions ──────────────────────────────────────────────────────────

function upsertCategory(cat) {
  state.categories = Storage.upsertCategory(cat);
  emit('categories:changed', state.categories);
}

function deleteCategory(id) {
  state.categories = Storage.deleteCategory(id);
  // Remove from active filters if present
  if (state.activeFilters.includes(id)) {
    setActiveFilters(state.activeFilters.filter(f => f !== id));
  }
  emit('categories:changed', state.categories);
}

// ── Specific Place Actions ────────────────────────────────────────────────────

function upsertSpecificPlace(place) {
  state.specificPlaces = Storage.upsertSpecificPlace(place);
  emit('places:changed', state.specificPlaces);
}

function deleteSpecificPlace(id) {
  state.specificPlaces = Storage.deleteSpecificPlace(id);
  emit('places:changed', state.specificPlaces);
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function toggleFavorite(place) {
  state.favorites = Storage.toggleFavorite(place);
  emit('favorites:changed', state.favorites);
}

// ── Settings ──────────────────────────────────────────────────────────────────

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  Storage.saveSettings(state.settings);
  emit('settings:changed', state.settings);
}

// ── Geolocation ───────────────────────────────────────────────────────────────

let _refreshDebounce = null;

// If a manual pin has been placed, Refresh re-uses it and skips GPS
async function refreshLocation() {
  if (state.isSearching) return;
  if (_refreshDebounce) return;
  _refreshDebounce = setTimeout(() => { _refreshDebounce = null; }, 2000);

  // Manual pin mode — skip GPS entirely
  if (state.currentLocation?.manual) {
    setLocationStatus('requesting');
    // Small delay so the UI shows "getting location" briefly
    await new Promise(r => setTimeout(r, 300));
    setCurrentLocation({ ...state.currentLocation, timestamp: Date.now() });
    runNearbySearch(state.currentLocation);
    return state.currentLocation;
  }

  setLocationStatus('requesting');

  if (!navigator.geolocation) {
    // No GPS available — if we have any saved location use it, else error
    if (state.currentLocation) {
      setCurrentLocation({ ...state.currentLocation, timestamp: Date.now() });
      runNearbySearch(state.currentLocation);
      return state.currentLocation;
    }
    setLocationStatus('error', 'Geolocation is not supported. Use the 📍 pin button to set your location manually.');
    return;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
          manual: false,
        };
        setCurrentLocation(coords);
        runNearbySearch(coords);
        resolve(coords);
      },
      (err) => {
        // GPS failed — if we have a manual pin, use it silently
        if (state.currentLocation) {
          setCurrentLocation({ ...state.currentLocation, timestamp: Date.now() });
          runNearbySearch(state.currentLocation);
          resolve(state.currentLocation);
          return;
        }
        const messages = {
          1: 'Location access denied. Use the 📍 pin button to set your location manually.',
          2: 'Location unavailable. Use the 📍 pin button to set your location manually.',
          3: 'Location timed out. Use the 📍 pin button to set your location manually.',
        };
        setLocationStatus(err.code === 1 ? 'denied' : 'error',
          messages[err.code] || 'Location error. Use the 📍 pin button.');
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

async function runNearbySearch(coords) {
  if (!coords) return;
  const enabledCats = state.categories.filter(c => c.enabled);
  if (enabledCats.length === 0) {
    setNearbyResults([]);
    return;
  }

  setIsSearching(true);
  emit('search:started');

  try {
    const results = await Search.runNearbySearch(
      coords.lat, coords.lon, state.mapRadius, enabledCats
    );
    setNearbyResults(results);
    if (state.settings.autoOpenNearbyAfterRefresh && results.length > 0) {
      setBottomSheet(true);
    }
  } catch (e) {
    console.error('Search error:', e);
    setIsSearching(false);
    emit('search:error', e.message);
  }
}

// ── Derived Getters ───────────────────────────────────────────────────────────

function getFilteredResults() {
  if (state.activeFilters.length === 0) return state.nearbyResults;
  return state.nearbyResults.filter(r =>
    state.activeFilters.includes(r.matchedBy?.sourceId)
  );
}

function getSpecificPlacesInRange() {
  if (!state.currentLocation) return state.specificPlaces.filter(p => p.enabled);
  return state.specificPlaces.filter(p => {
    if (!p.enabled) return false;
    const dist = Search.distanceMeters(
      state.currentLocation.lat, state.currentLocation.lon,
      p.latitude, p.longitude
    );
    return dist <= state.mapRadius * 2; // show specific places in 2x radius
  });
}

export const State = {
  get: () => ({ ...state }),
  on, off,

  loadFromStorage,
  setTab, setSetupSection,
  setSelectedPlace, setBottomSheet,
  setActiveFilters, setMapRadius,
  completeOnboarding,

  upsertCategory, deleteCategory,
  upsertSpecificPlace, deleteSpecificPlace,
  toggleFavorite,
  updateSettings,

  setCurrentLocation,   // exported so map.js pin placement can set location + trigger search
  clearManualLocation,
  refreshLocation,
  runNearbySearch,

  getFilteredResults,
  getSpecificPlacesInRange,
};
