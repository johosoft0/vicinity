// search.js — POI search via Overpass API (OpenStreetMap)

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MAPBOX_GEOCODE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

const OSM_TAG_MAP = {
  'sushi':              [{ amenity: 'restaurant', cuisine: 'sushi' }, { amenity: 'restaurant', cuisine: 'japanese' }],
  'ramen':              [{ amenity: 'restaurant', cuisine: 'ramen' }],
  'coffee':             [{ amenity: 'cafe' }],
  'café':               [{ amenity: 'cafe' }],
  'cafe':               [{ amenity: 'cafe' }],
  'restaurant':         [{ amenity: 'restaurant' }],
  'fast food':          [{ amenity: 'fast_food' }],
  'convenience':        [{ shop: 'convenience' }],
  'konbini':            [{ shop: 'convenience' }],
  'supermarket':        [{ shop: 'supermarket' }],
  'bakery':             [{ shop: 'bakery' }],
  'bar':                [{ amenity: 'bar' }, { amenity: 'pub' }],
  'izakaya':            [{ amenity: 'bar', cuisine: 'japanese' }],
  'pharmacy':           [{ amenity: 'pharmacy' }],
  'drugstore':          [{ amenity: 'pharmacy' }, { shop: 'chemist' }],
  'electronics':        [{ shop: 'electronics' }],
  'clothing':           [{ shop: 'clothes' }],
  'bookstore':          [{ shop: 'books' }],
  'department store':   [{ shop: 'department_store' }],
  'train station':      [{ railway: 'station' }, { railway: 'halt' }],
  'subway':             [{ station: 'subway' }, { railway: 'subway_entrance' }],
  'bus stop':           [{ highway: 'bus_stop' }],
  'atm':                [{ amenity: 'atm' }],
  'bank':               [{ amenity: 'bank' }],
  'hospital':           [{ amenity: 'hospital' }],
  'clinic':             [{ amenity: 'clinic' }],
  'post office':        [{ amenity: 'post_office' }],
  'museum':             [{ tourism: 'museum' }],
  'shrine':             [{ amenity: 'place_of_worship', religion: 'shinto' }],
  'temple':             [{ amenity: 'place_of_worship', religion: 'buddhist' }],
  'park':               [{ leisure: 'park' }],
  'hotel':              [{ tourism: 'hotel' }],
  'tourist attraction': [{ tourism: 'attraction' }],
};

// ── Query builders ────────────────────────────────────────────────────────────

function buildBatchQuery(lat, lon, radiusMeters, tagSets) {
  const parts = tagSets.flatMap(tagSet => {
    const cond = Object.entries(tagSet).map(([k, v]) => `["${k}"="${v}"]`).join('');
    return [
      `node${cond}(around:${radiusMeters},${lat},${lon});`,
      `way${cond}(around:${radiusMeters},${lat},${lon});`,
    ];
  });
  return `[out:json][timeout:25];(${parts.join('')});out center 100;`;
}

function buildBroadTagQuery(lat, lon, radiusMeters, term) {
  const esc = term.replace(/"/g, '\\"');
  const keys = ['amenity', 'shop', 'leisure', 'tourism', 'landuse', 'building'];
  const parts = keys.flatMap(k => [
    `node["${k}"~"${esc}",i](around:${radiusMeters},${lat},${lon});`,
    `way["${k}"~"${esc}",i](around:${radiusMeters},${lat},${lon});`,
  ]);
  return `[out:json][timeout:20];(${parts.join('')});out center 50;`;
}

function buildNameSearchQuery(lat, lon, radiusMeters, term) {
  const esc = term.replace(/"/g, '\\"');
  return `[out:json][timeout:20];(
    node["name"~"${esc}",i](around:${radiusMeters},${lat},${lon});
    way["name"~"${esc}",i](around:${radiusMeters},${lat},${lon});
  );out center 50;`;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchOverpass(query) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!res.ok) {
    const err = new Error(`overpass_error:${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.elements || [];
}

// ── Normalisation ─────────────────────────────────────────────────────────────

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
    hours: tags.opening_hours ? [tags.opening_hours] : null,
    distanceMeters: null,
    isOpenNow: null,
    lastFetchedAt: new Date().toISOString(),
  };
}

function buildAddressFromTags(tags) {
  const parts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : (tags.address || null);
}

// ── Main search — fully parallel ──────────────────────────────────────────────

async function runNearbySearch(lat, lon, radiusMeters, categories) {
  const enabled = categories.filter(c => c.enabled);
  if (enabled.length === 0) return [];

  const known = [];
  const unknown = [];
  for (const cat of enabled) {
    const tagSets = OSM_TAG_MAP[cat.label.toLowerCase()];
    if (tagSets?.length) {
      known.push({ cat, tagSets });
    } else {
      unknown.push(cat);
    }
  }

  const promises = [];

  if (known.length > 0) {
    const allTagSets = known.flatMap(({ tagSets }) => tagSets);
    promises.push(
      fetchOverpass(buildBatchQuery(lat, lon, radiusMeters, allTagSets))
        .then(elements => {
          const results = [];
          for (const el of elements) {
            const tags = el.tags || {};
            const matchedCat = known.find(({ tagSets }) =>
              tagSets.some(ts => Object.entries(ts).every(([k, v]) => tags[k] === v))
            );
            if (matchedCat) {
              const r = normalizeOSMElement(el, {
                sourceType: 'category',
                sourceId: matchedCat.cat.id,
                sourceLabel: matchedCat.cat.label,
                emoji: matchedCat.cat.emoji,
              });
              if (r) results.push(r);
            }
          }
          return results;
        })
        .catch(e => { console.warn('Batch query failed:', e.message); throw e; })
    );
  }

  for (const cat of unknown) {
    const terms = cat.searchTerms?.length ? cat.searchTerms : [cat.label.toLowerCase()];
    const matchedBy = {
      sourceType: 'category',
      sourceId: cat.id,
      sourceLabel: cat.label,
      emoji: cat.emoji,
    };
    for (const term of terms) {
      promises.push(
        fetchOverpass(buildBroadTagQuery(lat, lon, radiusMeters, term))
          .then(els => els.map(el => normalizeOSMElement(el, matchedBy)).filter(Boolean))
          .catch(() => [])
      );
      promises.push(
        fetchOverpass(buildNameSearchQuery(lat, lon, radiusMeters, term))
          .then(els => els.map(el => normalizeOSMElement(el, matchedBy)).filter(Boolean))
          .catch(() => [])
      );
    }
  }

  const resultSets = await Promise.all(promises);
  const allResults = resultSets.flat();

  allResults.forEach(r => {
    r.distanceMeters = Math.round(distanceMeters(lat, lon, r.latitude, r.longitude));
  });

  const deduped = deduplicateResults(allResults);
  deduped.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
  return deduped;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

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

// ── Utilities ─────────────────────────────────────────────────────────────────

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function deduplicateResults(results) {
  const seen = [];
  return results.filter(r => {
    const dup = seen.some(s =>
      s.name === r.name &&
      distanceMeters(s.latitude, s.longitude, r.latitude, r.longitude) < 30
    );
    if (!dup) seen.push(r);
    return !dup;
  });
}

export const Search = {
  runNearbySearch,
  geocodePlace,
  distanceMeters,
  formatDistance,
  OSM_TAG_MAP,
};
