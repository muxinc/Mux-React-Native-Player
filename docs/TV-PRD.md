# PRD — Apple TV and Android TV Support

Status: Implementing · Created: 2026-09-10 · Implementation baseline: package 0.1.15

## Product decision

Extend this package to Apple TV (tvOS) and Android TV / Google TV while preserving
the `MuxVideoView` and `useMuxVideoPlayer` API used by mobile applications.
Keep Mux Player Swift on iOS and Mux Player Android on Android. Add a tvOS backend
using AVPlayer, AVPlayerViewController, and the Mux Data AVPlayer SDK. Ship native
TV playback controls first; add custom TV controls in a later phase.

Confirmed launch scope: public and signed playback first. TV DRM is deferred;
FairPlay and Widevine are not requirements for the initial TV release.

Current testing scope, confirmed by the user: simulators and emulators only.
Physical-device qualification is deferred to a later release review; unchecked
physical-device gates below do not block the current development phase and must
not be reported as passed.

This document tracks implementation and release qualification. Local build and
runtime evidence is recorded in [TV validation](tv-validation.md) and below; physical-TV release gates remain pending. The existing [feature roadmap](PRD.md) continues to track general
player features; this document owns TV-specific acceptance and release gates.

## Problem and desired outcome

Developers need to play Mux video in Expo and React Native applications across
phones, tablets, and TVs without maintaining separate player APIs. TV viewers
need complete playback navigation with a remote, readable controls, accessible
focus behavior, and predictable return navigation.

At the start of this work, the package declared only iOS and Android support. Its
Apple implementation imported Mux Player Swift, and parts of the wrapper assumed
phone orientation and touch interaction. Android already embedded Media3 PlayerView,
but the wrapper needed explicit TV remote routing and focus behavior.

Success means a developer can build a TV example from documented instructions,
play public and signed Mux streams, navigate playback entirely with a remote,
and observe correct Mux Data sessions. Existing mobile examples must continue to
build and pass playback smoke checks.

## Architecture

| Platform | Playback backend | Controls for initial TV release |
| --- | --- | --- |
| iOS / iPadOS | Existing Mux Player Swift | Existing mobile controls |
| Android phones / tablets | Existing Mux Player Android / Media3 | Existing mobile controls |
| Apple TV / tvOS | AVPlayer + Mux Data AVPlayer SDK | AVPlayerViewController |
| Android TV / Google TV | Existing Mux Player Android / Media3 | PlayerView |

The shared JavaScript API remains the integration boundary. Platform-specific
source preparation, native dependencies, and UI behavior stay inside the package.
Use `react-native-tvos` and `@react-native-tvos/config-tv` in the TV example with
versions matched to its Expo SDK. Consumers use native builds; Expo Go is not a
supported runtime for this package.

Do not make the first release depend on a private fork of Mux Player Swift.
Prove platform-specific dependency resolution early: adding a tvOS deployment
target alone does not establish that the entire native dependency graph builds.

## Scope and requirements

| Area | Initial TV release requirement |
| --- | --- |
| Playback | Public and signed HLS VOD, live playback, and live-edge seeking; DVR seeking where the source provides a window |
| Shared API | Source replacement, play/pause, seek, replay, loop, mute, rate, release, status/events, and supported track selection |
| Controls | Native controls, remote play/pause, directional navigation, seeking, captions/audio selection, and Back/Menu handling |
| Presentation | Fullscreen TV playback and a tested return to the host app; `contentFit` and poster support |
| Analytics | Mux Data startup, playback, seeking, errors, completion, and teardown, with correct video/viewer metadata |
| Authentication | Valid and expired signed playback tokens; image tokens handled separately from playback tokens |
| Accessibility | Visible focus, readable labels, OS screen reader checks, captions, and no touch-only required actions |
| Expo | Repeatable TV prebuild/build instructions and compatibility with the TV config plugin |
| Mobile compatibility | Existing iOS and Android behavior remains supported and tested |
| DRM | Deferred by user decision; initial TV release supports public/signed playback, with no TV FairPlay/Widevine support claim |

The original native preview excluded custom TV overlays and Robots panels; these
are now implemented in Phase 6. Remaining exclusions: feed/shorts TV UX,
offline downloads, casting, and a guarantee of parity for every mobile-only
feature. Caching, preloading, PiP, AirPlay controls, background playback, caption
styling, and volume behavior need explicit capability decisions. These exclusions
do not remove existing mobile functionality.

Resolution parameters express stream selection constraints, not a guarantee of
4K/HDR playback on every TV. Publish only the device and stream capabilities tested.

## Progress tracking

Use `[ ]` for incomplete and `[x]` only when the acceptance evidence is recorded.
Keep partial work unchecked and describe it in the execution log. An unavailable
device or credential is a blocker, not a passed check. Each phase gate requires
its required tasks and acceptance checks to be complete.

| Phase | Milestone | Depends on | Status | Owner / evidence |
| --- | --- | --- | --- | --- |
| 0 | Scope and dependency feasibility | — | In progress | Root + Apple/Expo workers |
| 1 | Expo TV build foundation | 0 | Complete locally | Both TV apps launch; mobile native builds pass |
| 2 | Android TV playback and controls | 1 | Implemented; qualifying | Emulator smoke passes; physical/fixture gates pending |
| 3 | Apple TV playback and controls | 1 | Implemented; qualifying | Simulator remote smoke passes; physical/fixture gates pending |
| 4 | Cross-platform validation | 2, 3 | In progress | Root; physical devices pending |
| 5 | Initial TV release | 4 | Preparation | Root; release qualification pending |
| 6 | Custom TV controls and Robots | Native foundation; authorized 2026-09-11 | Complete for simulator/emulator scope | Remote/Robots checks pass; physical release gate deferred |

The native preview followed phases 0 → 1 → 2 → 3 → 4 → 5. The user authorized
Phase 6 development on the simulator/emulator baseline while release qualification
continues separately. Physical-device gates remain unchecked.

## Phase 0 — Confirm scope and prove dependencies

- [x] P0.1 Record supported Expo SDK, React Native TV version, Xcode, Android SDK,
  minimum tvOS version, and minimum Android TV OS/API level. Start by evaluating
  the repository's [Expo SDK 57 baseline](native-player-upgrade.md); do not assume
  its mobile build results establish TV compatibility.
- [ ] P0.2 Build a minimal tvOS AVPlayer + Mux Data integration for simulator and
  device targets. Verify framework slices, linkage, packaging, and signing setup.
- [x] P0.3 Prove Mux Player Swift can remain an iOS-only dependency while tvOS
  resolves Mux Data directly. Record the chosen podspec/SPM structure and SDK versions.
- [x] P0.4 Resolve Android Mux Player and Media3 dependencies and record a
  compatible version set, including the existing UI and session dependencies.
- [x] P0.5 Decide and record whether DRM is required for launch. If required, prove
  FairPlay on physical Apple TV and Widevine on a physical Android TV before
  committing to release scope. Record license/certificate/token requirements.
- [x] P0.6 Create a capability matrix for every current public prop and command:
  supported, adapted, deferred, or unavailable on each TV platform. Define explicit
  behavior for unsupported options, including `controls="custom"` and `"none"`.
- [ ] P0.7 Prepare public VOD, signed VOD, captioned/multi-audio, live/DVR, invalid
  source, and expired-token fixtures. Identify devices and a Mux Data test environment.
- [ ] **Phase 0 gate:** dependency feasibility and launch scope are recorded,
  including the DRM decision and any architecture changes needed by the build spike.

## Phase 1 — Establish Expo TV builds

- [x] P1.1 Add a minimal TV example with a focusable video selection screen and
  player screen, using the same public player API as mobile.
- [x] P1.2 Configure the Expo TV plugin and matching `react-native-tvos` version.
  Add documented commands for generating and running both TV targets.
- [x] P1.3 Update Expo module registration, Apple deployment targets, source
  selection, and dependencies for tvOS. Ensure tvOS does not import Mux Player Swift.
- [x] P1.4 Audit the Mux config plugin's framework embed/signature phases and
  target selection for tvOS. Repeated prebuilds must not duplicate configuration.
- [x] P1.5 Verify Android TV launcher/manifest configuration, landscape presentation,
  and operation without a touchscreen through the TV plugin and example app.
- [x] P1.6 Isolate TV build configuration so mobile prebuilds remain reproducible.
  Document any destructive clean-prebuild step and use disposable generated projects
  for verification rather than overwriting manually maintained native changes.
- [x] P1.7 Guard phone-only orientation, status-bar, AirPlay-button, and other
  unavailable platform APIs in native code and the JavaScript wrapper.
- [x] **Phase 1 gate:** both TV examples launch with the native module registered;
  mobile examples still build; setup requires no undocumented native edits.

## Phase 2 — Deliver Android TV playback

- [ ] P2.1 Load public and signed Mux sources through the existing Android backend
  and present native PlayerView controls on the TV playback screen.
- [x] P2.2 Give the active player appropriate focus and route remote key events to
  PlayerView. Prevent duplicate handling between native controls and React Native.
- [ ] P2.3 Verify play/pause, seek, caption/audio selection, and control visibility
  with a physical remote. Hidden controls can be recalled without trapping focus.
- [x] P2.4 Define Back behavior: dismiss an open control panel first, then leave
  playback and restore focus to the originating video item. Do not consume host
  navigation events when the player is inactive.
- [ ] P2.5 Verify MediaSession transport behavior and cleanup with the active player,
  including interaction with `enableNowPlaying` and existing mobile behavior.
- [ ] P2.6 Exercise source replacement, live-edge/DVR seeking, end/replay, buffering,
  background/foreground transitions, release, and recovery from playback errors.
- [ ] P2.7 Verify public events and Mux Data session lifecycle/metadata. Verify
  Widevine if included in the Phase 0 launch decision.
- [ ] **Phase 2 gate:** all required playback actions work on a physical Android
  TV / Google TV device with a remote, with evidence recorded and no touch dependency.

## Phase 3 — Deliver Apple TV playback

- [x] P3.1 Implement tvOS source preparation with AVPlayerItem/AVPlayer behind the
  existing JavaScript API, preserving the existing iOS Mux Player Swift path.
- [x] P3.2 Construct Mux HLS URLs with correct encoding for playback IDs, signed
  tokens, custom domains, resolution bounds, rendition order, and clipping. Add
  focused tests for public/signed URLs and parameter combinations.
- [ ] P3.3 Attach Mux Data to AVPlayerViewController with the appropriate environment,
  video, viewer, and custom metadata. Ensure one monitor per active playback view
  and explicit teardown/source-change behavior.
- [x] P3.4 Integrate AVPlayerViewController with correct parent/child controller
  lifecycle, fullscreen presentation, native controls, and return navigation.
- [ ] P3.5 Verify Siri Remote play/pause, seeking, captions/audio selection, and
  Menu/Back behavior. Restore focus to the host screen when playback closes.
- [x] P3.6 Map loading, ready, first-frame, playback, time, buffering, end, live/DVR,
  and error state into the existing event/status contract. Keep current source
  identity and playback position correct through source replacement.
- [x] P3.7 Implement required shared commands and poster behavior. Apply the Phase 0
  capability decisions for unsupported mobile options and preload/cache APIs.
- [x] P3.8 If DRM is required, implement FairPlay content-key/license handling and
  verify successful playback and failure recovery on physical Apple TV. Otherwise,
  reject DRM sources clearly and document tvOS DRM as unsupported for this release.
- [ ] P3.9 Verify release, observer/timer cleanup, screen re-entry, interruption,
  background/foreground behavior, and Mux Data completion/error reporting.
- [ ] **Phase 3 gate:** public and signed video play on physical Apple TV, native
  remote controls and analytics work, and required DRM checks pass if in scope.

## Phase 4 — Validate the shared contract and TV experience

- [ ] P4.1 Complete the matrix below with build/commit, OS/device, fixture, outcome,
  and evidence for each required scenario. Separate simulator and device results.
- [ ] P4.2 Validate visible focus, labels, contrast/readability at TV viewing distance,
  caption presentation, tvOS VoiceOver, and Android TV TalkBack where supported.
- [ ] P4.3 Confirm malformed/expired tokens, inaccessible streams, and network
  interruption produce useful errors without leaking tokens or leaving stuck UI.
- [ ] P4.4 Confirm source replacement and repeated navigation produce no stale
  events, duplicate audio, orphaned monitors, or accumulating native players.
- [ ] P4.5 Run a 30-minute playback session and 20 player enter/exit cycles on each
  physical TV platform. Record memory/player/observer behavior; investigate growth
  that persists after cleanup rather than treating a single memory reading as proof.
- [ ] P4.6 Compare startup and seek recovery against the Phase 0 native baseline
  using the same device, source, and network. Record results and agree acceptable
  budgets before release; investigate material wrapper overhead.
- [x] P4.7 Run `npm run typecheck`, `npm test`, `npm run build`, and
  `npm run check:plugin`. Add focused regression tests for URL generation,
  platform selection, plugin changes, and lifecycle fixes where appropriate.
- [ ] P4.8 Build iOS and Android mobile examples and smoke-test playback, custom
  controls, fullscreen, source replacement, and existing signed/DRM paths.
- [ ] **Phase 4 gate:** all required scenarios pass; no open release-blocking crashes,
  broken remote navigation, playback/authentication failures, analytics lifecycle
  defects, or mobile regressions remain.

### Required validation matrix

Mark a cell Pass only with linked evidence. Use N/A with a reason only for an
explicitly excluded capability. A simulator pass does not satisfy a physical-TV gate.

| Scenario | Physical Apple TV | Physical Android TV / Google TV | Mobile regression |
| --- | --- | --- | --- |
| Public VOD, first frame, pause/resume, seek, end/replay | Pending | Pending | iPhone simulator and Android phone emulator public playback/pause/seek pass; end/replay pending |
| Signed playback, invalid/expired token, custom domain | Pending | Pending | Pending |
| Captions and alternate audio | Pending | Pending | Pending |
| Live, live edge, DVR window boundaries | Pending | Pending | Pending |
| Remote focus, controls, Back/Menu, focus restoration | Pending | Pending | Touch navigation: pending |
| Source replacement, release, repeat entry/exit | Pending | Pending | Pending |
| Network interruption and foreground recovery | Pending | Pending | Pending |
| Mux Data metadata, errors, session start/end | Pending | Pending | Pending |
| Poster and signed image assets | Pending | Pending | Pending |
| DRM | N/A: deferred; tvOS explicitly rejects DRM sources | N/A: deferred; existing backend is not advertised as TV DRM support | Existing paths: pending |
| Accessibility and sustained playback | Pending | Pending | Pending |

## Phase 5 — Document and release initial TV support

- [x] P5.1 Publish a TV getting-started guide with exact tested dependency versions,
  Expo plugin setup, build commands, troubleshooting, and the working example.
- [x] P5.2 Publish the platform capability matrix and document controls behavior,
  unsupported options, DRM status, minimum OS versions, and tested devices.
- [x] P5.3 Verify installation from a packed release artifact in a clean consumer
  app for both TV platforms, including release-mode builds and Apple archive linkage.
- [x] P5.4 Add CI build/contract checks where infrastructure supports them; document
  physical-device checks required for subsequent native TV changes.
- [x] P5.5 Prepare version/changelog and release notes. Review any behavior changes
  to existing API options and choose versioning consistent with their impact.
- [ ] P5.6 Complete release review with linked Phase 4 evidence and an explicit list
  of limitations. Publish only after the repository's normal release authorization.
- [ ] **Phase 5 gate:** the TV release is published, installation instructions are
  verified, and advertised capabilities match tested behavior.

## Phase 6 — Custom TV controls and optional features

Authorized by the user on 2026-09-11 after the native simulator/emulator baseline.
Implementation completed in parallel across custom controls, Robots panels, native
remote handoff, and shared integration. Simulator/emulator acceptance is the current
development scope; the physical-device release gate remains separate.

Custom controls use the shared player API and one JavaScript remote owner. Native
controls remain selectable. Robots supports provided content and host callbacks;
the example clearly labels its sample content and keeps API credentials on a backend.

- [x] P6.1 Design a TV-specific custom control layout with clear selected/focused
  states, predictable directional navigation, and remote-friendly seek behavior.
- [x] P6.2 Implement custom play/pause, progress, captions/audio, and settings using
  the shared player API. Ensure native and JavaScript controls do not both handle
  the same remote action.
- [x] P6.3 Add storyboard previews and chapter navigation with reliable remote focus.
- [x] P6.4 Evaluate Robots summaries/chapters/moments/transcripts for TV and define
  accessible focus entry, panel dismissal, and restoration before adding them.
- [x] P6.5 Revisit deferred caching, preloading, PiP, and other capabilities based on
  demonstrated TV use cases and platform support. Decision: retain the documented
  no-op/unsupported TV behavior. Custom controls and Robots do not require cache,
  feed, PiP or background playback changes; none are added without a validated use case.
- [x] **Development acceptance:** custom controls and all four Robots panels pass
  Apple TV simulator and Android TV emulator checks, including transport, seek,
  panel dismissal and focus restoration; final Back priority regression passes.
- [ ] **Phase 6 release gate:** custom TV controls pass the same physical-device navigation,
  accessibility, playback, and lifecycle checks as the native-controls release.

## Risks and decisions to resolve

| Risk / decision | Mitigation or required outcome | Due |
| --- | --- | --- |
| iOS-only dependency pulled into tvOS | Prove platform-specific linking and archive compatibility before the main implementation | Phase 0 |
| Future TV DRM support | Deferred for initial release; scope FairPlay/Widevine and physical-device validation separately | Future phase |
| Expo/RN TV or Media3 version mismatch | Record a tested version set and inspect resolved native dependencies | Phases 0–1 |
| Phone UI compiles but fails on TV | Audit unavailable APIs and test focus/controller lifecycle on device | Phases 1–3 |
| Native controls differ across platforms | Preserve command/event contract; document UI/capability differences | Phases 0–4 |
| Duplicate analytics after replacement/re-entry | Explicit monitor ownership and teardown with verified Mux Data sessions | Phases 2–4 |
| `controls="custom"` consumers have unusable TV UI | Decide documented fallback or explicit unsupported behavior before release | Phase 0 |
| Hardware, fixtures, or analytics access unavailable | Assign an owner and unblock evidence collection; keep release gates unchecked | Phase 0 |

## Execution log

Add a row when work starts, a decision changes scope, or a task completes. Include
task IDs and evidence such as a PR, build log, test result, or device recording.

| Date | Task / decision | Outcome / evidence | Next action |
| --- | --- | --- | --- |
| 2026-09-10 | Planning | TV PRD created from agreed architecture; implementation unstarted | Assign Phase 0 owner and resolve launch scope |
| 2026-09-11 | Parallel implementation | Three Herdr Codex workers: Apple native, Android native, Expo TV foundation; root owns shared JS and validation | Integrate and build both TV apps |
| 2026-09-11 | P0.6 | [Capability matrix and control policy](tv-support.md); custom controls fall back to native, TV fullscreen is host-owned, preload/PiP deferred | Verify on TV targets |
| 2026-09-11 | P3.2 | Foundation-only Swift URL tests pass for encoding, public parameters, signed token-only policy, custom domain, clipping and DRM rejection | Full tvOS app build |
| 2026-09-11 | P0.1, P0.3–4, P1.1–7 | [Tested versions, native builds and repeatable generation](tv-validation.md); both TV targets register the native module; mobile native builds pass | Complete runtime and physical-device qualification |
| 2026-09-11 | P2.2, P2.4 | Final Android TV emulator: native autoplay, pause/seek, Back hides controls, second Back returns to selected card; 5 native Back unit tests | Physical remote, track selection, lifecycle and analytics checks remain |
| 2026-09-11 | P3.1, P3.6–8 | tvOS backend compiles/links with real Expo; source identity and atomic playback intent implemented across both native backends; URL tests and shared regressions pass | Validate Menu return and remaining runtime matrix |
| 2026-09-11 | P5.1–2, P5.4–5 | TV guide, capability matrix, CI contract workflow and [draft release notes](tv-release-notes.md) prepared in repository | CI execution, physical evidence and release authorization remain pending |
| 2026-09-11 | P1 gate, P3.4 | Apple TV XCTest remote smoke passes autoplay, stable pause, resume, seek, Menu return, originating-card focus and reentry; iPhone custom-control playback smoke passes | Physical device, AVKit track panels and full mobile matrix remain pending |
| 2026-09-11 | P4.7 | Final suite: 63 tests; root and TV TypeScript, package build and plugin syntax pass | Re-run required checks on future native changes |
| 2026-09-11 | P5.3 | [Clean consumer](tv-validation.md#packed-consumer-release-builds) built final packed artifact as Android Release APK and unsigned tvOS device archive; duplicate signature packaging fixed and retested | Production signing and physical-device release gates remain pending |
| 2026-09-11 | P4.8 partial | Final mobile builds and public playback/custom play-pause-seek smoke pass on iPhone 17 Pro simulator and isolated Android API 36.1 phone emulator | Fullscreen, replacement, signed/DRM and complete regression matrix remain pending |
| 2026-09-11 | P0.5 — TV DRM scope confirmed | User decision: defer TV DRM; ship public/signed playback first. FairPlay/Widevine excluded from initial TV release | Keep public/signed playback qualification gates; scope TV DRM separately later |
| 2026-09-11 | Analytics environment authorized | User authorized reusing the active Mux CLI environment. Matched its environment to the dashboard Data key and configured ignored local TV fixtures | Verify simulator/emulator view ingestion; API secrets stay outside app bundles |
| 2026-09-11 | Testing scope confirmed | User decision: test on simulators for now. Apple TV simulator and Android TV emulator public-playback smoke evidence is recorded | Continue simulator/emulator validation; physical-device qualification deferred |

| 2026-09-11 | P6.1–P6.4 | Custom TV transport, seek image previews, tracks/settings and four Robots panels implemented. Android TV navigation/seek/captions/quality focus passes; Apple final2 XCTest passes the complete custom remote and panel sequence (121 seconds). | Final Back priority regression and Apple smoke pass; physical/production gates remain separate |
| 2026-09-11 | P6.5 | Caching/preload, PiP, feeds and TV DRM remain deferred; custom controls require none of them. | Revisit only with a concrete TV use case |

## References

- [Expo: build apps for TV](https://docs.expo.dev/guides/building-for-tv/) — TV runtime and config plugin setup.
- [Android: Media3 on Android TV](https://developer.android.com/media/media3/ui/androidtv) — PlayerView key-event delegation and focus.
- [Mux: monitor AVPlayer](https://www.mux.com/docs/guides/monitor-avplayer) — Mux Data support for tvOS and monitor lifecycle.
- [Mux Player Swift package](https://github.com/muxinc/mux-player-swift/blob/main/Package.swift) — upstream platform/dependency declarations; recheck during Phase 0.
- Local integration points: [podspec](../MuxReactNativePlayer.podspec), [Expo module registration](../expo-module.config.json), [config plugin](../plugin/withMuxReactNativePlayer.js), [Apple view](../ios/MuxVideoView.swift), [Android view](../android/src/main/java/com/mux/reactnativeplayer/MuxVideoView.kt), [shared view](../src/MuxVideoView.tsx), and [public types](../src/types.ts).
