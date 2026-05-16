# Vicinity

A browser-based, mobile-friendly walking discovery app. Keep a personal list of categories and specific places, then tap **Refresh Location** to find nearby matches on demand.

No API keys. No accounts. No tracking. Everything runs in your browser.

---

## Quick Start

No build step, no dependencies to install. Just serve the folder.

```bash
# Python 3
python3 -m http.server 8080

# Node
npx serve .

# VS Code: Live Server extension works too
```

Then open `http://localhost:8080`.

---

## Deploy to GitHub Pages

1. Push the repo to GitHub
2. Go to **Settings → Pages → Source: main branch, / (root)**
3. Done — live at `https://yourusername.github.io/vicinity/`

No config files to edit. No tokens to manage.

---

## Architecture

```
vicinity/
  index.html              — App entry point
  manifest.json           — PWA manifest
  icons/
    icon-192.png
    icon-512.png
  css/
    styles.css            — All styles
  js/
    storage.js            — localStorage service (versioned keys, export/import)
    state.js              — Central reactive state + event emitter
    map.js                — MapLibre GL JS integration + supercluster
    search.js             — Overpass API (OSM) POI search + Nominatim geocoding
    translation.js        — MyMemory API for CJK name translation + cache
    ui.js                 — All DOM rendering and event wiring
```

No framework. No bundler. ES modules only.

---

## Tech Stack

| Concern | Solution | Cost |
|---|---|---|
| Map rendering | [MapLibre GL JS](https://maplibre.org/) | Free, open source |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) | Free, no key |
| POI search | [Overpass API](https://overpass-api.de/) (OpenStreetMap) | Free, no key |
| Geocoding | [Nominatim](https://nominatim.org/) (OSM) | Free, no key |
| Translation | [MyMemory](https://mymemory.translated.net/) | Free, no key, 5k chars/day per IP |
| Persistence | Browser localStorage | Free |

Zero external dependencies at runtime beyond the CDN scripts in `index.html`.

---

## Features

- Onboarding with starter category quick-picks
- Category management — add, toggle, edit, delete
- Specific place management with Nominatim geocoding lookup
- Dark map with radius circle overlay
- On-demand location refresh — no continuous GPS tracking
- Manual pin placement — tap anywhere on the map to set location
- Draggable pin — reposition after drop
- GPS toggle — green = active, red = manual/off
- Radius selector: 2 min (200m) / 10 min (800m) / 20 min (1600m)
- Emoji markers for POI results and saved places
- Marker clustering for dense cities (Tokyo, NYC, etc.)
- Category filter chips
- Nearby slide-up sheet with Update Places button
- Place detail with Open in Maps (Google Maps, name + coords)
- Favorites
- CJK name translation (Japanese → English) with local cache
- Export / import JSON data bundle
- Settings panel
- Last known location restored across sessions
- PWA — add to home screen on iOS and Android

---

## Scalability Notes

The free stack holds up well across usage tiers:

- **OpenFreeMap tiles** — no rate limits, runs at scale, donation-funded
- **Nominatim geocoding** — 1 req/sec limit, only called on place add (low frequency)
- **Overpass POI search** — community servers with slot-based limits; fine for personal use and small teams; at 10k+ MAU consider self-hosting or using a mirror (overpass.kumi.systems)
- **MyMemory translation** — 5k chars/day per user IP; local cache means repeat visits cost nothing

---

## Adding OSM Category Types

Edit `js/search.js` and add an entry to `OSM_TAG_MAP`:

```js
'your category': [{ amenity: 'your_osm_value' }],
```

Find OSM tags at [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org).

---

## Data & Privacy

All user data (categories, places, favorites, settings) lives in browser localStorage only. Queries go to:

- **OpenFreeMap** — map tile requests (your rough viewport, no account)
- **Overpass API** — anonymous POI queries with your coordinates
- **Nominatim** — place name lookups when adding a specific place
- **MyMemory** — Japanese place names only, cached after first translation

No analytics. No ads. No server.

---

## Roadmap

- Marker clustering refinements (count badge sizing)
- Trip / list profiles (multiple saved lists)
- Favorites map layer
- Self-hosted Overpass option for high-traffic deployments
