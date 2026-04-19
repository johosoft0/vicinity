// storage.js — localStorage service for Vicinity
// Versioned keys, typed get/set, export/import bundle

const KEYS = {
  categories:       'vicinity:v1:categories',
  specificPlaces:   'vicinity:v1:specificPlaces',
  favorites:        'vicinity:v1:favorites',
  settings:         'vicinity:v1:settings',
  translationCache: 'vicinity:v1:translationCache',
  onboarded:        'vicinity:v1:onboarded',
  uiState:          'vicinity:v1:uiState',
};

function get(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Storage read error', key, e);
    return null;
  }
}

function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Storage write error', key, e);
    return false;
  }
}

function remove(key) {
  localStorage.removeItem(key);
}

// ── Categories ──────────────────────────────────────────────────────────────

function getCategories() {
  return get(KEYS.categories) || [];
}

function saveCategories(categories) {
  return set(KEYS.categories, categories);
}

function upsertCategory(cat) {
  const list = getCategories();
  const idx = list.findIndex(c => c.id === cat.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...cat, updatedAt: now };
  } else {
    list.push({ ...cat, createdAt: now, updatedAt: now });
  }
  saveCategories(list);
  return list;
}

function deleteCategory(id) {
  const list = getCategories().filter(c => c.id !== id);
  saveCategories(list);
  return list;
}

// ── Specific Places ──────────────────────────────────────────────────────────

function getSpecificPlaces() {
  return get(KEYS.specificPlaces) || [];
}

function saveSpecificPlaces(places) {
  return set(KEYS.specificPlaces, places);
}

function upsertSpecificPlace(place) {
  const list = getSpecificPlaces();
  const idx = list.findIndex(p => p.id === place.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...place, updatedAt: now };
  } else {
    list.push({ ...place, createdAt: now, updatedAt: now });
  }
  saveSpecificPlaces(list);
  return list;
}

function deleteSpecificPlace(id) {
  const list = getSpecificPlaces().filter(p => p.id !== id);
  saveSpecificPlaces(list);
  return list;
}

// ── Favorites ────────────────────────────────────────────────────────────────

function getFavorites() {
  return get(KEYS.favorites) || [];
}

function saveFavorites(favs) {
  return set(KEYS.favorites, favs);
}

function toggleFavorite(place) {
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.id === place.id);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push({ ...place, savedAt: new Date().toISOString() });
  }
  saveFavorites(favs);
  return favs;
}

function isFavorite(id) {
  return getFavorites().some(f => f.id === id);
}

// ── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  language: 'en',
  mapLabelLanguage: 'en',
  defaultRadiusMeters: 800,
  autoOpenNearbyAfterRefresh: false,
  hideClosedPlaces: false,
  minRating: null,
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(get(KEYS.settings) || {}) };
}

function saveSettings(settings) {
  return set(KEYS.settings, settings);
}

// ── Translation Cache ─────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 500;

function getTranslationCache() {
  return get(KEYS.translationCache) || {};
}

function getCachedTranslation(sourceText, targetLang) {
  const cache = getTranslationCache();
  const key = `${targetLang}::${sourceText}`;
  return cache[key] || null;
}

function setCachedTranslation(sourceText, targetLang, result) {
  const cache = getTranslationCache();
  const key = `${targetLang}::${sourceText}`;
  cache[key] = { ...result, createdAt: new Date().toISOString() };
  // Prune if over limit
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const oldest = keys.sort((a, b) =>
      new Date(cache[a].createdAt) - new Date(cache[b].createdAt)
    ).slice(0, keys.length - MAX_CACHE_ENTRIES);
    oldest.forEach(k => delete cache[k]);
  }
  set(KEYS.translationCache, cache);
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function isOnboarded() {
  return !!get(KEYS.onboarded);
}

function setOnboarded() {
  set(KEYS.onboarded, true);
}

// ── UI State ──────────────────────────────────────────────────────────────────

function getUIState() {
  return get(KEYS.uiState) || { lastTab: 'map', activeFilters: [], lastLocation: null };
}

function saveUIState(state) {
  set(KEYS.uiState, state);
}
function saveLastLocation(coords) {
  saveUIState({ ...getUIState(), lastLocation: coords });
}

function getLastLocation() {
  return getUIState().lastLocation || null;
}

// ── Export / Import ───────────────────────────────────────────────────────────

function exportBundle() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: getCategories(),
    specificPlaces: getSpecificPlaces(),
    favorites: getFavorites(),
    settings: getSettings(),
    translationCache: getTranslationCache(),
  };
}

function importBundle(bundle, mode = 'replace') {
  if (!bundle || bundle.version !== 1) {
    throw new Error('Invalid or incompatible export file (expected version 1)');
  }
  if (mode === 'replace') {
    if (bundle.categories)       saveCategories(bundle.categories);
    if (bundle.specificPlaces)   saveSpecificPlaces(bundle.specificPlaces);
    if (bundle.favorites)        saveFavorites(bundle.favorites);
    if (bundle.settings)         saveSettings(bundle.settings);
    if (bundle.translationCache) set(KEYS.translationCache, bundle.translationCache);
  }
  return true;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const Storage = {
  KEYS,
  getCategories, saveCategories, upsertCategory, deleteCategory,
  getSpecificPlaces, saveSpecificPlaces, upsertSpecificPlace, deleteSpecificPlace,
  getFavorites, saveFavorites, toggleFavorite, isFavorite,
  getSettings, saveSettings,
  getTranslationCache, getCachedTranslation, setCachedTranslation,
  isOnboarded, setOnboarded,
  getUIState, saveUIState, getLastLocation, saveLastLocation,
  exportBundle, importBundle,
  generateId,
};
