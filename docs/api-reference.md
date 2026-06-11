# API Reference

## Creating a player

### `useMuxVideoPlayer(source?, setup?)`

React hook that creates a `MuxVideoPlayer` and keeps it in sync with `source`. Changing the source (by identity) reloads the video.

```tsx
const player = useMuxVideoPlayer(
  { playbackId: 'abc123' },
  player => player.setMuted(true) // optional one-time setup
);
```

### `createMuxVideoPlayer(source?)`

Imperative factory for use outside React components. You own the lifecycle — call `player.release()` when done.

## Video sources

A source is either a playback ID string or an object:

```ts
type MuxVideoSourceObject = {
  playbackId: string;
  assetId?: string;          // required for Mux Robots callbacks
  playbackToken?: string;    // signed playback
  drmToken?: string;         // DRM (requires playbackToken)
  customDomain?: string;     // e.g. media.example.com
  minResolution?: '480p' | '540p' | '720p' | '1080p' | '1440p' | '2160p';
  maxResolution?: '720p' | '1080p' | '1440p' | '2160p';
  renditionOrder?: 'default' | 'desc';
  clipping?: { assetStartTime?: number; assetEndTime?: number };
  metadata?: MuxVideoMetadata;
};
```

### Mux Data metadata

Set `metadata.envKey` to enable [Mux Data](https://www.mux.com/data) monitoring; the other fields enrich the views it records:

```ts
type MuxVideoMetadata = {
  envKey?: string;
  playerName?: string;
  playerVersion?: string;
  videoTitle?: string;
  videoId?: string;
  videoSeries?: string;
  viewerUserId?: string;
  customData?: Record<string, string>; // customData1–customData10
};
```

## `<MuxVideoView />` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `player` | `MuxVideoPlayer` | required | The player instance driving this view |
| `controls` | `'native' \| 'custom' \| 'none'` | `'native'` | Platform controls, the shared JS controls, or none |
| `controlsTheme` | `MuxVideoControlsTheme` | — | Colors/sizing for the custom controls (below) |
| `robots` | `MuxVideoRobotsConfig` | — | Enables Mux Robots buttons in custom controls — see [Mux Robots](robots.md) |
| `contentFit` | `'contain' \| 'cover' \| 'fill'` | `'contain'` | How video fills the view |
| `poster` | `boolean \| string \| { uri }` | auto | Poster before first frame. Omit/`true` = auto Mux thumbnail, `false` = none, string/`{uri}` = custom |
| `posterTime` | `number` | — | Time (seconds) for the auto-generated poster frame |
| `thumbnailPreviews` | `boolean` | `true` | Show storyboard thumbnail previews above the scrubber while dragging (custom controls) |
| `allowsFullscreen` | `boolean` | `true` | Fullscreen button + rotate-to-fullscreen ([setup required](orientation-and-fullscreen.md)) |
| `allowsPictureInPicture` | `boolean` | — | PiP support (also enable the plugin option) |
| `timeUpdateEventInterval` | `number` | — | Seconds between `onTimeUpdate` events |
| `startupBufferDuration` | `number` | — | Target startup buffer in seconds |
| `onStatusChange` | `(e: MuxPlayerStatus) => void` | — | Status, time, duration, volume, captions snapshot |
| `onPlayingChange` | `(e: { isPlaying }) => void` | — | Play/pause transitions |
| `onTimeUpdate` | `(e: { currentTime, duration, bufferedPosition }) => void` | — | Playback progress |
| `onSourceLoad` | `(e: { playbackId, duration, captionTracks }) => void` | — | Source became ready |
| `onSourceError` | `(e: { message, code?, playbackId? }) => void` | — | Source failed to load |
| `onFullscreenChange` | `(isFullscreen: boolean) => void` | — | Fullscreen entered/exited |

Plus all standard `ViewProps` (`style`, etc.).

### View ref

`<MuxVideoView ref={...} />` exposes the native commands plus `enterFullscreen()` / `exitFullscreen()` if you need to drive fullscreen programmatically.

## Player commands & state

All commands return promises and are safely queued until the native view attaches:

```ts
await player.play();
await player.pause();
await player.replay();
await player.seekTo(12);          // absolute seconds
await player.seekBy(10);          // relative seconds (negative rewinds)
await player.setMuted(true);
await player.setVolume(0.5);      // 0–1
await player.setLoop(true);
await player.setPlaybackRate(1.25); // 0.25–4
await player.setCaptionTrack(trackId); // or null to disable
player.replace({ playbackId: 'NEW_ID' }); // swap source, keeps settings
await player.release();           // tear down native playback
```

Readable state on the instance: `status`, `currentTime`, `duration`, `bufferedPosition`, `error`, `muted`, `volume`, `loop`, `playbackRate`.

### Playback status values

`idle → loading → ready → playing / paused / buffering → ended`, with `error` on failure. Subscribe via `onStatusChange` on the view.

## Captions

Available tracks arrive on `onSourceLoad` / `onStatusChange` as `captionTracks` (`{ id, label, language?, kind? }`). Select with `player.setCaptionTrack(id)`, disable with `null`. The custom controls include a captions menu automatically when tracks exist.

## Custom controls theming

```tsx
<MuxVideoView
  player={player}
  controls="custom"
  controlsTheme={{
    accentColor: '#fa50b5',
    backgroundColor: 'rgba(0,0,0,0.4)',
    buttonBackgroundColor: 'rgba(255,255,255,0.15)',
    buttonTextColor: '#ffffff',
    textColor: '#ffffff',
    progressTrackColor: '#fa50b5',
    bufferedTrackColor: 'rgba(255,255,255,0.35)',
    trackColor: 'rgba(255,255,255,0.2)',
    trackHeight: 4,
    buttonSize: 40,
    playButtonSize: 56,
    fullscreenButtonSize: 36,
    seekSeconds: 10, // double-tap / skip amount
  }}
/>
```

All fields are optional; omitted values fall back to the default dark theme.

## Poster & scrubber thumbnail previews

Mux generates a poster image and a storyboard sprite sheet for every asset, so
these work with no extra backend setup.

- **Poster** — before the first frame the player shows
  `https://image.mux.com/{playbackId}/thumbnail.jpg`. Use `posterTime` to pick a
  frame, `poster={false}` to disable, or `poster="https://…"` for a custom image.
- **Scrubber previews** — while scrubbing with `controls="custom"`, a thumbnail of
  the target time renders above the scrubber, sourced from the storyboard VTT
  (`storyboard.vtt` + sprite sheet). Disable with `thumbnailPreviews={false}`. If
  the storyboard is unavailable the player falls back to per-time thumbnails, and
  if both fail it degrades silently (no preview, no error).

### Signed playback

For signed playback, pass the matching tokens on the source so image URLs are
authorized:

```ts
{
  playbackId: 'abc',
  playbackToken: '…',   // video
  thumbnailToken: '…',  // poster + fallback scrubber thumbnails
  storyboardToken: '…', // storyboard sprite previews
}
```

### Building image URLs yourself

The URL helpers are exported if you need posters/thumbnails elsewhere:

```ts
import { buildMuxThumbnailUrl, buildMuxStoryboardVttUrl } from '@mux/mux-react-native-player';

buildMuxThumbnailUrl({ playbackId: 'abc' }, { time: 30, width: 640 });
buildMuxStoryboardVttUrl({ playbackId: 'abc' });
```
