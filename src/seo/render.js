// Server-side SEO renderer (Node only).
//
// Produces, for every public URL, a fully formed HTML document: route-specific
// <title>/meta/canonical/Open Graph tags, JSON-LD structured data and a
// pre-rendered, crawlable body inside #root. The React bundle then mounts over
// the pre-rendered markup, so users get the interactive app while search
// engines and AI crawlers (many of which do not execute JavaScript) see real
// content and real links.

import { SEED_STATIONS, normalizeStationList } from './stations.js';
import { SITE_NAME, SITE_ORIGIN, normalizePathname, parseRoute, pathForPage, stationPath } from './routes.js';

const DEFAULT_DESCRIPTION = 'Find the best tide windows to scrub your boat. UK tide times for every Admiralty station, a monthly tide calendar and a boat scrubbing day planner built for UK boat owners.';
const SOCIAL_IMAGE = `${SITE_ORIGIN}/social-card.svg`;
const SCRUB_WINDOW = { startMinutes: 6 * 60 + 30, endMinutes: 9 * 60 };

export const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const escapeXml = escapeHtml;

const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const truncate = (value = '', max = 160) => {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

const londonDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
const londonTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const londonDateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

const ensureUtc = (value) => {
  if (typeof value !== 'string') return value;
  if (!value.includes('T')) return value;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
};

const londonMinutes = (date) => {
  const [h, m] = londonTime.format(date).split(':').map(Number);
  return h * 60 + m;
};

/** Group Admiralty tidal events by London calendar day. */
export const groupEventsByDay = (events = []) => {
  const days = new Map();
  for (const event of events) {
    const date = new Date(ensureUtc(event.DateTime));
    if (Number.isNaN(date.getTime())) continue;
    const key = londonDateKey.format(date);
    if (!days.has(key)) days.set(key, { key, label: londonDate.format(date), events: [], scrubbable: false });
    const day = days.get(key);
    const isHigh = event.EventType === 'HighWater';
    const minutes = londonMinutes(date);
    const inWindow = isHigh && minutes >= SCRUB_WINDOW.startMinutes && minutes <= SCRUB_WINDOW.endMinutes;
    if (inWindow) day.scrubbable = true;
    day.events.push({ type: isHigh ? 'HW' : 'LW', time: londonTime.format(date), height: Number(event.Height), inWindow });
  }
  return [...days.values()];
};

// ---------------------------------------------------------------------------
// Caching data layer
// ---------------------------------------------------------------------------

const createTtlCache = () => {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value, ttlMs) { store.set(key, { value, expires: Date.now() + ttlMs }); return value; },
  };
};

/**
 * @param {object} deps
 * @param {() => Promise<any>} deps.fetchStations   resolves to Admiralty station list (GeoJSON or array)
 * @param {(stationId: string) => Promise<any[]>} deps.fetchTidalEvents  resolves to 7-day tidal events
 * @param {() => Promise<any[]>} deps.fetchBlogPosts  resolves to blog posts [{slug,title,excerpt,contentHtml,publishedAt,updatedAt,coverImageUrl}]
 * @param {string} deps.template  index.html template containing <!--SEO_HEAD--> and <!--SEO_BODY--> markers
 */
export const createSeoRenderer = ({ fetchStations, fetchTidalEvents, fetchBlogPosts, template, logger = console }) => {
  const cache = createTtlCache();
  const STATIONS_TTL = 24 * 60 * 60 * 1000;
  const EVENTS_TTL = 6 * 60 * 60 * 1000;
  const BLOG_TTL = 5 * 60 * 1000;
  let stationsInflight = null;

  const getStations = async () => {
    const cached = cache.get('stations');
    if (cached) return cached;
    if (!stationsInflight) {
      stationsInflight = (async () => {
        try {
          const list = normalizeStationList(await fetchStations());
          if (list.length === 0) throw new Error('empty station list');
          return cache.set('stations', list, STATIONS_TTL);
        } catch (err) {
          logger.warn('SEO: station catalogue unavailable, using bundled seed list:', err.message);
          return cache.set('stations', normalizeStationList(SEED_STATIONS), 5 * 60 * 1000);
        } finally {
          stationsInflight = null;
        }
      })();
    }
    return stationsInflight;
  };

  const getStation = async (stationId) => {
    if (!stationId) return null;
    const stations = await getStations();
    const wanted = String(stationId).toUpperCase();
    return stations.find((s) => String(s.id).toUpperCase() === wanted) || null;
  };

  const getEvents = async (stationId) => {
    const key = `events:${stationId}`;
    const cached = cache.get(key);
    if (cached) return cached;
    try {
      const events = await fetchTidalEvents(stationId);
      return cache.set(key, Array.isArray(events) ? events : [], EVENTS_TTL);
    } catch (err) {
      logger.warn(`SEO: tidal events unavailable for ${stationId}:`, err.message);
      return cache.set(key, [], 15 * 60 * 1000);
    }
  };

  const getBlogPosts = async () => {
    const cached = cache.get('blog');
    if (cached) return cached;
    try {
      const posts = await fetchBlogPosts();
      return cache.set('blog', Array.isArray(posts) ? posts : [], BLOG_TTL);
    } catch (err) {
      logger.warn('SEO: blog posts unavailable:', err.message);
      return cache.set('blog', [], 60 * 1000);
    }
  };

  // -------------------------------------------------------------------------
  // Shared chrome
  // -------------------------------------------------------------------------

  const NAV_LINKS = [
    ['/', 'Calendar'],
    ['/tides', 'Tide stations'],
    ['/blog', 'Blog'],
    ['/about', 'Plans'],
    ['/account', 'Account'],
  ];

  const chrome = (inner, { active = '/' } = {}) => `
<div class="prerender">
  <header class="pr-header">
    <p class="pr-kicker">For UK boat owners</p>
    <h1 class="pr-brand"><a href="/">Scrubbing off Calendar</a></h1>
    <p class="pr-tagline">Monthly view • Harmonic predictions • Boat scrubbing day finder</p>
    <nav class="pr-nav" aria-label="Primary">
      ${NAV_LINKS.map(([href, label]) => `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
  </header>
  <main class="pr-main">${inner}</main>
  <footer class="pr-footer">
    <p>Tide data from the <a href="https://admiraltyapi.portal.azure-api.net" rel="noopener noreferrer">UK Hydrographic Office</a>. Extended predictions use harmonic algorithms (M2/S2 constituents).</p>
    <p><a href="/tides">All UK tide stations</a> · <a href="/blog">Blog</a> · <a href="/about">Plans and pricing</a> · <a href="/datasets/">Open datasets</a> · <a href="/llms.txt">llms.txt</a></p>
    <p>© Crown Copyright. Times shown in UK local time. Heights in metres above Chart Datum. Predictions beyond 7 days are estimates and are not a substitute for official navigational publications.</p>
  </footer>
</div>`;

  const breadcrumbs = (items) => jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE_ORIGIN}${url}` })),
  });

  const organization = {
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    logo: SOCIAL_IMAGE,
  };

  // -------------------------------------------------------------------------
  // Page builders. Each returns { title, description, canonicalPath, ogType, jsonLd: [], body, status, noindex }
  // -------------------------------------------------------------------------

  const stationCard = (station) => `<li><a href="${stationPath(station)}">${escapeHtml(station.name)}</a> <small>${escapeHtml(station.country)}</small></li>`;

  const homePage = async () => {
    const stations = await getStations();
    const featured = stations.filter((s) => SEED_STATIONS.some((seed) => seed.id === s.id));
    const posts = (await getBlogPosts()).slice(0, 4);
    const body = chrome(`
      <section class="pr-hero">
        <h2>Boat scrubbing tide calendar for the UK</h2>
        <p>Find the best tide windows to scrub your boat in minutes. BoatScrubCalendar combines UK Admiralty tide predictions with a simple monthly planner that highlights mornings when high water falls between 06:30 and 09:00, the classic window for drying out on a scrubbing grid or posts.</p>
        <p><a class="pr-cta" href="/tides">Choose your tide station</a></p>
      </section>
      <section>
        <h2>How the scrubbing day planner works</h2>
        <ul>
          <li><strong>Monthly tide calendar.</strong> High and low water times and heights for every day of the month at your home port.</li>
          <li><strong>Scrubbing day finder.</strong> Days with a morning high water inside your preferred window are flagged, so you can float on, dry out and scrub before the afternoon flood.</li>
          <li><strong>Official data plus harmonic predictions.</strong> The next 7 days use official UK Hydrographic Office tidal events; later dates use M2/S2 harmonic estimates, with year-long Admiralty data for subscribers.</li>
          <li><strong>Club booking and reminders.</strong> Sailing clubs can publish scrub windows and manage bookings; members get maintenance reminders by email.</li>
        </ul>
      </section>
      <section>
        <h2>Popular tide stations</h2>
        <ul class="pr-grid">${featured.map(stationCard).join('')}</ul>
        <p><a href="/tides">Browse all ${stations.length} UK tide stations →</a></p>
      </section>
      ${posts.length ? `<section><h2>From the blog</h2><ul>${posts.map((p) => `<li><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a> – ${escapeHtml(truncate(p.excerpt, 140))}</li>`).join('')}</ul></section>` : ''}
      <section>
        <h2>Frequently asked questions</h2>
        <h3>What is the best tide for scrubbing a boat?</h3>
        <p>Most owners want a high water around 06:30 to 09:00 so the boat can be put on the grid or posts at the top of the tide, dry out through the morning ebb and be scrubbed and antifouled before the flood returns in the afternoon. Spring tides give more time and a bigger drop.</p>
        <h3>Is the tide data official?</h3>
        <p>The first 7 days come directly from the UK Hydrographic Office Admiralty Tidal API. Beyond that the calendar shows harmonic estimates, clearly marked as approximate. Subscribers get official Admiralty predictions for the whole year.</p>
        <h3>Which ports are covered?</h3>
        <p>Every standard and secondary port in the Admiralty UK station list, from Aberdeen to Plymouth. See the <a href="/tides">full station index</a>.</p>
      </section>`, { active: '/' });

    return {
      title: 'Boat Scrubbing Tide Calendar UK | BoatScrubCalendar',
      description: DEFAULT_DESCRIPTION,
      canonicalPath: '/',
      body,
      jsonLd: [
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: `${SITE_ORIGIN}/`,
          inLanguage: 'en-GB',
          publisher: organization,
          potentialAction: { '@type': 'SearchAction', target: `${SITE_ORIGIN}/tides?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
        }),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE_NAME,
          applicationCategory: 'UtilityApplication',
          operatingSystem: 'Web',
          url: `${SITE_ORIGIN}/`,
          description: DEFAULT_DESCRIPTION,
          offers: [
            { '@type': 'Offer', price: '0', priceCurrency: 'GBP', description: 'Free: 7-day official tide times, monthly harmonic calendar and scrubbing day finder' },
            { '@type': 'Offer', price: '5', priceCurrency: 'GBP', description: 'Subscriber: year-long Admiralty tide predictions, PDF tide booklet and maintenance reminders' },
          ],
          publisher: organization,
        }),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            { '@type': 'Question', name: 'What is the best tide for scrubbing a boat?', acceptedAnswer: { '@type': 'Answer', text: 'A high water between about 06:30 and 09:00 lets you put the boat on the grid at the top of the tide, dry out through the morning ebb and finish scrubbing before the afternoon flood. Spring tides give a longer working window.' } },
            { '@type': 'Question', name: 'Is the tide data official?', acceptedAnswer: { '@type': 'Answer', text: 'The next 7 days use official UK Hydrographic Office Admiralty tidal predictions. Later dates use harmonic estimates marked as approximate; subscribers receive official predictions for the whole year.' } },
            { '@type': 'Question', name: 'Which UK ports are covered?', acceptedAnswer: { '@type': 'Answer', text: 'Every standard and secondary port in the Admiralty UK tide station list. Each station has its own page under /tides/.' } },
          ],
        }),
      ],
    };
  };

  const tidesIndexPage = async () => {
    const stations = await getStations();
    const byCountry = new Map();
    for (const s of stations) {
      if (!byCountry.has(s.country)) byCountry.set(s.country, []);
      byCountry.get(s.country).push(s);
    }
    const sections = [...byCountry.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([country, list]) => `<section><h2 id="${escapeHtml(SITE_NAME && country.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(country)} <small>(${list.length})</small></h2><ul class="pr-grid">${list.map(stationCard).join('')}</ul></section>`)
      .join('');
    const body = chrome(`
      <h2>UK tide stations</h2>
      <p>Tide times, high and low water heights and boat scrubbing days for ${stations.length} UK Hydrographic Office tide stations. Pick your home port to open its monthly tide calendar and scrubbing day planner.</p>
      ${sections}`, { active: '/tides' });
    return {
      title: `UK Tide Stations A–Z: Tide Times for ${stations.length} Ports | ${SITE_NAME}`,
      description: `Tide times and boat scrubbing days for ${stations.length} UK Admiralty tide stations in England, Scotland, Wales, Northern Ireland and the Channel Islands.`,
      canonicalPath: '/tides',
      body,
      jsonLd: [
        breadcrumbs([['Home', '/'], ['Tide stations', '/tides']]),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'UK tide stations',
          url: `${SITE_ORIGIN}/tides`,
          inLanguage: 'en-GB',
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
          numberOfItems: stations.length,
        }),
      ],
    };
  };

  const stationPage = async (station) => {
    const events = await getEvents(station.id);
    const days = groupEventsByDay(events);
    const scrubDays = days.filter((d) => d.scrubbable);
    const path = stationPath(station);
    const hasCoords = Number.isFinite(station.lat) && Number.isFinite(station.lon);

    const table = days.length
      ? `<table class="pr-table"><caption>Next 7 days of tidal events at ${escapeHtml(station.name)} (UK local time, heights in metres above Chart Datum)</caption>
<thead><tr><th scope="col">Day</th><th scope="col">Tidal events</th><th scope="col">Scrubbing morning?</th></tr></thead>
<tbody>${days.map((d) => `<tr><th scope="row">${escapeHtml(d.label)}</th><td>${d.events.map((e) => `<span class="pr-event${e.inWindow ? ' pr-hit' : ''}">${e.type} ${e.time}${Number.isFinite(e.height) ? ` (${e.height.toFixed(1)} m)` : ''}</span>`).join(' ')}</td><td>${d.scrubbable ? '✅ Yes' : '—'}</td></tr>`).join('')}</tbody></table>`
      : `<p>Live tide times for ${escapeHtml(station.name)} load in the interactive calendar. Open the calendar to see the next 7 days of official Admiralty predictions and a full month of harmonic estimates.</p>`;

    const scrubSummary = days.length
      ? (scrubDays.length
        ? `<p>${scrubDays.length === 1 ? 'One morning' : `${scrubDays.length} mornings`} in the next 7 days ${scrubDays.length === 1 ? 'has' : 'have'} a high water between 06:30 and 09:00, the ideal window to put a boat on the scrubbing grid or posts: ${scrubDays.map((d) => `<strong>${escapeHtml(d.label)}</strong>`).join(', ')}.</p>`
        : '<p>No high water falls between 06:30 and 09:00 in the next 7 days. The monthly calendar shows the next suitable scrubbing mornings.</p>')
      : '';

    const body = chrome(`
      <nav class="pr-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/tides">Tide stations</a> › <span>${escapeHtml(station.name)}</span></nav>
      <h2>${escapeHtml(station.name)} tide times and boat scrubbing days</h2>
      <p>${escapeHtml(station.name)} is a UK Hydrographic Office tide station in ${escapeHtml(station.country)}${hasCoords ? ` at ${station.lat.toFixed(3)}°, ${station.lon.toFixed(3)}°` : ''}. This page lists the next 7 days of official Admiralty high and low water predictions and flags the mornings when high water falls in the 06:30 to 09:00 scrubbing window. The interactive calendar extends this to a full month with harmonic predictions.</p>
      ${scrubSummary}
      ${table}
      <p><a class="pr-cta" href="${path}">Open the ${escapeHtml(station.name)} monthly calendar</a></p>
      <section>
        <h3>Planning a scrub at ${escapeHtml(station.name)}</h3>
        <ul>
          <li>Aim for a high water between 06:30 and 09:00 so the boat dries out through the morning and refloats on the afternoon flood.</li>
          <li>Spring tides (around new and full moon) give a larger range and more working time on the grid.</li>
          <li>Check the height of high water against the depth of your grid or posts; neap tides may not float a deep-keeled yacht on.</li>
          <li>Predictions beyond 7 days are harmonic estimates. Confirm dates against official tide tables before committing a crane or grid booking.</li>
        </ul>
      </section>`, { active: '/tides' });

    return {
      title: `${station.name} Tide Times & Boat Scrubbing Days | ${SITE_NAME}`,
      description: truncate(`${station.name} tide times: high and low water for the next 7 days from UK Admiralty data, plus the best mornings to scrub your boat at ${station.name}, ${station.country}. Monthly tide calendar and scrubbing day planner.`),
      canonicalPath: path,
      body,
      jsonLd: [
        breadcrumbs([['Home', '/'], ['Tide stations', '/tides'], [station.name, path]]),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `${station.name} tide times and boat scrubbing days`,
          url: `${SITE_ORIGIN}${path}`,
          inLanguage: 'en-GB',
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
          about: {
            '@type': 'Place',
            name: station.name,
            address: { '@type': 'PostalAddress', addressCountry: 'GB', addressRegion: station.country },
            ...(hasCoords ? { geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lon } } : {}),
          },
          ...(days.length ? {
            mainEntity: {
              '@type': 'Dataset',
              name: `${station.name} 7-day tidal predictions`,
              description: `High and low water times and heights for ${station.name} for the next 7 days.`,
              creator: { '@type': 'Organization', name: 'UK Hydrographic Office' },
              temporalCoverage: `${days[0].key}/${days[days.length - 1].key}`,
              license: 'https://www.admiralty.co.uk/terms-and-conditions',
            },
          } : {}),
        }),
      ],
    };
  };

  const blogIndexPage = async () => {
    const posts = await getBlogPosts();
    const body = chrome(`
      <h2>Boat maintenance and tide planning blog</h2>
      <p>Practical guides on scrubbing, antifouling, spring and neap tides and seasonal maintenance for UK boat owners.</p>
      ${posts.length ? `<ul class="pr-posts">${posts.map((p) => `<li><article><h3><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>${p.publishedAt ? `<time datetime="${escapeHtml(new Date(p.publishedAt).toISOString())}">${escapeHtml(londonDate.format(new Date(p.publishedAt)))}</time>` : ''}<p>${escapeHtml(truncate(p.excerpt, 220))}</p></article></li>`).join('')}</ul>` : '<p>Articles are on their way.</p>'}`, { active: '/blog' });
    return {
      title: `Boat Maintenance & Tide Planning Blog | ${SITE_NAME}`,
      description: 'Guides on boat scrubbing, antifouling, spring and neap tides and seasonal yacht maintenance for UK boat owners.',
      canonicalPath: '/blog',
      body,
      jsonLd: [
        breadcrumbs([['Home', '/'], ['Blog', '/blog']]),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: `${SITE_NAME} blog`,
          url: `${SITE_ORIGIN}/blog`,
          inLanguage: 'en-GB',
          publisher: organization,
          blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE_ORIGIN}/blog/${p.slug}`, datePublished: p.publishedAt || undefined })),
        }),
      ],
    };
  };

  const blogPostPage = async (post) => {
    const path = `/blog/${post.slug}`;
    const published = post.publishedAt ? new Date(post.publishedAt) : null;
    const modified = post.updatedAt ? new Date(post.updatedAt) : published;
    const body = chrome(`
      <nav class="pr-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog">Blog</a> › <span>${escapeHtml(post.title)}</span></nav>
      <article class="pr-article">
        <h2>${escapeHtml(post.title)}</h2>
        ${published ? `<p><time datetime="${published.toISOString()}">${escapeHtml(londonDate.format(published))} ${published.getFullYear()}</time></p>` : ''}
        ${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="" loading="lazy" />` : ''}
        ${post.contentHtml || ''}
      </article>`, { active: '/blog' });
    return {
      title: `${post.title} | ${SITE_NAME}`,
      description: truncate(post.excerpt || post.contentHtml?.replace(/<[^>]+>/g, ' ') || DEFAULT_DESCRIPTION),
      canonicalPath: path,
      ogType: 'article',
      image: post.coverImageUrl || SOCIAL_IMAGE,
      body,
      jsonLd: [
        breadcrumbs([['Home', '/'], ['Blog', '/blog'], [post.title, path]]),
        jsonLd({
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: truncate(post.excerpt || '', 200),
          url: `${SITE_ORIGIN}${path}`,
          mainEntityOfPage: `${SITE_ORIGIN}${path}`,
          inLanguage: 'en-GB',
          image: post.coverImageUrl || SOCIAL_IMAGE,
          datePublished: published ? published.toISOString() : undefined,
          dateModified: modified ? modified.toISOString() : undefined,
          author: { '@type': 'Organization', name: SITE_NAME },
          publisher: organization,
        }),
      ],
    };
  };

  const aboutPage = async () => {
    const body = chrome(`
      <h2>Plans and pricing</h2>
      <p>BoatScrubCalendar keeps UK boat owners informed with a monthly tide view, scrubbing guidance and maintenance reminders for a chosen home port. It blends official UK Hydrographic Office data with harmonic predictions so you can plan confidently.</p>
      <section><h3>Guest users (free)</h3><ul><li>Browse every UK tide station and set a home port without signing in.</li><li>Official UKHO tidal events for the next 7 days.</li><li>Free use of the scrubbing day finder and monthly harmonic calendar.</li></ul></section>
      <section><h3>Signed-in users (free)</h3><ul><li>Maintenance log with email reminders before important dates.</li><li>Home-port preferences synced across devices.</li><li>Request to join a sailing club and book club scrub windows.</li></ul></section>
      <section><h3>Subscribers</h3><ul><li>Official Admiralty tide predictions for the whole year, not just 7 days.</li><li>Downloadable PDF tide booklet for your home port.</li><li>Priority support for club administrators.</li></ul></section>
      <section><h3>Sailing clubs</h3><p>Club administrators can register a club, define scrubbing posts or grids, publish scrub windows aligned with the tides and manage member bookings and invites. <a href="mailto:hello@boatscrub.com?subject=Club%20enquiry">Get in touch</a> to set up your club.</p></section>
      <p><a class="pr-cta" href="/account">Create a free account</a></p>`, { active: '/about' });
    return {
      title: `Plans & Pricing: Free Tide Calendar and Subscriber Features | ${SITE_NAME}`,
      description: 'Compare free and subscriber plans: 7-day official tide times for everyone, year-long Admiralty predictions, PDF tide booklets and club scrub-window booking for subscribers.',
      canonicalPath: '/about',
      body,
      jsonLd: [breadcrumbs([['Home', '/'], ['Plans', '/about']])],
    };
  };

  const privatePage = (page) => ({
    title: `${page === 'profile' ? 'Account' : page === 'club' ? 'Club dashboard' : 'Admin'} | ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: pathForPage(page),
    noindex: true,
    body: chrome('<h2>Loading…</h2><p>This page requires JavaScript. <a href="/">Return to the calendar</a>.</p>', { active: pathForPage(page) }),
    jsonLd: [],
  });

  const notFoundPage = (pathname) => ({
    title: `Page not found | ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
    noindex: true,
    status: 404,
    body: chrome(`<h2>Page not found</h2><p>There is nothing at <code>${escapeHtml(pathname)}</code>. Try the <a href="/tides">tide station index</a> or go back to the <a href="/">calendar</a>.</p>`),
    jsonLd: [],
  });

  // -------------------------------------------------------------------------
  // Document assembly
  // -------------------------------------------------------------------------

  const PRERENDER_CSS = `<style id="prerender-css">
.prerender{max-width:1100px;margin:0 auto;padding:32px 24px 60px;font-family:'Outfit',system-ui,sans-serif;color:#0f172a;line-height:1.6}
.prerender a{color:#0284c7}
.pr-header{text-align:center;padding-bottom:24px}
.pr-kicker{font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#0ea5e9;margin:0 0 12px}
.pr-brand{font-family:'Cormorant Garamond',Georgia,serif;font-weight:400;font-size:clamp(36px,8vw,64px);letter-spacing:2px;margin:0 0 12px}
.pr-brand a{color:#0f172a;text-decoration:none}
.pr-tagline{color:#475569;font-size:14px;margin:0 0 20px}
.pr-nav{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.pr-nav a{padding:10px 16px;border-radius:10px;border:1px solid rgba(14,165,233,.25);background:#fff;color:#0f172a;text-decoration:none;font-size:14px;letter-spacing:1px}
.pr-nav a[aria-current]{background:#e0f2fe}
.pr-main h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:30px;margin:28px 0 10px}
.pr-main h3{font-size:18px;margin:20px 0 6px}
.pr-main p,.pr-main li{font-size:15px;color:#334155}
.pr-hero{background:#fff;border:1px solid rgba(15,23,42,.06);border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)}
.pr-cta{display:inline-block;padding:12px 20px;border-radius:10px;background:#0ea5e9;color:#fff !important;text-decoration:none;font-weight:500}
.pr-grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.pr-grid li{background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px}
.pr-grid small{display:block;color:#64748b;font-size:12px}
.pr-crumbs{font-size:13px;color:#64748b;margin-top:8px}
.pr-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;font-size:14px}
.pr-table caption{caption-side:bottom;font-size:12px;color:#64748b;padding:8px}
.pr-table th,.pr-table td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
.pr-event{display:inline-block;margin:2px 8px 2px 0;white-space:nowrap}
.pr-hit{font-weight:600;color:#15803d}
.pr-posts{list-style:none;padding:0}
.pr-posts li{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin-bottom:12px}
.pr-posts time{font-size:12px;color:#64748b}
.pr-article img{max-width:100%;border-radius:12px}
.pr-footer{border-top:1px solid rgba(56,189,248,.2);margin-top:40px;padding-top:24px;text-align:center;font-size:12px;color:#475569}
</style>`;

  const buildHead = (page) => {
    const canonical = `${SITE_ORIGIN}${page.canonicalPath}`;
    const image = page.image || SOCIAL_IMAGE;
    const robots = page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1';
    return [
      `<title>${escapeHtml(page.title)}</title>`,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
      `<meta name="robots" content="${robots}" />`,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:locale" content="en_GB" />`,
      `<meta property="og:type" content="${page.ogType || 'website'}" />`,
      `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
      `<meta property="og:image" content="${escapeHtml(image)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
      `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
      ...page.jsonLd,
      PRERENDER_CSS,
    ].join('\n    ');
  };

  const resolvePage = async (pathname) => {
    const route = parseRoute(pathname);
    if (route.notFound) return notFoundPage(pathname);
    switch (route.page) {
      case 'tides': return tidesIndexPage();
      case 'calendar': {
        if (!route.stationId) return homePage();
        const station = await getStation(route.stationId);
        if (!station) return notFoundPage(pathname);
        const page = await stationPage(station);
        // Redirect legacy, misspelt or differently-cased slugs to the single canonical URL.
        if (normalizePathname(pathname) !== page.canonicalPath) page.redirectTo = page.canonicalPath;
        return page;
      }
      case 'blog': {
        if (!route.blogSlug) return blogIndexPage();
        const posts = await getBlogPosts();
        const post = posts.find((p) => p.slug === route.blogSlug);
        if (!post) return notFoundPage(pathname);
        const page = await blogPostPage(post);
        if (normalizePathname(pathname) !== page.canonicalPath) page.redirectTo = page.canonicalPath;
        return page;
      }
      case 'about': return aboutPage();
      default: return privatePage(route.page);
    }
  };

  /** Render a full HTML document for a pathname. Returns { html, status, redirectTo }. */
  const render = async (pathname) => {
    let page;
    try {
      page = await resolvePage(pathname);
    } catch (err) {
      logger.error('SEO render failed, serving generic shell:', err);
      page = { title: 'Boat Scrubbing Tide Calendar UK | BoatScrubCalendar', description: DEFAULT_DESCRIPTION, canonicalPath: '/', body: '', jsonLd: [] };
    }
    if (page.redirectTo) return { status: 301, redirectTo: page.redirectTo, html: '' };
    const html = template
      .replace('<!--SEO_HEAD-->', buildHead(page))
      .replace('<!--SEO_BODY-->', page.body || '');
    return { html, status: page.status || 200 };
  };

  const sitemap = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [stations, posts] = await Promise.all([getStations(), getBlogPosts()]);
    const url = (loc, { lastmod = today, changefreq = 'weekly', priority = '0.7' } = {}) =>
      `  <url><loc>${escapeXml(`${SITE_ORIGIN}${loc}`)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
    const entries = [
      url('/', { changefreq: 'daily', priority: '1.0' }),
      url('/tides', { changefreq: 'weekly', priority: '0.9' }),
      url('/blog', { changefreq: 'weekly', priority: '0.8' }),
      url('/about', { changefreq: 'monthly', priority: '0.6' }),
      url('/datasets/', { changefreq: 'weekly', priority: '0.6' }),
      url('/datasets/boat-scrub-windows-v1/', { changefreq: 'weekly', priority: '0.6' }),
      url('/llms.txt', { changefreq: 'weekly', priority: '0.5' }),
      ...posts.map((p) => url(`/blog/${p.slug}`, { lastmod: (p.updatedAt || p.publishedAt || today).toString().slice(0, 10), changefreq: 'monthly', priority: '0.7' })),
      ...stations.map((s) => url(stationPath(s), { changefreq: 'daily', priority: '0.8' })),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  };

  const llmsTxt = async () => {
    const [stations, posts] = await Promise.all([getStations(), getBlogPosts()]);
    const featured = stations.filter((s) => SEED_STATIONS.some((seed) => seed.id === s.id));
    return [
      `# ${SITE_NAME}`,
      '',
      '> BoatScrubCalendar is a UK tide-planning web app for boat owners. It shows tide times for every UK Hydrographic Office tide station, a monthly tide calendar, and flags the best mornings to scrub a boat (high water between 06:30 and 09:00). Sailing clubs can publish and book scrub windows.',
      '',
      '## Key facts',
      `- Production URL: ${SITE_ORIGIN}/`,
      '- Geography: United Kingdom (England, Scotland, Wales, Northern Ireland, Channel Islands, Isle of Man)',
      '- Data source: UK Hydrographic Office Admiralty Tidal API (official, next 7 days) plus M2/S2 harmonic estimates beyond that',
      '- Units: metres above Chart Datum for heights; UK local time (Europe/London) for tide times',
      '- Scrubbing rule of thumb used by the planner: a morning high water between 06:30 and 09:00',
      '- Pricing: free tier (7-day official tides, monthly calendar, scrubbing day finder); paid subscription (year-long Admiralty data, PDF tide booklet, reminders)',
      '',
      '## Pages',
      `- [Home and calendar](${SITE_ORIGIN}/): interactive monthly tide calendar and scrubbing day planner`,
      `- [Tide station index](${SITE_ORIGIN}/tides): all ${stations.length} UK tide stations, grouped by country`,
      `- [Blog](${SITE_ORIGIN}/blog): guides on scrubbing, antifouling and seasonal maintenance`,
      `- [Plans and pricing](${SITE_ORIGIN}/about)`,
      `- [Datasets](${SITE_ORIGIN}/datasets/): machine-readable scrub window data (JSON, CSV)`,
      `- [Sitemap](${SITE_ORIGIN}/sitemap.xml)`,
      '',
      '## Station pages',
      'Each station page lists the next 7 days of high and low water with heights and marks scrubbing mornings. URL pattern: /tides/<station-name>-<admiralty-id>. Examples:',
      ...featured.map((s) => `- [${s.name} tide times](${SITE_ORIGIN}${stationPath(s)})`),
      '',
      ...(posts.length ? ['## Articles', ...posts.slice(0, 30).map((p) => `- [${p.title}](${SITE_ORIGIN}/blog/${p.slug}): ${truncate(p.excerpt, 140)}`), ''] : []),
      '## API for agents',
      `- Public station list: ${SITE_ORIGIN}/api/Stations (GeoJSON, proxied from the Admiralty API)`,
      `- Tidal events: ${SITE_ORIGIN}/api/Stations/<id>/TidalEvents?duration=7`,
      '- A Model Context Protocol server and an Alexa voice backend are available in the open-source repository.',
      '',
      '## Citation guidance',
      '- Cite the station page for tide times and the dataset page for scrub-window data; include the date the page was retrieved.',
      '- Scrub windows are planning aids, not navigational safety instructions.',
      '',
    ].join('\n');
  };

  return { render, sitemap, llmsTxt, getStations, getStation, getBlogPosts, warm: () => getStations().catch(() => null) };
};
