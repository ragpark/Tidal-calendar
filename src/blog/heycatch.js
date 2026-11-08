// HeyCatch blog client (server side). Follows https://heycatch.ai/blog-agents.md:
// the publishable `hck_lv_…` key travels as the `key` query parameter only, articles are
// read live from the API (never copied into the database), responses are cached for a few
// minutes with last-good fallback, errors never throw, and `content_html` is sanitised
// before anything renders it.

import sanitizeHtml from 'sanitize-html';
import { applyArticleOverrides } from './overrides.js';

export const HEYCATCH_API_BASE = 'https://api.heycatch.ai/v1';
const PAGE_SIZE = 50;
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

const SANITIZE_OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'blockquote', 'a', 'strong', 'b', 'em', 'i', 'code', 'pre', 'br', 'hr', 'sup', 'sub', 'span', 'img', 'figure', 'figcaption', 'caption',
  ],
  allowedAttributes: {
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    a: ['href', 'title', 'rel', 'target'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    code: ['class'],
    pre: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      const external = /^https?:\/\//i.test(href);
      return {
        tagName,
        attribs: external ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
      };
    },
  },
};

export const sanitizeArticleHtml = (html = '') => sanitizeHtml(String(html), SANITIZE_OPTIONS);

const decodeEntities = (text = '') => text
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

const stripTags = (html = '') => decodeEntities(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Read every `<h2 id="…">` except `id="faq"` from sanitised HTML, in order.
 * The Key takeaways heading carries no id and is therefore never listed.
 */
export const extractTableOfContents = (sanitisedHtml = '') => {
  const entries = [];
  const re = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi;
  let match;
  while ((match = re.exec(sanitisedHtml)) !== null) {
    const idMatch = /\bid="([^"]+)"/i.exec(match[1]);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (id === 'faq') continue;
    const text = stripTags(match[2]);
    if (text) entries.push({ id, text });
  }
  return entries;
};

export const renderTableOfContents = (entries = []) => {
  if (!entries.length) return '';
  return `<nav class="blog-toc" aria-labelledby="blog-toc-heading"><h2 id="blog-toc-heading">Table of contents</h2><ol>${entries
    .map((e) => `<li><a href="#${escapeHtml(e.id)}">${escapeHtml(e.text)}</a></li>`)
    .join('')}</ol></nav>`;
};

/**
 * Insert the table of contents right after the Key takeaways list when the article has one,
 * otherwise above the content. Returns the HTML with the TOC embedded.
 */
export const insertTableOfContents = (sanitisedHtml = '') => {
  const toc = renderTableOfContents(extractTableOfContents(sanitisedHtml));
  if (!toc) return sanitisedHtml;
  const takeaways = /<h2\b[^>]*>\s*Key takeaways\s*<\/h2>/i.exec(sanitisedHtml);
  if (takeaways) {
    const after = sanitisedHtml.slice(takeaways.index + takeaways[0].length);
    const listEnd = /<\/(ul|ol)>/i.exec(after);
    if (listEnd) {
      const cut = takeaways.index + takeaways[0].length + listEnd.index + listEnd[0].length;
      return `${sanitisedHtml.slice(0, cut)}\n${toc}\n${sanitisedHtml.slice(cut)}`;
    }
  }
  return `${toc}\n${sanitisedHtml}`;
};

export const isRtlLanguage = (language = '') => RTL_LANGUAGES.has(String(language || '').toLowerCase().split('-')[0]);

const createTtlCache = () => {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) return undefined; // keep stale entries for last-good fallback
      return hit.value;
    },
    stale(key) { return store.get(key)?.value; },
    set(key, value, ttlMs) { store.set(key, { value, expires: Date.now() + ttlMs }); return value; },
  };
};

const normaliseSummary = (a) => ({
  id: a.id,
  slug: a.slug,
  title: a.title,
  metaDescription: a.meta_description || '',
  excerpt: '', // never shown: meta_description goes into meta tags only
  publishedAt: a.published_at || a.published || null,
  updatedAt: a.updated_at || a.updated || a.published_at || null,
  publishedDate: a.published || (a.published_at ? String(a.published_at).slice(0, 10) : null),
  updatedDate: a.updated || (a.updated_at ? String(a.updated_at).slice(0, 10) : null),
  readTime: Number.isFinite(Number(a.read_time)) ? Number(a.read_time) : null,
  keywords: Array.isArray(a.keywords) ? a.keywords : [],
  language: a.language || 'en',
  heroImageUrl: a.hero_image_url || a.featured_image || '',
  coverImageUrl: a.hero_image_url || a.featured_image || '',
  coverImageAlt: '',
  authorEmail: 'HeyCatch',
  source: 'heycatch',
});

/**
 * @param {object} opts
 * @param {string} opts.apiKey      the hck_lv_ publishable blog key (HEYCATCH_API_KEY)
 * @param {string} [opts.baseUrl]   API base, default https://api.heycatch.ai/v1
 * @param {Function} [opts.fetch]   fetch implementation (tests)
 * @param {number} [opts.ttlMs]     cache lifetime, 60-300 s per the guide (default 120 s)
 */
export const createHeyCatchBlog = ({ apiKey, baseUrl = HEYCATCH_API_BASE, fetch: fetchImpl = globalThis.fetch, ttlMs = 120 * 1000, logger = console, timeoutMs = 8000 } = {}) => {
  const cache = createTtlCache();
  const enabled = Boolean(apiKey);
  const base = String(baseUrl).replace(/\/+$/, '');
  let warnedMissingKey = false;

  const request = async (path, params = {}, { retried = false } = {}) => {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('key', apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url.toString(), { method: 'GET', headers: { Accept: 'application/json' }, signal: controller?.signal });
      if (res.status === 429 && !retried) {
        const waitSeconds = Number.parseInt(res.headers?.get?.('retry-after') || '1', 10);
        await new Promise((r) => setTimeout(r, Math.min(Math.max(waitSeconds, 1), 30) * 1000));
        return request(path, params, { retried: true });
      }
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const noteError = (what, status, body) => {
    if (status === 401) logger.warn(`HeyCatch blog: ${what} rejected (401). Check HEYCATCH_API_KEY is the hck_lv_ blog key.${body?.hint ? ` Hint: ${body.hint}` : ''}`);
    else if (status === 403) logger.warn(`HeyCatch blog: ${what} forbidden (403): the key was revoked or the HeyCatch project was deleted. Rendering the empty state.`);
    else if (status !== 404) logger.warn(`HeyCatch blog: ${what} failed (${status}).`);
  };

  /** All published articles, newest first, following `total` across pages. Never throws. */
  const listArticles = async () => {
    if (!enabled) {
      if (!warnedMissingKey) { logger.warn('HeyCatch blog: HEYCATCH_API_KEY is not set; the blog shows local posts only.'); warnedMissingKey = true; }
      return [];
    }
    const cached = cache.get('list');
    if (cached) return cached;
    try {
      const articles = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const { status, body } = await request('/articles', { limit: PAGE_SIZE, offset });
        if (status !== 200 || !body || !Array.isArray(body.articles)) {
          noteError('article list', status, body);
          throw new Error(`list status ${status}`);
        }
        articles.push(...body.articles.map(normaliseSummary));
        total = Number.isFinite(Number(body.total)) ? Number(body.total) : articles.length;
        if (body.articles.length === 0) break;
        offset += PAGE_SIZE;
      }
      return cache.set('list', articles, ttlMs);
    } catch (err) {
      if (err?.name !== 'Error') logger.warn('HeyCatch blog: article list unavailable:', err.message);
      const stale = cache.stale('list');
      if (stale) return stale;
      return cache.set('list', [], Math.min(ttlMs, 60 * 1000));
    }
  };

  /** One article with sanitised `contentHtml` (table of contents embedded). Null when missing. Never throws. */
  const getArticle = async (slug) => {
    if (!enabled || !slug) return null;
    const key = `article:${slug}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const { status, body } = await request(`/articles/${encodeURIComponent(slug)}`);
      if (status === 404) return cache.set(key, null, ttlMs);
      if (status !== 200 || !body?.article) {
        noteError(`article ${slug}`, status, body);
        throw new Error(`article status ${status}`);
      }
      const a = body.article;
      const sanitised = sanitizeArticleHtml(applyArticleOverrides(a.slug || slug, a.content_html || ''));
      const article = {
        ...normaliseSummary(a),
        contentHtml: insertTableOfContents(sanitised),
        tableOfContents: extractTableOfContents(sanitised),
        jsonLd: a.jsonLd && typeof a.jsonLd === 'object' && Object.keys(a.jsonLd).length ? a.jsonLd : null,
        dir: isRtlLanguage(a.language) ? 'rtl' : null,
      };
      return cache.set(key, article, ttlMs);
    } catch (err) {
      if (err?.name !== 'Error') logger.warn(`HeyCatch blog: article ${slug} unavailable:`, err.message);
      const stale = cache.stale(key);
      return stale === undefined ? null : stale;
    }
  };

  /** `total` from a limit=1 list request, for hiding the nav link while empty. */
  const countArticles = async () => (await listArticles()).length;

  return { enabled, listArticles, getArticle, countArticles };
};
