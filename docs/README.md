# Mux React Native Player Docs

A React Native video player with built-in Mux Data and Mux Robots integrations. Playback is delegated to [`mux-player-swift`](https://github.com/muxinc/mux-player-swift) on iOS and [`mux-player-android`](https://github.com/muxinc/mux-player-android) on Android.

- [Getting Started](getting-started.md) — install, config plugin, and your first player
- [Orientation & Fullscreen](orientation-and-fullscreen.md) — letting the player rotate to landscape, theater mode, Info.plist setup
- [API Reference](api-reference.md) — `MuxVideoView` props, player commands, events, theming
- [Feeds & Shorts](feeds.md) — `useMuxVideoFeed` for TikTok/Reels-style vertical feeds
- [Accessibility](accessibility.md) — screen readers, reduced motion, caption styling
- [Mux Robots](robots.md) — AI summaries, chapters, and key moments with a secure backend

## Requirements

- React Native 0.75+ with Expo Modules (Expo SDK 52+; tested on SDK 55)
- iOS 15+, Android minSdk 23+
- Expo SDK 56 note: Expo itself requires Xcode 26.1+ to compile on iOS
