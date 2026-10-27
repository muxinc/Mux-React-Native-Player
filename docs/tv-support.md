# Apple TV and Android TV support

Status: implementation preview; physical-device release qualification is pending.
The [TV PRD](TV-PRD.md) tracks acceptance evidence and remaining release gates.
Recorded automated checks use simulators and emulators.

## Architecture and dependency baseline

The package preserves `MuxVideoView`, `MuxVideoPlayer`, and `useMuxVideoPlayer` across
mobile and TV. iOS retains Mux Player Swift 1.8.1. tvOS uses AVPlayer and
AVPlayerViewController with Mux Data 4.16.0 / MuxCore 5.14.0 in the resolved TV build.
The podspec allows Mux Data >=4.13.0 and <5.0.0. Android TV retains Mux Player Android 1.6.0 /
Media3 1.11.0. Both TV platforms support selectable native or custom controls.

The TV workspace targets Expo 57.0.22 with `react-native` aliased to
`npm:react-native-tvos@0.86.2-0` and `@react-native-tvos/config-tv@0.1.6`. Expo's
[compatibility table](https://docs.expo.dev/versions/latest/) specifies the 0.86 TV
line for SDK 57. All workspace apps use the same fork to avoid duplicate native
runtimes, as required by the [Expo TV guide](https://docs.expo.dev/guides/building-for-tv/).
Mobile support must be retested after this dependency change; the previous
[Expo 57 mobile baseline](native-player-upgrade.md) used upstream RN 0.86.3.

The [example-tv](../example-tv/) app keeps generated TV projects separate from the
mobile example. Use the [TV example README](../example-tv/README.md) for exact commands, optional
fixtures, and the persisted `RCT_BUILD_FOR_TV=1` Podfile setting. Native builds are
required; Expo Go cannot load this package.

## Controls and presentation

Put one player on a fullscreen TV screen and let the host app own entry/exit and
focus restoration. The TV example demonstrates a focusable video list and a
fullscreen player screen. There is no phone orientation lock or fullscreen Modal
on TV; `enterFullscreen()` / `exitFullscreen()` do not change host navigation.

| Option | TV behavior |
| --- | --- |
| `controls="native"` (default) | AVPlayerViewController on tvOS; PlayerView on Android TV |
| `controls="custom"` | TV overlay with remote transport, seek previews, tracks/settings, and optional Robots panels |
| `controls="none"` or `nativeControls={false}` without an explicit controls value | Hides native controls; the host must provide accessible remote controls and exit navigation |
| `controlsTheme`, `settingsMenu`, `thumbnailPreviews`, `robots` | Configure the custom TV overlay; not applied to native controls |
| `allowsFullscreen`, `onFullscreenChange`, ref fullscreen commands | Host owns TV fullscreen; wrapper reports its own fullscreen state as false |
| Back / Menu | Active custom panel closes first and restores its initiating control; native mode gives native controls first refusal. The host handles screen exit and library focus. |

Do not add a second JavaScript remote transport handler while native controls are
active. Sending both a native and JavaScript play/pause action can toggle twice.
On tvOS, the example enables `TVEventControl.enableTVMenuKey()` while its player
screen is mounted so `BackHandler` can receive Menu, then disables it on exit.
Integrate this with the host navigator's own Menu policy. In custom mode the overlay
owns remote transport; do not add a competing host playback handler.

### Custom controls and Robots

The TV overlay starts with visible controls: a bottom bar with the timeline, play,
skip and the current chapter, and Robots buttons along the top. Text is set in the
bundled DM Sans, as in the design. Remote focus is always white: top-row buttons turn
white, the bar's skip buttons grow and its captions and settings icons fill in,
caption and settings pills fill half-white inside their white border (a selected
pill is already white), Robots cards thicken their white outline without moving their
content, and a focused workflow tab or **…** menu option underlines its label. Playing or paused, the overlay fades away after three seconds without input,
leaving video and captions unobstructed; it stays up once the video ends. Arrow keys fade it back in;
Up focuses the top-row control used last (initially the first visible Robots button),
while other arrows restore the last control.
Center/OK (Select) while hidden plays or pauses,
reveals the controls, and focuses Play so another Select toggles playback again.
Remote media keys remain active while hidden, and while a Robots panel is open,
whichever of its tabs or items has focus. Back/Menu leaves the host screen when
no panel is open. Select also plays or pauses when the timeline is focused; other
focused buttons, menu options, and Robots items perform their own actions.

With the timeline focused, Left/Right open a seek preview; keep pressing
Left/Right to move it a step at a time. As in the native Apple TV player, holding one
starts scanning that way, faster the longer it is held, and the scan keeps going after
release. While it scans, press the same way to speed it up (2×, 4×, 8×, then 16×, shown
on the preview) or the other way to slow it down; below 2× it stops. The video pauses while
you choose a spot, and when the preview rests a sharp frame of that moment fills the
screen behind the controls. Select seeks there and Back/Menu cancels; either way playback
resumes if it was playing. Live streams keep playing and preview only in the card. Storyboard
failures fall back to a thumbnail or an unavailable message; `thumbnailPreviews={false}`
removes image previews, including the full-screen frame. Track menus reflect tracks the
stream exposes. Settings supports playback speed and a maximum-resolution limit; signed streams require resolution limits in their
server-generated JWT, so client quality choices are disabled for signed sources.

Pass `robots` with a summary, chapters, key moments or transcript cues, or provide
callbacks with an `assetId` to load them from your backend. Available features get
top-row buttons; the **…** menu switches each one on or off (Transcript starts off).
#### Remote focus order

Like other TV players, the arrows move one row or one control at a time in screen
order, on both Apple TV and Android TV. From top to bottom the rows are: the Robots
buttons and **…**, the open workflow's content, the timeline, then Play, skip back,
skip forward, Live, captions and settings. Rows do not wrap; at an edge, focus stays put.

- **Left/Right** move along the current row. On the timeline they preview a seek
  instead. With a workflow open, they switch one visible workflow at a time, and
  Right from the last tab reaches **…**; Down from **…** enters the open workflow.
- **Up/Down** move to the next row. Up from a button reaches the timeline first,
  and Up from the timeline reaches the open workflow's content, else the top row.
  A row is re-entered at the control focus left it from: Down from the timeline
  returns to the button you came up from, and Up returns to the top-row button you
  came down from.
- **The … menu** hangs below its button: Up/Down move through its switches, and
  Left closes it onto the workflow button beside **…** (Key Moments by default).
- **Open workflows** sit between their tab and the timeline. Down or Select on the tab
  enters its content at the entry row (Close on Summary, the current chapter or cue,
  or the first moment). Within Summary, focus runs Close, then the text, then the
  timeline. Vertical lists move a row at a time, so keep pressing Up from a transcript
  to reach its tab. Up from any chapter or moment card, including cards at either edge
  of the screen, returns to the tab. Down from a card or the last transcript row
  reaches the timeline, or the button row if the timeline is unavailable.

The Robots panel
stays visible while the bar's playback controls remain usable. Panels support remote
scrolling, loading, empty/error/retry
states, timed-row seeking, and focus restoration to their opening button. Results remain cached while the same source and asset are active; source
replacement invalidates pending requests and old results. Callback error text is
not displayed, because it may contain private backend details.

The default Tears of Steel example bundles genuine completed Mux Robots results
and its English caption transcript for repeatable navigation tests without a local
proxy. Its optional connected card demonstrates backend callbacks. API credentials must
stay on the backend; see [example setup](../example-tv/README.md#tv-controls-and-robots).
Unmount a player screen when it loses host navigation focus; a hidden mounted
screen must not remain a competing remote owner. The overlay also suspends input
when the app is inactive or its controls lose focus.

## Capability matrix

These entries describe implementation scope, not physical-device certification.
See the PRD validation matrix for the distinction between implemented and verified.

| API or behavior | tvOS | Android TV |
| --- | --- | --- |
| Public playback ID, VOD, live HLS | Implemented with AVPlayer | Existing Mux Player backend |
| `playbackToken` | Token passed to HLS endpoint | Existing Mux Player backend |
| `customDomain` | Validated custom playback host | Existing Mux Player backend |
| `minResolution`, `maxResolution`, `renditionOrder`, `clipping` | Public URL parameters; signed-stream constraints belong in JWT claims | Existing Mux Player source options |
| `assetId` | Passed to optional host Robots callbacks; provided content needs no asset ID | Same |
| `drmToken` | Rejected with an explicit unsupported error | Existing Widevine backend; TV hardware verification pending, no TV DRM support claim |
| Metadata environment/player/video/viewer/custom fields | Mux Data AVPlayer monitor | Mux Player's Mux Data integration |
| Play, pause, replay, seekBy, seekTo, live-edge seek | Implemented; seekable-window clamping for live | Existing commands with native remote handling |
| Mute, volume, loop, playback rate | Native player properties; remote hardware volume remains OS-controlled | Native player properties; remote hardware volume remains OS-controlled |
| Caption/audio tracks and selection | AVPlayer media selection | Media3 track selection |
| `replace`, `release`, repeated screen entry/exit | Source/observer/monitor ownership and teardown | Player/session ownership and teardown |
| Status, playing, time, load, error, first-frame events | Mapped to shared contract | Existing shared contract with lifecycle fixes |
| `contentFit` | Native gravity/layout | Native resize mode |
| `poster`, `posterTime`, `thumbnailToken` | Noninteractive overlay until first frame; signed image token kept separate | Same |
| `captionStyle` | Native/OS caption rendering; verify actual appearance on TV | Existing native caption styling |
| `startupBufferDuration`, `timeUpdateEventInterval` | Native buffer preference and event interval | Existing native configuration |
| `allowsAirPlay` / AirPlay button | Mobile button not loaded on TV | No AirPlay button |
| `allowsPictureInPicture` | Disabled for initial TV preview | Disabled for initial TV preview |
| `enableNowPlaying` | AVKit/OS owns system transport; flag is a no-op on tvOS | Opt-in MediaSession in native-control mode; detached for custom/none, no mobile notification |
| `preloadMuxVideo`, cancel preload APIs | Best-effort no-ops; `isMuxVideoPreloadSupported()` is false | Same; TV caching/preload not advertised |
| `storyboardToken`, storyboard/chapter UI | Custom overlay supports storyboard seek previews and Robots chapter navigation | Same |
| Feed helpers | Standalone helpers retained; TV feed UX is deferred | Same |
| Standard `ViewProps` | Applied to the TV container; the selected controls own focus | Same |

TV DRM is deferred by confirmed launch decision. The initial TV release targets
public and signed playback; FairPlay/Widevine are not launch requirements.
Do not put playback signing keys or Mux API secrets into app code. Playback
and image tokens must be generated server-side and scoped to their respective use.

Equivalent `replace()` calls are idempotent. Each actual source change receives a
non-secret `sourceId`, echoed in native events so delayed messages from a replaced
source cannot overwrite the current state, including token refreshes of the same
playback ID. Native generation guards also protect asynchronous callbacks.

Playback commands also carry an internal intent revision. Native status reports
acknowledge that revision so a queued pause from an earlier render cannot undo a
newer `play()` call. Remote actions use the currently committed revision and still
update the shared player state. Source and intent props are applied together after
each native prop batch.

## Release qualification

Before advertising production TV support, complete physical-device checks in
[TV-PRD.md](TV-PRD.md): signed playback and expiration, captions/audio, live/DVR,
remote Back and focus, VoiceOver/TalkBack, Mux Data session metadata and teardown,
network recovery, a 30-minute session and 20 entry/exit cycles on each TV platform.
Measure startup and seek recovery against the same device/source/network baseline.
Mobile custom controls, fullscreen, signed playback, and DRM also need regression
checks after changing the shared React Native dependency.

A passing simulator build does not satisfy those device gates. Publishing remains
subject to the repository's release authorization and the PRD evidence review.
