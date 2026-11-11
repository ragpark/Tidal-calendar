import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatScrubClient } from './boatscrubClient.js';

test('getScrubWindows maps /api/clubs payload', async () => {
  const originalFetch = global.fetch;
  process.env.BOATSCRUB_API_BASE_URL = 'https://boatscrubcalendar.com';

  global.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          id: 'club-1',
          name: 'Sheerness Marina Club',
          windows: [
            {
              id: 'win-1',
              date: 'Thu 07 May',
              lowWater: '10:42',
              duration: '2h 10m',
              capacity: 10,
              booked: 3,
            },
          ],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  try {
    const client = new BoatScrubClient();
    const result = await client.getScrubWindows();

    assert.equal(result.ok, true);
    assert.equal(result.source, 'live_api');
    assert.equal(result.data?.length, 1);
    assert.equal(result.data?.[0].clubName, 'Sheerness Marina Club');
    assert.equal(result.data?.[0].lowWater, '10:42');
  } finally {
    global.fetch = originalFetch;
  }
});
