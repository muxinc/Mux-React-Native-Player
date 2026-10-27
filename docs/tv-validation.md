# TV implementation validation

Recorded 2026-09-11 against the uncommitted TV implementation based on package
`0.1.15`. This is local engineering evidence, not production TV certification.
The [TV PRD](TV-PRD.md) retains the physical-device and release gates.
The user has confirmed simulator/emulator testing for the current phase;
physical-device qualification is deferred. TV DRM is also explicitly deferred,
with public and signed playback as the initial release scope.

## Tested environment

| Component | Version / target |
| --- | --- |
| Expo / React | 57.0.22 / 19.2.3 |
| React Native alias | `npm:react-native-tvos@0.86.2-0`, one runtime throughout the workspace |
| TV config plugin | `@react-native-tvos/config-tv@0.1.6` |
| Apple tools | Xcode 26.6 (17F113), tvOS/iOS 26.5 simulators |
| Apple minimum | tvOS 16.4; iOS 16.4 |
| iOS player | Mux Player Swift 1.8.1 |
| tvOS analytics, resolved | Mux Data AVPlayer 4.16.0 / MuxCore 5.14.0 |
| Android player | Mux Player Android 1.6.0 / Media3 1.11.0 |
| Android tools | JDK 17, AGP 9.1.1, Gradle 9.3.1, RN Gradle plugin 0.86.2 |
| Android SDK | Compile 37, target 36, minimum 24 |
| Android TV emulator | API 36, Android TV arm64-v8a, 1080p profile |

The earlier Apple header spike used Mux Data 4.13.0 / MuxCore 5.12.0. The full
workspace build resolved the newer versions above. The podspec permits Data
`>=4.13.0` and `<5.0.0`; inspect `Package.resolved` when reproducing.

## Automated and native build evidence

Local logs are under `/tmp` and are not committed. Screenshots and generated apps
are under ignored `build/` directories. These paths describe this validation run;
use the commands below to produce fresh evidence on another machine.

| Check | Result | Local evidence |
| --- | --- | --- |
| Clean workspace install and single RN runtime | Pass | `/tmp/mux-tv-npm-ci.log`; `npm ls react-native` exits 0 |
| Root TypeScript and unit tests | Pass: 63 tests in 9 files | `/tmp/mux-tv-typescript.log`, `/tmp/mux-tv-tests-final.log` |
| Mobile and TV app TypeScript | Pass | `npm exec --workspace example -- tsc --noEmit`; `npm run tv:typecheck` |
| TV and mobile Expo Doctor | Pass: 21/21 each, no exclusions | `/tmp/mux-tv-doctor.log`, `/tmp/mux-mobile-tv-doctor.log` |
| TV production JS export, both platforms | Pass | `/tmp/mux-tv-export.log` |
| Clean and repeated non-clean TV generation | Pass | `/tmp/mux-tv-prebuild-final.log`, native config checker |
| Swift public/signed URL tests | Pass | `test/apple/MuxPlaybackURLTests.swift` |
| Android module compile and Back unit tests | Pass: 5 Back tests | `/tmp/mux-tv-android-compile.log`; `android/build/test-results/testDebugUnitTest/` |
| Android TV debug app, final intent contract | Pass | `/tmp/mux-tv-android-build.log` |
| tvOS simulator debug app | Pass, including MuxCore embedding | `/tmp/mux-tv-ios-build.log` |
| Android mobile debug app | Pass | `/tmp/mux-tv-mobile-android-build.log` |
| iOS mobile simulator debug app, final intent contract | Pass | `/tmp/mux-tv-mobile-ios-final.log` |

The tests cover platform/control policy, phone API guards, plugin generation,
equivalent source replacement, same-asset token replacement, queued command cleanup,
stale source events, and playback intent acknowledgement. Native compilation checks
the actual Expo/native linkage; the earlier Swift header check used an Expo stub
and is not substituted for the full build result.

## Runtime evidence

Android TV emulator checks used the public Tears of Steel fixture, with the optional
development readout enabled using `EXPO_PUBLIC_MUX_TV_QA_STATUS=1`. The readout is
off by default and always off in release builds.

| Scenario | Android TV API 36 emulator | Evidence |
| --- | --- | --- |
| Launch and focusable selection | Pass | `build/tv-evidence/android-tv-focus-final.xml` |
| Autoplay after mounting through the hook | Pass; readout reaches `playing` and time advances | `build/tv-evidence/android-tv-autoplay.png` |
| Remote pause and fast-forward | Pass; paused at 43.4 seconds with decoded video | `build/tv-evidence/android-tv-pause-seek-final.png` |
| Back hides controls, then returns to library | Pass | `build/tv-evidence/android-tv-back-hides-final.png` |
| Focus restored to originating video | Pass; Tears of Steel has `focused="true"` | `build/tv-evidence/android-tv-focus-final.xml` |
| Invalid-source error and exit | Pass; generic error UI, Back returns to selected error card | `build/tv-evidence/android-tv-error-fixed.png`, `android-tv-error-back.xml` |
| Valid playback after error | Pass; returns to playing at 18.2 seconds with a decoded frame | `build/tv-evidence/android-tv-recovery.png` |

Android input was delivered through emulator remote key events, not a physical
remote. An Apple TV 4K (3rd generation) simulator running tvOS 26.5 passes an
XCTest remote sequence with the same fixture:

| Scenario | Result |
| --- | --- |
| Autoplay and time advance | Playing at 8.1 seconds, advancing to 13.6 |
| Play/Pause remote key | Paused at 14.1 seconds, unchanged over 3 seconds |
| Remote resume | Playing at 18.4 seconds |
| Right + Select seek | Playing at 32.4 seconds after pausing at 18.8 |
| Menu return | Returns to the selection screen |
| Focus restoration | XCTest `hasFocus` is true on the originating Tears of Steel card |
| Re-entry | Select starts playback again |

Evidence: `/tmp/mux-tv-runtime-ui/menu-fix.xcresult`, `menu-fix.log`, and exported
attachments, copied to `build/tv-evidence/tvos-*.png`. The initial run exposed
missing host Menu registration. The example now enables `TVEventControl` Menu
handling only while the player screen is mounted and disables it on exit.
This test does not establish physical Siri Remote or AVKit track-panel behavior.

An iPhone 17 Pro simulator running iOS 26.5 passes the custom Play/Pause smoke
check: time advances from 8 to 12 seconds and pauses at 15 seconds. A `simctl`
capture shows a decoded movie frame and captions. Three custom 10-second forward
seeks then reach playing at 49 seconds and paused at 50 seconds, with a visible
frame in `build/tv-evidence/ios-mobile-seek.png`. XCTest captures of that same
video surface were dark; they are not used as visual-frame evidence. Results:
`/tmp/mux-tv-runtime-ui/phone.xcresult`, `phone.log`, and
`phone-simctl-paused.png`; the seek check is `phone-seek.xcresult` / `phone-seek.log`.
The full mobile signed, DRM, fullscreen and replacement
regression matrix remains pending.

An isolated Android phone emulator (`Mux_Mobile_QA_API_36_1`, API 36.1) also
passes the final mobile APK smoke check: custom touch Play starts playback and
advancing time, Pause stops at 22 seconds with a decoded frame, and Skip forward
10 seconds reaches paused at 32 seconds with a different frame. Resuming advances
to playing at 35 seconds. Evidence:
`build/tv-evidence/android-mobile-paused.png`, `android-mobile-seek.png`, and
`android-mobile-seek.xml`, and `android-mobile-resumed.png`. The existing phone
emulator lacked installation space;
its data was preserved and the QA emulator used the already cached system image.

## Mux Data environment follow-up

The active Mux CLI profile was matched by organization/environment ID to its
`robotube` dashboard environment. Its client Data key is configured in ignored
`example-tv/.env.local`; API credentials and signing keys were not copied into
client configuration. Metro was restarted and the Android manifest's served
bundle was checked for the configured client key.

Apple TV simulator and Android TV emulator playback ran with this configuration.
The Apple test repeated play/pause/seek and two host exits, finishing with no active
player; `/tmp/mux-tv-runtime-ui/data-session.xcresult` passes. Its approximate view
window is 2026-09-11 21:10:48–21:11:58 UTC. The Android playback capture is
`build/tv-evidence/android-tv-data-playback.png`; the filtered app log contains no
Mux-related errors. These checks establish configured playback and teardown.

Mux Data ingestion is not yet verified: queries using the same CLI credentials
and `player_name:MuxPlayerTVExample` returned no matching completed views during
the initial observation window. Keep analytics/session-metadata acceptance open
until server-side view records are retrieved. Query again with:

```sh
mux --agent video-views list --filters player_name:MuxPlayerTVExample --timeframe 1:hours --limit 20
```

## Packed consumer release builds

P5.3 passes with a consumer installed outside the workspace at
`/private/tmp/mux-tv-consumer`. The final package is
`build/tv-preview/final/mux-mux-react-native-player-0.1.15.tgz`, SHA-256
`b9ba84644f60a3b171967bb660aba6168b9ac87d324b88825f3229fd6e3ad52e`.
It contains 88 entries and excludes examples, dependency trees, Pods, environment
files, nested archives and stale build output. Android test sources remain included
by the existing package allowlist. All 88 packaged files were compared with the
final workspace and match byte-for-byte.

| Consumer output | Result / path |
| --- | --- |
| Android release APK | Pass; `/tmp/mux-tv-consumer/android/app/build/outputs/apk/release/app-release.apk` |
| tvOS release device archive | Pass; `/tmp/mux-tv-consumer/build/MuxPlayerTV.xcarchive` |
| Archive ZIP | `/tmp/mux-tv-consumer/build/MuxPlayerTV.xcarchive.zip` |

The APK uses a test certificate; the tvOS archive is unsigned. The archived app
and embedded MuxCore are arm64, the executable links MuxCore through `@rpath`, and
the archive contains exactly one MuxCore tvOS signature. This verifies archive
assembly and linkage, not production signing or physical-device playback.

The first archive exposed duplicate MuxCore xcframework signatures. The final
library plugin removes only the redundant root intermediate signature, preserving
the pod copy and embedded framework. The clean consumer was regenerated from the
final tarball without its temporary workaround plugin. Both release outputs bundle
the final example Menu handling and startup rejection handling.

The consumer copied the host compatibility plugin and both AGP patches, used the
single RN alias override, and declared `@types/node@25.6.0` with TypeScript
`types: ["node"]` for its environment variables. Reapply `patch-package` after
dependency changes that restore patched files. On macOS, use the canonical consumer
path for npm commands to avoid lockfile paths crossing the `/tmp` symlink.

Commands, artifact hashes and setup details are preserved in
`build/tv-evidence/packed-consumer.md`. Final build logs:
`/tmp/mux-tv-consumer-android-release-final.log`,
`/tmp/mux-tv-consumer-android-release-aligned.log`, and
`/tmp/mux-tv-consumer-ios-archive-final.log`. The root generated TV project also
passes two `--no-clean` prebuild/checker runs with the final signature phase;
see `/tmp/mux-tv-prebuild-signature-final.log`.

## Reproduce

Start from the repository lockfile and follow the [TV example guide](../example-tv/README.md).
Run the following from the repository root after dependencies are installed:

```sh
npm run typecheck
npm run tv:typecheck
npm exec --workspace example -- tsc --noEmit
npm test
npm run build
npm run check:plugin
npm run tv:prebuild
node example-tv/scripts/check-native-config.cjs
npm run tv:prebuild
node example-tv/scripts/check-native-config.cjs
swiftc ios/MuxPlaybackURL.swift test/apple/MuxPlaybackURLTests.swift -o /tmp/mux-tv-url-tests
/tmp/mux-tv-url-tests
npm --prefix example-tv run ios:pods
npm run tv:ios:build
npm run tv:android:build
npm run example:ios:build
npm run example:android:build
```

TV prebuild scripts explicitly use `--no-clean`: Expo 57 otherwise cleans generated
projects by default. Run native generation exclusively, before starting native
builds. Use `prebuild:clean` only when regeneration and deletion are intended.

The tvOS build script selects `-packageAuthorizationProvider netrc` for public SPM
dependencies. An initial build stalled inside macOS Keychain lookup before HTTP
transfer; this option avoids that lookup without changing credentials. MuxCore is
a dynamic framework and must be embedded in the final TV application.

## Remaining release qualification

Physical Apple TV and Android TV / Google TV testing is required for signed and
expired tokens, live/DVR, alternate audio and captions, remote navigation and
accessibility, Mux Data metadata and session teardown, network/interruption recovery,
30-minute playback and 20 entry/exit cycles, and startup/seek performance comparisons.
Optional signed/live fixtures require developer-supplied playback tokens and a
Mux Data test environment. The user subsequently authorized the Mux CLI environment for analytics checks;
the matching client Data key is configured only in ignored `example-tv/.env.local`.
API token secrets remain outside the app. Physical-device testing is deferred.

tvOS DRM is explicitly rejected for this preview. Existing Android Widevine is
not advertised as TV-verified. Publishing and version changes remain pending release
review and authorization; no package has been published by this validation run.


## Phase 6 implementation validation (2026-09-11)

This work adds the custom TV overlay and Robots panels after the native preview
baseline above. Earlier packed-consumer hashes identify the native preview, not
this later custom-controls change. No publication or version bump has occurred.

- Current automated suite: 119 tests pass, including remote event-phase
  de-duplication, seek bounds, Robots stale request/cue handling, local fixtures,
  workspace/packed-layout Metro resolution, and panel Back priority over a later
  host listener. Root, TV and mobile TypeScript
  checks pass. Logs: `/tmp/mux-tv-phase6-tests-final.log` and the corresponding
  `phase6-*-typecheck-final.log` files. TV production exports for both platforms
  also pass: `/tmp/mux-tv-phase6-export-final.log`.
- Incremental native debug builds pass for Android TV, tvOS simulator, Android
  mobile and iOS simulator. Logs: `/tmp/mux-tv-phase6-android-build.log`,
  `/tmp/mux-tv-phase6-ios-build.log`, `/tmp/mux-tv-phase6-mobile-android-build.log`,
  `/tmp/mux-tv-phase6-mobile-ios-build.log`. Five Android Back unit tests also
  pass: `/tmp/mux-tv-phase6-android-tests.log`.
- Android TV remote checks pass for single Play/Pause (paused 8.1 seconds stays
  stable), storyboard/thumbnail preview adjustment, cancel without seeking,
  commit to 18.1 seconds, and timeline focus restoration. A 720p limit preserves
  the paused position and restores Settings after source replacement.
- Android TV shows all four Robots panels. Summary Back restores Summary;
  chapter/moment selection seeks to 60 seconds and restores its button. Transcript
  scroll reaches cue 11, seeks to 300 seconds, and restores Transcript. Content is
  clearly labeled sample data; this does not prove a live Robots API job.
- Android TV native English captions become fully visible with Hide controls.
  Hidden media keys pause at 48.7 seconds; Select restores focus to Hide controls.
  Evidence: `build/tv-evidence/phase6/mux-tv-phase6-hidden-captions.png`,
  `mux-tv-phase6-hidden-paused.png`, and `mux-tv-phase6-shown-focus-restored.png`.
- Final Android TV Back smoke passes after the subscription fix: Back closes
  Chapters, restores Chapters focus at paused 13.9 seconds, and the next Back
  returns to the library with Tears of Steel focused. The app is left idle there.
- Final Android mobile touch regression passes on isolated API 36.1 phone
  emulator 5556: playing 2→6 seconds, pause stable at 11, scrub to 269 while paused,
  resume to 272, with visible decoded frames and mobile controls. App stopped
  afterward. Evidence: `/tmp/phase6-mobile/SUMMARY.md` and screenshots 08–14.

- Apple TV full custom XCTest passes in 121.137 seconds: single media toggles,
  stable pause, vertical navigation, seek preview cancel/commit (15.4→35.4 seconds),
  Hide/Show, all four Robots panels, timed-row selection, panel dismissal and exact
  initiating focus, then host exit. Follow-up checks prove distinct paused seeks
  to Moments 180 and Transcript 90 seconds; native comparison also passes.
- Apple final Back smoke passes in 25.728 seconds after the subscription priority
  fix: Summary and seek Menu dismiss their panel first; next Menu returns to the
  library and restores its card focus. Chapters and Transcript visibly scroll;
  Summary and Moments fixtures fit on screen, so long-content scrolling is not
  claimed for those fixtures. Friendly screenshots and logs are copied under
  `build/tv-evidence/phase6/apple-tv/`.

Two UIKit focus issues were fixed and retested: the closed Robots wrapper uses
native `display: none` while retaining its cache, and interactive timestamp panels
use a nonfocusable ScrollView so their row buttons can receive focus. Summary
retains the TV reading scroll view. Temporary input diagnostics have been removed.

The final Phase 6 preview is
`build/tv-preview/phase6-final/mux-mux-react-native-player-0.1.15.tgz`, SHA-256
`96684c104bd6efd2f07afb86019004c41ad1779d585786591cb440097db24d0c`.
It contains the final Back priority fix and compiled TV modules. The package audit
is saved in `build/tv-evidence/phase6/package-audit.md`. This is a local preview;
the version remains 0.1.15 and nothing was published. The earlier clean-consumer
release/archive hashes above remain evidence for the native baseline, not a new
Phase 6 packed-consumer native rebuild.

Physical-device accessibility/lifecycle/endurance, signed/live fixtures, live
Robots backend jobs and Mux Data ingestion remain separate qualification gates.
The configured client Data key and simulator session generation do not establish
server-side ingestion. TV DRM remains deferred.
