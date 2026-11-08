import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeyCatchBlog,
  extractTableOfContents,
  insertTableOfContents,
  isRtlLanguage,
  sanitizeArticleHtml,
} from '../src/blog/heycatch.js';

const article = (overrides = {}) => ({
  id: 'a1',
  slug: 'best-tide-for-scrubbing',
  title: 'Best tide for scrubbing',
  meta_description: 'Which tide to pick.',
  published: '2026-10-14',
  updated: '2026-10-20',
  read_time: 6,
  keywords: ['tides'],
  featured_image: '',
  language: 'en',
  published_at: '2026-10-14T08:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
  hero_image_url: '',
  ...overrides,
});

const jsonResponse = (status, body, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
});

const quiet = { warn() {}, error() {} };

test('sanitiser keeps article structure and h2 ids, drops scripts and handlers', () => {
  const dirty = '<h2 id="intro" onclick="x()">Intro</h2><script>alert(1)</script><p>Hi <a href="javascript:evil()">x</a> <a href="https://e.com">ok</a></p><style>p{}</style><iframe src="x"></iframe><table><tr><th>a</th><td>b</td></tr></table><blockquote>q</blockquote><code>c</code>';
  const clean = sanitizeArticleHtml(dirty);
  assert.match(clean, /<h2 id="intro">Intro<\/h2>/);
  assert.doesNotMatch(clean, /onclick|<script|<style|<iframe|javascript:/);
  assert.match(clean, /<a href="https:\/\/e.com" rel="noopener noreferrer">ok<\/a>/);
  assert.match(clean, /<table>/);
  assert.match(clean, /<blockquote>q<\/blockquote><code>c<\/code>/);
});

test('table of contents lists h2 ids in order, skipping Key takeaways and faq', () => {
  const html = '<h2>Key takeaways</h2><ul><li>a</li></ul><h2 id="why-it-matters">Why it &amp; matters</h2><p>x</p><h2 id="how-to">How to</h2><h2 id="faq">FAQ</h2><h3>Q?</h3>';
  assert.deepEqual(extractTableOfContents(html), [
    { id: 'why-it-matters', text: 'Why it & matters' },
    { id: 'how-to', text: 'How to' },
  ]);
  const withToc = insertTableOfContents(html);
  const tocIndex = withToc.indexOf('<nav class="blog-toc"');
  assert.ok(tocIndex > withToc.indexOf('</ul>'), 'TOC sits after the Key takeaways list');
  assert.ok(tocIndex < withToc.indexOf('<h2 id="why-it-matters">'), 'TOC sits before the body');
  assert.match(withToc, /<a href="#why-it-matters">Why it &amp; matters<\/a>/);
  assert.doesNotMatch(withToc, /href="#faq"/);
});

test('table of contents goes above content when there are no takeaways, and is omitted with no ids', () => {
  const noTakeaways = '<p>Intro</p><h2 id="one">One</h2>';
  assert.ok(insertTableOfContents(noTakeaways).startsWith('<nav class="blog-toc"'));
  const noIds = '<h2>Key takeaways</h2><ul><li>a</li></ul><p>body</p>';
  assert.equal(insertTableOfContents(noIds), noIds);
});

test('rtl detection', () => {
  assert.equal(isRtlLanguage('ar'), true);
  assert.equal(isRtlLanguage('he-IL'), true);
  assert.equal(isRtlLanguage('en'), false);
});

test('list follows total across pages, sends the key as a query parameter only, and caches', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const offset = Number(new URL(url).searchParams.get('offset'));
    const page = offset === 0
      ? Array.from({ length: 50 }, (_, i) => article({ id: `p${i}`, slug: `post-${i}` }))
      : [article({ id: 'last', slug: 'post-50' })];
    return jsonResponse(200, { articles: page, total: 51, limit: 50, offset });
  };
  const blog = createHeyCatchBlog({ apiKey: 'hck_lv_test', fetch: fetchImpl, logger: quiet });
  const list = await blog.listArticles();
  assert.equal(list.length, 51);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('key'), 'hck_lv_test');
  assert.equal(calls[0].url.searchParams.get('limit'), '50');
  assert.equal(calls[1].url.searchParams.get('offset'), '50');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(list[0].source, 'heycatch');
  assert.equal(list[0].readTime, 6);
  assert.equal(list[0].excerpt, '');
  await blog.listArticles();
  assert.equal(calls.length, 2, 'second call served from cache');
});

test('article is sanitised, carries a table of contents, jsonLd and rtl direction; 404 yields null', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/articles/missing')) return jsonResponse(404, { error: 'not found' });
    return jsonResponse(200, {
      article: article({
        slug: 'arabic', language: 'ar',
        content_html: '<h2>Key takeaways</h2><ul><li>t</li></ul><h2 id="body">Body<script>x</script></h2><p>p</p><h2 id="faq">FAQ</h2>',
        jsonLd: { '@type': 'Article', headline: 'x' },
      }),
    });
  };
  const blog = createHeyCatchBlog({ apiKey: 'hck_lv_test', fetch: fetchImpl, logger: quiet });
  const a = await blog.getArticle('arabic');
  assert.equal(a.dir, 'rtl');
  assert.doesNotMatch(a.contentHtml, /<script/);
  assert.match(a.contentHtml, /blog-toc/);
  assert.deepEqual(a.tableOfContents, [{ id: 'body', text: 'Body' }]);
  assert.deepEqual(a.jsonLd, { '@type': 'Article', headline: 'x' });
  assert.equal(await blog.getArticle('missing'), null);
});

test('errors never throw: 401/403/timeouts give an empty list, stale content is kept after a failure', async () => {
  let mode = 'ok';
  const fetchImpl = async () => {
    if (mode === 'ok') return jsonResponse(200, { articles: [article()], total: 1, limit: 50, offset: 0 });
    if (mode === '403') return jsonResponse(403, { error: 'revoked' });
    throw new Error('network down');
  };
  const blog = createHeyCatchBlog({ apiKey: 'hck_lv_test', fetch: fetchImpl, logger: quiet, ttlMs: 1 });
  assert.equal((await blog.listArticles()).length, 1);
  await new Promise((r) => setTimeout(r, 5));
  mode = 'throw';
  assert.equal((await blog.listArticles()).length, 1, 'last good content survives a failure');
  const fresh = createHeyCatchBlog({ apiKey: 'hck_lv_test', fetch: async () => jsonResponse(401, { hint: 'sdk key' }), logger: quiet });
  assert.deepEqual(await fresh.listArticles(), []);
  const noKey = createHeyCatchBlog({ apiKey: '', logger: quiet });
  assert.deepEqual(await noKey.listArticles(), []);
  assert.equal(await noKey.getArticle('x'), null);
});

test('429 is retried once after Retry-After', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return jsonResponse(429, {}, { 'retry-after': '0' });
    return jsonResponse(200, { articles: [article()], total: 1, limit: 50, offset: 0 });
  };
  const blog = createHeyCatchBlog({ apiKey: 'hck_lv_test', fetch: fetchImpl, logger: quiet });
  assert.equal((await blog.listArticles()).length, 1);
  assert.equal(n, 2);
});
