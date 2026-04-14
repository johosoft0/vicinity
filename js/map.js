// map.js — Mapbox GL JS integration
// Handles map init, user location marker, emoji POI markers, specific places

import { State } from './state.js';
import { Search } from './search.js';

let map = null;
let userMarker = null;
let poiMarkers = [];
let radiusCircle = null;

// ── Init ──────────────────────────────────────────────────────────────────────

function init(containerId, mapboxToken) {
  if (!window.mapboxgl) {
    console.error('Mapbox GL JS not loaded');
    return;
  }

  mapboxgl.accessToken = mapboxToken;

  map = new mapboxgl.Map({
    container: containerId,
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [0, 20],
    zoom: 2,
    attributionControl: false,
    logoPosition: 'bottom-left',
  });

  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

  map.on('load', () => {
    State.on('location:updated', onLocationUpdated);
    State.on('nearby:updated', onNearbyUpdated);
    State.on('radius:changed', onRadiusChanged);
    State.on('filters:changed', () => {
      refreshPOIMarkers(State.getFilteredResults(), State.getSpecificPlacesInRange());
    });
  });

  return map;
}

// ── Location ──────────────────────────────────────────────────────────────────

function onLocationUpdated(coords) {
  const lngLat = [coords.lon, coords.lat];

  // Fly to location
  map.flyTo({ center: lngLat, zoom: 15, speed: 1.2 });

  // User dot marker
  if (userMarker) {
    userMarker.setLngLat(lngLat);
  } else {
    const el = document.createElement('div');
    el.className = 'user-dot';
    userMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(map);
  }

  // Radius circle
  updateRadiusCircle(coords.lat, coords.lon, State.get().mapRadius);
}

function recenter() {
  const loc = State.get().currentLocation;
  if (loc) {
    map.flyTo({ center: [loc.lon, loc.lat], zoom: 15, speed: 1.4 });
  }
}

// ── Radius Circle ─────────────────────────────────────────────────────────────

function updateRadiusCircle(lat, lon, radiusMeters) {
  const sourceId = 'radius-circle';
  const layerId = 'radius-fill';
  const outlineId = 'radius-outline';

  const geojson = {
    type: 'Feature',
    geometry: createCircle(lat, lon, radiusMeters),
  };

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type: 'geojson', data: geojson });
    map.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': '#E8A87C',
        'fill-opacity': 0.06,
      },
    });
    map.addLayer({
      id: outlineId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#E8A87C',
        'line-opacity': 0.3,
        'line-width': 1.5,
        'line-dasharray': [4, 4],
      },
    });
  }
}

function createCircle(lat, lon, radiusMeters, points = 64) {
  const km = radiusMeters / 1000;
  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = km * Math.cos(angle);
    const dy = km * Math.sin(angle);
    const newLat = lat + (dy / 111.32);
    const newLon = lon + (dx / (111.32 * Math.cos(lat * Math.PI / 180)));
    coords.push([newLon, newLat]);
  }
  coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

function onRadiusChanged(meters) {
  const loc = State.get().currentLocation;
  if (loc) updateRadiusCircle(loc.lat, loc.lon, meters);
}

// ── POI Markers ───────────────────────────────────────────────────────────────

function onNearbyUpdated(results) {
  const specific = State.getSpecificPlacesInRange();
  refreshPOIMarkers(State.getFilteredResults(), specific);
}

function clearPOIMarkers() {
  poiMarkers.forEach(m => m.remove());
  poiMarkers = [];
}

function refreshPOIMarkers(nearbyResults, specificPlaces) {
  clearPOIMarkers();

  // Nearby results
  nearbyResults.forEach(result => {
    const el = createEmojiMarker(result.matchedBy?.emoji || '📍', 'nearby');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      State.setSelectedPlace(result);
    });

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([result.longitude, result.latitude])
      .addTo(map);

    poiMarkers.push(marker);
  });

  // Specific saved places
  specificPlaces.forEach(place => {
    const el = createEmojiMarker(place.emoji || '📌', 'specific');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      State.setSelectedPlace(place);
    });

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);

    poiMarkers.push(marker);
  });
}

function createEmojiMarker(emoji, type = 'nearby') {
  const el = document.createElement('div');
  el.className = `emoji-marker emoji-marker--${type}`;
  el.textContent = emoji;
  el.title = type === 'specific' ? 'Saved place' : 'Nearby';
  return el;
}

// ── External ──────────────────────────────────────────────────────────────────

function getMap() { return map; }

function flyTo(lat, lon, zoom = 16) {
  if (map) map.flyTo({ center: [lon, lat], zoom, speed: 1.2 });
}

export const MapService = {
  init, recenter, flyTo, getMap,
  refreshPOIMarkers, clearPOIMarkers,
};
