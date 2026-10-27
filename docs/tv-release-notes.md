# Draft release notes — TV preview

Proposed next version: `0.2.0-tv.0`, followed by `0.2.0` after qualification.
The package remains `0.1.15` while this change is reviewed. No version bump,
registry publication, signed distribution archive, or store submission has occurred.

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
  and focus restoration. The example includes labeled sample content.
- Metro watch configuration for library source/assets in workspace and packed
  installs, so player edits no longer leave stale example bundles.

## Integration changes

Use the [tested dependency set and setup guide](../example-tv/README.md). The
repository now uses `react-native-tvos@0.86.2-0` consistently across its workspaces;
installations must avoid a second stock React Native runtime. The example's host
compatibility plugin and patches are needed for this tested Android toolchain.

TV `controls="custom"` now selects a remote-focused overlay with transport, seek
previews, tracks/settings, and optional Robots panels. Native controls remain the
default and can be selected explicitly. `controls="none"` remains
available, with host-owned remote controls and exit navigation. Fullscreen entry,
exit, and focus restoration belong to the TV host screen. Phone orientation APIs,
the AirPlay button, PiP, and preload are not part of this TV preview.

Equivalent `replace()` calls are now idempotent. Real changes, including a new
token for the same playback ID, create a new internal source identity. Imperative
playback methods still return promises; applications should handle rejection when
a view detaches before an asynchronous native command arrives.

tvOS signed playback follows Mux's token-only URL policy: resolution and clipping
constraints for signed streams belong in JWT claims. tvOS DRM sources are explicitly
rejected. Android's existing Widevine backend has not been certified on TV hardware.
TV DRM is deferred by the confirmed release scope; public and signed playback ship first.

## Validation and release gate

See [validation evidence](tv-validation.md) and the [tracked PRD](TV-PRD.md).
Simulator and emulator playback checks support this implementation preview.
Physical remote navigation, signed/live fixtures, analytics, accessibility, sustained
playback, performance, and the full mobile regression matrix remain required before
production TV support is advertised. The package must pass final release review
and receive publication authorization before these notes become a published release.
