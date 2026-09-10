// Shared (browser + Node) URL routing helpers for crawlable, human-readable paths.
//
// Public URL structure:
//   /                      Home: calendar + scrubbing planner
//   /tides                 Index of all UK tide stations
//   /tides/:slug           Station page, slug = "<name-slug>-<stationId>" e.g. /tides/southampton-0240
//   /blog                  Blog index
//   /blog/:slug            Blog article
//   /about                 Product overview, plans and pricing
//   /account               Sign-in / profile (noindex)
//   /club, /admin          Private dashboards (noindex)

export const SITE_ORIGIN = 'https://boatscrubcalendar.com';
export const SITE_NAME = 'BoatScrubCalendar';

export const slugify = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'station';

export const stationSlug = (station) => {
  if (!station) return '';
  const id = String(station.id || '').trim().toLowerCase();
  return `${slugify(station.name)}-${id}`;
};

export const stationPath = (station) => `/tides/${stationSlug(station)}`;

// Extract the Admiralty station id from a station slug. Ids look like "0240" or "0240A".
export const stationIdFromSlug = (slug = '') => {
  const match = String(slug).trim().toLowerCase().match(/-?([0-9]{1,5}[a-z]?)$/);
  return match ? match[1].toUpperCase() : null;
};

export const normalizePathname = (pathname = '/') => {
  let value = String(pathname || '/');
  try { value = decodeURIComponent(value); } catch { /* keep raw */ }
  value = value.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return value || '/';
};

const PAGE_PATHS = {
  calendar: '/',
  tides: '/tides',
  blog: '/blog',
  about: '/about',
  profile: '/account',
  club: '/club',
  admin: '/admin',
};

export const pathForPage = (page) => PAGE_PATHS[page] || '/';

/**
 * Parse a pathname into an app route descriptor.
 * @returns {{ page: string, blogSlug: string|null, stationId: string|null, stationSlug: string|null, notFound?: boolean }}
 */
export const parseRoute = (pathname = '/') => {
  const path = normalizePathname(pathname).toLowerCase();
  const base = { page: 'calendar', blogSlug: null, stationId: null, stationSlug: null };

  if (path === '/' || path === '/calendar' || path === '/index.html') return base;
  if (path === '/tides' || path === '/stations') return { ...base, page: 'tides' };
  if (path.startsWith('/tides/') || path.startsWith('/stations/')) {
    const slug = path.split('/')[2] || '';
    const stationId = stationIdFromSlug(slug);
    return { ...base, page: 'calendar', stationSlug: slug, stationId, notFound: !stationId };
  }
  if (path === '/blog') return { ...base, page: 'blog' };
  if (path.startsWith('/blog/')) {
    const slug = path.slice('/blog/'.length).split('/')[0];
    return { ...base, page: 'blog', blogSlug: slug || null };
  }
  if (path === '/about' || path === '/pricing' || path === '/subscribe') return { ...base, page: 'about' };
  if (path === '/account' || path === '/profile' || path === '/login' || path === '/reset-password') return { ...base, page: 'profile' };
  if (path === '/club') return { ...base, page: 'club' };
  if (path === '/admin') return { ...base, page: 'admin' };
  return { ...base, notFound: true };
};

export const isIndexablePage = (page) => ['calendar', 'tides', 'blog', 'about'].includes(page);
