# Release notes — 0.2.0 (Apple TV and Android TV)

`0.2.0` adds Apple TV and Android TV support and is the `latest` release on npm:

```sh
npm install @mux/mux-react-native-player
npx expo install expo-font
```

The code is the same as `0.2.0-beta.0`. If you installed the beta, move to `0.2.0`.

## Added

- Apple TV playback through AVPlayer/AVPlayerViewController and Mux Data, while
  retaining Mux Player Swift on iOS.
- Android TV focus, native remote key routing, Back handling, lifecycle suspension,
  and opt-in MediaSession support without a phone notification.
- An isolated Expo 57 TV example, repeatable native generation, TV framework
  embedding, and automated configuration checks.
- Source identity and playback intent revisions that prevent delayed native events
  from overwriting a replacement source or a newer playback command.

- TV custom controls with storyboard seeking and separate focus/selection states.
- Summary, Chapters, Moments, and Transcript panels with provided content or host
  callbacks, remote scrolling, safe errors/retry, source-scoped results, timed seeks
  and focus restoration. The example bundles completed Robots results for Tears of Steel.
- Metro watch configuration for library source/assets in workspace and packed
  installs, so player edits no longer leave stale example bundles.

## Integration changes

Use the [tested dependency set and setup guide](../example-tv/README.md). The
repository now uses `react-native-tvos@0.86.2-0` consistently across its workspaces;
installations must avoid a second stock React Native runtime. The example's host
compatibility plugin and patches are needed for this tested Android toolchain.

The package now has a peer dependency on `expo-font`, which loads the TV controls'
bundled fonts. npm installs it automatically; in an Expo app, run
`npx expo install expo-font` so its version matches your SDK.

TV `controls="custom"` now selects a remote-focused overlay with transport, seek
previews, tracks/settings, and optional Robots panels. Native controls remain the
default and can be selected explicitly. `controls="none"` remains
available, with host-owned remote controls and exit navigation. Fullscreen entry,
exit, and focus restoration belong to the TV host screen. Phone orientation APIs,
the AirPlay button, PiP, and preload are not supported on TV.

Equivalent `replace()` calls are now idempotent. Real changes, including a new
token for the same playback ID, create a new internal source identity. Imperative
playback methods still return promises; applications should handle rejection when
a view detaches before an asynchronous native command arrives.

tvOS signed playback follows Mux's token-only URL policy: resolution and clipping
constraints for signed streams belong in JWT claims. tvOS DRM sources are explicitly
rejected. Android's existing Widevine backend has not been certified on TV hardware.
TV DRM is deferred by the confirmed release scope; public and signed playback ship first.

## Validation

Simulator and emulator checks are recorded in [validation evidence](tv-validation.md)
and the [tracked PRD](TV-PRD.md). `0.2.0-beta.0` was then tested on physical Apple TV
and Android TV devices before this release.
