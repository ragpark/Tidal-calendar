import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stationSlug, stationPath, stationIdFromSlug, normalizePathname, pathForPage } from '../src/seo/routes.js';
import { normalizeStationList } from '../src/seo/stations.js';
import { createSeoRenderer, groupEventsByDay } from '../src/seo/render.js';

const TEMPLATE = '<html><head><!--SEO_HEAD--></head><body><div id="root"><!--SEO_BODY--></div></body></html>';

const stations = [
  { id: '0240', name: 'Southampton', country: 'England', lat: 50.899, lon: -1.391 },
  { id: '0001', name: 'Aberdeen', country: 'Scotland', lat: 57.143, lon: -2.079 },
  { id: '0240A', name: 'Calshot Castle', country: 'England' },
];

const events = [
  { EventType: 'HighWater', DateTime: '2026-09-11T06:45:00', Height: 4.4 },
  { EventType: 'LowWater', DateTime: '2026-09-11T13:02:00', Height: 0.9 },
  { EventType: 'HighWater', DateTime: '2026-09-11T19:10:00', Height: 4.3 },
  { EventType: 'HighWater', DateTime: '2026-09-12T10:30:00', Height: 4.2 },
];

const posts = [
  { slug: 'spring-maintenance', title: 'Spring <Maintenance>', excerpt: 'A plan & checklist', contentHtml: '<p>Body</p>', publishedAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
];

const makeRenderer = (overrides = {}) => createSeoRenderer({
  template: TEMPLATE,
  fetchStations: async () => stations,
  fetchTidalEvents: async () => events,
  fetchBlogPosts: async () => posts,
  logger: { warn() {}, error() {} },
  ...overrides,
});

test('route parsing maps public URLs to app pages', () => {
  assert.deepEqual(parseRoute('/'), { page: 'calendar', blogSlug: null, stationId: null, stationSlug: null });
  assert.equal(parseRoute('/tides').page, 'tides');
  assert.equal(parseRoute('/tides/').page, 'tides');
  const station = parseRoute('/tides/Southampton-0240');
  assert.equal(station.page, 'calendar');
  assert.equal(station.stationId, '0240');
  assert.equal(parseRoute('/tides/calshot-castle-0240a').stationId, '0240A');
  assert.deepEqual(parseRoute('/blog/My-Post').blogSlug, 'my-post');
  assert.equal(parseRoute('/about').page, 'about');
  assert.equal(parseRoute('/pricing').page, 'about');
  assert.equal(parseRoute('/account').page, 'profile');
  assert.equal(parseRoute('/reset-password').page, 'profile');
  assert.equal(parseRoute('/no-such-page').notFound, true);
  assert.equal(parseRoute('/tides/garbage').notFound, true);
});

test('station slugs are stable, lowercase and reversible', () => {
  assert.equal(stationSlug({ id: '0162', name: 'Liverpool (Alfred Dock)' }), 'liverpool-alfred-dock-0162');
  assert.equal(stationPath({ id: '0240A', name: 'Calshot Castle' }), '/tides/calshot-castle-0240a');
  assert.equal(stationIdFromSlug('liverpool-alfred-dock-0162'), '0162');
  assert.equal(stationIdFromSlug('0240a'), '0240A');
  assert.equal(normalizePathname('//blog///'), '/blog');
  assert.equal(pathForPage('profile'), '/account');
  assert.equal(pathForPage('unknown'), '/');
});

test('station catalogue normalises GeoJSON and flat records', () => {
  const list = normalizeStationList({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.391, 50.899] }, properties: { Id: '0240', Name: 'Southampton', Country: 'England' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-2.079, 57.143] }, properties: { Id: '0001', Name: 'Aberdeen', Country: 'Scotland' } },
    ],
  });
  assert.deepEqual(list.map((s) => s.name), ['Aberdeen', 'Southampton']);
  assert.equal(list[1].lat, 50.899);
  assert.equal(list[1].mhws, 4.5);
});

test('tidal events are grouped by UK day and scrubbing mornings flagged', () => {
  const days = groupEventsByDay(events);
  assert.equal(days.length, 2);
  assert.equal(days[0].scrubbable, true);   // HW 07:45 BST
  assert.equal(days[1].scrubbable, false);  // HW 11:30 BST
  assert.equal(days[0].events[0].time, '07:45');
});

test('station page renders metadata, tide table and structured data', async () => {
  const { html, status } = await makeRenderer().render('/tides/southampton-0240');
  assert.equal(status, 200);
  assert.match(html, /<title>Southampton Tide Times &amp; Boat Scrubbing Days \| BoatScrubCalendar<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/boatscrubcalendar\.com\/tides\/southampton-0240" \/>/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /"@type":"GeoCoordinates","latitude":50\.899/);
  assert.match(html, /<table class="pr-table">/);
  assert.match(html, /HW 07:45 \(4\.4 m\)/);
  assert.match(html, /One morning in the next 7 days has a high water/);
  assert.match(html, /<meta name="robots" content="index, follow/);
});

test('non-canonical station and blog URLs redirect to the canonical form', async () => {
  const renderer = makeRenderer();
  assert.deepEqual(await renderer.render('/tides/anything-0240'), { status: 301, redirectTo: '/tides/southampton-0240', html: '' });
  assert.equal((await renderer.render('/tides/SOUTHAMPTON-0240')).redirectTo, '/tides/southampton-0240');
  assert.equal((await renderer.render('/blog/Spring-Maintenance')).redirectTo, '/blog/spring-maintenance');
});

test('unknown pages and stations return a noindex 404 shell', async () => {
  const renderer = makeRenderer();
  const missing = await renderer.render('/tides/nowhere-9999');
  assert.equal(missing.status, 404);
  assert.match(missing.html, /noindex, nofollow/);
  assert.equal((await renderer.render('/does-not-exist')).status, 404);
});

test('private pages are served but marked noindex', async () => {
  const { html, status } = await makeRenderer().render('/account');
  assert.equal(status, 200);
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /<link rel="canonical" href="https:\/\/boatscrubcalendar\.com\/account" \/>/);
});

test('blog post page escapes titles and emits BlogPosting JSON-LD', async () => {
  const { html } = await makeRenderer().render('/blog/spring-maintenance');
  assert.match(html, /<title>Spring &lt;Maintenance&gt; \| BoatScrubCalendar<\/title>/);
  assert.match(html, /<meta property="og:type" content="article" \/>/);
  assert.match(html, /"@type":"BlogPosting","headline":"Spring \\u003cMaintenance>"/);
  assert.doesNotMatch(html, /<script type="application\/ld\+json">[^]*?<Maintenance>/);
  assert.match(html, /"dateModified":"2026-03-02T00:00:00.000Z"/);
});

test('sitemap lists core pages, blog posts and every station', async () => {
  const xml = await makeRenderer().sitemap();
  assert.match(xml, /<loc>https:\/\/boatscrubcalendar\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/boatscrubcalendar\.com\/tides<\/loc>/);
  assert.match(xml, /<loc>https:\/\/boatscrubcalendar\.com\/blog\/spring-maintenance<\/loc><lastmod>2026-03-02<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/boatscrubcalendar\.com\/tides\/calshot-castle-0240a<\/loc>/);
  assert.equal((xml.match(/<url>/g) || []).length, 7 + posts.length + stations.length);
});

test('llms.txt describes the site and links station pages', async () => {
  const txt = await makeRenderer().llmsTxt();
  assert.match(txt, /^# BoatScrubCalendar/);
  assert.match(txt, /all 3 UK tide stations/);
  assert.match(txt, /\/tides\/southampton-0240\)/);
});

test('falls back to the bundled seed stations when the catalogue is unavailable', async () => {
  const renderer = makeRenderer({ fetchStations: async () => { throw new Error('offline'); } });
  const list = await renderer.getStations();
  assert.ok(list.length >= 10);
  const { status } = await renderer.render('/tides/southampton-0240');
  assert.equal(status, 200);
});

test('station page degrades gracefully when tidal events are unavailable', async () => {
  const renderer = makeRenderer({ fetchTidalEvents: async () => { throw new Error('upstream down'); } });
  const { html, status } = await renderer.render('/tides/aberdeen-0001');
  assert.equal(status, 200);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /Live tide times for Aberdeen load in the interactive calendar/);
});
