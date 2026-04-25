import { z } from 'zod';
import type { DataSource, ScrubWindow, TideSummary, ToolResult } from './types.js';

const ClubWindowSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  date: z.string(),
  lowWater: z.string(),
  duration: z.string(),
  capacity: z.number().optional().default(1),
  booked: z.number().optional().default(0),
});

const ClubSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string(),
  windows: z.array(ClubWindowSchema).optional().default([]),
});

const StationSchema = z.object({
  Id: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  Name: z.string().optional(),
});

const TideEventSchema = z.object({
  EventType: z.string().optional(),
  DateTime: z.string().optional(),
  Height: z.number().optional(),
});

const TideResponseSchema = z.object({
  values: z.array(TideEventSchema).optional(),
  Values: z.array(TideEventSchema).optional(),
});

export class BoatScrubClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly allowDemoFallback: boolean;

  constructor() {
    this.baseUrl = process.env.BOATSCRUB_API_BASE_URL || 'https://boatscrubcalendar.com';
    this.apiKey = process.env.BOATSCRUB_API_KEY || undefined;
    this.allowDemoFallback = process.env.BOATSCRUB_ALLOW_DEMO_FALLBACK === 'true';
  }

  private getHeaders(): HeadersInit {
    return {
      Accept: 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}`, 'x-api-key': this.apiKey } : {}),
    };
  }

  private async requestJson<T = unknown>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`BoatScrub API ${response.status} for ${path}. Body: ${body.slice(0, 300) || 'empty'}`);
    }

    return response.json() as Promise<T>;
  }

  private fallbackWindows(): ScrubWindow[] {
    return [
      {
        clubId: 'demo-club-1',
        clubName: 'Demo Harbour Club',
        windowId: 'demo-window-1',
        dateLabel: 'Fri 08 May',
        lowWater: '10:20',
        duration: '2h 00m',
        capacity: 6,
        booked: 2,
      },
    ];
  }

  async getScrubWindows(): Promise<ToolResult<ScrubWindow[]>> {
    try {
      const raw = await this.requestJson<unknown>('/api/clubs');
      const clubs = z.array(ClubSchema).parse(raw);
      const windows: ScrubWindow[] = clubs.flatMap((club) =>
        club.windows.map((window) => ({
          clubId: club.id,
          clubName: club.name,
          windowId: window.id,
          dateLabel: window.date,
          lowWater: window.lowWater,
          duration: window.duration,
          capacity: window.capacity,
          booked: window.booked,
        })),
      );

      return {
        ok: true,
        source: 'live_api',
        assumptions: ['Using /api/clubs as the canonical scrub-window endpoint.'],
        data: windows,
      };
    } catch (error) {
      if (!this.allowDemoFallback) {
        return {
          ok: false,
          source: 'live_api',
          assumptions: ['Demo fallback is disabled.'],
          error: (error as Error).message,
        };
      }

      return {
        ok: true,
        source: 'demo_fallback',
        assumptions: ['Live API call failed, using hard-coded demo sample windows.'],
        data: this.fallbackWindows(),
      };
    }
  }

  async getStations(query?: string): Promise<ToolResult<Array<{ id: string; name?: string }>>> {
    try {
      const suffix = query ? `?query=${encodeURIComponent(query)}` : '';
      const raw = await this.requestJson<unknown>(`/api/Stations${suffix}`);
      const stationsRaw = Array.isArray(raw)
        ? raw
        : ((raw as { values?: unknown[]; Values?: unknown[] }).values
          || (raw as { values?: unknown[]; Values?: unknown[] }).Values
          || []);
      const stations = z.array(StationSchema).parse(stationsRaw).map((s) => ({ id: s.Id || '', name: s.Name }));
      return {
        ok: true,
        source: 'live_api',
        assumptions: ['Using /api/Stations proxy route from the Boat Scrub Calendar server.'],
        data: stations.filter((s) => s.id),
      };
    } catch (error) {
      return {
        ok: false,
        source: 'live_api',
        assumptions: ['No station fallback is provided to avoid invented tide data.'],
        error: (error as Error).message,
      };
    }
  }

  async getTideSummary(stationId: string, from: string, to: string): Promise<ToolResult<TideSummary>> {
    try {
      // NOTE: adapter path. If your deployment uses a different route shape, update this path.
      const path = `/api/Stations/${encodeURIComponent(stationId)}/TidalEventsForDateRange?StartDate=${encodeURIComponent(from)}&EndDate=${encodeURIComponent(to)}`;
      const raw = await this.requestJson<unknown>(path);
      const parsed = TideResponseSchema.parse(raw);
      const events = parsed.Values || parsed.values || [];

      const lowWaters = events
        .filter((e) => String(e.EventType || '').toLowerCase().includes('low'))
        .map((e) => ({ dateTime: e.DateTime || '', height: e.Height }))
        .filter((e) => e.dateTime);

      return {
        ok: true,
        source: 'live_api',
        assumptions: ['Using Admiralty-proxy tidal events endpoint exposed at /api/Stations/:id/TidalEventsForDateRange.'],
        data: {
          stationId,
          from,
          to,
          eventCount: events.length,
          lowWaters,
          source: 'live_api',
        },
      };
    } catch (error) {
      return {
        ok: false,
        source: 'live_api',
        assumptions: [
          'No fallback tide summary is used, to avoid inventing tidal data.',
          'TODO: If your API route differs, update getTideSummary() adapter path in boatscrubClient.ts.',
        ],
        error: (error as Error).message,
      };
    }
  }
}

export const isLiveSource = (source: DataSource) => source === 'live_api';
