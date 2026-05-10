import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../adapters/http.js';

vi.mock('../services/mcpClient.js', () => ({
  McpClient: class {
    listStations = async () => [{ id: 's1', name: 'Seattle' }];
    getTideSummary = async () => ({ summary: 'High tide at 3 PM.' });
    listClubs = async () => [];
    login = async () => 'x';
    bookScrubWindow = async () => ({ ok: true, message: 'ok' });
  }
}));

describe('POST /voice/intent', () => {
  it('returns speech', async () => {
    const res = await request(buildApp()).post('/voice/intent').send({ sessionId: 's', intentName: 'GetTideSummaryIntent', slots: { station_name: 'Seattle' } });
    expect(res.status).toBe(200);
    expect(res.body.speechText).toBeTruthy();
  });
});
