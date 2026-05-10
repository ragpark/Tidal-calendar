import { Club, ScrubWindow, Station } from '../types.js';

export function resolveStation(input: { station_id?: string; station_name?: string; location?: string }, stations: Station[]): Station | undefined {
  if (input.station_id) return stations.find((s) => s.id === input.station_id);
  const needle = (input.station_name ?? input.location ?? '').toLowerCase();
  return stations.find((s) => s.name.toLowerCase().includes(needle) || (s.location ?? '').toLowerCase().includes(needle));
}

export function resolveClub(clubNameOrId: string | undefined, clubs: Club[]): Club | undefined {
  if (!clubNameOrId) return clubs[0];
  const n = clubNameOrId.toLowerCase();
  return clubs.find((c) => c.id === clubNameOrId || c.name.toLowerCase().includes(n));
}

export function resolveSlotIndex(reference: string | undefined, slots: Array<{ club: Club; window: ScrubWindow }>) {
  if (!reference) return undefined;
  const idx = Number(reference) - 1;
  return Number.isInteger(idx) && idx >= 0 ? slots[idx] : undefined;
}
