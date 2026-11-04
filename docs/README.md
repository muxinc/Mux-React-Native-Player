# Mux React Native Player Docs

A React Native video player with built-in Mux Data and Mux Robots integrations. Playback is delegated to [`mux-player-swift`](https://github.com/muxinc/mux-player-swift) on iOS and [`mux-player-android`](https://github.com/muxinc/mux-player-android) on Android. The TV preview uses AVPlayer with Mux Data on tvOS and the existing Android backend on Android TV.

- [Getting Started](getting-started.md) — install, config plugin, and your first player
- [Orientation & Fullscreen](orientation-and-fullscreen.md) — letting the player rotate to landscape, theater mode, Info.plist setup
- [API Reference](api-reference.md) — `MuxVideoView` props, player commands, events, theming
- [Feeds & Shorts](feeds.md) — `useMuxVideoFeed` for TikTok/Reels-style vertical feeds
- [Accessibility](accessibility.md) — screen readers, reduced motion, caption styling
- [Mux Robots](robots.md) — AI summaries, chapters, and key moments with a secure backend
- [TV Support](tv-support.md) — implementation capabilities and [validation evidence](tv-validation.md)
- [TV Release Notes](tv-release-notes.md) — draft preview scope and integration changes
- [TV Support PRD](TV-PRD.md) — Apple TV and Android TV implementation, phased checklists, and release acceptance criteria

## Requirements

- Current workspace: Expo 57.0.22 / React Native TV 0.86.2-0; [current validation](tv-validation.md)
- Baseline app minimums: iOS / tvOS 16.4+, Android minSdk 24+
- Android compileSdk 37+, AGP 9.1.1 / Gradle 9.3.1, with [compatibility configuration and patches](native-player-upgrade.md)
- Native verification uses Xcode 26.6 and JDK 17; Expo Go is unsupported
