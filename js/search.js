// search.js — POI search via Overpass API (OpenStreetMap)
// Free, no key, rich POI tags, great for category-based nearby search
// Also handles Mapbox geocoding for specific place resolution

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MAPBOX_GEOCODE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

// OSM tag mappings for common categories
// Maps user-friendly category labels to OSM amenity/shop/tourism tags
const OSM_TAG_MAP = {
  // Food
  'sushi':          [{ amenity: 'restaurant', cuisine: 'sushi' }, { amenity: 'restaurant', cuisine: 'japanese' }],
  'ramen':          [{ amenity: 'restaurant', cuisine: 'ramen' }],
  'coffee':         [{ amenity: 'cafe' }],
  'café':           [{ amenity: 'cafe' }],
  'cafe':           [{ amenity: 'cafe' }],
  'restaurant':     [{ amenity: 'restaurant' }],
  'fast food':      [{ amenity: 'fast_food' }],
  'convenience':    [{ shop: 'convenience' }],
  'konbini':        [{ shop: 'convenience' }],
  'supermarket':    [{ shop: 'supermarket' }],
  'bakery':         [{ shop: 'bakery' }, { amenity: 'cafe', bakery: 'yes' }],
  'bar':            [{ amenity: 'bar' }, { amenity: 'pub' }],
  'izakaya':        [{ amenity: 'bar', cuisine: 'japanese' }],
  // Shopping
  'pharmacy':       [{ amenity: 'pharmacy' }],
  'drugstore':      [{ amenity: 'pharmacy' }, { shop: 'chemist' }],
  'electronics':    [{ shop: 'electronics' }],
  'clothing':       [{ shop: 'clothes' }],
  'bookstore':      [{ shop: 'books' }],
  'department store': [{ shop: 'department_store' }],
  // Transit
  'train station':  [{ railway: 'station' }, { railway: 'halt' }],
  'subway':         [{ station: 'subway' }, { railway: 'subway_entrance' }],
  'bus stop':       [{ highway: 'bus_stop' }],
  // Services
  'atm':            [{ amenity: 'atm' }],
  'bank':           [{ amenity: 'bank' }],
  'hospital':       [{ amenity: 'hospital' }],
  'clinic':         [{ amenity: 'clinic' }],
  'post office':    [{ amenity: 'post_office' }],
  // Tourism / Culture
  'museum':         [{ tourism: 'museum' }],
  'shrine':         [{ amenity: 'place_of_worship', religion: 'shinto' }, { historic: 'wayside_shrine' }],
  'temple':         [{ amenity: 'place_of_worship', religion: 'buddhist' }],
  'park':           [{ leisure: 'park' }],
  'hotel':          [{ tourism: 'hotel' }],
  'tourist attraction': [{ tourism: 'attraction' }],
  // Generic fallback uses name search
};

// Build an Overpass QL query for explicit tag sets (e.g. amenity=bar)
function buildOverpassQuery(lat, lon, radiusMeters, tagSets) {
  const parts = tagSets.flatMap(tagSet => {
    const conditions = Object.entries(tagSet)
      .map(([k, v]) => `["${k}"="${v}"]`)
      .join('');
    return [
      `node${conditions}(around:${radiusMeters},${lat},${lon});`,
      `way${conditions}(around:${radiusMeters},${lat},${lon});`,
    ];
  });
  return `[out:json][timeout:20];(${parts.join('')});out center 50;`;
}

// Build a broad tag-value search: looks for the term as a value in any of
// the main OSM classification keys. Catches user-typed terms like "bar",
// "storage", "gym", "laundry" etc. that aren't in OSM_TAG_MAP.
function buildBroadTagQuery(lat, lon, radiusMeters, term) {
  const esc = term.replace(/"/g, '\\"');
  const keys = ['amenity', 'shop', 'leisure', 'tourism', 'landuse', 'building'];
  const parts = keys.flatMap(k => [
    `node["${k}"~"${esc}",i](around:${radiusMeters},${lat},${lon});`,
    `way["${k}"~"${esc}",i](around:${radiusMeters},${lat},${lon});`,
  ]);
  return `[out:json][timeout:20];(${parts.join('')});out center 50;`;
}

// Name-based regex fallback — searches the place's name field
function buildNameSearchQuery(lat, lon, radiusMeters, searchTerm) {
  const esc = searchTerm.replace(/"/g, '\\"');
  return `[out:json][timeout:20];(
    node["name"~"${esc}",i](around:${radiusMeters},${lat},${lon});
    way["name"~"${esc}",i](around:${radiusMeters},${lat},${lon});
  );out center 50;`;
}

// Normalize an Overpass element to NearbyResult shape
function normalizeOSMElement(el, matchedBy) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;

  if (!lat || !lon) return null;

  const name = tags.name || tags['name:en'] || tags['name:ja'] || 'Unnamed';
  const localName = tags['name:ja'] || (tags.name !== name ? tags.name : null);

  return {
    id: `osm-${el.type}-${el.id}`,
    provider: 'overpass',
    providerPlaceId: `${el.type}/${el.id}`,
    matchedBy,
    name,
    localName: localName || null,
    translatedName: null,
    categoryLabel: matchedBy.sourceLabel,
    latitude: lat,
    longitude: lon,
    address: buildAddressFromTags(tags),
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    rating: null,
    reviewCount: null,
    priceLevel: null,
    menuUrl: null,
    hours: parseOSMHours(tags.opening_hours),
    distanceMeters: null,
    isOpenNow: null,
    lastFetchedAt: new Date().toISOString(),
  };
}

function buildAddressFromTags(tags) {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : (tags.address || null);
}

function parseOSMHours(raw) {
  if (!raw) return null;
  // Return as-is for now; a full parser is out of MVP scope
  return [raw];
}

// Run a category search via Overpass
// Strategy:
//   1. If label is in OSM_TAG_MAP → use explicit tag query (most accurate)
//   2. Otherwise run broad tag-value search across amenity/shop/leisure/etc
//      for each searchTerm (catches "bar", "storage", "gym", etc.)
//   3. Also run name-regex search as a parallel pass to catch branded places
async function searchCategory(lat, lon, radiusMeters, category) {
  const label = category.label.toLowerCase();
  const tagSets = OSM_TAG_MAP[label];

  const matchedBy = {
    sourceType: 'category',
    sourceId: category.id,
    sourceLabel: category.label,
    emoji: category.emoji,
  };

  const runQuery = async (query) => {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' },
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    return (data.elements || [])
      .map(el => normalizeOSMElement(el, matchedBy))
      .filter(Boolean);
  };

  try {
    if (tagSets && tagSets.length > 0) {
      // Known category — single precise query
      return await runQuery(buildOverpassQuery(lat, lon, radiusMeters, tagSets));
    }

    // Unknown category — run broad tag search for each searchTerm in parallel
    const terms = category.searchTerms?.length
      ? category.searchTerms
      : [label];

    const queries = terms.flatMap(term => [
      buildBroadTagQuery(lat, lon, radiusMeters, term),
      buildNameSearchQuery(lat, lon, radiusMeters, term),
    ]);

    // Run with small stagger to avoid hammering Overpass
    const allResults = [];
    for (const q of queries) {
      try {
        const r = await runQuery(q);
        allResults.push(...r);
      } catch (e) {
        console.warn('Overpass sub-query failed:', e.message);
      }
      if (queries.indexOf(q) < queries.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return allResults;

  } catch (e) {
    console.warn('Overpass search failed:', category.label, e);
    return [];
  }
}

// Geocode a place name/address to coordinates using Mapbox
async function geocodePlace(query, mapboxToken) {
  if (!mapboxToken) throw new Error('Mapbox token required for geocoding');
  const encoded = encodeURIComponent(query);
  const url = `${MAPBOX_GEOCODE_URL}/${encoded}.json?access_token=${mapboxToken}&limit=5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const data = await res.json();

  return (data.features || []).map(f => ({
    name: f.place_name,
    shortName: f.text,
    latitude: f.center[1],
    longitude: f.center[0],
    placeId: f.id,
    placeType: f.place_type?.[0],
  }));
}

// Haversine distance in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// Deduplicate results by proximity (merge OSM nodes that are very close)
function deduplicateResults(results) {
  const seen = [];
  return results.filter(r => {
    const duplicate = seen.some(s =>
      s.name === r.name &&
      distanceMeters(s.latitude, s.longitude, r.latitude, r.longitude) < 30
    );
    if (!duplicate) seen.push(r);
    return !duplicate;
  });
}

// Main search runner — runs all enabled categories
async function runNearbySearch(lat, lon, radiusMeters, categories) {
  const enabled = categories.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  // Run searches with slight delay between them to be Overpass-polite
  const allResults = [];
  for (const cat of enabled) {
    const results = await searchCategory(lat, lon, radiusMeters, cat);
    // Attach distances
    results.forEach(r => {
      r.distanceMeters = Math.round(distanceMeters(lat, lon, r.latitude, r.longitude));
    });
    allResults.push(...results);
    if (enabled.indexOf(cat) < enabled.length - 1) {
      await new Promise(res => setTimeout(res, 300));
    }
  }

  const deduped = deduplicateResults(allResults);
  deduped.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
  return deduped;
}

export const Search = {
  runNearbySearch,
  geocodePlace,
  distanceMeters,
  formatDistance,
  OSM_TAG_MAP,
};
