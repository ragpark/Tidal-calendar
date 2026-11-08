# HeyCatch - native install guide (Swift, Kotlin, Flutter)

You are installing [HeyCatch](https://heycatch.ai) analytics into a native
app. You need the user's project key - a `hck_pk_…` string included in the
prompt that pointed you here. Missing? Stop and tell the user: "Copy the
install prompt from your project's Install page in the HeyCatch dashboard -
it includes your project key."

A native app does not use `@heycatch/sdk` - that package is JavaScript
only. HeyCatch's ingest speaks the PostHog protocol, so a native app
installs PostHog's own open-source SDK and points it at HeyCatch. React
Native and Expo are not covered here: they use `@heycatch/sdk`, see
`/agents.md` on this same host.

A game engine or another native stack with no PostHog SDK - Godot, Unity,
C++? Skip the stack sections and go to "Any other stack" at the bottom.

Two values are HeyCatch's, the same for every app on this environment. They
are a write-only ingest token and its host, safe to ship inside an app
binary - not secrets:

- Token: `phc_oiDt6uXiBiEA2aT43SMzMAFE9D4gMVkRP3BtvYRsmHqe`
- Host: `https://in.heycatch.ai`

Use both exactly as written. Do not create a PostHog account or use a key
from posthog.com - events sent anywhere else never reach the user's
dashboard.

Every stack below does the same four things:

1. Add the package.
2. `setup` with the token and host above - once, at app start.
3. Right after setup, `register` the project key as `heycatch_project_key`
   and `group` the app under `project` with the same key. Without these
   two calls events reach HeyCatch but belong to no project, and the
   dashboard stays empty.
4. `identify` on sign-in, screen views, `capture` for business outcomes
   (a completed sign-up, a purchase, a finished onboarding step).

`reset()` on sign-out wipes the registered key and the group along with the
user. Re-run `register` + `group` immediately after every `reset()` - the
snippets below do.

The app already calls PostHog's setup for its own PostHog project? Stop
here and go to "Already running PostHog" at the bottom - a second setup
would take over the app's own analytics.

Not on native: pageviews and short links are web-only, skip them. App store
numbers (downloads, revenue) stay in App Store Connect / Google Play
Console.

## Swift (iOS)

Add `posthog-ios` with Swift Package Manager: package URL
`https://github.com/PostHog/posthog-ios.git`, dependency rule "Up to Next
Major Version" from `3.0.0`. CocoaPods instead: `pod "PostHog", "~> 3.0"`.

Set up once at launch - `init()` of the SwiftUI `App`, or
`application(_:didFinishLaunchingWithOptions:)` for UIKit:

```swift
import PostHog

let heycatchProjectKey = "hck_pk_…" // the key from the prompt, inlined

let config = PostHogConfig(apiKey: "phc_oiDt6uXiBiEA2aT43SMzMAFE9D4gMVkRP3BtvYRsmHqe", host: "https://in.heycatch.ai")
PostHogSDK.shared.setup(config)
PostHogSDK.shared.register(["heycatch_project_key": heycatchProjectKey])
PostHogSDK.shared.group(type: "project", key: heycatchProjectKey)
```

Identity, screens and events:

```swift
// After sign-in. A stable internal user id - never an email or a token.
PostHogSDK.shared.identify(user.id, userProperties: ["email": user.email, "name": user.name])

PostHogSDK.shared.screen("Paywall") // a screen appeared
PostHogSDK.shared.capture("signup_completed") // a business outcome

// On sign-out:
PostHogSDK.shared.reset()
PostHogSDK.shared.register(["heycatch_project_key": heycatchProjectKey])
PostHogSDK.shared.group(type: "project", key: heycatchProjectKey)
```

UIKit view controllers are captured as screens automatically. SwiftUI views
are not - add `.postHogScreenView("Paywall")` to each top-level view, or
call `screen` from `.onAppear`.

## Kotlin (Android)

Add `posthog-android` (the latest `3.x` release) to the app module's
`build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.posthog:posthog-android:3.+")
}
```

Set up once in `Application.onCreate`. No `Application` subclass yet?
Create one and register it in `AndroidManifest.xml` with
`android:name=".App"` on `<application>`.

```kotlin
import android.app.Application
import com.posthog.PostHog
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig

const val HEYCATCH_PROJECT_KEY = "hck_pk_…" // the key from the prompt, inlined

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val config = PostHogAndroidConfig(apiKey = "phc_oiDt6uXiBiEA2aT43SMzMAFE9D4gMVkRP3BtvYRsmHqe", host = "https://in.heycatch.ai")
        PostHogAndroid.setup(this, config)
        PostHog.register("heycatch_project_key", HEYCATCH_PROJECT_KEY)
        PostHog.group(type = "project", key = HEYCATCH_PROJECT_KEY)
    }
}
```

Identity, screens and events:

```kotlin
// After sign-in. A stable internal user id - never an email or a token.
PostHog.identify(
    distinctId = user.id,
    userProperties = mapOf("email" to user.email, "name" to user.name),
)

PostHog.screen(screenTitle = "Paywall") // a screen appeared
PostHog.capture(event = "signup_completed") // a business outcome

// On sign-out:
PostHog.reset()
PostHog.register("heycatch_project_key", HEYCATCH_PROJECT_KEY)
PostHog.group(type = "project", key = HEYCATCH_PROJECT_KEY)
```

Activities are captured as screens automatically. Jetpack Compose
destinations are not - call `screen` whenever the current destination
changes.

## Flutter

Add the package to `pubspec.yaml` - `^5.0.0`, not an older major:

```yaml
dependencies:
  posthog_flutter: ^5.0.0
```

Turn off the package's auto-init on both platforms, or it starts itself
from manifest values before your setup runs.

`android/app/src/main/AndroidManifest.xml`, inside `<application>`:

```xml
<meta-data android:name="com.posthog.posthog.AUTO_INIT" android:value="false" />
```

`ios/Runner/Info.plist`, inside the top-level `<dict>`:

```xml
<key>com.posthog.posthog.AUTO_INIT</key>
<false/>
```

Set up once in `main()`:

```dart
import 'package:flutter/widgets.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

const heycatchProjectKey = 'hck_pk_…'; // the key from the prompt, inlined

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = PostHogConfig('phc_oiDt6uXiBiEA2aT43SMzMAFE9D4gMVkRP3BtvYRsmHqe');
  config.host = 'https://in.heycatch.ai';
  await Posthog().setup(config);
  await Posthog().register('heycatch_project_key', heycatchProjectKey);
  await Posthog().group(groupType: 'project', groupKey: heycatchProjectKey);
  runApp(const MyApp());
}
```

Identity, screens and events:

```dart
// After sign-in. A stable internal user id - never an email or a token.
await Posthog().identify(
  userId: user.id,
  userProperties: {'email': user.email, 'name': user.name},
);

await Posthog().screen(screenName: 'Paywall'); // a screen appeared
await Posthog().capture(eventName: 'signup_completed'); // a business outcome

// On sign-out:
await Posthog().reset();
await Posthog().register('heycatch_project_key', heycatchProjectKey);
await Posthog().group(groupType: 'project', groupKey: heycatchProjectKey);
```

For screen views, add `PosthogObserver()` to `navigatorObservers` on the
`MaterialApp` (or your router's observer list) instead of calling `screen`
by hand. The observer only records routes that have a name and silently
skips the rest, so a plain `Navigator.push(MaterialPageRoute(...))` records
nothing. Check how the app navigates. For every unnamed push, either give
the route a name:

```dart
Navigator.push(
  context,
  MaterialPageRoute(
    settings: const RouteSettings(name: 'Paywall'),
    builder: (_) => const PaywallScreen(),
  ),
);
```

or call `Posthog().screen(screenName: ...)` when that screen appears.

## Already running PostHog? Send to HeyCatch directly

The app already sets up PostHog for its own PostHog project. Do NOT call
setup a second time with HeyCatch's token: the SDK is one shared instance
per app, so a second setup would take over the app's own events. Leave
their PostHog as it is, and send events to HeyCatch over plain HTTP from the
app's analytics layer - wherever it already captures an event, send the same
event here too, following "Sending over HTTP" below.

## Any other stack (Godot, Unity, C++)

There is no SDK to install. Send events from the app's own code over plain
HTTP, following "Sending over HTTP" below. Put it in one small module the
rest of the app calls - `track(event, properties)`, `screen(name)`,
`identify(userId, props)` - so the fields below are set in one place.

## Sending over HTTP

`POST https://in.heycatch.ai/batch/` for several events, or `POST https://in.heycatch.ai/capture/` for
one, with a JSON body in the standard PostHog capture format:

```json
{
  "api_key": "phc_oiDt6uXiBiEA2aT43SMzMAFE9D4gMVkRP3BtvYRsmHqe",
  "batch": [
    {
      "event": "signup_completed",
      "distinct_id": "<stable user id>",
      "timestamp": "<ISO 8601, UTC, when it happened>",
      "properties": {
        "heycatch_project_key": "hck_pk_…",
        "$groups": { "project": "hck_pk_…" },
        "$lib": "heycatch-native",
        "$session_id": "<UUIDv7 of the current session>",
        "heycatch_custom_user_event": true
      }
    }
  ]
}
```

`/capture/` takes one event with the same fields at the top level next to
`api_key`. A `200 {"status": "Ok"}` means accepted.

Every event's `properties` carries these. Without any of the first
three, events are still accepted with a 200, but the dashboard stays empty
and the install is never verified:

- `heycatch_project_key` and `$groups.project`: the project key, twice -
  what `register` + `group` do on the SDK route. Without them the event
  belongs to no project.
- `$lib`: exactly `"heycatch-native"`. It tells HeyCatch the events come
  from an app. Not the engine's or the game's own name, and not a PostHog
  SDK's name - any other value puts the app on no dashboard tab.
- `$session_id`: one id per session, the same on every event of that
  session. HeyCatch builds sessions, the summary and the funnel from it;
  events without one are dropped. It must be a UUIDv7 - its first 48 bits
  are the session start in Unix milliseconds. Use the platform's UUIDv7 if
  it has one, otherwise build it: 48-bit Unix ms timestamp, then 4 bits
  `0111`, 12 random bits, the 2 bits `10`, 62 random bits, written as
  `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`. Start a new session id when the
  app launches, and before sending any event when 30 minutes or more have
  passed since the previous one - in the foreground too, not only on coming
  back from the background.
- `heycatch_custom_user_event: true` on the app's own business events
  (`signup_completed`, `level_completed`, `purchase`), and only on those -
  that is what makes an event available as a funnel step. Leave it off
  `$screen` and `$identify`.

`distinct_id`: before sign-in, a random id generated once per install
and stored, so the same player stays one person across launches. After
sign-in, the app's stable internal user id - never an email or a token.

A screen view is event `$screen` with a `$screen_name` property. On
sign-in, send an `$identify` event with `distinct_id` set to the user id,
`"$anon_distinct_id"` set to the install's anonymous id (so the events
before sign-in join the same person), and person properties as
`"$set": { "email": …, "name": … }`. On sign-out, generate a fresh
anonymous id and store it in place of the old one before sending anything
else - otherwise the next launch restores the old id, which is already
joined to the signed-out user.

Send promptly with a fresh timestamp - batch every few seconds and on going
to the background. Events held in a long offline queue can be dropped.

## Get it live, then hand over

A running build is enough to verify - a debug build on a simulator or a
device counts, no App Store or Play release needed. The SDKs send in
batches, so events show up within about half a minute, or when the app
goes to the background.

Build and run it yourself if you can. Then tell the user, in plain words:

> "HeyCatch is set up in your app. Run it (a simulator is fine), tap through
> a few screens, then go to the Install page in your HeyCatch dashboard and
> press 'I've installed'."

For real users the events start flowing once they are on an app version
that includes this change.
