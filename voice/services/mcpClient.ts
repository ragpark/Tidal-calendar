import { Club, ScrubWindow, StandardizedError, Station, TideSummary } from '../types.js';

type Auth = { mode: 'cookie'; cookie: string } | { mode: 'password'; email: string; password: string };

export class McpClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 5000) {}

  private async request<T>(path: string, init: RequestInit = {}, retry = false): Promise<T> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!r.ok) throw { code: 'UPSTREAM_ERROR', message: `Upstream ${r.status}`, status: r.status } satisfies StandardizedError;
      return (await r.json()) as T;
    } catch (e) {
      if (!retry && init.method !== 'POST') return this.request<T>(path, init, true);
      throw normalizeError(e);
    } finally { clearTimeout(id); }
  }

  listStations(query?: string) { return this.request<Station[]>(`/api/list_stations${query ? `?query=${encodeURIComponent(query)}` : ''}`); }
  getStation(stationId: string) { return this.request<Station & { tideSummary?: string }>(`/api/get_station/${stationId}`); }
  listClubs() { return this.request<Array<Club & { windows: ScrubWindow[] }>>('/api/list_clubs'); }
  bookScrubWindow(clubId: string, windowId: string, authCookie: string) {
    return this.request<{ ok: boolean; message: string }>('/api/book_scrub_window', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify({ club_id: clubId, window_id: windowId }) });
  }
  login(auth: Auth) {
    if (auth.mode === 'cookie') return Promise.resolve(auth.cookie);
    return this.request<{ cookie: string }>('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: auth.email, password: auth.password }) }).then((x) => x.cookie);
  }
  async getTideSummary(stationId: string, date: string): Promise<TideSummary> {
    const s = await this.getStation(stationId);
    return { stationId, date, summary: s.tideSummary ?? `Tide details unavailable for ${date}.` };
  }
}

export function normalizeError(e: any): StandardizedError {
  if (e?.code) return e;
  if (e?.name === 'AbortError') return { code: 'TIMEOUT', message: 'Request timed out', retryable: true };
  return { code: 'UNKNOWN', message: 'Something went wrong' };
}
