# @heycatch/sdk

The official [HeyCatch](https://heycatch.ai) package for your app.

_(AI Agents: the setup guide is https://heycatch.ai/agents.md - you also need
the project key from the user's HeyCatch dashboard Install page.)_

## Sign-in and sign-out

Call `setIdentity` right after sign-in and `resetIdentity` on sign-out:

```ts
// After sign-in. A stable internal user id - never an email or a session
// token. Email and name, if you send them, go in the properties.
analytics.setIdentity(user.id, { email: user.email, name: user.name });

analytics.resetIdentity(); // on sign-out, so the next person starts anonymous
```

Skip `resetIdentity` and the device keeps the signed-out user's identity.
Everything the next person does before signing in is recorded as the
previous user. On a shared device - a work tablet, a kiosk, a family
computer - whoever uses it without signing in lands in the last signed-in
user's profile, which then describes several people. HeyCatch's per-user summaries and recommendations are written from
those profiles, so they end up describing someone who does not exist.

`setIdentity` with a different user than the one already signed in resets
on its own, so a direct account switch is safe. What it cannot know is that
someone signed out and left: only your sign-out handler knows that.

`resetIdentity` works in the browser and in React Native. On the server it
is a no-op, so isomorphic sign-out code still resolves there - but the call
has to run on the device to take effect.

## Privacy & consent options

`init()` accepts optional privacy/consent options alongside `projectKey`. Every
one is unset by default, and each takes effect only when you set it - so
`init({ projectKey })` on its own captures exactly as it always has:

```ts
analytics.init({
  projectKey: 'hck_pk_...',
  autocapture: false, // turn off automatic click/form-submit capture (pageviews and rage-clicks are captured separately, unaffected)
  maskAllText: true, // strip captured elements' text content
  maskAllElementAttributes: true, // strip captured elements' attributes
  propertyDenylist: ['some_property'], // drop specific properties from every event (HeyCatch's own attribution keys can't be denylisted)
  beforeSend: event => event, // runs on every event right before it's queued; return null to drop it (the SDK's own delivery and attribution keys are put back after it)
  persistence: 'localStorage', // where the distinct id + super properties are stored
  disablePersistence: false, // disable persistence entirely
  cookieExpirationDays: 365, // days before the persistence cookie expires
  optOutCapturingByDefault: true, // start with capturing off - see below
  respectDnt: true, // honor the browser's Do Not Track signal
  collectIp: false, // don't store the visitor's IP address or their location - see below
});
```

In the browser, setting `autocapture: false`, `maskAllText: true`, or
`maskAllElementAttributes: true` logs a one-line console notice naming what
it costs you in the dashboard. (The other entries ignore these options, so
they have nothing to warn about - see the platform notes below.)

### URL tokens are redacted

Some sign-in flows put the session in the page URL - `#access_token=…` and
`refresh_token=…` after an OAuth or magic-link callback, `?token=…` or
`?token_hash=…` in the link itself. The SDK replaces those values with
`[redacted]` in every event before it leaves the app: every string in an
event's properties is checked (the page URL, the referrer, the first URL
stored on a person, your own properties), for the parameter names
`access_token`, `refresh_token`, `token_hash` and `token`, and for anything
shaped like a JWT. The parameter name stays, so you can still see which page
it was. This is always on, has no option, and runs after your `beforeSend`,
so a hook cannot put a token back. It applies in the browser, in React
Native, and on the server alike.

### Visitor IP addresses

Set `collectIp: false` and no event stores the visitor's IP address, and no
country or city is derived from it. The address does not reach analytics
storage at all: the SDK blanks it on every event, after your `beforeSend`,
and HeyCatch's ingest drops it from the request too.

It is decided per visitor, so if your banner asks about IP or location you
can pass that answer straight through, and flip it when the visitor answers
later:

```ts
// `=== true`: a visitor who has not answered yet is not collected either
analytics.init({
  projectKey: 'hck_pk_...',
  collectIp: storedIpAnswer() === true,
});

// in your consent banner's handler
analytics.setIpCollection(allowsIp); // false stops collecting from the next event
```

Nothing is remembered between page loads or app launches: pass the
visitor's answer to `init()` every time. `setIpCollection()` before
`init()` logs a warning and does nothing. Unset, or `true`, collects the
IP as before. What `false` costs, and what it
does not promise:

- No country in your users table for new visitors, and no geo breakdowns
  for those events. A returning visitor keeps the country already stored on
  their profile from before.
- It applies from the SDK version that has it. A mobile app needs a new
  release, and app versions already on users' phones keep sending IPs.
- It has to be set on every surface you ship - your site and your app each
  have their own `init()`. One left out keeps sending IPs for that surface.
- What you can tell your users is "we don't store your IP address or a
  location derived from it" - for what they do after you turn it off; a
  country already on a returning visitor's profile stays, and location you
  send yourself in event or person properties is stored as you sent it.
  Not "your analytics is anonymous":
  the device id, and your own user id after `setIdentity`, stay on events.
  If your banner asks for consent to analytics as a whole, that is the
  [consent gate](#consent-gate) below, not this switch.

It works in the browser and in React Native. The server entry accepts
`collectIp` and `setIpCollection()` and ignores both: a server event's
request comes from your server, not a visitor.

### Consent gate

Set `optOutCapturingByDefault: true` to capture nothing until your visitor
agrees (behind a cookie banner, for example), then:

```ts
analytics.optInCapturing(); // consent granted - start capturing
analytics.optOutCapturing(); // consent withdrawn - stop again
```

While the gate is closed nothing is written to browser storage either, so no
identifier lands before consent - not just "no events sent".

A visitor who arrives through one of your HeyCatch short links lands on a URL
carrying `?utm_source=heycatch&utm_campaign=<letter>`. The SDK removes those
from the address bar a second after the first capture has read them - and
behind the gate, that first capture is the one `optInCapturing()` makes, so
the URL stays as it is until then and the visit is still attributed after
consent. Your own UTM links (any `utm_source` other than `heycatch`) are never
touched.

Call `init()` before either one. Neither is remembered if it runs first -
there is no transport yet to carry the decision - and both warn on the
console when that happens rather than failing quietly. `init()`'s own config
always wins, so a call made too early can never silently flip
`optOutCapturingByDefault` back on.

`optInCapturing` / `optOutCapturing` exist on every entry, so shared code
compiles everywhere. They are a real gate in the browser and in React
Native. On the server they are no-ops: a server event has no ambient visitor
to consent for - each one already names its `userId` and only happens
because your code called it.

The remaining options above are browser behaviour. React Native honours
`optOutCapturingByDefault` and `collectIp`; the rest describe a DOM and a
browser store it does not have. The server entry accepts the same `HeyCatchConfig` so one
object works under every import condition, and ignores them.

## Delivery options

By default the SDK batches captured events for a few seconds before sending
them, which is right for a single-page app. On a **multi-page site** - one
where each click is a full page load - a visitor can navigate away inside
that window, and iOS Safari in particular does not reliably let the batch out
as the page is torn down. The symptom is mobile pageviews missing from your
dashboard while desktop looks fine. Two options, both browser-only and both
unset by default:

```ts
analytics.init({
  projectKey: 'hck_pk_...',
  requestBatching: false, // send every event as it happens - the fix for multi-page sites
  flushIntervalMs: 250, // or keep batching but shrink the window (250-5000 ms; default 3000)
});
```

Set one or the other - with batching off the interval has nothing to act on.
The cost is one request per captured event, and autocapture is on by default:
the count follows how much a visitor clicks, not how many pages they open, so a
busy page sends more requests than a quiet one. `flushIntervalMs: 250` is the
middle ground - still batched, but a window short enough that a navigation
rarely lands inside it.

## Volume limits

A tracking call inside a render loop or an effect can send thousands of
events from one browser tab, and nothing about the app looks broken while it
does. So the SDK bounds what one session can send. None of this needs
configuring. The first three limits are the SDK's own, and each logs one
`[HeyCatch] …` console warning the first time it applies on a page, so a
runaway loop is visible where you are already looking:

- **5,000 events per session.** Past that, the rest of the session is
  dropped until a new one starts. Real sessions do not get near this - it is
  a backstop for a loop, not a quota for a busy user.
- **60 person-property updates a minute.** Call `setPersonProperties` when a
  property changes, not on every render. Updates past the budget are dropped;
  pageviews and other events in the same session still flow.
- **localhost is throttled, not filtered out.** A session on `localhost`,
  `127.0.0.1` or a private-network host sends its first 1,000 events like
  any other, then 60 a minute. A dev server hot-reloading for an hour cannot
  flood your dashboard, and your first local test still shows up on the
  Install page. Only this throttle is limited to local hosts: a production
  session meets the other three limits like any other, and a local session
  that reaches the cap is cut off like any other.
- **5 events a second, sustained** (browser only). Bursts of up to 50 pass;
  a steady stream faster than that is dropped. This one applies from the
  first event, on every host, and it belongs to the transport rather than
  the SDK, so there is no `[HeyCatch]` warning for it: the transport logs
  its own console error, under its own prefix, for each call it drops.

The session cap and the person-property budget apply in React Native too. The
localhost limit does not: a native event has no page host, so there is
nothing to tell a simulator from a phone. Server events are not counted at
all - each one is a call your own code made.

## React Native screen views

On Expo Router, `<HeyCatchProvider>` records a screen view each time the
route changes, named by the path (`/settings`, `/recipe/42`). The route's
search params ride along as properties, minus anything that could identify
a person or unlock an account: the `#` fragment, keys such as `email`,
`code`, `token`, `password`, `passcode`, `secret`, `session`, `otp`,
`pin`, `auth…` and anything containing `key`, plus any value that looks
like an email address. Attribution params such as
`utm_*` and ids are kept.

If your app already records screens itself with `analytics.trackScreen`,
turn the automatic ones off so each screen is not counted twice:

```tsx
<HeyCatchProvider trackScreens={false}>{children}</HeyCatchProvider>
```

## License

MIT
