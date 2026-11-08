# heycatch.ai website audit: BoatScrubCalendar

Source: https://app.heycatch.ai/audit/hck_pk_LN4a3dywhgOw9klTYq0McRJnWF_8r7Mh?surface=website

Extracted: 2026-11-08T17:27:55.306Z (headless Chromium, all six dimension drawers opened; detailed insights decoded from the page's embedded server payload and cross-checked against the rendered drawer text).

## Overall score

The page does not display a single overall score. The six dimension scores sum to **72.5/110**.

| Dimension | Score | Status |
|---|---|---|
| Positioning (D1) | 19/25 | Pass |
| Conversion clarity (D2) | 19/25 | Pass |
| Trust signals and social proofs (D3) | 6/20 | Fail |
| Paywall and pricing (D4) | 9/15 | Partial |
| SEO basics (D5) | 11.5/15 | Pass |
| Brief fit (FIT) | 8/10 | Pass |

## Audit document

### Site Audit: BoatScrubCalendar

**Audience scope:** United Kingdom, explicit: the site is en-GB, prices in GBP, the kicker reads “For UK boat owners”, and the footer notes UK local time and metres above Chart Datum. Scoring uses the UK competitor set from the research, not a US default.

**Gut reaction:** A genuinely well-written niche tool: the copy reads like a sailor who scrubs their own hull wrote it, and the SEO plumbing (schema, llms.txt, 608 station pages, robots) is better than most early-stage sites manage. But the page shows nothing of the product, never prints its own price, and no human anywhere stands behind it, so every buying decision hits a wall of anonymity.

#### Spotlight competitors

- Closest ICP match: **Neaps**, the only fetched rival doing calendar-based tide planning for the same UK freemium buyer.
- Most successful in category: **EasyTide (UKHO)**, the data source's own consumer tool and the name UK buyers already trust for tide times.

## Dimensions and findings

### Positioning (D1) — 19/25, Pass

**Key finding:** The hero names the audience, the category and the exact scrub window in the owner's own vocabulary, but the page never shows what the product looks like and no founder or operator stands behind it.

#### Key findings & insights

##### D1.1 Hook

- Score: 5/6
- Status: Pass
- Insight: The page opens with the kicker *“For UK boat owners”* and the H2 *“Boat scrubbing tide calendar for the UK”*, with a subhead that names the category, the audience and the concrete goal: *“highlights mornings when high water falls between 06:30 and 09:00, the classic window for drying out on a scrubbing grid or posts.”* That is a category-named, audience-named hook in the first words. The only deduction is that the H1 is the brand mark *“Scrubbing off Calendar”* rather than the descriptive line, so the biggest heading is a slogan, not the positioning.

##### D1.2 Pain match

- Score: 4/5
- Status: Pass
- Insight: The primary pain from the audience research (finding mornings with a high water around 06:30-09:00 to dry out on a grid) is addressed above the fold and again in the FAQ: *“Most owners want a high water around 06:30 to 09:00 so the boat can be put on the grid or posts at the top of the tide.”* The second audience pain, scarce and manually-rationed club slots, is touched only in one line (*“Sailing clubs can publish scrub windows and manage bookings”*) with no explanation of how the club tier fixes the email-diary problem the research documents.

##### D1.3 JTBD coverage

- Score: 3/4
- Status: Pass
- Insight: The functional job is covered almost word for word (*“float on, dry out and scrub before the afternoon flood”*), and the club administrator's job gets a dedicated tier. The emotional job, confidence that the chosen morning gives enough time on the grid, is only half-covered (*“Spring tides give a longer working window”*), and the personal and social jobs (the hands-on owner who knows their tides) are absent.

##### D1.4 Objection handling

- Score: 2/3
- Status: Partial
- Insight: The audience's accuracy objection is answered head-on in the FAQ: *“The first 7 days come directly from the UK Hydrographic Office Admiralty Tidal API. Beyond that the calendar shows harmonic estimates, clearly marked as approximate.”* The bigger objection in the research, vendor stability after tools that died without notice, is not addressed: there is no operator name, no about-the-team content and no way to see who runs this. The claim that paid plans carry no trial or money-back also goes unspoken.

##### D1.5 Desired-result visualization

- Score: 1/3
- Status: Fail
- Insight: None of the fetched pages shows a single product visual. There is no screenshot of the monthly calendar, the scrubbing day finder or a flagged morning; the only images on the site are a blog photo (with empty alt text) and an SVG social card. A visitor cannot see the after-state of a scrub day planned with this tool. This is the highest-leverage positioning gap on the page.

##### D1.6 Audience language

- Score: 4/4
- Status: Pass
- Insight: The copy uses the audience's exact vocabulary throughout: *“scrubbing grid or posts”*, *“dry out through the morning ebb”*, *“before the afternoon flood”*, *“antifouled”*, *“top of the tide”*, *“Chart Datum”*. None of the research's avoid-words (platform, seamless, solution, workflow) appear. This is the strongest sub-criterion on the page.

#### How competitors handle this

Neaps opens with *“Plan your day on your boat.”* and *“Tides, Waves, Weather.”*, friendly but generic for this buyer and with no maintenance angle anywhere. EasyTide (UKHO) opens with *“ADMIRALTY EasyTide”* and *“Find tide times for the next 7 days”*, pure data-lookup framing with no user pain at all. BoatScrubCalendar's hook is sharper than both because the 06:30-09:00 scrub-window language belongs to it alone; what it lacks versus EasyTide is institutional authority standing behind it, and versus Neaps a compact tagline.

### Conversion clarity (D2) — 19/25, Pass

**Key finding:** A visitor understands the product and audience within seconds and has a clear next step, but broken file:/// links inside the newest blog post and thin mobile signals cost points.

#### Key findings & insights

##### D2.1 5-second comprehension

- Score: 6/7
- Status: Pass
- Insight: The above-fold unit is kicker *“For UK boat owners”*, H2 *“Boat scrubbing tide calendar for the UK”*, subhead naming the product and window, and CTA *“Choose your tide station”*. Any visitor can answer what this is and who it is for; the missing seventh point is that without a product visual the hero describes rather than shows.

##### D2.2 CTA hierarchy

- Score: 4/5
- Status: Pass
- Insight: Primary CTA *“Choose your tide station”* is above the fold and the secondary *“Browse all 608 UK tide stations →”* gives the not-yet-ready visitor a lower-commitment path. The plans page offers *“Create a free account”*. One point off because the primary CTA leads to a picker rather than the account path, and the label does not preview the payoff of signing in (reminders, club booking).

##### D2.3 Visual hierarchy and scroll flow

- Score: 3/5
- Status: Partial
- Insight: From the markup the page reads in a sensible order (hero, how it works, popular stations, blog, FAQ) and sections are consistently built, but rendering cannot be verified from the fetched HTML, so the eye-flow, contrast and density claims are capped at the middle bracket.

##### D2.4 Friction and navigation

- Score: 3/4
- Status: Partial
- Insight: Top nav is clean and categorical (*Calendar · Tide stations · Blog · Plans · Account*), pricing is one click via Plans, and the guest tier needs no sign-in. The real defect: inside the September blog post the in-content links point to file:///C:/blog/… and file:///C:/tides paths, which are broken for every visitor. The /features and /customers probes are unlinked URLs we tried ourselves, not broken navigation.

##### D2.5 Mobile experience

- Score: 2/4
- Status: Partial
- Insight: The pages carry <meta name="viewport" content="width=device-width, initial-scale=1.0">, which is a positive markup signal, but there are no responsive srcset/sizes attributes on images and no real device pass is possible in this runtime, so the score is capped at the middle bracket and the six checks are not verifiable from the fetched HTML.

##### D2.B Scope honesty bonus

- Score: +1/2
- Status: (bonus, no status)
- Insight: The kicker *“For UK boat owners”* and en-GB/GBP scoping imply who the product is for without excluding anyone explicitly, which earns +1 but not the full +2.

#### How competitors handle this

Neaps runs a conventional funnel: nav with *“Pricing, FAQ, Sign in, Start free”* and pricing CTAs *“Get 7 days”* and *“Get 30 days”*. EasyTide has no labelled button at all in its fetched page, just the instruction *“Please use the map to search”*. BoatScrubCalendar's CTA hierarchy is clearer than EasyTide's and roughly on par with Neaps, though Neaps' CTA labels preview the offer (what you get) while this site's lead to a station picker.

### Trust signals and social proofs (D3) — 6/20, Fail

**Key finding:** There is no social proof of any kind: no testimonials, no founder or operator identity, no printed price-with-guarantee, and no third-party validation beyond the data-source attribution.

#### Key findings & insights

##### D3.1 Quantity proof

- Score: 2/4
- Status: Partial
- Insight: The site has a credible specific quantity, *“608 UK tide stations”*, surfaced with structure: country counts on the station index (*England (301)*, *Scotland (217)*, *Wales (64)*, *Northern Ireland (26)*) and a browsable grid. But it is a data-coverage count, not usage proof: no user, member or club counts appear anywhere, and no avatar or activity texture backs any number.

##### D3.2 Story proof

- Score: 1/5
- Status: Fail
- Insight: Not one testimonial, named user, photo of a customer, tweet screenshot or case study appears on any of the fetched pages. The blog author is the generic *“BoatScrubCalendar”* organization. For an audience that has watched tools die and revert to spreadsheets, the absence of any real human voice is the site's costliest trust failure.

##### D3.3 Founder-led trust

- Score: 0/4
- Status: Fail
- Insight: The only contact is a mailto to hello@boatscrub.com; there is no founder name, photo, LinkedIn or X link, no why-I-built-this story, and the nav label *“Plans”* points at the pricing page, so there is no about surface at all. Who operates this site is invisible, which directly feeds the audience's dominant objection.

##### D3.4 Transactional trust

- Score: 2/4
- Status: Partial
- Insight: The free path is genuinely card-free (guest use with no sign-in, *“Create a free account”* for the free signed-in tier), and the footer's accuracy disclaimer (*“not a substitute for official navigational publications”*) is honest. But the paid tier has no trial, no money-back language, no stated billing period, no checkout mark and no payment processor named; a subscriber cannot see what they are buying into.

##### D3.5 Third-party and recency signals

- Score: 1/3
- Status: Fail
- Insight: The strongest validation on the page is the data-source attribution: *“Tide data from the UK Hydrographic Office”* with Crown Copyright. That is data provenance, not third-party validation. There is no Product Hunt, no reviews, no press, no club endorsements, dated or otherwise.

#### How competitors handle this

Neaps leans on data-source attribution too (*“ADMIRALTY Crown copyright”* and NOAA) plus Stripe for payments, but shows no testimonials or counts in its fetched text either. EasyTide carries the strongest trust in the category through the Admiralty brand itself and a navigation disclaimer. So social proof is thin across the whole set, but Neaps still beats this site on transactional trust with a named payment provider and printed prices, and EasyTide beats it on institutional authority.

### Paywall and pricing (D4) — 9/15, Partial

**Key finding:** Pricing is well-organized and one click away, but the subscriber price of £5 exists only in schema markup and never in visible copy, and no checkout path is offered.

#### Key findings & insights

##### D4.1 Location and accessibility

- Score: 2/2
- Status: Pass
- Insight: Plans sits in the top nav and /about is a full plans page (*“Plans and pricing”*) with all tiers listed. The unlinked /pricing duplicate is not a defect since the founder never linked it.

##### D4.2 Tier and offer design

- Score: 3/4
- Status: Pass
- Insight: Four descriptively named groups: *“Guest users (free)”*, *“Signed-in users (free)”*, *“Subscribers”*, *“Sailing clubs”*, with clear tier-to-tier deltas (7 days official vs year-long official, booklet, reminders, club tools). The free path is graded and passes, since the competitor pool shows freemium as the category norm (Neaps' *“£0/ forever”* tier). One point off because the subscriber tier names no price and the club tier is email-only with no visible starting point.

##### D4.3 Paywall and conversion mechanics

- Score: 1/5
- Status: Fail
- Insight: The six checks: mechanical clarity partial (what is free vs paid is clear, but the price itself is never stated in user-facing copy, only in the JSON-LD SoftwareApplication offer of *“price":"5”* GBP); period uniformity fail (no visible price at all to normalize); pre-selected tier fail (no tier highlighted or recommended); most-popular badge fail (absent); discount mechanic fail (no annual option, promo or launch pricing mentioned); value anchoring fail (the audience research documents club scrubs costing £45-£295 a session, and the site never uses that comparison near a price).

##### D4.4 Pricing vs competitors

- Score: 3/4
- Status: Pass
- Insight: Model match is strong: freemium with a paid subscription matches the category pattern, and the deviation (no per-port billing vs Neaps' *“£2.50/ per month, per port”* and *“£5/ per month, per port”* 30-day tier) is coherent, with a single subscription covering a home port and clubs. Entry price band: £5 sits at the top of the demonstrated band (Neaps £2.50-£5, Force 4 paper planner £6.95) but is only positioned by implication since visible copy prints nothing.

##### D4.B Comparison-table bonus

- Score: +0/1
- Status: (bonus, no status)
- Insight: Not awarded: the site has more than two tier groups so no bonus applies, and no comparison table exists.

#### How competitors handle this

Neaps prints everything visibly: *“7 days - £2.50/ per month, per port”* and *“30 days - £5/ per month, per port”*, with a *“Most popular”* badge on the 7-day tier, Stripe payments and *“cancel any time”*. EasyTide shows no pricing in its fetched page at all, stopping at the 7-day view. BoatScrubCalendar sits between them: better structured than EasyTide's silence, but strictly behind Neaps, which is exactly the transparency bar a £5 subscription should meet.

### SEO basics (D5) — 11.5/15, Pass

**Key finding:** Titles, meta, sitemap, robots, schema and llms.txt are genuinely well done, with the gaps being no comparison pages, an empty alt attribute, and a homepage just over the 800 ms response band.

#### Key findings & insights

##### D5.1 Title and meta description

- Score: 3/3
- Status: Pass
- Insight: Titles are keyword-aware and distinct per page: home is *“Boat Scrubbing Tide Calendar UK | BoatScrubCalendar”*, the station index is *“UK Tide Stations A–Z: Tide Times for 608 Ports | BoatScrubCalendar”*, and each tier of pages carries its own meta description within length limits.

##### D5.2 Heading structure

- Score: 2/2
- Status: Pass
- Insight: Each page has one H1 (the brand mark *“Scrubbing off Calendar”*), descriptive H2 sections, and H3s used for FAQ questions and tier names, with no skipped levels visible in the fetched markup.

##### D5.3 Indexable content, /vs pages, internal linking

- Score: 2/4
- Status: Partial
- Insight: Indexable content earns full marks: all key copy is plain text, robots.txt is permissive including AI crawlers (GPTBot, ClaudeBot, PerplexityBot explicitly allowed), sitemap.xml is referenced and large, and an indexable surface beyond legal pages exists (blog, station index, datasets). The /vs and category check fails: no comparison pages exist targeting the spotlight competitors, even though the product has real differentiators to write about. Internal linking earns its half point: pricing, blog, station index and datasets are all one click from the footer and most from the nav.

##### D5.4 Page speed

- Score: 2/3
- Status: Pass
- Insight: Homepage: 991 ms response at 16 KB; the plans page 593 ms at 12 KB; the station index 125 ms at 61 KB. The homepage response crosses the 800 ms band boundary, so one point off; totals are well under the 1.5 MB band.

##### D5.5 AI-driven discovery and structured data

- Score: 2.5/3
- Status: Pass
- Insight: Open Graph and Twitter card metadata present on every page (0.5); Organization JSON-LD with logo and SearchAction (0.5); SoftwareApplication JSON-LD with a free offer and a £5 subscriber offer (0.5); FAQPage schema matching the visible FAQ (0.5); llms.txt at root with dated blog content (0.5). Alt text fails: the blog image carries alt="", and no product screenshots exist to describe.

#### How competitors handle this

No structured-data, robots or speed evidence was captured for either spotlight competitor (their pages were fetched as text extracts), so this is the one dimension where the comparison is limited: neither Neaps nor EasyTide visibly offers /vs pages or a blog in the fetched text, meaning this site's station-index and blog footprint is ahead of what the pool shows, and its remaining SEO gaps (no comparison pages, empty alt text) are fixable in-house without chasing anyone.

### Brief fit (FIT) — 8/10, Pass

**Key finding:** The site sells the product the brief describes, with the same audience, window, data model and tier structure, held back mainly by the subscriber price never appearing in visible copy and a broken-link defect inside the newest blog post.

#### What matches the brief

The hero subhead matches the brief's value prop verbatim on the live page: *“Find the best tide windows to scrub your boat in minutes… highlights mornings when high water falls between 06:30 and 09:00, the classic window for drying out on a scrubbing grid or posts.”*

The page body carries the brief's audience kicker *“For UK boat owners”* and the full 608-station claim with *“Browse all 608 UK tide stations →”* and country counts (England 301, Scotland 217, Wales 64, Northern Ireland 26).

The four tiers the brief describes are all present and worded as described: *“Guest users (free)”* with 7-day official UKHO events, *“Signed-in users (free)”* with maintenance log and reminders, *“Subscribers”* with year-long Admiralty predictions and the PDF booklet, and *“Sailing clubs”* routed through hello@boatscrub.com.

The footer carries the brief's trust spine verbatim: *“Tide data from the UK Hydrographic Office”*, *“© Crown Copyright”* and *“Predictions beyond 7 days are estimates and are not a substitute for official navigational publications.”*

#### Gaps vs the brief

- The brief's £5 subscriber price (schema.org Offer, 5 GBP) never appears in any visible copy on the plans page; a visitor sees tier names but no number.
- The billing period for the subscriber tier is stated nowhere, in either visible copy or the Offer block, so the £5 cannot be read as monthly, annual or one-off.
- The plans page offers only “Create a free account”; there is no subscribe or checkout path from the page that describes the paid tier.
- The September blog post's in-content links point to file:///C:/blog/… and file:///C:/tides instead of real site paths, so they are broken for every visitor.
- The club tier is described but no club names, counts or partner proof appear anywhere, so the brief's sailing-club story is asserted, not evidenced.
- No trial, money-back or card-required language accompanies the subscriber tier, matching the brief's own note that none appears.

## Prioritised action plan

Groups present on the page: "Quick wins", "Do this quarter". No "Bigger bets" group is rendered for this audit.

### Quick wins

#### Print the £5 subscriber price and billing period on the plans page

- Where: boatscrubcalendar.com/about, Subscribers section
- Why (FIT, D4.3, D4.2): The £5 charge exists in the site's own schema markup but never in visible copy, so a visitor cannot see what the paid tier costs or whether it is monthly or annual; competitor Neaps prints £2.50 and £5 per month visibly.
- What: Add the price to the Subscribers section heading, e.g. “Subscribers - £5/month”, with a line stating the billing period and, if annual exists, the annual saving next to it.
- Hypothesis: If the subscriber price and billing period are printed visibly, more visitors will evaluate the paid tier instead of stopping at the free account.
- Target metric: free-account to paid-subscriber conversion rate, measured over 60 days
- Effort: Low
- Referenced findings: FIT, D4.3, D4.2

#### Add a subscribe path to the plans page

- Where: boatscrubcalendar.com/about, under the Subscribers section and the bottom “Create a free account” CTA
- Why (FIT, D4.3): The only CTA on the pricing page is “Create a free account”, so the paid tier is described with no way to buy it, and Neaps shows a checkout CTA per tier (“Get 7 days”, “Get 30 days”).
- What: Add a “Subscribe - £5/month” button under the Subscribers tier that leads to a checkout or an upgrade flow inside the account page.
- Hypothesis: If a subscribe button sits on the plans page, visitors who decide on the spot will complete instead of dropping at the account step.
- Target metric: click-through rate on the subscribe button from /about
- Effort: Medium
- Referenced findings: FIT, D4.3

#### Fix the file:/// blog links

- Where: blog/batten-down-autumn-boat-maintenance-for-the-winter-ahead, in-content links
- Why (FIT, D2.4): The newest blog post links to file:///C:/blog/… and file:///C:/tides, which are broken for every visitor, and the post is the blog's September feature.
- What: Replace those hrefs with /blog/know-your-waters-hull-fouling-around-the-uk-and-when-to-scrub, /tides and /, matching the links already used in the footer.
- Hypothesis: If the in-content links point at real pages, blog readers will follow them into the product instead of hitting dead ends.
- Target metric: clicks from blog posts into the station index and calendar, measured over 4 weeks
- Effort: Low
- Referenced findings: FIT, D2.4

#### Add a product screenshot to the hero

- Where: homepage hero, beside or under the H2 and subhead
- Why (D1.5, D2.1, D5.5): No page on the site shows a single product visual; the visitor reads a description of the calendar and scrub finder without ever seeing the flagged mornings or the monthly view.
- What: Add a screenshot of the monthly calendar with a scrubbing morning visibly flagged, with descriptive alt text such as “The monthly tide calendar for a UK port with the 06:30-09:00 scrubbing mornings highlighted”.
- Hypothesis: If the hero shows the flagged calendar, visitors will grasp the product faster and click the station CTA more often.
- Target metric: hero CTA click-through rate on the homepage
- Effort: Low
- Referenced findings: D1.5, D2.1, D5.5

#### Collect and publish three named user testimonials

- Where: homepage, new section above the FAQ; mirrored on /about
- Why (D3.2): There is not one testimonial, named user or customer photo anywhere on the site, which is the costliest trust gap for an audience that has watched tools die and reverted to spreadsheets.
- What: Ask three boat owners who have used the scrub finder for a one-line quote with first name, boat or club, and a specific outcome (“picked two grid mornings at X in March, both dry-outs worked”). Publish with a photo if they agree.
- Hypothesis: If real named owners appear on the page, free-account signups from the homepage will rise.
- Target metric: homepage to free-account conversion rate, measured over 4 weeks
- Effort: Low
- Referenced findings: D3.2

#### Add a founder or operator block with a real name and contact

- Where: new short “Who runs this” block on /about, linked from the footer
- Why (D3.3, D1.4): The only contact is hello@boatscrub.com and no page names the operator, which directly feeds the audience's dominant objection, distrust of tools that disappeared without notice.
- What: Add a short block: name, one photo, why you built the scrub calendar for your own boat, and the contact email. One paragraph is enough at this stage.
- Hypothesis: If a named human stands behind the product, visitor trust questions in feedback will decrease and account signups will rise.
- Target metric: homepage to free-account conversion rate on the same 4-week window as the testimonial test
- Effort: Low
- Referenced findings: D3.3, D1.4

#### Add subscriber purchase guarantees and a no-card line

- Where: /about, Subscribers section and the subscribe CTA
- Why (D3.4, D1.4): The paid tier has no trial, no money-back language and no cancellation promise, and the free 7-day official window already gives visitors a taste they could be reminded of.
- What: Add one line under the subscribe button: “Cancel any time. The free 7-day official tide view stays free for everyone - subscribe only if you want the full year.” Name the payment processor when checkout exists.
- Hypothesis: If the cancellation and free-tier framing sit next to the subscribe CTA, fewer subscribers will hesitate at checkout.
- Target metric: subscribe-button click-to-purchase completion rate
- Effort: Low
- Referenced findings: D3.4, D1.4

#### Frame the £5 against what a scrub or lift-out costs

- Where: /about, directly under the subscriber price once it is printed
- Why (D4.3): The audience research shows club scrubs and grid sessions costing real money (a pressure scrub at Aldeburgh at £69.50, sessions at £45), and the site never uses that comparison even though a few scrubs a year is exactly the user's rhythm.
- What: Add one line: “One morning on the grid costs a fraction of a club pressure scrub - and the calendar tells you which mornings those are.”
- Hypothesis: If the price is anchored against the cost of paid scrubs, subscriber conversion will rise vs the unanchored price.
- Target metric: free-account to subscriber conversion rate, measured over 8 weeks
- Effort: Low
- Referenced findings: D4.3

#### Add descriptive alt text to blog imagery

- Where: blog post images, starting with the September post's photo
- Why (D5.5): The one image on the site carries alt="", so search engines and AI assistants get no description of it and the site loses an accessibility point for free.
- What: Give each blog image an alt attribute describing what it shows, e.g. “A hauled-out yacht being scrubbed on a UK drying grid in autumn”.
- Hypothesis: If images carry descriptive alt text, image-search impressions on maintenance terms will rise.
- Target metric: image-search impressions on blog terms, over 60 days
- Effort: Low
- Referenced findings: D5.5

### Do this quarter

#### Publish club proof: named clubs and a club count

- Where: /about, Sailing clubs section, and the homepage club line
- Why (D3.1, FIT, D3.2): The club tier is described in detail but no club name, count or pilot appears anywhere, so the secondary segment has to take the offer on faith.
- What: List the first clubs publishing scrub windows with a link to their booking surface, or state a count (“Two clubs now publish their scrub windows here”), and add a one-paragraph pitch that names the email-diary problem the tool replaces.
- Hypothesis: If named clubs or a count appear, club-enquiry emails through the mailto will increase.
- Target metric: club-enquiry emails received via the mailto link, counted monthly
- Effort: Medium
- Referenced findings: D3.1, FIT, D3.2

#### Build two comparison pages against the spotlight competitors

- Where: new pages /vs/easytide and /vs/neaps, linked from the footer and the FAQ
- Why (D5.3, D1.4): No comparison pages exist anywhere on the site even though it has real differentiators (scrub-window flagging, club booking, 608 per-station pages) that no fetched competitor offers, and owners searching these tool names are high-intent.
- What: Write one page each: “BoatScrubCalendar vs EasyTide” (planner vs raw 7-day lookup) and “BoatScrubCalendar vs Neaps” (scrub planning vs day planning, one subscription vs per-port billing), each with a comparison table and the accuracy and cancellation answers in FAQ schema.
- Hypothesis: If the pages are indexed, organic traffic to them will convert into free accounts at a higher rate than general blog traffic.
- Target metric: organic visits to the /vs pages converting to free accounts, over 60 days
- Effort: Medium
- Referenced findings: D5.3, D1.4

#### Verify and harden the mobile layout

- Where: homepage and /about at a 375px viewport
- Why (D2.5): The pages declare a viewport and the markup is simple, but there are no responsive image attributes and no real mobile pass has been documented; this audience reads club pages and forums on phones at the pontoon.
- What: Open both pages at 375x812, check the hero wraps cleanly and the CTA is reachable within one screen, then add srcset/sizes to any product imagery and confirm nav tap targets.
- Hypothesis: If the hero and CTA hold at 375px, mobile visitor conversion will rise vs the current unverified layout.
- Target metric: mobile share of free-account signups, measured over 4 weeks after the pass
- Effort: Medium
- Referenced findings: D2.5

