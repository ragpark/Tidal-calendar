export type IntentName =
  | 'GetTideSummaryIntent'
  | 'GetScrubSlotsIntent'
  | 'GetScrubOffDaysIntent'
  | 'BookScrubSlotIntent'
  | 'HelpIntent'
  | 'FallbackIntent';

export type VoiceIntentRequest = {
  sessionId: string;
  intentName: IntentName;
  slots?: Record<string, string | undefined>;
  rawUtterance?: string;
};

export type VoiceConfirmRequest = { sessionId: string; confirmation: 'yes' | 'no' };

export type VoiceResponse = {
  speechText: string;
  repromptText?: string;
  endSession?: boolean;
  cards?: Array<{ title: string; content: string }>;
  statePatch?: Partial<SessionState>;
};

export type Station = { id: string; name: string; location?: string };
export type TideSummary = { stationId: string; date: string; summary: string };
export type Club = { id: string; name: string };
export type ScrubWindow = { id: string; clubId: string; start: string; end: string; available: boolean };

export type PendingBooking = { clubId: string; windowId: string; spokenLabel: string };

export type SessionState = {
  resolved_station?: Station;
  candidate_slots: Array<{ club: Club; window: ScrubWindow }>;
  pending_booking?: PendingBooking;
  last_intent?: IntentName;
  auth_state?: 'unknown' | 'authenticated' | 'failed';
};

export type StandardizedError = { code: string; message: string; retryable?: boolean; status?: number };
