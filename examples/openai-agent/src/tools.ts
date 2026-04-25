import { z } from 'zod';
import { BoatScrubClient } from './boatscrubClient.js';
import type { ScrubWindow, ToolResult } from './types.js';

export const toolSchemas = {
  getScrubWindows: z.object({
    location: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    boatType: z.string().optional(),
  }),
  getNextScrubWindow: z.object({
    location: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    boatType: z.string().optional(),
  }),
  getTideSummary: z.object({
    stationId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  explainScrubWindow: z.object({
    clubName: z.string(),
    dateLabel: z.string(),
    lowWater: z.string(),
    duration: z.string(),
    booked: z.number(),
    capacity: z.number(),
    source: z.enum(['live_api', 'demo_fallback']),
    assumptions: z.array(z.string()).default([]),
  }),
};

const toolJsonSchemas = {
  getScrubWindows: {
    type: 'object',
    properties: {
      location: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      boatType: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  getNextScrubWindow: {
    type: 'object',
    properties: {
      location: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      boatType: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  getTideSummary: {
    type: 'object',
    properties: {
      stationId: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['stationId', 'from', 'to'],
    additionalProperties: false,
  },
  explainScrubWindow: {
    type: 'object',
    properties: {
      clubName: { type: 'string' },
      dateLabel: { type: 'string' },
      lowWater: { type: 'string' },
      duration: { type: 'string' },
      booked: { type: 'number' },
      capacity: { type: 'number' },
      source: { type: 'string', enum: ['live_api', 'demo_fallback'] },
      assumptions: { type: 'array', items: { type: 'string' } },
    },
    required: ['clubName', 'dateLabel', 'lowWater', 'duration', 'booked', 'capacity', 'source'],
    additionalProperties: false,
  },
};

const parseDateLabel = (dateLabel: string): number => {
  const parsed = Date.parse(dateLabel);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const scoreWindow = (window: ScrubWindow): number => {
  const occupancy = window.capacity > 0 ? window.booked / window.capacity : 1;
  return occupancy;
};

const filterWindows = (windows: ScrubWindow[], location?: string): ScrubWindow[] => {
  if (!location) return windows;
  const needle = location.toLowerCase();
  return windows.filter((w) => w.clubName.toLowerCase().includes(needle));
};

export const createToolHandlers = (client = new BoatScrubClient()) => ({
  async getScrubWindows(args: unknown): Promise<ToolResult<ScrubWindow[]>> {
    const parsed = toolSchemas.getScrubWindows.parse(args);
    const response = await client.getScrubWindows();
    if (!response.ok || !response.data) return response;

    const filteredByLocation = filterWindows(response.data, parsed.location);
    return {
      ...response,
      data: filteredByLocation,
      assumptions: [
        ...response.assumptions,
        parsed.location
          ? `Filtered windows by club name matching location "${parsed.location}".`
          : 'No location filter applied.',
        parsed.boatType ? `Boat type hint provided (${parsed.boatType}), but no boat-type filter exists in /api/clubs.` : 'No boat type hint provided.',
      ],
    };
  },

  async getNextScrubWindow(args: unknown): Promise<ToolResult<ScrubWindow | null>> {
    const parsed = toolSchemas.getNextScrubWindow.parse(args);
    const response = await client.getScrubWindows();
    if (!response.ok || !response.data) return { ...response, data: null };

    const filtered = filterWindows(response.data, parsed.location)
      .sort((a, b) => parseDateLabel(a.dateLabel) - parseDateLabel(b.dateLabel) || scoreWindow(a) - scoreWindow(b));

    const next = filtered[0] ?? null;

    return {
      ok: true,
      source: response.source,
      assumptions: [
        ...response.assumptions,
        'Selected the next window by earliest parseable date label, then lowest occupancy.',
        'Date range arguments are accepted for forward compatibility; /api/clubs currently does not expose server-side date filtering.',
      ],
      data: next,
    };
  },

  async getTideSummary(args: unknown) {
    const parsed = toolSchemas.getTideSummary.parse(args);
    return client.getTideSummary(parsed.stationId, parsed.from, parsed.to);
  },

  async explainScrubWindow(args: unknown) {
    const parsed = toolSchemas.explainScrubWindow.parse(args);
    const remaining = Math.max(parsed.capacity - parsed.booked, 0);
    return {
      ok: true,
      source: parsed.source,
      assumptions: parsed.assumptions,
      data: {
        explanation: [
          `Recommended window: ${parsed.clubName} on ${parsed.dateLabel} around low water at ${parsed.lowWater}.`,
          `Suitability: declared scrub duration is ${parsed.duration}, with ${remaining} places remaining out of ${parsed.capacity}.`,
          `Data source: ${parsed.source === 'live_api' ? 'live Boat Scrub Calendar API' : 'demo fallback sample data'}.`,
          parsed.assumptions.length ? `Assumptions: ${parsed.assumptions.join(' ')}` : 'Assumptions: none supplied.',
        ].join(' '),
      },
    };
  },
});

export const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    name: 'getScrubWindows',
    description: 'Get available scrub windows from Boat Scrub Calendar API.',
    parameters: toolJsonSchemas.getScrubWindows,
  },
  {
    type: 'function' as const,
    name: 'getNextScrubWindow',
    description: 'Get the next recommended scrub window from API data.',
    parameters: toolJsonSchemas.getNextScrubWindow,
  },
  {
    type: 'function' as const,
    name: 'getTideSummary',
    description: 'Get a tidal summary for a station/date range via API.',
    parameters: toolJsonSchemas.getTideSummary,
  },
  {
    type: 'function' as const,
    name: 'explainScrubWindow',
    description: 'Explain why a scrub window is suitable in plain English.',
    parameters: toolJsonSchemas.explainScrubWindow,
  },
];
