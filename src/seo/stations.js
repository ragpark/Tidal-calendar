// Bundled fallback station list. The server enriches this at runtime from the
// UK Admiralty Tidal API station catalogue; the app falls back to these when
// the upstream API is unavailable.
export const SEED_STATIONS = [
  { id: '0001', name: 'Aberdeen', country: 'Scotland', lat: 57.143, lon: -2.079, mhws: 4.3, mhwn: 3.4, mlwn: 1.3, mlws: 0.5 },
  { id: '0113', name: 'London Bridge', country: 'England', lat: 51.507, lon: -0.087, mhws: 7.1, mhwn: 6.0, mlwn: 1.5, mlws: 0.5 },
  { id: '0162', name: 'Liverpool (Alfred Dock)', country: 'England', lat: 53.405, lon: -2.994, mhws: 9.4, mhwn: 7.5, mlwn: 2.9, mlws: 1.0 },
  { id: '0240', name: 'Southampton', country: 'England', lat: 50.899, lon: -1.391, mhws: 4.5, mhwn: 3.7, mlwn: 1.8, mlws: 0.5 },
  { id: '0316', name: 'Dover', country: 'England', lat: 51.114, lon: 1.318, mhws: 6.8, mhwn: 5.3, mlwn: 1.9, mlws: 0.8 },
  { id: '0402', name: 'Bristol (Avonmouth)', country: 'England', lat: 51.509, lon: -2.711, mhws: 13.2, mhwn: 9.8, mlwn: 3.8, mlws: 0.9 },
  { id: '0452', name: 'Plymouth (Devonport)', country: 'England', lat: 50.368, lon: -4.186, mhws: 5.5, mhwn: 4.4, mlwn: 2.2, mlws: 0.8 },
  { id: '0503', name: 'Cardiff', country: 'Wales', lat: 51.461, lon: -3.165, mhws: 12.4, mhwn: 9.2, mlwn: 3.6, mlws: 0.8 },
  { id: '0590', name: 'Holyhead', country: 'Wales', lat: 53.314, lon: -4.633, mhws: 5.6, mhwn: 4.4, mlwn: 2.0, mlws: 0.7 },
  { id: '0621', name: 'Belfast', country: 'Northern Ireland', lat: 54.607, lon: -5.909, mhws: 3.5, mhwn: 3.0, mlwn: 1.1, mlws: 0.4 },
];

// Normalise an Admiralty station record (GeoJSON feature or flat object) into the app shape.
export const normalizeStation = (raw) => {
  if (!raw) return null;
  const props = raw.properties || raw;
  const id = props.Id || props.id;
  const name = props.Name || props.name;
  if (!id || !name) return null;
  const coords = raw.geometry?.coordinates;
  return {
    id: String(id),
    name: String(name),
    country: props.Country || props.country || 'Unknown',
    lat: props.Latitude ?? props.lat ?? (coords ? coords[1] : undefined),
    lon: props.Longitude ?? props.lon ?? (coords ? coords[0] : undefined),
    continuousHeightsAvailable: props.ContinuousHeightsAvailable ?? props.continuousHeightsAvailable,
    mhws: props.mhws ?? 4.5,
    mhwn: props.mhwn ?? 3.5,
    mlwn: props.mlwn ?? 1.5,
    mlws: props.mlws ?? 0.5,
  };
};

export const normalizeStationList = (data) => {
  const list = Array.isArray(data) ? data : (data?.features || []);
  const stations = list.map(normalizeStation).filter(Boolean);
  return stations.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
};
