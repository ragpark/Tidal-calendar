import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { BoatScrubClient } from './boatscrubClient.js';
import type { ScrubWindow, ToolResult } from './types.js';

export const toolSchemas = {
  getScrubWindows: z.object({
    location: z.string().optional().describe('Club or harbour name to filter by, e.g. "Sheerness"'),
    from: z.string().optional().describe('Start date, ISO 8601 (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date, ISO 8601 (YYYY-MM-DD)'),
    boatType: z.string().optional().describe('Boat type hint, e.g. "fin keel yacht"'),
  }),
  getNextScrubWindow: z.object({
    location: z.string().optional().describe('Club or harbour name to filter by'),
    from: z.string().optional().describe('Start date, ISO 8601 (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date, ISO 8601 (YYYY-MM-DD)'),
    boatType: z.string().optional().describe('Boat type hint'),
  }),
  getTideSummary: z.object({
    stationId: z.string().describe('UK Admiralty station id, e.g. "0240" for Southampton'),
    from: z.string().describe('Start date, ISO 8601 (YYYY-MM-DD)'),
    to: z.string().describe('End date, ISO 8601 (YYYY-MM-DD)'),
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

/**
 * Plain tool handlers over the Boat Scrub Calendar HTTP API. These are the canonical
 * integration layer: the Claude tools below and any future MCP wrapper both call them.
 */
export const createToolHandlers = (client = new BoatScrubClient()) => ({
  async getScrubWindows(args: z.infer<typeof toolSchemas.getScrubWindows>): Promise<ToolResult<ScrubWindow[]>> {
    const response = await client.getScrubWindows();
    if (!response.ok || !response.data) return response;

    const filteredByLocation = filterWindows(response.data, args.location);
    return {
      ...response,
      data: filteredByLocation,
      assumptions: [
        ...response.assumptions,
        args.location
          ? `Filtered windows by club name matching location "${args.location}".`
          : 'No location filter applied.',
        args.boatType ? `Boat type hint provided (${args.boatType}), but no boat-type filter exists in /api/clubs.` : 'No boat type hint provided.',
      ],
    };
  },

  async getNextScrubWindow(args: z.infer<typeof toolSchemas.getNextScrubWindow>): Promise<ToolResult<ScrubWindow | null>> {
    const response = await client.getScrubWindows();
    if (!response.ok || !response.data) return { ...response, data: null };

    const filtered = filterWindows(response.data, args.location)
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

  async getTideSummary(args: z.infer<typeof toolSchemas.getTideSummary>) {
    return client.getTideSummary(args.stationId, args.from, args.to);
  },

  async explainScrubWindow(args: z.infer<typeof toolSchemas.explainScrubWindow>) {
    const remaining = Math.max(args.capacity - args.booked, 0);
    return {
      ok: true,
      source: args.source,
      assumptions: args.assumptions,
      data: {
        explanation: [
          `Recommended window: ${args.clubName} on ${args.dateLabel} around low water at ${args.lowWater}.`,
          `Suitability: declared scrub duration is ${args.duration}, with ${remaining} places remaining out of ${args.capacity}.`,
          `Data source: ${args.source === 'live_api' ? 'live Boat Scrub Calendar API' : 'demo fallback sample data'}.`,
          args.assumptions.length ? `Assumptions: ${args.assumptions.join(' ')}` : 'Assumptions: none supplied.',
        ].join(' '),
      },
    };
  },
});

const formatToolError = (error: unknown): ToolResult<never> => ({
  ok: false,
  source: 'live_api',
  assumptions: [],
  error: `Tool call failed: ${(error as Error).message}. Check BOATSCRUB_API_BASE_URL and BOATSCRUB_API_KEY.`,
});

/** Run a handler and hand Claude a JSON string; API failures come back as data, never as a thrown error. */
const asToolResult = async (work: () => Promise<unknown>): Promise<string> => {
  try {
    return JSON.stringify(await work());
  } catch (error) {
    return JSON.stringify(formatToolError(error));
  }
};

/**
 * Claude tool definitions for the SDK tool runner. Zod schemas become the JSON input schemas;
 * `strict` guarantees the arguments Claude sends validate exactly against them.
 */
export const createClaudeTools = (handlers = createToolHandlers()) => [
  betaZodTool({
    name: 'getScrubWindows',
    description: 'List the scrub windows that sailing clubs have published on Boat Scrub Calendar: club, date, low-water time, duration, capacity and places booked. Use it when the user wants to see their options or compare several dates. Filter by club or harbour name when one is given; date and boat-type arguments are accepted but not applied server-side yet. For a single recommendation use getNextScrubWindow instead.',
    inputSchema: toolSchemas.getScrubWindows,
    strict: true,
    run: (input) => asToolResult(() => handlers.getScrubWindows(input)),
  }),
  betaZodTool({
    name: 'getNextScrubWindow',
    description: 'Pick the next recommended scrub window from Boat Scrub Calendar data: the earliest dated window, with ties broken by the most places left. Use it when the user asks when they should scrub next or wants one suggestion. Returns null data when no window matches, in which case say so rather than inventing one.',
    inputSchema: toolSchemas.getNextScrubWindow,
    strict: true,
    run: (input) => asToolResult(() => handlers.getNextScrubWindow(input)),
  }),
  betaZodTool({
    name: 'getTideSummary',
    description: 'Fetch official UK Admiralty tidal events for one station over a date range and summarise the low waters (time and height) via the Boat Scrub Calendar API. Use it when the user gives a station id or asks about tide times rather than club bookings. Dates must be ISO 8601; there is no fallback data, so an error means the API is unreachable or the station id is wrong.',
    inputSchema: toolSchemas.getTideSummary,
    strict: true,
    run: (input) => asToolResult(() => handlers.getTideSummary(input)),
  }),
  betaZodTool({
    name: 'explainScrubWindow',
    description: 'Turn one scrub window (from getScrubWindows or getNextScrubWindow) into a plain-English explanation of why it suits a scrub: date, low water, duration, places left, data source and assumptions. Use it after choosing a window and before answering the user; pass the window fields through unchanged.',
    inputSchema: toolSchemas.explainScrubWindow,
    strict: true,
    run: (input) => asToolResult(() => handlers.explainScrubWindow(input)),
  }),
];
