# Accessibility

The custom controls (`controls="custom"`) are built to work with VoiceOver (iOS) and
TalkBack (Android), respect the OS reduced-motion setting, and let you style captions.

## Screen readers (VoiceOver / TalkBack)

Every interactive control exposes a role, a label, and (where applicable) state:

- **Play/pause, skip ±, fullscreen, captions, settings, AirPlay, Robots buttons** —
  `accessibilityRole="button"` with descriptive labels that update with state (e.g. the
  play button announces "Pause" while playing, the fullscreen button toggles
  enter/exit).
- **Caption & quality options** — announce their selected state so the screen reader
  says which track / speed / quality is active.
- **Scrubber** — `accessibilityRole="adjustable"` with an `accessibilityValue`
  (0–100% of the timeline) and increment/decrement actions: swipe up/down with the
  screen reader focused on the bar to skip forward/back by the configured `seekSeconds`.
- **Live badge** — announced as a button ("Go to live edge").

Focus order follows the visual layout: the center play cluster, then the bottom
timeline (scrubber → time/LIVE → captions → settings → AirPlay → fullscreen).

## Reduced motion

When the OS "Reduce Motion" setting is on, the controls' fade in/out animations are
disabled (they snap instead of animating). This is detected via `AccessibilityInfo` and
updates live if the user changes the setting.

## Caption styling

Natively-rendered captions follow the OS caption-appearance settings by default
(Settings → Accessibility → Subtitles/Captions), which is the most accessible default.
To override, pass `captionStyle`:

```tsx
<MuxVideoView
  player={player}
  captionStyle={{
    textColor: '#FFFFFF',
    backgroundColor: '#000000B0', // #AARRGGBB supported
    fontScale: 1.25,             // 1 = default size
  }}
/>
```

- Omitted fields fall back to the OS/default appearance.
- `fontScale` multiplies the default caption size.
- Colors are hex strings (`#RRGGBB` or `#AARRGGBB`).

> Status: caption styling is applied via native APIs (iOS `AVTextStyleRule`, Android
> `SubtitleView`/`CaptionStyleCompat`) and has not yet been validated on-device by the
> maintainers — verify with a captioned asset and a development build.
