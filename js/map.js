// map.js — MapLibre GL JS integration (no token required)
// Tiles: OpenFreeMap — free, no key, no usage limits
// Clustering: supercluster — handles Tokyo/NYC marker density

import { State } from './state.js';
import { Search } from './search.js';

const OPENFREE_STYLE = 'https://tiles.openfreemap.org/styles/dark';

let map = null;
let userMarker = null;
let clusterer = null;
let clusterMarkers = [];
let rawPOIData = [];   // flat array of { feature, result/place } for click lookup

// ── Init ──────────────────────────────────────────────────────────────────────

function init(containerId) {
  if (!window.maplibregl) {
    console.error('MapLibre GL JS not loaded');
    return;
  }

  map = new maplibregl.Map({
    container: containerId,
    style: OPENFREE_STYLE,
    center: [0, 20],
    zoom: 2,
    attributionControl: false,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  map.on('load', () => {
    map.resize();
    State.on('location:updated', onLocationUpdated);
    State.on('nearby:updated', onNearbyUpdated);
    State.on('radius:changed', onRadiusChanged);
    State.on('filters:changed', () => {
      refreshPOIMarkers(State.getFilteredResults(), State.getSpecificPlacesInRange());
    });
  });

  map.on('moveend', () => updateClusterVisibility());
  map.on('zoomend', () => updateClusterVisibility());

  setTimeout(() => map?.resize(), 300);
  return map;
}

// ── Location ──────────────────────────────────────────────────────────────────

function onLocationUpdated(coords) {
  const lngLat = [coords.lon, coords.lat];
  const RADIUS_ZOOM = { 200: 16, 800: 14, 1600: 13 };
  const zoom = RADIUS_ZOOM[State.get().mapRadius] ?? 14;
  const dotClass = coords.manual ? 'user-dot user-dot--manual' : 'user-dot';

  if (!coords.manual) {
    map.flyTo({ center: lngLat, zoom, speed: 1.2 });
  }

  if (userMarker) {
    userMarker.getElement().className = dotClass;
    userMarker.setLngLat(lngLat);
  } else {
    const el = document.createElement('div');
    el.className = dotClass;
    userMarker = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(map);
  }

  updateRadiusCircle(coords.lat, coords.lon, State.get().mapRadius);
}

function recenter() {
  const loc = State.get().currentLocation;
  if (!loc || !map) return;
  const RADIUS_ZOOM = { 200: 16, 800: 14, 1600: 13 };
  const zoom = RADIUS_ZOOM[State.get().mapRadius] ?? 14;
  map.easeTo({ center: [loc.lon, loc.lat], zoom, duration: 500 });
}

// ── Radius Circle ─────────────────────────────────────────────────────────────

function updateRadiusCircle(lat, lon, radiusMeters) {
  const sourceId = 'radius-circle';
  const geojson = { type: 'Feature', geometry: createCircle(lat, lon, radiusMeters) };

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type: 'geojson', data: geojson });
    map.addLayer({ id: 'radius-fill', type: 'fill', source: sourceId,
      paint: { 'fill-color': '#E8A87C', 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'radius-outline', type: 'line', source: sourceId,
      paint: { 'line-color': '#E8A87C', 'line-opacity': 0.3,
               'line-width': 1.5, 'line-dasharray': [4, 4] } });
  }
}

function createCircle(lat, lon, radiusMeters, points = 64) {
  const km = radiusMeters / 1000;
  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = km * Math.cos(angle);
    const dy = km * Math.sin(angle);
    coords.push([
      lon + (dx / (111.32 * Math.cos(lat * Math.PI / 180))),
      lat + (dy / 111.32),
    ]);
  }
  coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

function onRadiusChanged(meters) {
  const loc = State.get().currentLocation;
  if (loc) updateRadiusCircle(loc.lat, loc.lon, meters);
}

// ── POI Markers + Clustering ──────────────────────────────────────────────────

function onNearbyUpdated() {
  refreshPOIMarkers(State.getFilteredResults(), State.getSpecificPlacesInRange());
}

function clearPOIMarkers() {
  clusterMarkers.forEach(m => m.remove());
  clusterMarkers = [];
  rawPOIData = [];
  clusterer = null;
}

// Max results to render per category to prevent DOM overload in dense cities
const MAX_PER_CATEGORY = 60;

function refreshPOIMarkers(nearbyResults, specificPlaces) {
  clearPOIMarkers();
  if (!map) return;

  // Trim to closest MAX_PER_CATEGORY per category
  const byCat = {};
  for (const r of nearbyResults) {
    const key = r.matchedBy?.sourceId || 'unknown';
    if (!byCat[key]) byCat[key] = [];
    if (byCat[key].length < MAX_PER_CATEGORY) byCat[key].push(r);
  }
  const trimmed = Object.values(byCat).flat();

  // Build GeoJSON features for clustering
  const features = trimmed.map((r, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
    properties: { idx: i, emoji: r.matchedBy?.emoji || '📍', type: 'nearby' },
  }));

  // Specific places are always shown individually (not clustered)
  specificPlaces.forEach(place => {
    const el = createEmojiMarker(place.emoji || '📌', 'specific');
    el.addEventListener('click', (e) => { e.stopPropagation(); State.setSelectedPlace(place); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);
    clusterMarkers.push(marker);
  });

  rawPOIData = trimmed;

  if (features.length === 0) return;

  clusterer = new Supercluster({ radius: 40, maxZoom: 16 });
  clusterer.load(features);

  updateClusterVisibility();
}

function updateClusterVisibility() {
  if (!clusterer || !map) return;

  // Remove old cluster markers
  clusterMarkers = clusterMarkers.filter(m => {
    if (m._isCluster) { m.remove(); return false; }
    return true;
  });

  const bounds = map.getBounds();
  const zoom = Math.floor(map.getZoom());
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const clusters = clusterer.getClusters(bbox, zoom);

  clusters.forEach(cluster => {
    const [lon, lat] = cluster.geometry.coordinates;
    const el = document.createElement('div');

    if (cluster.properties.cluster) {
      // Cluster bubble
      const count = cluster.properties.point_count;
      el.className = 'cluster-marker';
      el.textContent = count;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const expansionZoom = Math.min(clusterer.getClusterExpansionZoom(cluster.properties.cluster_id), 17);
        map.easeTo({ center: [lon, lat], zoom: expansionZoom, duration: 400 });
      });
    } else {
      // Individual marker
      const idx = cluster.properties.idx;
      const result = rawPOIData[idx];
      el.className = `emoji-marker emoji-marker--nearby`;
      el.textContent = cluster.properties.emoji;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (result) State.setSelectedPlace(result);
      });
    }

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .addTo(map);
    marker._isCluster = true;
    clusterMarkers.push(marker);
  });
}

function createEmojiMarker(emoji, type = 'nearby') {
  const el = document.createElement('div');
  el.className = `emoji-marker emoji-marker--${type}`;
  el.textContent = emoji;
  el.title = type === 'specific' ? 'Saved place' : 'Nearby';
  return el;
}

// ── Manual Pin Placement ──────────────────────────────────────────────────────

let pinMode = false;
let pinModeHandler = null;

function togglePinMode() {
  pinMode = !pinMode;
  if (!map) return false;

  if (pinMode) {
    map.getCanvas().style.cursor = 'crosshair';
    pinModeHandler = (e) => {
      const coords = { lat: e.lngLat.lat, lon: e.lngLat.lng, accuracy: 0, timestamp: Date.now(), manual: true };

      if (userMarker) {
        userMarker.setLngLat([coords.lon, coords.lat]);
        userMarker.getElement().className = 'user-dot user-dot--manual';
      } else {
        const el = document.createElement('div');
        el.className = 'user-dot user-dot--manual';
        userMarker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([coords.lon, coords.lat])
          .addTo(map);
      }

      userMarker.setDraggable(true);
      userMarker.off('dragend');
      userMarker.on('dragend', () => {
        const ll = userMarker.getLngLat();
        const dragged = { lat: ll.lat, lon: ll.lng, accuracy: 0, timestamp: Date.now(), manual: true };
        updateRadiusCircle(dragged.lat, dragged.lon, State.get().mapRadius);
        State.setGpsEnabled(false);
        State.setCurrentLocation(dragged);
        State.runNearbySearch(dragged);
      });

      updateRadiusCircle(coords.lat, coords.lon, State.get().mapRadius);
      State.setGpsEnabled(false);
      State.setCurrentLocation(coords);
      State.runNearbySearch(coords);

      pinMode = false;
      map.getCanvas().style.cursor = '';
      map.off('click', pinModeHandler);
      pinModeHandler = null;
    };
    map.on('click', pinModeHandler);
  } else {
    map.getCanvas().style.cursor = '';
    if (pinModeHandler) { map.off('click', pinModeHandler); pinModeHandler = null; }
  }
  return pinMode;
}

// ── External ──────────────────────────────────────────────────────────────────

function getMap() { return map; }

function flyTo(lat, lon, zoom = 16) {
  if (map) map.flyTo({ center: [lon, lat], zoom, speed: 1.2 });
}

function showStaleLocation(coords) {
  if (!map) return;
  const lngLat = [coords.lon, coords.lat];
  if (userMarker) {
    userMarker.getElement().className = 'user-dot user-dot--stale';
    userMarker.setLngLat(lngLat);
  } else {
    const el = document.createElement('div');
    el.className = 'user-dot user-dot--stale';
    userMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }
  map.flyTo({ center: lngLat, zoom: 14, speed: 0.8 });
}

function upgradeMarkerToLive() {
  if (userMarker) userMarker.getElement().className = 'user-dot';
}

export const MapService = {
  init, recenter, flyTo, getMap,
  refreshPOIMarkers, clearPOIMarkers,
  showStaleLocation, upgradeMarkerToLive,
  togglePinMode,
};
