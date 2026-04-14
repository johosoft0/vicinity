# Vicinity

A browser-based, mobile-friendly walking discovery app. Keep a personal list of categories and specific places, then tap **Refresh Location** to find nearby matches on demand.

---

## Quick Start

### 1. Get a Mapbox token (free)
1. Create a free account at [account.mapbox.com](https://account.mapbox.com)
2. Copy your default public token (starts with `pk.`)

### 2. Configure
```bash
cp config.example.js config.js
```
Edit `config.js` and replace `YOUR_MAPBOX_PUBLIC_TOKEN_HERE` with your token.

### 3. Serve
The app uses ES modules, so it requires a local HTTP server (not `file://`).

```bash
# Python 3
python3 -m http.server 8080

# Node (npx)
npx serve .

# VS Code: Live Server extension works great
```

Then open `http://localhost:8080` in your browser.

---

## Architecture

No build step, no bundler, no framework dependencies.

```
vicinity/
  index.html          — App entry point
  config.js           — Your Mapbox token (gitignored)
  config.example.js   — Token template
  css/
    styles.css        — All styles
  js/
    storage.js        — localStorage service (versioned keys, export/import)
    state.js          — Central reactive state + event emitter
    map.js            — Mapbox GL JS integration
    search.js         — Overpass API (OSM) for POI search + Mapbox geocoding
    translation.js    — MyMemory API for CJK name translation + cache
    ui.js             — All DOM rendering and event wiring
```

### Key design decisions vs. the original planning doc

| Topic | Plan Doc | Actual Implementation |
|---|---|---|
| Framework | Next.js + React | Vanilla JS ES Modules (no build step) |
| POI search | "Mapbox search" | **Overpass API (OpenStreetMap)** — free, no limits, rich tags |
| Translation | Unspecified | **MyMemory API** — free, no key, good Japanese support |
| Nearby list | Separate tab or sheet | **Bottom sheet** from the map screen |
| Navigation | 3 tabs | **2 tabs** (Map + Setup) — Nearby is a sheet |

---

## Features (Phase 1–3)

- ✅ Onboarding with starter category quick-picks
- ✅ Category management (add, toggle, delete)
- ✅ Specific place management with Mapbox geocoding
- ✅ Mapbox map with dark style
- ✅ On-demand location refresh (no continuous tracking)
- ✅ Radius selector (5/10/15 min walk)
- ✅ Emoji markers for POI results and saved places
- ✅ Radius circle overlay
- ✅ Category filter chips
- ✅ Nearby bottom sheet (sorted by distance)
- ✅ Place detail screen with favorites
- ✅ Export/import JSON data bundle
- ✅ Settings panel
- ✅ localStorage persistence with versioned keys
- ✅ CJK translation cache architecture (MyMemory)

---

## Adding the App to Your Phone

On mobile, visit the app URL and use your browser's **Add to Home Screen** option. The app is designed to work well as a PWA-style bookmark.

---

## Data Storage

All data is stored locally in `localStorage` under `vicinity:v1:*` keys. Nothing is sent to any server except:
- Mapbox (map tiles + geocoding) — see their privacy policy
- Overpass API (OpenStreetMap) — anonymous POI queries
- MyMemory (translation) — only triggered for CJK place names

---

## Adding New Category Types

Edit `js/search.js` and add an entry to `OSM_TAG_MAP`:

```js
'your category': [{ amenity: 'your_osm_tag' }],
```

Find OSM tags at [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org).

---

## Phase Roadmap

- **Phase 4** — Translation integration (automatic CJK → EN on nearby results)
- **Phase 5** — Marker clustering for dense urban areas  
- **Phase 6** — "Trip profiles" — multiple lists/contexts
- **Phase 7** — Favorites map layer, favorites-based quick filter
