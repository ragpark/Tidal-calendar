import { McpClient } from '../services/mcpClient.js';
import { resolveClub, resolveSlotIndex, resolveStation } from '../services/resolvers.js';
import { getSessionState, patchSessionState } from '../state/sessionStore.js';
import { isoDate, parseDateRange } from '../utils/dateParser.js';
import { concise, speakDateTime } from '../utils/formatters.js';
import { VoiceIntentRequest, VoiceResponse, VoiceConfirmRequest } from '../types.js';

export class IntentHandlers {
  constructor(private readonly mcp: McpClient) {}

  async handleIntent(req: VoiceIntentRequest): Promise<VoiceResponse> {
    const slots = req.slots ?? {};
    if (req.intentName === 'GetTideSummaryIntent') {
      const stations = await this.mcp.listStations(slots.station_name ?? slots.location);
      const station = resolveStation({ station_id: slots.station_id, station_name: slots.station_name, location: slots.location }, stations);
      if (!station) return { speechText: 'I could not find that tide station. Which station should I use?', repromptText: 'Tell me a station name.' };
      const { start } = parseDateRange(slots.date);
      const tide = await this.mcp.getTideSummary(station.id, isoDate(start));
      patchSessionState(req.sessionId, { resolved_station: station, last_intent: req.intentName });
      return { speechText: concise([`For ${station.name} on ${isoDate(start)}.`, tide.summary, 'Want scrub slots next?']) };
    }
    if (req.intentName === 'GetScrubSlotsIntent') {
      const clubs = await this.mcp.listClubs();
      const club = resolveClub(slots.club_id ?? slots.club_name, clubs.map((c) => ({ id: c.id, name: c.name })));
      if (!club) return { speechText: 'I could not find that club. Please say a club name.' };
      const { start, end } = slots.start_date ? { start: new Date(slots.start_date), end: new Date(slots.end_date ?? slots.start_date) } : (() => { const s = new Date(); const e = new Date(); e.setDate(e.getDate() + 7); return { start: s, end: e }; })();
      const selected = clubs.find((c) => c.id === club.id)!;
      const candidates = selected.windows.filter((w) => w.available && new Date(w.start) >= start && new Date(w.start) <= end).sort((a, b) => +new Date(a.start) - +new Date(b.start)).slice(0, 3).map((w) => ({ club, window: w }));
      patchSessionState(req.sessionId, { candidate_slots: candidates, last_intent: req.intentName });
      if (!candidates.length) return { speechText: 'No scrub slots found in that range. Want me to check more dates?' };
      return { speechText: candidates.map((c, i) => `Option ${i + 1}, ${speakDateTime(c.window.start)}.`).join(' '), repromptText: 'Say book option 1, 2, or 3.' };
    }
    if (req.intentName === 'BookScrubSlotIntent') {
      const state = getSessionState(req.sessionId);
      const picked = resolveSlotIndex(slots.slot_reference, state.candidate_slots);
      const explicit = slots.window_id && slots.club_id ? { club: { id: slots.club_id, name: slots.club_id }, window: { id: slots.window_id, clubId: slots.club_id, start: new Date().toISOString(), end: new Date().toISOString(), available: true } } : undefined;
      const target = picked ?? explicit;
      if (!target) return { speechText: 'I need a slot choice first. Say list scrub slots.', repromptText: 'Say list scrub slots.' };
      patchSessionState(req.sessionId, { pending_booking: { clubId: target.club.id, windowId: target.window.id, spokenLabel: `${target.club.name} at ${speakDateTime(target.window.start)}` }, last_intent: req.intentName });
      return { speechText: `Confirm booking for ${speakDateTime(target.window.start)} at ${target.club.name}? Say yes or no.`, repromptText: 'Please say yes or no.' };
    }
    if (req.intentName === 'HelpIntent') return { speechText: 'Try: tide summary for Seattle today. Or: list scrub slots this weekend. Or: book option 2.' };
    return { speechText: 'Sorry, I did not catch that. You can ask for tide summary, scrub slots, or booking help.' };
  }

  async handleConfirm(req: VoiceConfirmRequest): Promise<VoiceResponse> {
    const state = getSessionState(req.sessionId);
    if (!state.pending_booking) return { speechText: 'There is nothing pending to confirm.' };
    if (req.confirmation === 'no') {
      patchSessionState(req.sessionId, { pending_booking: undefined });
      return { speechText: 'Okay, I cancelled that booking.' };
    }
    try {
      const mode = process.env.BOOKING_SESSION_COOKIE ? { mode: 'cookie' as const, cookie: process.env.BOOKING_SESSION_COOKIE } : { mode: 'password' as const, email: process.env.BOOKING_EMAIL ?? '', password: process.env.BOOKING_PASSWORD ?? '' };
      const cookie = await this.mcp.login(mode);
      const result = await this.mcp.bookScrubWindow(state.pending_booking.clubId, state.pending_booking.windowId, cookie);
      patchSessionState(req.sessionId, { pending_booking: undefined, auth_state: 'authenticated' });
      return { speechText: result.ok ? 'Booked. You are all set.' : `Booking failed. ${result.message}` };
    } catch {
      patchSessionState(req.sessionId, { auth_state: 'failed' });
      return { speechText: 'I could not authenticate booking right now. Please check your account and try again.' };
    }
  }
}
