export type DataSource = 'live_api' | 'demo_fallback';

export interface ScrubWindow {
  clubId: string;
  clubName: string;
  windowId: string;
  dateLabel: string;
  lowWater: string;
  duration: string;
  capacity: number;
  booked: number;
}

export interface TideSummary {
  stationId: string;
  stationName?: string;
  from?: string;
  to?: string;
  eventCount: number;
  lowWaters: Array<{ dateTime: string; height?: number }>;
  source: DataSource;
}

export interface ToolResult<T> {
  ok: boolean;
  source: DataSource;
  assumptions: string[];
  data?: T;
  error?: string;
}

export interface AgentCliOptions {
  location?: string;
  from?: string;
  to?: string;
  stationId?: string;
  draft?: number;
  loa?: number;
  boatType?: string;
  question?: string;
}
