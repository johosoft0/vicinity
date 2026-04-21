// ui.js — DOM rendering, screen management, event wiring
// All UI is rendered into #app via innerHTML / DOM manipulation

import { State } from './state.js';
import { Storage } from './storage.js';
import { Search } from './search.js';
import { MapService } from './map.js';

// Token is read dynamically so it picks up localStorage-saved value at boot
// and can be updated live without a page reload.
function getToken() {
  return window.VICINITY_MAPBOX_TOKEN
    || Storage.getSettings().mapboxToken
    || '';
}

// ── Startup ───────────────────────────────────────────────────────────────────

export function boot() {
  State.loadFromStorage();

  // Seed window token from storage if config.js didn't provide one
  const saved = Storage.getSettings().mapboxToken;
  if (saved && !window.VICINITY_MAPBOX_TOKEN) {
    window.VICINITY_MAPBOX_TOKEN = saved;
  }

  const token = getToken();

  if (!token) {
    renderTokenSetup();
  } else if (!State.get().onboarded) {
    renderOnboarding();
  } else {
    renderApp();
  }
}

// ── Token Setup ───────────────────────────────────────────────────────────────

function renderTokenSetup() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="onboarding">
      <div class="onboarding__inner">
        <div class="onboarding__logo">
          <span class="logo-mark">◎</span>
          <h1>Vicinity</h1>
        </div>
        <p class="onboarding__tagline">One quick setup step.</p>

        <div class="token-card">
          <p class="token-card__desc">
            Vicinity uses Mapbox to render maps and look up places.
            A free Mapbox account gives you more than enough for personal use.
          </p>
          <a class="btn btn--outline token-reg-link"
            href="https://account.mapbox.com/auth/signup/"
            target="_blank" rel="noopener">
            ① Create a free Mapbox account ↗
          </a>
          <p class="token-card__step">
            Then copy your <strong>public token</strong> (starts with <code>pk.</code>)
            from your <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener">Access Tokens page</a>
            and paste it below.
          </p>
          <input
            id="tokenInput"
            class="text-input mono token-input"
            type="text"
            placeholder="pk.eyJ1Ii..."
            autocomplete="off"
            spellcheck="false"
          >
          <p id="tokenError" class="token-error hidden">Token must start with <code>pk.</code></p>
          <button class="btn btn--primary btn--full" id="tokenSaveBtn" type="button">
            Save &amp; Continue
          </button>
          <p class="token-card__note">
            Your token is stored only in your browser's local storage and is never sent anywhere except Mapbox.
          </p>
        </div>
      </div>
    </div>
  `;

  const input = document.getElementById('tokenInput');
  const errEl = document.getElementById('tokenError');

  document.getElementById('tokenSaveBtn').addEventListener('click', () => {
    const val = input.value.trim();
    if (!val.startsWith('pk.')) {
      errEl.classList.remove('hidden');
      input.focus();
      return;
    }
    errEl.classList.add('hidden');
    window.VICINITY_MAPBOX_TOKEN = val;
    Storage.saveSettings({ ...Storage.getSettings(), mapboxToken: val });

    if (!State.get().onboarded) {
      renderOnboarding();
    } else {
      renderApp();
    }
  });

  input.addEventListener('input', () => {
    if (input.value.trim().startsWith('pk.')) errEl.classList.add('hidden');
  });

  // Allow Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tokenSaveBtn').click();
  });
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function renderOnboarding() {
  const app = document.getElementById('app');
  const STARTER_CATEGORIES = [
    { label: 'Coffee', emoji: '☕', searchTerms: ['cafe', 'coffee'] },
    { label: 'Ramen', emoji: '🍜', searchTerms: ['ramen'] },
    { label: 'Convenience', emoji: '🏪', searchTerms: ['convenience store', 'konbini'] },
    { label: 'ATM', emoji: '💴', searchTerms: ['atm', 'bank'] },
    { label: 'Train Station', emoji: '🚃', searchTerms: ['train station', 'subway'] },
    { label: 'Pharmacy', emoji: '💊', searchTerms: ['pharmacy', 'drugstore'] },
  ];

  app.innerHTML = `
    <div class="onboarding">
      <div class="onboarding__inner">
        <div class="onboarding__logo">
          <span class="logo-mark">◎</span>
          <h1>Vicinity</h1>
        </div>
        <p class="onboarding__tagline">Your nearby places, on demand.</p>
        <p class="onboarding__sub">Tap refresh when you arrive somewhere new. No continuous tracking.</p>

        <div class="onboarding__section">
          <label class="section-label">Quick-start categories</label>
          <div class="starter-grid" id="starterGrid">
            ${STARTER_CATEGORIES.map((c, i) => `
              <button class="starter-chip" data-idx="${i}" type="button">
                <span>${c.emoji}</span> ${c.label}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="onboarding__section">
          <label class="section-label">Add a custom category</label>
          <div class="custom-cat-row">
            <input id="onboardingEmoji" class="emoji-input" type="text" placeholder="🍣" maxlength="2" value="">
            <input id="onboardingCatLabel" class="text-input" type="text" placeholder="e.g. Sushi">
            <button id="onboardingAddCat" class="btn btn--sm" type="button">Add</button>
          </div>
        </div>

        <div id="onboardingCatList" class="onboarding__cat-list"></div>

        <button id="onboardingContinue" class="btn btn--primary btn--full" type="button">
          Open Map
        </button>
      </div>
    </div>
  `;

  const selectedIdx = new Set();
  const pendingCats = [];

  function updateCatList() {
    document.getElementById('onboardingCatList').innerHTML =
      pendingCats.map((c, i) => `
        <div class="cat-pill">
          <span>${c.emoji}</span> ${c.label}
          <button class="pill-remove" data-remove="${i}" type="button">×</button>
        </div>
      `).join('');
  }

  app.addEventListener('click', (e) => {
    const chip = e.target.closest('.starter-chip');
    if (chip) {
      const idx = parseInt(chip.dataset.idx);
      if (selectedIdx.has(idx)) {
        selectedIdx.delete(idx);
        chip.classList.remove('starter-chip--active');
        const pi = pendingCats.findIndex(c => c.label === STARTER_CATEGORIES[idx].label);
        if (pi >= 0) pendingCats.splice(pi, 1);
      } else {
        selectedIdx.add(idx);
        chip.classList.add('starter-chip--active');
        pendingCats.push(STARTER_CATEGORIES[idx]);
      }
      updateCatList();
      return;
    }

    if (e.target.id === 'onboardingAddCat') {
      const emoji = document.getElementById('onboardingEmoji').value.trim() || '📍';
      const label = document.getElementById('onboardingCatLabel').value.trim();
      if (label) {
        pendingCats.push({ emoji, label, searchTerms: [label.toLowerCase()] });
        document.getElementById('onboardingCatLabel').value = '';
        document.getElementById('onboardingEmoji').value = '';
        updateCatList();
      }
      return;
    }

    const removeBtn = e.target.closest('.pill-remove');
    if (removeBtn) {
      pendingCats.splice(parseInt(removeBtn.dataset.remove), 1);
      updateCatList();
      return;
    }

    if (e.target.id === 'onboardingContinue') {
      pendingCats.forEach(c => {
        State.upsertCategory({
          id: Storage.generateId(),
          type: 'category',
          label: c.label,
          emoji: c.emoji,
          enabled: true,
          searchTerms: c.searchTerms || [c.label.toLowerCase()],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });
      State.completeOnboarding();
      renderApp();
    }
  });
}

// ── Main App ──────────────────────────────────────────────────────────────────

function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-shell">
      <div class="screen screen--map" id="screenMap"></div>
      <div class="screen screen--setup hidden" id="screenSetup"></div>

      <!-- Bottom Sheet (Nearby List) — inside app-shell, above nav -->
      <div class="bottom-sheet" id="bottomSheet">
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <span class="sheet-title">Nearby</span>
          <button class="sheet-update" id="sheetUpdateBtn" type="button">↻ Update Places</button>
          <button class="sheet-close" id="sheetClose" type="button">×</button>
        </div>
        <div class="sheet-body" id="sheetBody"></div>
      </div>

      <!-- Place Detail Overlay -->
      <div class="place-detail hidden" id="placeDetail"></div>
    </div>

    <!-- Bottom Nav — outside app-shell so it's never covered by overlays -->
    <nav class="bottom-nav">
      <button class="nav-btn" id="navNearby" type="button">
        <span class="nav-icon">≡</span>
        <span class="nav-label">Nearby <span id="navNearbyCount"></span></span>
      </button>
      <button class="nav-btn nav-btn--active" id="navMap" data-tab="map" type="button">
        <span class="nav-icon">◎</span>
        <span class="nav-label">Map</span>
      </button>
      <button class="nav-btn" id="navSetup" data-tab="setup" type="button">
        <span class="nav-icon">⊞</span>
        <span class="nav-label">Setup</span>
      </button>
    </nav>
  `;

  initMapScreen();
  initSetupScreen();
  wireNavigation();
  wireStateListeners();

  document.getElementById('sheetClose').addEventListener('click', closeBottomSheet);
  document.getElementById('sheetUpdateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('sheetUpdateBtn');
    if (!State.get().currentLocation) { showToast('No location set yet'); return; }
    btn.textContent = '⏳ Updating…';
    btn.disabled = true;
    await State.searchHere();
    btn.textContent = '↻ Update Places';
    btn.disabled = false;
  });

  document.getElementById('screenMap').addEventListener('click', (e) => {
    if (State.get().bottomSheetOpen && !e.target.closest('.bottom-sheet')) {
      closeBottomSheet();
    }
  });
}

// ── Map Screen ────────────────────────────────────────────────────────────────

function initMapScreen() {
  const el = document.getElementById('screenMap');
  el.innerHTML = `
    <div id="mapContainer"></div>

    <div class="map-overlay map-overlay--top">
      <div class="filter-scroll" id="filterChips"></div>
    </div>

    <div class="map-overlay map-overlay--status hidden" id="statusBanner"></div>

    <div class="map-overlay map-overlay--bottom">
      <div class="map-controls">
        <div class="radius-row" id="radiusRow">
          <button class="radius-chip ${State.get().mapRadius === 200 ? 'active' : ''}" data-r="200" type="button">2 min</button>
          <button class="radius-chip ${State.get().mapRadius === 800 ? 'active' : ''}" data-r="800" type="button">10 min</button>
          <button class="radius-chip ${State.get().mapRadius === 1600 ? 'active' : ''}" data-r="1600" type="button">20 min</button>
        </div>
        <div class="map-btn-row">
          <button class="map-btn map-btn--primary" id="refreshBtn" type="button">
            <span id="refreshIcon">⊙</span> Refresh Location
          </button>
          <button class="map-btn map-btn--icon" id="pinBtn" title="Drop pin to set location" type="button">📍</button>
          <button class="map-btn map-btn--icon map-btn--gps-toggle hidden" id="gpsToggleBtn" title="Clear manual pin, use GPS" type="button">⊙ GPS</button>
          <button class="map-btn map-btn--icon" id="recenterBtn" title="Recenter" type="button">⊕</button>
        </div>
      </div>
    </div>
  `;

  const tok = getToken();
  if (tok) {
    const m = MapService.init('mapContainer', tok);
    if (m && State.get().locationStale) {
      const lastLoc = State.get().currentLocation;
      m.once('load', () => MapService.showStaleLocation(lastLoc));
    }
  } else {
    document.getElementById('mapContainer').innerHTML = `
      <div class="map-placeholder">
        <p>⚠️ No Mapbox token found.</p>
        <p class="map-placeholder__sub">Go to Setup → Settings to add your token.</p>
      </div>
    `;
  }

  renderFilterChips();

  document.getElementById('refreshBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await State.refreshLocation();
  });

  document.getElementById('recenterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    MapService.recenter();
  });

  document.getElementById('pinBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const active = MapService.togglePinMode();
    const btn = document.getElementById('pinBtn');
    btn.classList.toggle('map-btn--pin-picking', active);
    btn.classList.remove('map-btn--pin-set');
    btn.title = active ? 'Click map to place pin — click again to cancel' : 'Drop pin to set location';
    if (active) showToast('Click the map to place your location pin');
  });

  document.getElementById('gpsToggleBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    State.clearManualLocation();
  });

  document.getElementById('radiusRow').addEventListener('click', (e) => {
    e.stopPropagation();
    const chip = e.target.closest('.radius-chip');
    if (!chip) return;
    const r = parseInt(chip.dataset.r);
    State.setMapRadius(r);
    document.querySelectorAll('.radius-chip').forEach(c =>
      c.classList.toggle('active', parseInt(c.dataset.r) === r)
    );
    const RADIUS_ZOOM = { 200: 16, 800: 14, 1600: 13 };
    const zoom = RADIUS_ZOOM[r] ?? 14;
    const loc = State.get().currentLocation;
    if (loc) MapService.getMap()?.easeTo({ center: [loc.lon, loc.lat], zoom, duration: 400 });
  });
}

function renderFilterChips() {
  const cats = State.get().categories.filter(c => c.enabled);
  const filters = State.get().activeFilters;
  const el = document.getElementById('filterChips');
  if (!el) return;

  if (cats.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = cats.map(c => `
    <button class="filter-chip ${filters.includes(c.id) ? 'filter-chip--active' : ''}"
      data-id="${c.id}" type="button">
      ${c.emoji} ${c.label}
    </button>
  `).join('');

  el.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const current = State.get().activeFilters;
      const next = current.includes(id)
        ? current.filter(f => f !== id)
        : [...current, id];
      State.setActiveFilters(next);
      renderFilterChips();
    });
  });
}

// ── Bottom Sheet (Nearby List) ────────────────────────────────────────────────

function openBottomSheet() {
  renderNearbyList();
  document.getElementById('bottomSheet').classList.add('open');
  State.setBottomSheet(true);
}

function closeBottomSheet() {
  const sheet = document.getElementById('bottomSheet');
  if (sheet) sheet.classList.remove('open');
  State.setBottomSheet(false);
}

function renderNearbyList() {
  const results = State.getFilteredResults();
  const specific = State.getSpecificPlacesInRange();
  const body = document.getElementById('sheetBody');
  if (!body) return;

  const count = document.getElementById('navNearbyCount');
  if (count) count.textContent = results.length || '';

  if (results.length === 0 && specific.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <span class="empty-icon">◌</span>
      <p>No nearby matches found.</p>
      <p class="empty-sub">Try refreshing your location or adjusting your radius.</p>
    </div>`;
    return;
  }

  const allItems = [
    ...specific.map(p => ({ ...p, _type: 'specific' })),
    ...results,
  ];

  body.innerHTML = allItems.map(item => {
    const dist = item.distanceMeters != null
      ? Search.formatDistance(item.distanceMeters) : '—';
    const displayName = item.translatedName || item.name;
    const secondaryName = item.translatedName ? item.name : (item.localName || null);
    return `
      <div class="nearby-row" data-id="${item.id}">
        <span class="nearby-emoji">${item.matchedBy?.emoji || item.emoji || '📍'}</span>
        <div class="nearby-info">
          <div class="nearby-name">${displayName}</div>
          ${secondaryName ? `<div class="nearby-local">${secondaryName}</div>` : ''}
          <div class="nearby-meta">
            <span class="nearby-dist">${dist}</span>
            <span class="nearby-cat">${item.matchedBy?.sourceLabel || item.categoryLabel || ''}</span>
          </div>
        </div>
        ${item.rating ? `<span class="nearby-rating">★ ${item.rating.toFixed(1)}</span>` : ''}
      </div>
    `;
  }).join('');

  body.querySelectorAll('.nearby-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const item = allItems.find(i => i.id === id);
      if (item) {
        State.setSelectedPlace(item);
        closeBottomSheet();
      }
    });
  });
}

// ── Place Detail ──────────────────────────────────────────────────────────────

function renderPlaceDetail(place) {
  const el = document.getElementById('placeDetail');
  if (!el) return;

  const dist = place.distanceMeters != null
    ? Search.formatDistance(place.distanceMeters) : null;
  const isFav = Storage.isFavorite(place.id);

  el.innerHTML = `
    <div class="detail-card">
      <div class="detail-header">
        <button class="detail-back" id="detailClose" type="button">← Back</button>
        <button class="detail-fav ${isFav ? 'active' : ''}" id="detailFav" type="button">
          ${isFav ? '♥' : '♡'}
        </button>
      </div>
      <div class="detail-emoji">${place.matchedBy?.emoji || place.emoji || '📍'}</div>
      <h2 class="detail-name">${place.translatedName || place.name || place.label}</h2>
      ${(place.translatedName && place.name) ? `<p class="detail-local">${place.name}</p>` : (place.localName ? `<p class="detail-local">${place.localName}</p>` : '')}

      <div class="detail-chips">
        ${dist ? `<span class="detail-chip">📏 ${dist}</span>` : ''}
        ${place.matchedBy?.sourceLabel || place.categoryLabel
          ? `<span class="detail-chip">${place.matchedBy?.emoji || ''} ${place.matchedBy?.sourceLabel || place.categoryLabel}</span>`
          : ''}
        ${place.isOpenNow != null
          ? `<span class="detail-chip ${place.isOpenNow ? 'open' : 'closed'}">${place.isOpenNow ? '● Open' : '● Closed'}</span>`
          : ''}
        ${place.priceLevel ? `<span class="detail-chip">${place.priceLevel}</span>` : ''}
      </div>

      <div class="detail-fields">
        ${place.address    ? `<div class="detail-field"><span class="field-icon">📍</span><span>${place.address}</span></div>` : ''}
        ${place.phone      ? `<div class="detail-field"><span class="field-icon">📞</span><a href="tel:${place.phone}">${place.phone}</a></div>` : ''}
        ${place.website    ? `<div class="detail-field"><span class="field-icon">🌐</span><a href="${place.website}" target="_blank" rel="noopener">Website</a></div>` : ''}
        ${place.menuUrl    ? `<div class="detail-field"><span class="field-icon">🍽</span><a href="${place.menuUrl}" target="_blank" rel="noopener">Menu</a></div>` : ''}
        ${place.hours?.length ? `<div class="detail-field"><span class="field-icon">🕐</span><span>${place.hours[0]}</span></div>` : ''}
        ${place.notes      ? `<div class="detail-field"><span class="field-icon">📝</span><span>${place.notes}</span></div>` : ''}
      </div>

      <div class="detail-actions">
        ${place.latitude && place.longitude ? (() => {
          const name = encodeURIComponent(place.name || place.label || '');
          const query = name
            ? `${name}+${place.latitude},${place.longitude}`
            : `${place.latitude},${place.longitude}`;
          return `<a class="btn btn--outline"
            href="https://www.google.com/maps/search/?api=1&query=${query}"
            target="_blank" rel="noopener">Open in Maps</a>`;
        })() : ''}
        ${place.latitude && place.longitude && getToken() ? `
          <button class="btn btn--ghost" id="detailFlyTo" type="button">Show on Map</button>
        ` : ''}
      </div>
    </div>
  `;

  el.classList.remove('hidden');

  el.querySelector('#detailClose')?.addEventListener('click', () => {
    el.classList.add('hidden');
    State.setSelectedPlace(null);
  });

  el.querySelector('#detailFav')?.addEventListener('click', () => {
    State.toggleFavorite(place);
    renderPlaceDetail(place); // re-render to update heart
  });

  el.querySelector('#detailFlyTo')?.addEventListener('click', () => {
    el.classList.add('hidden');
    State.setSelectedPlace(null);
    MapService.flyTo(place.latitude, place.longitude);
  });
}

// ── Setup Screen ──────────────────────────────────────────────────────────────

function initSetupScreen() {
  renderSetupScreen();
}

function renderSetupScreen() {
  const el = document.getElementById('screenSetup');
  if (!el) return;
  const section = State.get().setupSection;

  el.innerHTML = `
    <div class="setup-shell">
      <div class="setup-nav">
        ${[
          { id: 'categories',    label: 'Categories',   icon: '◈' },
          { id: 'places',        label: 'Places',       icon: '◎' },
          { id: 'favorites',     label: 'Favorites',    icon: '♥' },
          { id: 'settings',      label: 'Settings',     icon: '⊙' },
          { id: 'import-export', label: 'Import/Export',icon: '⇄' },
        ].map(s => `
          <button class="setup-nav-btn ${section === s.id ? 'active' : ''}"
            data-section="${s.id}" type="button">
            <span>${s.icon}</span> ${s.label}
          </button>
        `).join('')}
      </div>
      <div class="setup-body" id="setupBody"></div>
    </div>
  `;

  el.querySelectorAll('.setup-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      State.setSetupSection(btn.dataset.section);
      renderSetupScreen();
    });
  });

  renderSetupSection(section);
}

function renderSetupSection(section) {
  const body = document.getElementById('setupBody');
  if (!body) return;

  switch (section) {
    case 'categories':    renderCategorySection(body); break;
    case 'places':        renderSpecificPlacesSection(body); break;
    case 'favorites':     renderFavoritesSection(body); break;
    case 'settings':      renderSettingsSection(body); break;
    case 'import-export': renderImportExportSection(body); break;
  }
}

// Categories ──────────────────────────────────────────────────────────────────

function renderCategorySection(body, editingId = null) {
  const cats = State.get().categories;
  const editing = editingId ? cats.find(c => c.id === editingId) : null;

  body.innerHTML = `
    <div class="section-header">
      <h2>Categories</h2>
      <button class="btn btn--sm" id="addCatBtn" type="button">+ Add</button>
    </div>
    <div id="addCatForm" class="inline-form ${editing ? '' : 'hidden'}">
      <div class="emoji-suggest-row">
        <input id="newCatEmoji" class="emoji-input" type="text" placeholder="🍣" maxlength="2"
          value="${editing?.emoji || ''}">
        <span id="catEmojiSuggestChip" class="emoji-suggest-chip hidden"></span>
      </div>
      <input id="newCatLabel" class="text-input" type="text"
        placeholder="Category name" value="${editing?.label || ''}">
      <input id="newCatTerms" class="text-input" type="text"
        placeholder="Search terms (comma-separated)"
        value="${editing?.searchTerms?.join(', ') || ''}">
      <input type="hidden" id="editingCatId" value="${editingId || ''}">
      <div class="form-actions">
        <button class="btn btn--primary btn--sm" id="saveCatBtn" type="button">
          ${editing ? 'Update' : 'Save'}
        </button>
        <button class="btn btn--ghost btn--sm" id="cancelCatBtn" type="button">Cancel</button>
      </div>
    </div>
    ${cats.length === 0
      ? '<div class="empty-state"><p>No categories yet.</p></div>'
      : cats.map(c => `
          <div class="cat-row" data-id="${c.id}">
            <span class="cat-emoji">${c.emoji}</span>
            <div class="cat-info">
              <div class="cat-label">${c.label}</div>
              <div class="cat-terms">${(c.searchTerms || []).join(', ')}</div>
            </div>
            <div class="cat-actions">
              <button class="toggle-btn ${c.enabled ? 'on' : 'off'}"
                data-action="toggle" data-id="${c.id}" type="button">
                ${c.enabled ? 'On' : 'Off'}
              </button>
              <button class="icon-btn" data-action="edit-cat" data-id="${c.id}" title="Edit" type="button">✏️</button>
              <button class="icon-btn" data-action="delete" data-id="${c.id}" type="button">🗑</button>
            </div>
          </div>
        `).join('')
    }
  `;

  body.querySelector('#addCatBtn')?.addEventListener('click', () => {
    document.getElementById('editingCatId').value = '';
    document.getElementById('saveCatBtn').textContent = 'Save';
    document.getElementById('addCatForm').classList.toggle('hidden');
  });

  body.querySelector('#cancelCatBtn')?.addEventListener('click', () => {
    document.getElementById('addCatForm').classList.add('hidden');
  });

  // Emoji suggestion on label input
  const catLabelInput = document.getElementById('newCatLabel');
  const catEmojiInput = document.getElementById('newCatEmoji');
  const catSuggestChip = document.getElementById('catEmojiSuggestChip');

  catLabelInput?.addEventListener('input', () => {
    const current = catEmojiInput.value.trim();
    if (current && current !== '📍') return;
    const suggested = suggestEmoji(catLabelInput.value);
    if (suggested) {
      catSuggestChip.textContent = `Use ${suggested}?`;
      catSuggestChip.dataset.emoji = suggested;
      catSuggestChip.classList.remove('hidden');
    } else {
      catSuggestChip.classList.add('hidden');
    }
  });

  catSuggestChip?.addEventListener('click', () => {
    catEmojiInput.value = catSuggestChip.dataset.emoji;
    catSuggestChip.classList.add('hidden');
  });

  body.querySelector('#saveCatBtn')?.addEventListener('click', () => {
    const eid = document.getElementById('editingCatId').value;
    const emoji = document.getElementById('newCatEmoji').value.trim() || '📍';
    const label = document.getElementById('newCatLabel').value.trim();
    const termsRaw = document.getElementById('newCatTerms').value.trim();
    if (!label) return;
    const searchTerms = termsRaw
      ? termsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : [label.toLowerCase()];
    const existing = eid ? cats.find(c => c.id === eid) : null;
    State.upsertCategory({
      ...(existing || {}),
      id: eid || Storage.generateId(),
      type: 'category',
      emoji, label, searchTerms,
      enabled: existing ? existing.enabled : true,
    });
    renderCategorySection(body);
    renderFilterChips();
  });

  body.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const id = action.dataset.id;
    if (action.dataset.action === 'delete') {
      if (confirm('Delete this category?')) {
        State.deleteCategory(id);
        renderCategorySection(body);
        renderFilterChips();
      }
    } else if (action.dataset.action === 'toggle') {
      const cat = cats.find(c => c.id === id);
      if (cat) {
        State.upsertCategory({ ...cat, enabled: !cat.enabled });
        renderCategorySection(body);
        renderFilterChips();
      }
    } else if (action.dataset.action === 'edit-cat') {
      renderCategorySection(body, id);
      document.getElementById('addCatForm')?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// ── Emoji Suggestion ──────────────────────────────────────────────────────────
// Maps individual words (from real emoji names/aliases) to emoji characters.
// suggestEmoji scores the input label by counting word matches per emoji,
// returns the highest-scoring one. No regex patterns needed.

const EMOJI_WORDS = {
  // Food & drink
  '🍜': ['ramen','noodle','noodles','bowl','pho','udon','soba','soup'],
  '🍣': ['sushi','sashimi','nigiri','maki','roll','fish','japanese'],
  '🍕': ['pizza','pizzeria','slice'],
  '🍔': ['burger','hamburger','cheeseburger','grill','grilled'],
  '🌮': ['taco','tacos','burrito','mexican','tex','mex','tortilla'],
  '☕': ['coffee','cafe','café','espresso','latte','cappuccino','mocha','americano'],
  '🧋': ['tea','boba','bubble','milk','taiwanese'],
  '🍺': ['beer','pub','brewery','tap','ale','lager','craft','brew'],
  '🍸': ['bar','cocktail','lounge','drinks','speakeasy','izakaya','nightlife'],
  '🍷': ['wine','winery','vineyard','sommelier','cellar'],
  '🍦': ['ice','cream','gelato','frozen','yogurt','soft','serve','dessert','sorbet'],
  '🥐': ['bakery','bread','pastry','croissant','boulangerie','baked'],
  '🍩': ['donut','doughnut','donuts'],
  '🎂': ['cake','cupcake','sweets','sweet','candy','confection'],
  '🍱': ['bento','lunch','box','japanese','set'],
  '🥩': ['steak','beef','meat','grill','bbq','barbecue','butcher'],
  '🍗': ['chicken','wings','fried','poultry'],
  '🍜': ['noodle'],
  '🥗': ['salad','healthy','vegetarian','vegan','greens'],
  '🌶️': ['spicy','thai','indian','curry','hot','pepper'],
  // Drink
  '🧃': ['juice','smoothie','fresh','fruit'],
  // Grocery / retail
  '🛒': ['grocery','supermarket','market','food','store'],
  '🏪': ['convenience','konbini','seven','eleven','lawson','family','mart','mini'],
  '🏬': ['mall','shopping','center','department','store','plaza'],
  // Health
  '💊': ['pharmacy','drugstore','drug','chemist','medicine','prescription'],
  '🏥': ['hospital','emergency','urgent','care','medical','center'],
  '🩺': ['clinic','doctor','physician','health','dental','dentist','eye','optician'],
  // Finance
  '🏦': ['bank','banking','atm','cash','credit','union','financial'],
  '💴': ['atm','cash','money','exchange','currency'],
  // Services
  '📮': ['post','office','mail','postal','shipping','ups','fedex'],
  '✂️': ['hair','barber','salon','cut','beauty','stylist','grooming'],
  '💈': ['barber','barbershop','shave'],
  '🧺': ['laundry','laundromat','dry','clean','wash','cleaners'],
  '🔧': ['repair','fix','service','mechanic','maintenance'],
  // Lodging
  '🏨': ['hotel','hostel','inn','motel','ryokan','lodge','resort','accommodation'],
  '⛺': ['camp','camping','campsite'],
  // Transport
  '🚃': ['train','station','subway','metro','railway','rail','transit','commuter'],
  '🚌': ['bus','stop','terminal','coach'],
  '✈️': ['airport','terminal','flight','airline','departures','arrivals'],
  '🅿️': ['parking','garage','lot','valet'],
  '⛽': ['gas','petrol','fuel','station','diesel'],
  '🚢': ['ferry','boat','port','cruise','pier'],
  // Nature / outdoors
  '🌳': ['park','garden','nature','trail','botanical','green','reserve'],
  '🏖️': ['beach','surf','coast','ocean','sea','shore','bay'],
  '⛰️': ['mountain','hiking','trek','ski','snow','alpine','summit'],
  '🌊': ['surf','surfing','wave','beach','ocean'],
  // Culture / tourism
  '🏛️': ['museum','gallery','exhibit','art','history','science','natural'],
  '⛩️': ['shrine','jinja','torii','shinto'],
  '🛕': ['temple','cathedral','church','mosque','buddhist','hindu','worship'],
  '🗼': ['tower','landmark','monument','observation'],
  '🎡': ['amusement','park','rides','fun','fair','carnival'],
  // Entertainment
  '🎬': ['cinema','movie','theater','theatre','film','multiplex','imax'],
  '🎤': ['karaoke','singing','music','live'],
  '🕹️': ['arcade','game','gaming','esports','video'],
  '🎳': ['bowling','alley','lanes'],
  '⛳': ['golf','course','putting','driving','range'],
  '🏊': ['pool','swimming','aquatic','lap','water'],
  '🏋️': ['gym','fitness','workout','crossfit','weights','training','studio'],
  '🧘': ['yoga','pilates','meditation','wellness','stretch'],
  '🎭': ['theater','theatre','performance','opera','ballet','show'],
  '🎨': ['art','gallery','studio','craft','painting','creative'],
  // Spa / wellness
  '♨️': ['spa','massage','onsen','bath','sauna','hot','spring','thermal'],
  // Education
  '🎓': ['school','university','college','campus','academy','institute','education'],
  '📚': ['library','books','reading','study'],
  // Misc services
  '📦': ['storage','warehouse','self','stor','moving','boxes','depot'],
  '🐾': ['pet','vet','veterinary','animal','shelter','grooming','kennel'],
  '💐': ['flower','florist','floral','bouquet','garden'],
  '🧸': ['toy','toys','kids','children','baby','play'],
  '👗': ['clothes','clothing','fashion','apparel','boutique','dress'],
  '👟': ['shoes','sneaker','sneakers','footwear','boots'],
  '💻': ['electronics','tech','computer','phone','devices','gadget','apple','samsung'],
  '📖': ['book','bookstore','books','reading'],
  '🏟️': ['stadium','arena','sports','venue','field','court'],
  '🦁': ['zoo','aquarium','safari','wildlife','animals'],
  '🏕️': ['camp','outdoor','hiking','wilderness'],
};

// Flat word→emoji index built once
const _EMOJI_INDEX = (() => {
  const idx = {};
  for (const [emoji, words] of Object.entries(EMOJI_WORDS)) {
    for (const word of words) {
      if (!idx[word]) idx[word] = [];
      idx[word].push(emoji);
    }
  }
  return idx;
})();

function suggestEmoji(label) {
  if (!label) return null;
  const words = label.toLowerCase().split(/[\s\-_\/,]+/).filter(w => w.length > 2);
  const scores = {};
  for (const word of words) {
    // Exact match
    if (_EMOJI_INDEX[word]) {
      for (const e of _EMOJI_INDEX[word]) scores[e] = (scores[e] || 0) + 2;
    }
    // Partial match (word is substring of an index word or vice versa)
    for (const [key, emojis] of Object.entries(_EMOJI_INDEX)) {
      if (key !== word && (key.includes(word) || word.includes(key))) {
        for (const e of emojis) scores[e] = (scores[e] || 0) + 1;
      }
    }
  }
  if (Object.keys(scores).length === 0) return null;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Specific Places ──────────────────────────────────────────────────────────

function renderSpecificPlacesSection(body, editingId = null) {
  const places = State.get().specificPlaces;
  const editing = editingId ? places.find(p => p.id === editingId) : null;

  body.innerHTML = `
    <div class="section-header">
      <h2>Specific Places</h2>
      <button class="btn btn--sm" id="addPlaceBtn" type="button">+ Add</button>
    </div>
    <div id="placeForm" class="inline-form ${editing ? '' : 'hidden'}">
      <div class="emoji-suggest-row">
        <input id="newPlaceEmoji" class="emoji-input" type="text" placeholder="📌" maxlength="2"
          value="${editing?.emoji || ''}">
        <span id="emojiSuggestChip" class="emoji-suggest-chip hidden"></span>
      </div>
      <input id="newPlaceLabel" class="text-input" type="text"
        placeholder="Place name / custom label" value="${editing?.label || ''}">
      <input id="newPlaceAddress" class="text-input" type="text"
        placeholder="Search address or name" value="${editing?.address || ''}">
      <div id="geocodeResults" class="geocode-results"></div>
      <div class="coord-row">
        <input id="newPlaceLat" class="text-input" type="number" placeholder="Latitude"
          step="any" value="${editing?.latitude ?? ''}">
        <input id="newPlaceLon" class="text-input" type="number" placeholder="Longitude"
          step="any" value="${editing?.longitude ?? ''}">
      </div>
      <textarea id="newPlaceNotes" class="text-input" placeholder="Notes (optional)"
        rows="2">${editing?.notes || ''}</textarea>
      <input type="hidden" id="editingPlaceId" value="${editingId || ''}">
      <div class="form-actions">
        <button class="btn btn--ghost btn--sm" id="geocodeBtn" type="button">🔍 Look Up</button>
        <button class="btn btn--primary btn--sm" id="savePlaceBtn" type="button">
          ${editing ? 'Update' : 'Save'}
        </button>
        <button class="btn btn--ghost btn--sm" id="cancelPlaceBtn" type="button">Cancel</button>
      </div>
    </div>
    ${places.length === 0
      ? '<div class="empty-state"><p>No saved places yet.</p></div>'
      : places.map(p => `
          <div class="place-row" data-id="${p.id}">
            <span class="place-emoji">${p.emoji || '📌'}</span>
            <div class="place-info">
              <div class="place-label">${p.label}</div>
              ${p.address ? `<div class="place-addr">${p.address}</div>` : ''}
              ${p.notes ? `<div class="place-notes">${p.notes}</div>` : ''}
            </div>
            <div class="place-actions">
              <button class="toggle-btn ${p.enabled ? 'on' : 'off'}"
                data-action="toggle-place" data-id="${p.id}" type="button">
                ${p.enabled ? 'On' : 'Off'}
              </button>
              <button class="icon-btn" data-action="edit-place" data-id="${p.id}" title="Edit" type="button">✏️</button>
              <button class="icon-btn" data-action="delete-place" data-id="${p.id}" type="button">🗑</button>
            </div>
          </div>
        `).join('')
    }
  `;

  // Show/hide add form
  body.querySelector('#addPlaceBtn')?.addEventListener('click', () => {
    const form = document.getElementById('placeForm');
    document.getElementById('editingPlaceId').value = '';
    document.getElementById('savePlaceBtn').textContent = 'Save';
    form.classList.toggle('hidden');
  });
  body.querySelector('#cancelPlaceBtn')?.addEventListener('click', () => {
    document.getElementById('placeForm').classList.add('hidden');
  });

  // Emoji suggestion on label input
  const labelInput = document.getElementById('newPlaceLabel');
  const emojiInput = document.getElementById('newPlaceEmoji');
  const suggestChip = document.getElementById('emojiSuggestChip');

  labelInput?.addEventListener('input', () => {
    const current = emojiInput.value.trim();
    if (current && current !== '📌') return; // user already set one
    const suggested = suggestEmoji(labelInput.value);
    if (suggested) {
      suggestChip.textContent = `Use ${suggested}?`;
      suggestChip.dataset.emoji = suggested;
      suggestChip.classList.remove('hidden');
    } else {
      suggestChip.classList.add('hidden');
    }
  });

  suggestChip?.addEventListener('click', () => {
    emojiInput.value = suggestChip.dataset.emoji;
    suggestChip.classList.add('hidden');
  });

  // Geocode lookup
  body.querySelector('#geocodeBtn')?.addEventListener('click', async () => {
    const query = document.getElementById('newPlaceAddress').value.trim();
    if (!query || !getToken()) return;
    const btn = document.getElementById('geocodeBtn');
    btn.textContent = '⏳';
    try {
      const results = await Search.geocodePlace(query, getToken());
      const container = document.getElementById('geocodeResults');
      container.innerHTML = results.slice(0, 4).map((r, i) => `
        <button class="geocode-result" data-idx="${i}" type="button">
          <strong>${r.shortName}</strong> — ${r.name}
        </button>
      `).join('');
      container.querySelectorAll('.geocode-result').forEach(btn2 => {
        btn2.addEventListener('click', () => {
          const r = results[parseInt(btn2.dataset.idx)];
          document.getElementById('newPlaceLat').value = r.latitude;
          document.getElementById('newPlaceLon').value = r.longitude;
          document.getElementById('newPlaceAddress').value = r.name;
          if (!document.getElementById('newPlaceLabel').value) {
            document.getElementById('newPlaceLabel').value = r.shortName;
            // Trigger emoji suggestion for geocoded name too
            labelInput.dispatchEvent(new Event('input'));
          }
          container.innerHTML = '';
        });
      });
    } catch (e) { console.warn('Geocode error', e); }
    btn.textContent = '🔍 Look Up';
  });

  // Save / update
  body.querySelector('#savePlaceBtn')?.addEventListener('click', () => {
    const eid = document.getElementById('editingPlaceId').value;
    const emoji = document.getElementById('newPlaceEmoji').value.trim() || '📌';
    const label = document.getElementById('newPlaceLabel').value.trim();
    const address = document.getElementById('newPlaceAddress').value.trim();
    const lat = parseFloat(document.getElementById('newPlaceLat').value);
    const lon = parseFloat(document.getElementById('newPlaceLon').value);
    const notes = document.getElementById('newPlaceNotes').value.trim();
    if (!label || isNaN(lat) || isNaN(lon)) {
      showToast('Label and coordinates are required');
      return;
    }
    const existing = eid ? places.find(p => p.id === eid) : null;
    State.upsertSpecificPlace({
      ...(existing || {}),
      id: eid || Storage.generateId(),
      type: 'specific_place',
      emoji, label, address, notes,
      latitude: lat, longitude: lon,
      enabled: existing ? existing.enabled : true,
    });
    renderSpecificPlacesSection(body);
  });

  // Row actions
  body.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const id = action.dataset.id;
    if (action.dataset.action === 'delete-place') {
      if (confirm('Delete this place?')) {
        State.deleteSpecificPlace(id);
        renderSpecificPlacesSection(body);
      }
    } else if (action.dataset.action === 'toggle-place') {
      const place = State.get().specificPlaces.find(p => p.id === id);
      if (place) {
        State.upsertSpecificPlace({ ...place, enabled: !place.enabled });
        renderSpecificPlacesSection(body);
      }
    } else if (action.dataset.action === 'edit-place') {
      renderSpecificPlacesSection(body, id);
      document.getElementById('placeForm')?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// Favorites ───────────────────────────────────────────────────────────────────

function renderFavoritesSection(body) {
  const favs = State.get().favorites;
  body.innerHTML = `
    <div class="section-header"><h2>Favorites</h2></div>
    ${favs.length === 0
      ? '<div class="empty-state"><p>No favorites yet.</p><p class="empty-sub">Tap ♡ on any place detail.</p></div>'
      : favs.map(f => `
          <div class="fav-row" data-id="${f.id}">
            <span>${f.matchedBy?.emoji || f.emoji || '♥'}</span>
            <div class="fav-info">
              <div class="fav-name">${f.name || f.label}</div>
              ${f.address ? `<div class="fav-addr">${f.address}</div>` : ''}
            </div>
            <button class="icon-btn" data-action="unfav" data-id="${f.id}" type="button">♥</button>
          </div>
        `).join('')
    }
  `;

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="unfav"]');
    if (btn) {
      const fav = favs.find(f => f.id === btn.dataset.id);
      if (fav) {
        State.toggleFavorite(fav);
        renderFavoritesSection(body);
      }
    }
  });
}

// Settings ────────────────────────────────────────────────────────────────────

function renderSettingsSection(body) {
  const s = State.get().settings;
  body.innerHTML = `
    <div class="section-header"><h2>Settings</h2></div>
    <div class="settings-form">
      <label class="setting-row">
        <span>Default Radius</span>
        <select id="settingRadius" class="select-input">
          <option value="200" ${s.defaultRadiusMeters === 200 ? 'selected' : ''}>200m (2 min)</option>
          <option value="800" ${s.defaultRadiusMeters === 800 ? 'selected' : ''}>800m (10 min)</option>
          <option value="1600" ${s.defaultRadiusMeters === 1600 ? 'selected' : ''}>1600m (20 min)</option>
        </select>
      </label>
      <label class="setting-row">
        <span>Auto-open Nearby list after refresh</span>
        <input type="checkbox" id="settingAutoNearby" ${s.autoOpenNearbyAfterRefresh ? 'checked' : ''}>
      </label>
      <label class="setting-row">
        <span>Hide closed places</span>
        <input type="checkbox" id="settingHideClosed" ${s.hideClosedPlaces ? 'checked' : ''}>
      </label>
      <div class="setting-row setting-row--column">
        <div class="setting-row-label">
          <span>Mapbox Token</span>
          <a class="token-help-link" href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener">Get token ↗</a>
        </div>
        <input type="text" id="settingMapboxToken" class="text-input mono"
          placeholder="pk.eyJ1..." value="${getToken()}">
        <p class="token-hint">Starts with <code>pk.</code> — stored locally only.</p>
      </div>
      <button class="btn btn--primary btn--sm" id="saveSettingsBtn" type="button">Save Settings</button>
    </div>
  `;

  body.querySelector('#saveSettingsBtn')?.addEventListener('click', () => {
    const radius = parseInt(document.getElementById('settingRadius').value);
    const autoNearby = document.getElementById('settingAutoNearby').checked;
    const hideClosed = document.getElementById('settingHideClosed').checked;
    const token = document.getElementById('settingMapboxToken').value.trim();
    State.updateSettings({
      defaultRadiusMeters: radius,
      autoOpenNearbyAfterRefresh: autoNearby,
      hideClosedPlaces: hideClosed,
    });
    if (token && token !== getToken()) {
      window.VICINITY_MAPBOX_TOKEN = token;
      Storage.saveSettings({ ...State.get().settings, mapboxToken: token });
      // Reinit map with new token if map screen is active
      if (State.get().activeTab === 'map') {
        MapService.init('mapContainer', token);
      }
    } else if (!token) {
      // Token cleared — save empty
      Storage.saveSettings({ ...State.get().settings, mapboxToken: '' });
      window.VICINITY_MAPBOX_TOKEN = '';
    }
    State.setMapRadius(radius);
    showToast('Settings saved');
  });
}

// Import / Export ─────────────────────────────────────────────────────────────

function renderImportExportSection(body) {
  body.innerHTML = `
    <div class="section-header"><h2>Import / Export</h2></div>
    <div class="ie-section">
      <p class="ie-desc">Export all your categories, places, and favorites as a JSON file you can reimport later.</p>
      <button class="btn btn--primary" id="exportBtn" type="button">⬇ Export Data</button>
    </div>
    <div class="ie-section">
      <p class="ie-desc">Import replaces all local data with the contents of the file.</p>
      <label class="btn btn--outline" style="cursor:pointer">
        ⬆ Import Data
        <input type="file" id="importFile" accept=".json" style="display:none">
      </label>
      <p id="importStatus" class="import-status"></p>
    </div>
    <div class="ie-section danger-zone">
      <p class="ie-desc">Clear all local data and restart onboarding.</p>
      <button class="btn btn--danger" id="resetBtn" type="button">⚠ Reset Everything</button>
    </div>
  `;

  body.querySelector('#exportBtn')?.addEventListener('click', () => {
    const bundle = Storage.exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vicinity-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  body.querySelector('#importFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('importStatus');
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      Storage.importBundle(bundle, 'replace');
      State.loadFromStorage();
      statusEl.textContent = '✓ Import successful';
      statusEl.style.color = 'var(--color-success)';
      renderSetupScreen();
      renderFilterChips();
    } catch (err) {
      statusEl.textContent = `✗ Import failed: ${err.message}`;
      statusEl.style.color = 'var(--color-danger)';
    }
  });

  body.querySelector('#resetBtn')?.addEventListener('click', () => {
    if (confirm('This will delete all your data and restart onboarding. Are you sure?')) {
      Object.values(Storage.KEYS).forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function wireNavigation() {
  // Nearby nav button — opens sheet, doesn't change screen
  document.getElementById('navNearby').addEventListener('click', (e) => {
    e.stopPropagation();
    if (State.get().activeTab !== 'map') {
      State.setTab('map');
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      document.getElementById('screenMap').classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach(b =>
        b.classList.toggle('nav-btn--active', b.id === 'navMap')
      );
      requestAnimationFrame(() => MapService.getMap()?.resize());
    }
    openBottomSheet();
  });

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      State.setTab(tab);
      closeBottomSheet();
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      document.getElementById(tab === 'map' ? 'screenMap' : 'screenSetup')
        .classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach(b =>
        b.classList.toggle('nav-btn--active', b.dataset.tab === tab)
      );
      if (tab === 'setup') renderSetupScreen();
      if (tab === 'map') requestAnimationFrame(() => MapService.getMap()?.resize());
    });
  });
}

// ── State Listeners ───────────────────────────────────────────────────────────

function wireStateListeners() {
  // 'loaded' fires during boot before DOM exists — defer one tick
  State.on('loaded', () => setTimeout(() => {
    if (State.get().locationStale) {
      const banner = document.getElementById('statusBanner');
      const btn = document.getElementById('refreshBtn');
      if (banner) {
        banner.textContent = 'Showing last known location — tap Refresh to update';
        banner.classList.remove('hidden', 'banner--error');
        banner.classList.add('banner--stale');
        setTimeout(() => banner.classList.add('hidden'), 6000);
      }
      if (btn) {
        btn.innerHTML = '<span id="refreshIcon">⊙</span> Refresh Location <span class="stale-badge">stale</span>';
      }
    }
  }, 0));
  State.on('place:selected', (place) => {
    if (place) renderPlaceDetail(place);
    else document.getElementById('placeDetail')?.classList.add('hidden');
  });

  State.on('location:status', ({ status, error }) => {
    const banner = document.getElementById('statusBanner');
    if (!banner) return;
    const btn = document.getElementById('refreshBtn');

    const hideBanner = () => {
      banner.style.display = 'none';
      banner.classList.add('hidden');
    };
    const showBanner = (text, cls) => {
      banner.style.display = '';
      banner.classList.remove('hidden', 'banner--stale', 'banner--error');
      if (cls) banner.classList.add(cls);
      banner.textContent = text;
    };
    const resetBtn = (stale = false) => {
      if (!btn) return;
      btn.classList.remove('loading');
      btn.innerHTML = stale
        ? '<span id="refreshIcon">⊙</span> Refresh Location <span class="stale-badge">stale</span>'
        : '<span id="refreshIcon">⊙</span> Refresh Location';
    };

    if (status === 'stale') {
      showBanner('Showing last known location — tap Refresh to update', 'banner--stale');
      resetBtn(true);
      setTimeout(hideBanner, 6000);
    } else if (status === 'requesting') {
      showBanner('Getting your location…');
      if (btn) {
        btn.classList.add('loading');
        btn.innerHTML = '<span id="refreshIcon">⏳</span> Getting location…';
      }
      // Safety net — always clear after 15s no matter what
      setTimeout(hideBanner, 15000);
    } else if (status === 'success') {
      hideBanner();
      resetBtn(false);
    } else if (status === 'denied' || status === 'error') {
      showBanner(error || 'Location unavailable', 'banner--error');
      resetBtn(false);
      setTimeout(hideBanner, 5000);
    }
  });

  State.on('search:started', () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.innerHTML = '<span id="refreshIcon">⏳</span> Searching…';
  });

  // nearby:updated is the definitive "all done" signal — always clear banner here too
  State.on('nearby:updated', (results) => {
    const banner = document.getElementById('statusBanner');
    if (banner) {
      banner.style.display = 'none';
      banner.classList.add('hidden');
    }
    const btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.classList.remove('loading');
      const isManual = !!State.get().currentLocation?.manual;
      btn.innerHTML = isManual
        ? '<span id="refreshIcon">⊙</span> Search Here <span class="loc-badge loc-badge--manual">Manual</span>'
        : '<span id="refreshIcon">⊙</span> Refresh Location <span class="loc-badge loc-badge--gps">GPS</span>';
    }
    const navCount = document.getElementById('navNearbyCount');
    if (navCount) navCount.textContent = results.length ? `(${results.length})` : '';
    if (State.get().bottomSheetOpen) renderNearbyList();
  });

  // search:error — reset button so it doesn't stay frozen at ⏳
  State.on('search:error', () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.classList.remove('loading');
      const isManual = !!State.get().currentLocation?.manual;
      btn.innerHTML = isManual
        ? '<span id="refreshIcon">⊙</span> Search Here'
        : '<span id="refreshIcon">⊙</span> Refresh Location';
    }
  });

  State.on('categories:changed', () => {
    renderFilterChips();
  });

  State.on('location:updated', (coords) => {
    const pinBtn = document.getElementById('pinBtn');
    const gpsBtn = document.getElementById('gpsToggleBtn');
    if (pinBtn) {
      pinBtn.classList.remove('map-btn--pin-picking');
      pinBtn.classList.toggle('map-btn--pin-set', !!coords.manual);
      pinBtn.title = coords.manual ? 'Manual pin active — tap to re-place' : 'Drop pin to set location manually';
    }
    // Show GPS toggle only when manual mode is active
    if (gpsBtn) gpsBtn.classList.toggle('hidden', !coords.manual);
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn && !refreshBtn.classList.contains('loading')) {
      refreshBtn.innerHTML = coords.manual
        ? '<span id="refreshIcon">⊙</span> Search Here <span class="loc-badge loc-badge--manual">Manual</span>'
        : '<span id="refreshIcon">⊙</span> Refresh Location';
    }
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}
