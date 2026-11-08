// Editorial overrides applied to HeyCatch article HTML before it is sanitised and rendered.
//
// HeyCatch articles are read live and the blog key is read-only, so wording changes that
// cannot (yet) be made in the HeyCatch dashboard live here, keyed by slug. Each rule is
// [find, replace]; `find` may be a string (replaced everywhere) or a RegExp. Keep the list
// short and remove a slug's rules once the article has been corrected at source.

export const ARTICLE_OVERRIDES = {
  'tide-times-hayling-scrub-launch-planning': [
    [
      'Use the UKHO EasyTide Chichester Harbour entrance station for Hayling, not Portsmouth, whose predictions can be tens of minutes out.',
      'Use the Chichester Harbour entrance station in the BoatScrubCalendar tidal calendar for Hayling, not Portsmouth, whose predictions can be tens of minutes out.',
    ],
    [
      /The quickest official answer comes from the UKHO's own <a href="https:\/\/easytide\.admiralty\.co\.uk\/?"[^>]*>EasyTide predictions for Hayling Island<\/a>, which are free and based on Admiralty tidal harmonic constants\./,
      'The quickest answer comes from the <a href="/tides">BoatScrubCalendar tidal calendar</a>, which is free to use and derived from official UKHO Admiralty tidal data.',
    ],
    [
      /The Admiralty publishes predictions covering the full year, so you can pencil scrub days months ahead \(<a href="https:\/\/easytide\.admiralty\.co\.uk\/?"[^>]*>EasyTide<\/a>\)\./,
      'The BoatScrubCalendar tidal calendar, derived from UKHO Admiralty predictions, covers the full year for subscribers, so you can pencil scrub days months ahead (<a href="/about">see plans</a>).',
    ],
    [
      'EasyTide gives you the official predictions but makes you click day by day.',
      'A day-by-day tide lookup gives you the official predictions but makes you click through one date at a time.',
    ],
    // Catch-alls in case the article is regenerated with the same references in new sentences.
    [/<a href="https:\/\/easytide\.admiralty\.co\.uk\/?"[^>]*>[^<]*<\/a>/g, '<a href="/tides">BoatScrubCalendar tidal calendar</a>'],
    [/UKHO EasyTide/g, 'BoatScrubCalendar tidal calendar'],
    [/\bEasyTide\b/g, 'the BoatScrubCalendar tidal calendar'],
  ],
};

export const applyArticleOverrides = (slug, html = '') => {
  const rules = ARTICLE_OVERRIDES[slug];
  if (!rules || !html) return html;
  let out = String(html);
  for (const [find, replace] of rules) {
    if (find instanceof RegExp) out = out.replace(find, replace);
    else out = out.split(find).join(replace);
  }
  return out;
};
