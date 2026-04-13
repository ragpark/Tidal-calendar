export const UK_REGIONS = [
  { id: 'plymouth', label: 'Plymouth / Devon', lat: 50.3755, lon: -4.1427 },
  { id: 'southampton', label: 'Southampton / Solent', lat: 50.9097, lon: -1.4044 },
  { id: 'portsmouth', label: 'Portsmouth / Chichester', lat: 50.8198, lon: -1.088 },
  { id: 'london', label: 'London / Thames', lat: 51.5072, lon: -0.1276 },
  { id: 'bristol', label: 'Bristol Channel', lat: 51.4545, lon: -2.5879 },
  { id: 'liverpool', label: 'Liverpool / Mersey', lat: 53.4084, lon: -2.9916 },
  { id: 'newcastle', label: 'Newcastle / Tyne', lat: 54.9783, lon: -1.6178 },
  { id: 'aberdeen', label: 'Aberdeen / Moray', lat: 57.1497, lon: -2.0943 },
  { id: 'belfast', label: 'Belfast Lough', lat: 54.5973, lon: -5.9301 },
  { id: 'cardiff', label: 'Cardiff / Severn', lat: 51.4816, lon: -3.1791 },
];

export const SCRUB_FACILITIES = [
  { name: 'Premier Trafalgar Yard', region: 'Portsmouth', lat: 50.8102, lon: -1.1086, maxDraft: 2.8, maxLoa: 22, dryWindowHours: 5, pressureWash: true },
  { name: 'Hamble Point Marina Lift-out', region: 'Southampton', lat: 50.8612, lon: -1.3065, maxDraft: 3.2, maxLoa: 24, dryWindowHours: 6, pressureWash: true },
  { name: 'QAB Dry Berth Services', region: 'Plymouth', lat: 50.3545, lon: -4.1598, maxDraft: 3.6, maxLoa: 28, dryWindowHours: 8, pressureWash: true },
  { name: 'Liverpool Marina Service Quay', region: 'Liverpool', lat: 53.3966, lon: -2.9934, maxDraft: 2.6, maxLoa: 20, dryWindowHours: 4, pressureWash: false },
  { name: 'Bristol Harbour Yard', region: 'Bristol', lat: 51.4467, lon: -2.6202, maxDraft: 2.9, maxLoa: 23, dryWindowHours: 5, pressureWash: true },
  { name: 'Aberdeen Boatyard', region: 'Aberdeen', lat: 57.149, lon: -2.0847, maxDraft: 3.8, maxLoa: 26, dryWindowHours: 7, pressureWash: true },
  { name: 'Thames Riverside Yard', region: 'London', lat: 51.5032, lon: 0.0021, maxDraft: 2.4, maxLoa: 18, dryWindowHours: 4, pressureWash: false },
  { name: 'Cardiff Marine Village', region: 'Cardiff', lat: 51.4477, lon: -3.1607, maxDraft: 3.0, maxLoa: 25, dryWindowHours: 6, pressureWash: true },
];

const toRadians = (deg) => (deg * Math.PI) / 180;

export const distanceKm = (aLat, aLon, bLat, bLon) => {
  const earthKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const p = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
};

export const recommendFacilities = ({ scrubNeed, draft, loa, regionId }) => {
  const region = UK_REGIONS.find((item) => item.id === regionId);
  if (!region) return [];

  return SCRUB_FACILITIES
    .map((facility) => {
      const distance = distanceKm(region.lat, region.lon, facility.lat, facility.lon);
      const draftHeadroom = facility.maxDraft - draft;
      const loaHeadroom = facility.maxLoa - loa;
      const supportsBoat = draftHeadroom >= 0 && loaHeadroom >= 0;
      const capabilityScore =
        (supportsBoat ? 200 : -300)
        + (facility.pressureWash ? 20 : 0)
        + Math.min(20, Math.max(0, facility.dryWindowHours * 3))
        + Math.min(20, Math.max(0, draftHeadroom * 10))
        + Math.min(20, Math.max(0, loaHeadroom * 2));
      const urgencyBoost = scrubNeed === 'urgent' ? (facility.dryWindowHours >= 6 ? 20 : -10) : 0;
      return {
        ...facility,
        distance,
        supportsBoat,
        score: capabilityScore + urgencyBoost - distance,
      };
    })
    .filter((facility) => facility.supportsBoat)
    .sort((a, b) => b.score - a.score || a.distance - b.distance)
    .slice(0, 5);
};
