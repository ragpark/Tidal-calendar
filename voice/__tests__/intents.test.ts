import { describe, it, expect } from 'vitest';
import { IntentHandlers } from '../intents/handlers.js';

const mockMcp: any = {
  listStations: async () => [{ id: 's1', name: 'Seattle' }],
  getTideSummary: async () => ({ summary: 'High tide at 3 PM.' }),
  listClubs: async () => [{ id: 'c1', name: 'Harbor', windows: [{ id: 'w1', clubId: 'c1', start: new Date().toISOString(), end: new Date().toISOString(), available: true }] }],
  login: async () => 'sess=1',
  bookScrubWindow: async () => ({ ok: true, message: 'ok' })
};

describe('IntentHandlers', () => {
  it('tide happy path', async () => {
    const h = new IntentHandlers(mockMcp);
    const r = await h.handleIntent({ sessionId: 'a', intentName: 'GetTideSummaryIntent', slots: { station_name: 'Seattle' } });
    expect(r.speechText).toContain('Seattle');
  });
  it('slots missing club fallback', async () => {
    const h = new IntentHandlers({ ...mockMcp, listClubs: async () => [] });
    const r = await h.handleIntent({ sessionId: 'a', intentName: 'GetScrubSlotsIntent', slots: {} });
    expect(r.speechText).toContain('could not find');
  });
  it('booking confirmation required', async () => {
    const h = new IntentHandlers(mockMcp);
    await h.handleIntent({ sessionId: 'b', intentName: 'GetScrubSlotsIntent', slots: {} });
    const r = await h.handleIntent({ sessionId: 'b', intentName: 'BookScrubSlotIntent', slots: { slot_reference: '1' } });
    expect(r.speechText).toContain('Confirm booking');
  });
  it('auth failure', async () => {
    const h = new IntentHandlers({ ...mockMcp, login: async () => { throw new Error('x'); } });
    await h.handleIntent({ sessionId: 'c', intentName: 'GetScrubSlotsIntent', slots: {} });
    await h.handleIntent({ sessionId: 'c', intentName: 'BookScrubSlotIntent', slots: { slot_reference: '1' } });
    const r = await h.handleConfirm({ sessionId: 'c', confirmation: 'yes' });
    expect(r.speechText).toContain('could not authenticate');
  });
});
