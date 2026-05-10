import { describe, it, expect } from 'vitest';
import { mapAlexaToVoiceIntent, mapVoiceToAlexaResponse } from '../adapters/alexa.js';

describe('alexa adapter', () => {
  it('maps intent slots', () => {
    const mapped = mapAlexaToVoiceIntent({
      version: '1.0',
      session: { sessionId: 's1' },
      request: { type: 'IntentRequest', requestId: 'r1', timestamp: '2026-05-10T00:00:00Z', intent: { name: 'GetTideSummaryIntent', slots: { station_name: { name: 'station_name', value: 'Seattle' } } } }
    });
    expect(mapped.intentName).toBe('GetTideSummaryIntent');
    expect(mapped.slots.station_name).toBe('Seattle');
  });

  it('maps voice response to alexa response', () => {
    const resp = mapVoiceToAlexaResponse('Hello there', 'Can I help?', false);
    expect(resp.version).toBe('1.0');
    expect(resp.response.outputSpeech.ssml).toContain('<speak>');
  });
});
