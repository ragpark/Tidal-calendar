# HeyCatch - agent install guide

You are installing the [HeyCatch](https://heycatch.ai) SDK into the
user's app. You need the user's project key - a `hck_…` string included in
the prompt that pointed you here. Missing? Stop and tell the user: "Copy
the install prompt from your project's Install page in the HeyCatch
dashboard - it includes your project key."

Native app - Swift / SwiftUI, Kotlin / Android, Flutter, or a game engine
like Godot or Unity? This guide is not for you: do not install `@heycatch/sdk`, it is JavaScript only. Fetch
`/agents-native.md` from the same host you fetched this guide from and
follow it instead, with the same project key. React Native and Expo stay
here.

## 1. Install

Add `@heycatch/sdk` as a regular dependency, latest version - the
`latest` dist-tag, what a plain `npm install @heycatch/sdk` resolves.
Never install a prerelease. A `-dev.N` version is an internal build wired
to a non-production backend, so every event it sends silently misses the
user's dashboard; other prereleases (`-beta.N`, `-rc.N`, …) are
unsupported for customer installs. "Most recently published" is NOT
"latest" - the newest upload on npm is usually an internal `-dev.N`
build.

Already installed? This guide is also the update path: bump the package to
the latest version, then walk the remaining steps again and reconcile them
with what the app looks like NOW - the entry point may have moved, auth may
have appeared, new payment or subscription flows may deserve server events.
Fix drift; do not duplicate calls that are already correct.

## 2. Call `init` once, at the client entry point

```ts
import { analytics } from '@heycatch/sdk';

analytics.init({
  projectKey: 'hck_…', // the key from the prompt, inlined
  install: {
    framework: 'nextjs', // nextjs | vite-react | react | vue | svelte | astro | angular | react-native | web
    frameworkVersion: '<major>', // the detected major, e.g. 16
    agent: '<your-id>', // who YOU are - lovable, bolt, v0, replit, cursor, claude-code, codex, windsurf, or other
  },
});
```

The rules - each exists because breaking it loses events:

- Module scope, in the client entry file that runs on every page - not
  inside a component, hook, or handler. Nothing is queued before `init`:
  every SDK method silently no-ops until it runs, so `init` inside one
  route's component leaves every other landing page untracked.
- Static import only - no dynamic `import()`, no `next/dynamic`, no lazy
  chunk. The SDK acts the moment the bundle evaluates (it forwards reserved
  short-link paths before the app's router can 404); a lazy chunk delays or
  skips that.
- No `typeof window` guards, no once-flags - `init` is idempotent and a
  no-op during SSR. Guards are dead weight.
- Inline the key as a literal - it is publishable, no env-var plumbing. A
  bad key does not throw: it logs a `[HeyCatch]` console error and the app
  silently sends zero events.
- Do not pass `apiHost` - the default is correct.
- The site sets a Content-Security-Policy? The effective policy must allow
  `https://in.heycatch.ai` for both script loads (`script-src`, or whatever
  fallback governs scripts) and connections (`connect-src`, or its
  fallback). The SDK sends events to that host, and it also loads one small
  helper script from it at runtime - the module that stamps the session
  header onto backend requests. A policy blocking the connection loses
  every event; one blocking the helper silently breaks backend session
  attribution. No CSP? Nothing to do.
- Autocapture covers pageviews, clicks, and SPA route changes from `init`
  onward - do not hand-instrument UI events or add router and history
  listeners; they double-count. A business outcome (a completed sign-up, a
  finished onboarding step) is a separate call, `trackEvent` - see step 3
  for where to send it from.
- Omit any `install` field you cannot determine - absent becomes a
  countable `unknown`; a guessed value is wrong data forever.
- This project is the user's marketing site, landing page, or waitlist - the
  prompt says "website (landing)", or the codebase is plainly that and the
  app lives elsewhere? Add `site: 'landing'` at init, so its visits read
  apart from the app's. If the site and the app are one project, do not set
  it. Not sure? Leave it out - an untagged project still works.
- The app calls its own backend on ANOTHER host (an `api.example.com`
  split)? `tracingHosts: ['api.example.com']` at init makes those requests
  carry the session header that step 3's `request` option reads. Turn it on
  only if that backend calls `trackEvent` with `request` AND you can change
  that backend's CORS in the same change; otherwise leave it off - nothing
  breaks, its events stay tied to the user, just not to the session. Before
  turning it on, add `X-HeyCatch-Session-Id`, `X-HeyCatch-Window-Id` and
  `X-HeyCatch-Distinct-Id` to that host's `Access-Control-Allow-Headers`, on
  top of what it already allows - or spread `TRACING_HEADERS` from
  `@heycatch/sdk/server` into it. If the backend rejects them anyway, the
  SDK stops sending them to that host and logs a `[HeyCatch]` console
  warning; the rejected request itself is not retried. Same-origin API
  routes are covered automatically; do not list third-party APIs.
- The site is multi-page - each navigation is a full page load, no
  client-side router? Add `requestBatching: false` at init. Events are
  otherwise held for a few seconds and sent in a batch, and a visitor who
  navigates away inside that window takes the batch with them - iOS Safari
  drops it often enough that mobile pageviews vanish while desktop looks
  fine. A single-page app does not need this.
- The user asked not to store their visitors' IP addresses, or their
  consent banner asks about IP or location separately? Pass
  `collectIp: false` at init - or the visitor's stored answer,
  `collectIp: ipAnswer === true`, so a visitor who has not answered yet is
  not collected (unset means collect) - and call
  `analytics.setIpCollection(answer)` from the banner's handler when the
  visitor answers later. This only drops the
  IP: events, the device id and the user id still go out. A banner that
  gates analytics as a whole uses the consent gate instead -
  `optOutCapturingByDefault: true` at init, then
  `analytics.optInCapturing()` when the visitor agrees. Nothing is
  remembered between loads, so pass both to `init` on every load. Set it in
  every `init` the user ships - site and app each have their own - or the
  one left out keeps sending IPs. It costs the country and every geo
  breakdown for those events. Do not add it unasked.
- A tracking call inside a render loop or an effect loses events: the SDK
  caps a session at 5,000 events and drops person-property updates past 60
  a minute. Call `setPersonProperties` when a property changes, not on every
  render. A session on localhost is throttled after its first 1,000 events -
  slowed, not filtered out, so the install check still sees it - and every
  limit logs one `[HeyCatch]` console warning when it applies.

Placements that are easy to get wrong:

- Next.js >= 15.3 (either router): `instrumentation-client.ts` at the
  project root (or `src/`) - Next runs it on the client before hydration.
- Next.js < 15.3 App Router: the root layout is a Server Component - create
  a tiny `'use client'` component whose module calls `init`, and mount it
  once in the root layout.
- React Native / Expo: import both -
  `import { analytics, HeyCatchProvider } from '@heycatch/sdk';` - call
  `analytics.init` at the top of `app/_layout.tsx` (or the root `App.tsx`),
  then wrap the layout's children once in `<HeyCatchProvider>`: taps are
  captured, and on Expo Router screen views are automatic too. Install the Expo companions
  alongside the package:
  `npx expo install expo-file-system expo-application expo-device expo-localization`
  - without `expo-file-system`, identity silently resets on every launch.
    On any other navigator, screen views are yours to wire: call
    `analytics.trackScreen(name)` whenever the current screen changes,
    skipping repeats of the same name. Example for a react-navigation
    container (the ref API works outside screens; hooks do not):

  ```tsx
  <NavigationContainer
    ref={navigationRef}
    onStateChange={() => {
      const name = navigationRef.getCurrentRoute()?.name;
      if (name) analytics.trackScreen(name);
    }}
  >
  ```

  A different navigator has a different callback - find its route-change
  event and report the screen name from there; the principle is the whole
  contract.

- No build step at all: `<script type="module">` in `<head>` importing
  `https://esm.sh/@heycatch/sdk@<version>` - pin the exact version the
  `latest` dist-tag points at, resolved ONLY one of these two ways:
  `npm view @heycatch/sdk version`, or GET
  `https://registry.npmjs.org/@heycatch/sdk/latest` and read `version`
  from the JSON. Do not resolve it any other way - version lists and the
  npm website surface the most recently published version, which is
  usually an internal `-dev.N` prerelease (see step 1: its events never
  reach the dashboard). A version containing `-` is always wrong here.
  Replace `<version>` with the resolved number - the literal text
  `<version>` in the URL loads nothing. An unpinned URL re-resolves on
  every page load.

Server-only projects with no client surface are not supported - stop and
tell the user. There is no server-side autocapture; identity and business
events do have a server door (step 3), but the product needs client
traffic.

## 3. Identity and business events

One import everywhere - the package resolves the browser or server build
by environment.

Identity - who the user is - is set with `setIdentity`. Most often that is a
browser call right after sign-in, with `resetIdentity` on sign-out
(sign-out is a client action, so `resetIdentity` is browser-only). It also
works from the server, wherever your backend independently learns who the
user is - see the webhook example below. Autocapture already covers all UI
behaviour - never hand-instrument clicks or pageviews.

`trackEvent` reports a business outcome autocapture cannot see on its own -
a completed sign-up, a subscription, a finished onboarding step. Where you
call it from depends on who actually knows the outcome:

- **Your backend already knows** (plan changes, payments, subscriptions) -
  send it from the webhook or route handler that knows, not the browser.
  An adblocker can never eat a server event, and the value comes from your
  backend, not from what a client claims. There is no server-side
  autocapture: server events are only what you send.
- **Only the client knows** - a client-only sign-up on managed auth
  (Supabase Auth, Clerk, Firebase Auth, …) with no server route of yours in
  the path, a finished onboarding step, anything your backend never sees -
  call `trackEvent` from the browser right where the outcome happens. Do
  not invent a server hop just to report something the client already
  knows; see the worked example below.

Browser, after sign-in:

```ts
import { analytics } from '@heycatch/sdk';

// After sign-in. The ID is a stable internal user id - never an email or a
// session token. Email and name go in the PROPERTIES - that is what makes
// the dashboard show "Sam Rivers <sam.rivers@example.com>" instead of an opaque id.
analytics.setIdentity(
  user.id,
  { email: user.email, name: user.name, plan: user.plan },
  { signup_date: user.createdAt }, // set-ONCE: written only if absent
);

analytics.setPersonProperties({ plan: 'pro' }); // a property changes outside sign-in

analytics.resetIdentity(); // on sign-out, so the next visitor starts anonymous
```

Browser, when the client is the only one who knows the outcome (see the
SPA + managed-auth section below for a full worked example):

```ts
import { analytics } from '@heycatch/sdk';

// Right after the outcome the client just witnessed - no server route of
// yours is involved, so there is nothing to send from a webhook.
analytics.trackEvent('signup_completed');
```

Server, in a webhook or route handler:

```ts
import { analytics } from '@heycatch/sdk';

analytics.init({ projectKey: 'hck_…' }); // module scope, once per server bundle

// e.g. after a successful payment:
await analytics.setIdentity(user.id, { plan: 'pro' });
await analytics.trackEvent(
  'subscription_started',
  { plan: 'pro' },
  { userId: user.id },
);
```

Server calls send immediately and resolve once ingest answered - `await`
them so a serverless handler cannot freeze mid-send; they never throw.
Every server call needs the user id (there is no ambient person in a
server process) - the SAME stable id as the browser side, that is what
joins the two. Happening during the user's own request (an API route, a
server action)? Pass it too - `{ userId: user.id, request }` - and the
event joins their live session on the dashboard; a webhook has no request
to pass.

Use these exact person property keys when the app has the value - the
dashboard reads them: `email`, `name`, `plan`, and `signup_date`
(set-once). Anything else useful about the user passes through too, nested
values included.

Any auth provider works. Browser calls are no-ops before `init` and during
SSR. No auth and no payments? Skip this step.

### Client-only SPA on managed auth

The case with no server business event to send: a single-page app where
sign-in goes straight from the browser to a managed-auth provider
(Supabase Auth, Clerk, Firebase Auth, …) with no server route of yours in
that flow. There is no webhook to instrument, and autocapture alone would
label every event with the one URL the app ever shows - the client is the
only place that ever learns "this person signed up." Send the event from
there, right when the client learns it:

```ts
import { analytics } from '@heycatch/sdk';
import { supabase } from './supabase-client';

async function completeSignUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    return { error, pendingConfirmation: false };
  }

  // `data.session` is null when email confirmation is pending, and also
  // when Supabase returns an obfuscated existing account to avoid leaking
  // which emails are taken - only a session proves this is a real,
  // completed signup. Tell the caller so it doesn't show signup success
  // early; do not identify or track on `data.user` alone.
  if (!data.session) {
    return { error: null, pendingConfirmation: true };
  }

  // The client is the only side that knows this happened - identify first
  // so the event below attaches to the right person, not an anonymous one.
  analytics.setIdentity(data.user.id, { email });
  analytics.trackEvent('signup_completed');

  return { error: null, pendingConfirmation: false };
}
```

Email confirmation required? This function does nothing until the user
confirms - call the same `setIdentity` + `trackEvent('signup_completed')`
pair where you detect the confirmed session instead, e.g. the page handling
Supabase's confirmation redirect.

The same pattern covers a finished onboarding step or a plan chosen in a
client-only flow: `setIdentity` once you know who they are, `trackEvent`
at the moment the outcome happens. A one-page app that never leaves `/`
still gets a real funnel this way, even though autocapture only ever sees
a single pageview.

## 4. Short links

Web only - a native mobile app has no URL paths for a visitor to land on,
so skip this step for React Native.

Single-character paths (one lowercase letter or digit, `/a`-`/z` and
`/0`-`/9`) are reserved for HeyCatch channel attribution. Add one host
redirect rule: `/<char>` → `/?utm_source=heycatch&utm_campaign=<char>`
(302). The query IS the attribution - a bare redirect to `/` loses it; the
SDK cleans the params off the URL bar after landing. Next.js
(`next.config.*`; exclude any real single-character route from the regex):

```js
async redirects() {
  return [
    {
      source: '/:l([a-z0-9])',
      destination: '/?utm_source=heycatch&utm_campaign=:l',
      permanent: false,
    },
  ];
}
```

Other hosts: the equivalent rule in their redirect config. Cannot edit host
config? The SDK auto-forwards reserved paths the moment it loads - but ONLY
if unknown paths serve a page that loads the SDK (an SPA catch-all rewrite).
On hosts that answer unknown paths with a real 404 page (most static
hosting), that page never loads the SDK and every short link dead-ends -
the redirect rule is REQUIRED there, not optional. Host rules are always
preferred (they forward before any paint). After the app is live, verify:
request `/x` on the live site - a 404 status means short links are broken.
If you could not add the rule and `/x` 404s, tell the user short links
will not work until their hosting gets one.

## 5. Get it live, then hand over

Analytics only reach us from the user's **live** app. Editing the code is
not enough: on most AI builders the change sits in a preview until a human
presses Publish or Deploy, and the dashboard will keep reporting no events
until that happens. This is the single most common reason a correct install
looks broken, so do not skip it.

Deploy it yourself if you can (you run the deploy, or a push auto-deploys),
and say that you did.

If you cannot - the platform needs a Publish / Deploy click (Lovable, Bolt,
v0, Replit,.new), or the user owns the deploy - tell them in plain words,
assuming they do not know what a commit or a build is:

> "The analytics code is in your project, but it's only in the preview
> right now. Press Publish (or Deploy) so it goes out to your real site."

Then, either way:

> "Once it's live, open your app in a browser and click around for a few
> seconds. Then go to the Install page in your HeyCatch dashboard and press
> 'I've installed'."

That browser must be a REAL one. Headless and automated browsers -
Playwright, Puppeteer, Selenium, Lighthouse, anything that sets
`navigator.webdriver` or a bot user agent - are filtered as bot traffic:
their events are dropped silently, no error, no console output. Checking
the install by scripting a browser makes a working install read as broken.
Have the user click around, or do it yourself in an ordinary browser
window.

Do not send the user to a browser console or devtools. The SDK does log
`[HeyCatch] SDK v<version> (<stage>) initialized → <apiHost>` on success
and a `[HeyCatch] …` error when something is wrong - read it yourself if
you have a running app in front of you, but never make it the user's job.
On that success line the stage must read `(prod)` and the version must be
a plain `x.y.z` with no `-` suffix: `(dev)` or a `-dev.N` version means an
internal development build got installed and every event is going to the
wrong environment - redo step 1 with the latest stable version.
