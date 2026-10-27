# Mux React Native Player

<p align="center">
  <img src="https://raw.githubusercontent.com/muxinc/Mux-React-Native-Player/main/assets/player_screenshot.png" alt="Mux React Native Player" width="320" />
</p>

A React native video player with built-in Mux Data and Mux Robots integrations. Native playback is delegated to:

- iOS: [`muxinc/mux-player-swift`](https://github.com/muxinc/mux-player-swift)
- Android / Android TV: [`muxinc/mux-player-android`](https://github.com/muxinc/mux-player-android)
- tvOS (preview): AVPlayer / AVPlayerViewController with Mux Data

## Documentation

Full guides live in [`docs/`](https://github.com/muxinc/Mux-React-Native-Player/tree/main/docs):

- [Getting Started](https://github.com/muxinc/Mux-React-Native-Player/blob/main/docs/getting-started.md)
- [Orientation & Fullscreen](https://github.com/muxinc/Mux-React-Native-Player/blob/main/docs/orientation-and-fullscreen.md) — required setup for landscape/theater mode
- [API Reference](https://github.com/muxinc/Mux-React-Native-Player/blob/main/docs/api-reference.md)
- [Feeds & Shorts](https://github.com/muxinc/Mux-React-Native-Player/blob/main/docs/feeds.md) — `useMuxVideoFeed`
- [Mux Robots](https://github.com/muxinc/Mux-React-Native-Player/blob/main/docs/robots.md)

- [TV Support](docs/tv-support.md) — capabilities, limitations, and [TV example setup](example-tv/README.md)

## Requirements

- Current workspace: Expo 57.0.22 with `react-native` aliased to `react-native-tvos@0.86.2-0` for mobile and TV native builds
- The earlier mobile-only baseline used React Native 0.86.3; see [TV validation](docs/tv-validation.md) for current evidence
- Baseline app minimums: iOS / tvOS 16.4+, Android minSdk 24+
- Android compileSdk 37+ and AGP 9.1.1 / Gradle 9.3.1, with the [Expo 57 compatibility setup](docs/native-player-upgrade.md)

The repository example includes the compatibility configuration and patches needed
for this Android toolchain. Stock Expo 57 requires that setup before building Mux
Player Android 1.6.0. Other Expo/React Native combinations are not verified by this baseline.

## Install

```sh
npm install @mux/mux-react-native-player
```

```json
{
  "expo": {
    "plugins": [
      [
        "@mux/mux-react-native-player/plugin",
        { "enablePictureInPicture": true }
      ]
    ]
  }
}
```

```sh
npx expo prebuild --no-clean
npx expo run:ios
npx expo run:android
```

## Usage

```tsx
import { MuxVideoView, useMuxVideoPlayer } from "@mux/mux-react-native-player";

export default function Player() {
  const player = useMuxVideoPlayer({
    playbackId: "qxb01i6T202018GFS02vp9RIe01icTcDCjVzQpmaB00CUisJ4",
    metadata: {
      envKey: "YOUR_MUX_DATA_ENV_KEY",
      playerName: "MuxReactNativePlayerExample",
      videoTitle: "Mux playback in React Native",
      viewerUserId: "user-123",
    },
  });

  return (
    <MuxVideoView
      player={player}
      controls="custom"
      contentFit="contain"
      style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "black" }}
    />
  );
}
```

`controls`: `"native"` for platform controls, `"custom"` for the mobile or TV JavaScript controls, `"none"` for the bare video surface. The TV overlay uses remote focus and includes Robots panels. With `"none"`, the TV host must provide its own accessible controls and exit navigation. See the [TV support guide](docs/tv-support.md) for preview limitations.

## Source Options

```ts
type MuxVideoSource = {
  playbackId: string;
  assetId?: string;
  playbackToken?: string;
  drmToken?: string;
  customDomain?: string;
  minResolution?: "480p" | "540p" | "720p" | "1080p" | "1440p" | "2160p";
  maxResolution?: "720p" | "1080p" | "1440p" | "2160p";
  renditionOrder?: "default" | "desc";
  clipping?: { assetStartTime?: number; assetEndTime?: number };
  metadata?: {
    envKey?: string;
    playerName?: string;
    videoTitle?: string;
    videoId?: string;
    viewerUserId?: string;
    customData?: Record<string, string>;
  };
};
```

- `metadata.envKey` enables Mux Data.
- `drmToken` requires `playbackToken`. tvOS rejects DRM sources in this preview; Android TV DRM is not certified.
- The source is mutable — pass it from state and the player will reload when it changes. Replacing an equivalent source is a no-op; use `replay()` to restart it.

## Player Commands

```ts
await player.play();
await player.pause();
await player.seekTo(12);
await player.seekBy(10);
await player.replay();
await player.setMuted(true);
await player.setVolume(0.5);
await player.setLoop(true);
await player.setPlaybackRate(1.25);
player.replace({ playbackId: "NEW_PLAYBACK_ID" });
await player.release();
```

## Mux Robots UI

When using `controls="custom"`, you can add Mux Robots buttons (summary, chapters, key moments). Keep `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` on a backend and pass callbacks:

```tsx
<MuxVideoView
  player={player}
  controls="custom"
  robots={{
    onSummarize: ({ assetId }) =>
      fetchJson("/mux/robots/summarize", { assetId }),
    onGenerateChapters: ({ assetId }) =>
      fetchJson("/mux/robots/chapters", { assetId }),
    onFindKeyMoments: ({ assetId }) =>
      fetchJson("/mux/robots/key-moments", { assetId }),
  }}
/>
```

Buttons appear only for actions with a callback. While the Chapters panel is open, chapters render as timeline markers; while the Moments panel is open, key moments render as highlighted ranges. Selecting either seeks to its start time.
