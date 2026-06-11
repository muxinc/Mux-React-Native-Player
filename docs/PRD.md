# PRD — Mux React Native Player Feature Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

This document is the source of truth for the autonomous build loop. Each item has
acceptance criteria that must ALL be checkable before the item is marked `[x]`.
Work top-to-bottom: finish (and verify) one item before starting the next.

Global constraints for every item:
- `npm run typecheck` and `npm test` must pass.
- New public API must be exported from `src/index.ts` and typed in `src/types.ts`.
- New props/behavior must be documented in the relevant file under `docs/`.
- Native changes (iOS Swift / Android Kotlin) must keep the example app building.
- No `console.log` left in shipped `src/`.
- Update this file's checkbox + the Changelog section when an item completes.

---

## 0. Cleanup — strip debug console.logs `[x]`

**Done** in commit `8037543` (2026-06-11). All `[MuxControls]` debug logs removed from
`src/MuxVideoControls.tsx`; seek/scrub handlers now use `runPlayerCommand`.

---

## Tier 1 — High value, low-to-medium effort

### 1. Scrubber thumbnail previews + automatic poster `[x]`

**Why:** Mux generates storyboards and thumbnails for every asset for free. A preview
frame above the scrubber and a real poster (instead of a black box) are marquee features
with no backend cost.

**Acceptance criteria:**
- [ ] A `poster` is shown before first frame, defaulting to
  `https://image.mux.com/{playbackId}/thumbnail.jpg` (with `?token=` when a
  `playbackToken` is present). Overridable/disable-able via prop.
- [ ] While scrubbing with `controls="custom"`, a thumbnail preview of the target time
  renders above the scrubber thumb, sourced from
  `https://image.mux.com/{playbackId}/storyboard.vtt` + sprite sheets (or per-frame
  `thumbnail.jpg?time=`).
- [ ] Storyboard VTT is fetched once per source and parsed to map time → sprite rect.
- [ ] Works with signed playback (token appended to image URLs).
- [ ] Gracefully degrades (no preview, no crash) if storyboard is unavailable.
- [ ] Props documented in `docs/api-reference.md`; typed in `src/types.ts`.

**Technical notes:** new `normalizeSource`-adjacent helper to build image URLs; a small
VTT parser; preview positioned using existing scrub `trackPageX`/`trackWidth` math.

---

### 2. Playback speed & quality settings menu `[x]`

**Why:** Player API already supports `setPlaybackRate` and `minResolution`/`maxResolution`;
there's no UI surface for them.

**Acceptance criteria:**
- [ ] A settings (gear) button appears in the custom controls next to captions/fullscreen.
- [ ] Speed submenu offers at least 0.5×, 1×, 1.25×, 1.5×, 2× and calls
  `player.setPlaybackRate`. Current rate is indicated.
- [ ] Quality submenu lets the user cap resolution (Auto + the `MuxMaxResolution` values)
  and applies it to the active source.
- [ ] Menu dismisses on background tap like the captions/robots panels.
- [ ] Configurable: `controlsTheme` or a prop can hide speed and/or quality menus.
- [ ] Documented in `docs/api-reference.md`.

---

### 3. Background audio + lock-screen / Now Playing controls `[ ]`

**Why:** The config plugin already adds `UIBackgroundModes: audio`; the missing half is
publishing Now Playing metadata so the OS shows lock-screen transport controls.

**Acceptance criteria:**
- [ ] iOS: populate `MPNowPlayingInfoCenter` (title, artwork, duration, elapsed, rate) and
  handle `MPRemoteCommandCenter` play/pause/seek, wired to the native player.
- [ ] Android: a `MediaSession` with matching metadata + transport actions and a media
  notification.
- [ ] Artwork defaults to the Mux thumbnail; title/metadata pulled from `MuxVideoMetadata`.
- [ ] Opt-in via prop (e.g. `enableNowPlaying`) so it doesn't surprise consumers.
- [ ] Documented; plugin docs note any added permissions (Android `FOREGROUND_SERVICE`,
  notification).

---

## Tier 2 — Strong differentiators, more native work

### 4. AirPlay & Chromecast `[ ]`

**Why:** Table stakes for serious video apps; common reason to reject a player library.

**Acceptance criteria:**
- [ ] iOS AirPlay: an `AVRoutePickerView`-backed button in the custom controls (shown when
  routes are available), togglable via prop.
- [ ] Chromecast: integration path documented; a cast button + basic load/play to a
  receiver, or a clearly-scoped follow-up if the dependency footprint is too large for v1.
- [ ] Casting state reflected in UI (e.g. "Playing on <device>").
- [ ] Documented, including any required native config / app IDs.

**Note:** Chromecast may be split into its own PRD item if the GCKCast SDK + Android
dependency proves too heavy. Document the decision either way.

---

### 5. First-class feed/shorts support (`useMuxVideoFeed`) `[ ]`

**Why:** The example already has a TikTok-style feed. Productizing preload / off-screen
release / autoplay presets is where naive RN video implementations fall apart.

**Acceptance criteria:**
- [ ] A `useMuxVideoFeed` (or equivalent) hook/component that manages a window of players:
  preloads the next N, releases off-screen ones.
- [ ] Presets for mute + autoplay + loop suited to a vertical feed.
- [ ] Memory stays bounded while scrolling a long list (no unbounded native player growth).
- [ ] The example app's feed screen is refactored to use it (proof + demo).
- [ ] Documented in a new `docs/feeds.md`.

---

### 6. Live stream support `[ ]`

**Why:** Live + DVR behavior differs from VOD and needs explicit handling.

**Acceptance criteria:**
- [ ] Player detects live streams and exposes a `isLive` (and live-edge) signal.
- [ ] Custom controls show a "LIVE" badge; tapping it seeks to the live edge.
- [ ] DVR scrubbing behaves correctly (seekable window, not 0..duration).
- [ ] Behavior documented in `docs/api-reference.md`.

---

## Tier 3 — Polish / credibility

### 7. Accessibility pass `[ ]`

**Acceptance criteria:**
- [ ] VoiceOver/TalkBack focus order through controls is logical and complete.
- [ ] Caption styling options (size/color/background) exposed via `controlsTheme` or props.
- [ ] Reduced-motion handling (respect OS setting; tone down fades/animations).
- [ ] All interactive controls have correct roles/labels/state (audit existing ones).
- [ ] Documented in a new `docs/accessibility.md`.

---

### 8. Expanded Robots surface `[ ]`

**Acceptance criteria:**
- [ ] A transcript panel in the Robots UI (callback-driven, same backend pattern as
  summary/chapters/moments).
- [ ] Optionally feed chapter data into native iOS chapter markers.
- [ ] Typed config additions in `src/types.ts`; documented in `docs/robots.md`.

---

## Changelog (loop appends here)

- 2026-06-11 — Item 0 (console.log cleanup) completed in `8037543`.
- 2026-06-11 — Item 1 (scrubber thumbnail previews + auto poster) completed. New
  `muxImageUrls.ts` / `storyboard.ts` modules, `poster`/`posterTime`/`thumbnailPreviews`
  props, signed-playback tokens, exported URL helpers, 13 new tests.
- 2026-06-11 — Item 2 (playback speed & quality settings menu) completed. Gear menu in
  custom controls with speed chips (0.5–2×) and quality cap (Auto + 720p–2160p); new
  `player.setMaxResolution()` + `maxResolution` getter that reloads and resumes;
  `settingsMenu` prop (toggle whole menu or per-section); 2 new tests.
