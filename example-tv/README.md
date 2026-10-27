# Mux Player TV example

An isolated Expo 57 native app for Apple TV and Android TV. The source picker uses
remote focus and opens an edge-to-edge player. The first card, Tears of Steel,
exercises custom TV controls with saved results from completed Mux Robots jobs and
the video's caption transcript. It needs no Robots proxy or API credentials.
The Native controls card retains the platform controls for comparison. Back/Menu
returns to the source picker and restores the selected item's focus. The public
VOD fixture reuses the mobile example's playback ID; the invalid fixture exercises
error recovery. No credentials are checked in. Signed, live, multi-audio and DRM
hardware evidence remains in the [TV validation plan](../docs/TV-PRD.md).

## Dependency and workspace contract

Install from the repository root with `npm ci`. This workspace pins:

- Expo `57.0.22`, React `19.2.3`.
- `react-native` alias `npm:react-native-tvos@0.86.2-0` (the resolved Expo 57
  [`0.86-stable` tag](https://docs.expo.dev/versions/latest/#each-expo-sdk-version-depends-on-a-react-native-version)).
- `@react-native-tvos/config-tv` `0.1.6`.
- React Native Gradle plugin `0.86.2`, Expo Modules Core `57.0.18`.
- AGP `9.1.1`, Gradle `9.3.1`, compile SDK `37`, target SDK `36`, minimum Android API `24`.
- Minimum tvOS `16.4`; use Xcode `26.6` for the current repository environment.

The generated TV workspace currently resolves Mux Data AVPlayer SDK `4.16.0` and
MuxCore `5.14.0`. The podspec requires Mux Data `>=4.13.0, <5.0.0`; these native
versions are the resolved build baseline, not exact npm-style pins. Check the
generated workspace's `Package.resolved` when recording future build evidence.

All three workspace packages use the same RN TV alias, including the mobile
example. Expo [requires this shared runtime in TV monorepos](https://docs.expo.dev/guides/building-for-tv/).
The root npm override also prevents exact peer dependencies from installing a
nested copy of stock React Native. The mobile app keeps its mobile configuration,
but changing the shared native runtime requires fresh mobile native builds and
playback checks; the prior [mobile baseline](../docs/native-player-upgrade.md)
does not establish a pass for this version.

Both examples explicitly watch the installed library’s `src` and `assets` folders.
Expo’s workspace defaults omit the package root, which can otherwise leave stale
player transforms after edits. Restart Metro after changing its configuration.

The mobile example's postinstall applies the AGP compatibility patches to shared
dependencies. Its host compatibility plugin is reused here to preserve AGP 9.1.1,
Gradle 9.3.1, Kotlin/source-set flags, ProGuard settings and the SPM UUID workaround.

## Generate and build

From the repository root:

```sh
npm ci
npm run tv:typecheck
npm run tv:prebuild
npm --prefix example-tv run ios:pods
npm run tv:ios:build
npm run tv:android:build
```

`tv:prebuild` creates `example-tv/ios` and `example-tv/android` only. Those native
folders are ignored and disposable. Do not run TV prebuild inside `example/`.
Expo 57 prebuild cleans by default; our scripts explicitly use `--no-clean`.
To reset the TV projects, `npm --prefix example-tv run prebuild:clean` deletes/regenerates only
those generated folders; preserve any experimental manual native edits first.

The Expo and Apple build scripts set both `EXPO_TV=1` and `RCT_BUILD_FOR_TV=1`. The library plugin also
persists `RCT_BUILD_FOR_TV=1` at the start of the generated Podfile, so direct
`cd example-tv/ios && pod install` selects tvOS dependencies. tvOS uses AVPlayer
and Mux Data. A dedicated TV embed phase copies the dynamic MuxCore framework
from Xcode's staged products or the matching tvOS device/simulator artifact slice,
then signs it when code signing is enabled. The iOS embed and duplicate-signature
phases are excluded from the TV project. A separate TV archive phase removes the
redundant root MuxCore xcframework signature, preserving the pod's signature and
the embedded framework, so Xcode can assemble the archive without duplicate files.

Finish generation before starting Pods or native builds. Even a non-clean prebuild
rewrites project files and must not run concurrently with those commands.

To run on a booted emulator/simulator:

```sh
npm --prefix example-tv run start
# In another terminal:
npm --prefix example-tv run ios -- --device
# Or select the running Android TV emulator:
npm --prefix example-tv run android -- --device
```

`ios:build` targets the generic tvOS simulator without signing. Physical Apple TV
builds require an appropriate Xcode signing team and provisioning. Open the
isolated workspace to select the physical device; keep `RCT_BUILD_FOR_TV=1` for
manual build commands. No physical-device behavior is implied by a simulator build.

The build script passes `-packageAuthorizationProvider netrc` because this example's
Swift packages are public. This avoids Xcode's Keychain credential lookup, which
can stall package resolution before an otherwise reachable binary downloads.
It does not create, modify or delete credentials. The equivalent manual command,
from `example-tv/`, is:

```sh
EXPO_TV=1 RCT_BUILD_FOR_TV=1 xcodebuild \
  -packageAuthorizationProvider netrc \
  -workspace ios/MuxPlayerTV.xcworkspace -scheme MuxPlayerTV \
  -configuration Debug -sdk appletvsimulator \
  -destination 'generic/platform=tvOS Simulator' \
  -derivedDataPath build/DerivedData build CODE_SIGNING_ALLOWED=NO -quiet
```

## Configuration checks

Set `EXPO_PUBLIC_MUX_TV_QA_STATUS=1` to enable a noninteractive playback status/time
readout in development builds.
It displays only status, current time and duration, and never source URLs or tokens.
Leave the variable unset or set it to `0` to hide it; production builds always omit it.
The stable playback setup callback runs on screen entry, so status updates do not
restart playback or override a remote pause.

```sh
npm run test:config
npm run tv:prebuild
node example-tv/scripts/check-native-config.cjs
npm --prefix example-tv run export
```

CI checks shared TypeScript/unit contracts and generates both TV native projects,
then repeats prebuild with `--no-clean`. It verifies TV launcher features,
dependency platform selection, the dedicated TV framework phase, exclusion of iOS
framework phases and the AGP/Gradle configuration. It does not certify remote interaction,
Mux Data delivery or physical-device playback. Those release gates remain in the
[TV PRD](../docs/TV-PRD.md).

## Local signed, live and analytics fixtures

Copy `.env.example` to `.env.local` inside `example-tv/` and fill only the fixtures
you can test. Restart Metro after changing values. The app always shows public VOD
and invalid-source cards. A signed card appears only when both
`EXPO_PUBLIC_MUX_SIGNED_PLAYBACK_ID` and `EXPO_PUBLIC_MUX_PLAYBACK_TOKEN` are present.
A live card appears only with `EXPO_PUBLIC_MUX_LIVE_PLAYBACK_ID`; provide
`EXPO_PUBLIC_MUX_LIVE_PLAYBACK_TOKEN` if that stream requires signed playback.

Set `EXPO_PUBLIC_MUX_ENV_KEY` to your Mux Data environment key to identify sessions
in your dashboard. `EXPO_PUBLIC_MUX_THUMBNAIL_TOKEN` is separate from the playback
JWT and must use the image audience. An expired playback JWT can be used to check
authentication failure. DVR seeking requires a live stream with a DVR window.

Every `EXPO_PUBLIC_*` value is readable from the built app. These are local test
fixtures, not a production token delivery design. Never place Mux API access
credentials or signing private keys in frontend environment variables. Generate
short-lived playback/image JWTs on a trusted backend. The example displays generic
playback errors and never renders or logs fixture credentials. Keep the ignored
`.env.local` and exported bundles out of source control. DRM is excluded pending
physical-device validation.

## TV controls and Robots

Choose Tears of Steel to test the custom transport, seek preview, track/settings
menus, and Summary, Chapters, Moments, and Transcript panels. Its bundled
[`fixtures/tears-of-steel-robots.json`](fixtures/tears-of-steel-robots.json) contains
genuine completed summary, chapter, and key-moment results for the same asset,
plus a transcript from its ready caption track. The snapshot records the asset,
playback, job, and caption-track IDs and when the results were fetched. Loading
these panels makes no Robots API requests and starts no new workloads.

The center/OK button (Select) plays or pauses when the timeline is focused.
Left/Right open a seek
preview (hold them to scrub faster, up to 16×); Select commits the preview and
Back cancels. Focused buttons, menu options, and Robots items keep their own Select
actions.

Playing or paused, the controls fade away after three seconds to leave video and captions
unobstructed. Select then plays or pauses, reveals the controls, and focuses Play;
arrow keys reveal the controls without toggling playback. Arrows move one row or
control at a time in screen order: the Robots buttons and **…**, the open workflow's
content, the timeline, then the button row. Up from a button reaches the timeline
before the content or the top row, and each row is re-entered at the control focus
left it from. Down or Select on a workflow tab enters its content at the current
row (Close on Summary); Down from the content reaches the timeline. Left/Right move
along a row without wrapping and switch workflows while a panel is open; Left
in the **…** menu closes it onto the workflow button beside it. See
[Remote focus order](../docs/tv-support.md#remote-focus-order). The panel stays
visible while playback controls remain usable. Selecting a timed row seeks and
closes its panel. Back/Menu closes the active panel before returning to the library;
focus returns to the initiating control.

For optional live API testing, set `EXPO_PUBLIC_MUX_ROBOTS_ASSET_ID` and
`EXPO_PUBLIC_MUX_ROBOTS_PLAYBACK_ID` for the same video, then restart Metro with
`--clear`. A Connected Robots card appears after Tears of Steel and calls the host
proxy for summary, chapters, moments and transcript. Run `npm run example:robots` from the root
after configuring server-only Mux credentials in the mobile example's ignored
environment file. The proxy reuses a completed job for the asset (Mux keeps jobs for
30 days) before starting a new one, and builds the transcript from the asset's ready
caption track. The default local proxy is `http://localhost:3030/mux/robots` on Apple
simulators and `http://10.0.2.2:3030/mux/robots` on Android emulators. On a physical
Apple TV, set `EXPO_PUBLIC_ROBOTS_API_URL` to the Mac's reachable LAN address, such
as `http://<mac-lan-address>:3030/mux/robots`, and keep the Mac and TV on the same
network; `localhost` on the TV refers to the TV itself. On a physical
Android TV, set `EXPO_PUBLIC_ROBOTS_API_URL=http://localhost:3030/mux/robots` and run
`adb reverse tcp:3030 tcp:3030`; use the same variable for your trusted backend.
Never place Mux API credentials in `EXPO_PUBLIC_*` variables.
