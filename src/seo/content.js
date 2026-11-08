// Marketing/content constants shared by the server-side renderer and the React app.
// Keep copy here plain and in the owner's own vocabulary (grid, posts, dry out, flood).

export const PRICING = {
  subscriberPriceGbp: 5,
  // The subscription covers 365 days from purchase (see users.subscription_period_end).
  billingPeriod: 'year',
  priceLabel: '£5 a year',
  periodLine: 'Billed once a year: £5 covers 365 days from the day you subscribe. No monthly plan, no auto-renew surprises.',
  guaranteeLine: 'Cancel any time. The free 7-day official tide view stays free for everyone - subscribe only if you want the full year.',
  anchorLine: 'One morning on the grid costs a fraction of a club pressure scrub - and the calendar tells you which mornings those are.',
  paymentProcessor: 'Stripe',
};

export const CONTACT_EMAIL = 'hello@boatscrub.com';

// Product screenshot used in the hero, on the plans page and in the empty-calendar state.
export const PRODUCT_SHOT = {
  src: '/images/scrubbing-calendar-southampton-800.png',
  srcset: '/images/scrubbing-calendar-southampton-800.png 1248w, /images/scrubbing-calendar-southampton-1600.png 2496w',
  webpSrcset: '/images/scrubbing-calendar-southampton-800.webp 1248w, /images/scrubbing-calendar-southampton-1600.webp 2496w',
  sizes: '(max-width: 760px) 100vw, 720px',
  width: 1248,
  height: 1189,
  alt: 'The monthly tide calendar for Southampton with the 06:30-09:00 scrubbing mornings highlighted by a green marker, showing high and low water times and heights for every day of November',
};

// Who runs this. Fill in name/photo/story; the block renders the contact line regardless.
// TODO(owner): add your name, a photo URL and one paragraph on why you built this for your own boat.
export const OPERATOR = {
  name: '',
  photoUrl: '',
  story: '',
  email: CONTACT_EMAIL,
};

// Named user testimonials. Leave empty until real quotes are collected; nothing renders while empty.
// Shape: { quote: 'picked two grid mornings at X in March, both dry-outs worked', name: 'First name', boatOrClub: 'Boat or club', photoUrl: '' }
export const TESTIMONIALS = [];

// Club proof. Set `count` and/or list `clubs` once real clubs publish scrub windows here.
// Shape: { count: 2, clubs: [{ name: 'Example Sailing Club', url: '/account' }] }
export const CLUB_PROOF = { count: 0, clubs: [] };

export const CLUB_PITCH = 'Most clubs still ration their scrubbing posts by email and a diary in the clubhouse: a member asks for a morning, someone checks the book, and the slots that line up with a good tide go to whoever asked first. BoatScrubCalendar replaces that. The club publishes its scrub windows against the real tide, members see which mornings are free and book them, and the admin stops being the diary.';

// Comparison pages. Facts about competitors come from their public pages at the time of writing;
// keep the claims narrow and date them in the page footer.
export const COMPARISONS = {
  easytide: {
    slug: 'easytide',
    competitor: 'EasyTide',
    competitorFull: 'ADMIRALTY EasyTide (UK Hydrographic Office)',
    title: 'BoatScrubCalendar vs EasyTide',
    summary: 'EasyTide is the UK Hydrographic Office’s own tide lookup: official predictions for the next 7 days at any UK port, found through a map. BoatScrubCalendar uses the same Admiralty data and turns it into a planner: a monthly calendar with the mornings that suit a scrub on the grid flagged, plus club booking and reminders.',
    rows: [
      ['What it is', 'Raw 7-day tide lookup', 'Tide calendar and scrubbing-day planner'],
      ['Tide data', 'Official Admiralty predictions', 'Official Admiralty predictions for 7 days free; the full year for subscribers; harmonic estimates beyond that, marked as approximate'],
      ['Finds scrubbing mornings (HW 06:30-09:00)', 'No', 'Yes, flagged on every month'],
      ['Monthly calendar view', 'No, 7 days at a time', 'Yes'],
      ['Per-station pages you can bookmark', 'Map search', '608 pages, one per UK station'],
      ['Club scrub-window booking', 'No', 'Yes, for sailing clubs'],
      ['Maintenance reminders by email', 'No', 'Yes, with a free account'],
      ['Price', 'Free', 'Free for 7-day official tides and the planner; £5 a year for year-long official data and the PDF booklet'],
    ],
    faqs: [
      ['Is BoatScrubCalendar as accurate as EasyTide?', 'For the next 7 days both show the same official UK Hydrographic Office predictions. Beyond 7 days BoatScrubCalendar shows harmonic estimates clearly marked as approximate, and subscribers get official predictions for the whole year.'],
      ['Why not just use EasyTide?', 'If you only want tomorrow’s high water, EasyTide is fine. If you want to see at a glance which mornings this month and next will let you float on, dry out and scrub before the afternoon flood, that is what BoatScrubCalendar is for.'],
      ['Can I cancel?', 'Yes. The subscription is £5 a year, billed once. Cancel any time and the free 7-day view stays free.'],
    ],
  },
  neaps: {
    slug: 'neaps',
    competitor: 'Neaps',
    competitorFull: 'Neaps (tides, waves and weather day planner)',
    title: 'BoatScrubCalendar vs Neaps',
    summary: 'Neaps is a day planner for time on the water: tides, waves and weather for a chosen port, sold per port at £2.50 or £5 a month. BoatScrubCalendar is a maintenance planner: it finds the mornings when high water sits in the scrubbing window so you can dry out on the grid, and one £5-a-year subscription covers your home port and your club.',
    rows: [
      ['What it is', 'Day-on-the-water planner (tides, waves, weather)', 'Tide calendar and scrubbing-day planner'],
      ['Finds scrubbing mornings (HW 06:30-09:00)', 'No', 'Yes, flagged on every month'],
      ['Billing', 'Per port, per month (£2.50 for 7 days ahead, £5 for 30 days ahead, as published)', 'One subscription, £5 a year, home port and club included'],
      ['Free tier', 'Yes', 'Yes: 7-day official tides, monthly harmonic calendar and the scrubbing day finder'],
      ['Tide data', 'Admiralty and NOAA', 'UK Hydrographic Office Admiralty predictions'],
      ['Club scrub-window booking', 'No', 'Yes, for sailing clubs'],
      ['Maintenance log and reminders', 'No', 'Yes, with a free account'],
      ['Weather and waves', 'Yes', 'Short-range weather on the calendar; no wave model'],
    ],
    faqs: [
      ['Which is cheaper?', 'For one port, BoatScrubCalendar’s £5 a year is less than one month of Neaps’ 30-day tier at its published £5 per port per month. If you want wave forecasts, Neaps offers something BoatScrubCalendar does not.'],
      ['Is the tide data official?', 'The next 7 days are official UK Hydrographic Office predictions. Beyond that BoatScrubCalendar shows harmonic estimates marked as approximate; subscribers get official predictions for the whole year.'],
      ['Can I cancel?', 'Yes. The subscription is £5 a year, billed once. Cancel any time and the free 7-day view stays free.'],
    ],
  },
};
