# Getting Started

## 1. Install

```sh
npx expo install @mux/mux-react-native-player expo-linear-gradient
```

`expo-linear-gradient` is a peer dependency used by the custom controls.

## 2. Add the config plugin

In `app.json` (or `app.config.js`):

```json
{
  "expo": {
    "plugins": [
      [
        "@mux/mux-react-native-player/plugin",
        {
          "enablePictureInPicture": true,
          "enableBackgroundAudio": false
        }
      ]
    ]
  }
}
```

### Plugin options

| Option | Default | Effect |
| --- | --- | --- |
| `enablePictureInPicture` | `false` | Adds the `audio` background mode on iOS so video keeps playing in PiP |
| `enableBackgroundAudio` | `false` | Adds the `audio` background mode on iOS for background playback |

### What the plugin configures for you

- **iOS**: adds a build phase that embeds `MuxCore.framework` (required by Mux Player Swift), and the `UIBackgroundModes` entry when PiP/background audio is enabled
- **Android**: adds the Mux Maven repository, `INTERNET` / `ACCESS_NETWORK_STATE` permissions, and the Kotlin/compileSdk versions Mux Player Android needs

## 3. Rebuild the native app

The player is a native module, so it does not run in Expo Go. Generate native projects and build a development client:

```sh
npx expo prebuild
npx expo run:ios
npx expo run:android
```

After this first build, day-to-day development works with `npx expo start` as usual. You only need to rebuild after changing native config (plugin options, new native modules).

## 4. Render a player

```tsx
import { MuxVideoView, useMuxVideoPlayer } from '@mux/mux-react-native-player';

export default function PlayerScreen() {
  const player = useMuxVideoPlayer({
    playbackId: 'YOUR_MUX_PLAYBACK_ID',
    metadata: {
      envKey: 'YOUR_MUX_DATA_ENV_KEY', // optional: enables Mux Data
      videoTitle: 'My first video',
      viewerUserId: 'user-123',
    },
  });

  return (
    <MuxVideoView
      player={player}
      controls="custom"
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: 'black' }}
    />
  );
}
```

- `controls="custom"` renders the shared cross-platform controls (scrubber, captions, fullscreen, optional Robots buttons). Use `"native"` for platform controls or `"none"` for a bare video surface.
- The player starts paused. Call `player.play()` or let the user tap play.

## Next steps

- Want fullscreen / landscape? Your app must allow landscape orientations — see [Orientation & Fullscreen](orientation-and-fullscreen.md).
- Full prop and command listing: [API Reference](api-reference.md).
- AI summaries, chapters, and key moments: [Mux Robots](robots.md).
