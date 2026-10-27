# Expo SDK 57 baseline and native player upgrade

Updated: 2026-09-11. This baseline precedes the [TV implementation](TV-PRD.md).
This document records the original mobile upgrade. The subsequent TV work switches
the shared workspace to `react-native-tvos@0.86.2-0`; see [TV support](tv-support.md)
and [current validation](tv-validation.md) for that implementation and its evidence.
The version table and verification below describe the original mobile baseline.

## Version set

| Component | Baseline |
| --- | --- |
| Expo | 57.0.22 |
| React Native | 0.86.3 |
| React / React DOM | 19.2.3 |
| TypeScript | 6.0.3 |
| Mux Player Swift | 1.8.1, with compatible newer 1.x releases allowed by the podspec |
| Mux Player Android | 1.6.0 |
| Media3 UI / session | 1.11.0 |
| Android Gradle Plugin / Gradle | 9.1.1 / 9.3.1 |
| Android compile SDK / target SDK / minimum SDK in example | 37 / 36 / 24 |
| JDK | 17 |
| Xcode / minimum iOS in example | 26.6 / 16.4 |

Swift and Android versions were checked against GitHub's latest stable releases:
[Swift 1.8.1](https://github.com/muxinc/mux-player-swift/releases/tag/v1.8.1),
[Android 1.6.0](https://github.com/muxinc/mux-player-android/releases/tag/v1.6.0).
Expo 57 uses [React Native 0.86.3](https://expo.dev/changelog/sdk-57) in current patches.
The root lockfile records the complete dependency set.

## Reproduce the baseline

The library and example are an npm workspace. Install from the repository root;
there is one lockfile and one shared React/native dependency graph. The example's
postinstall applies the versioned compatibility patches to the workspace dependencies.
These commands now use the TV fork recorded in the current root lockfile.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:plugin

cd example
npx expo-doctor
npx tsc --noEmit
npx expo prebuild --no-clean --no-install
cd ios
pod install
cd ..
npm run ios:build
npm run android:build
```

Expo 57 prebuild cleans native projects by default; `--no-clean` explicitly preserves
the generated folders for incremental updates. Prebuild regenerates configuration. Keep manual native app changes
in config plugins before running it. The example compatibility plugin reapplies
all required host build configuration, including on a clean prebuild.

To export production JavaScript bundles for both platforms:

```sh
cd example
npx expo export --platform ios --platform android
```

To produce an installable library artifact from the root:

```sh
mkdir -p build/artifacts
npm pack --pack-destination build/artifacts
```

The tarball contains the JavaScript build, types, Swift/Kotlin source, podspec, and
library config plugin. Consumer apps compile the native source against their own
Expo/React Native dependencies. This command does not publish to npm.

## Android compatibility setup

Mux Player Android 1.6.0's published AARs require compile SDK 37. The library plugin
sets that compile SDK without raising the host app's target or minimum SDK.
Google's supported API 37 toolchain starts at
[AGP 9.1.1 / Gradle 9.3.1 / JDK 17](https://developer.android.com/build/releases/agp-9-1-0-release-notes).
The default React Native 0.86.3 toolchain still uses AGP 8.12.0.

The [example compatibility plugin](../example/plugins/withNativeBuildCompatibility.js)
sets AGP 9.1.1 and Gradle 9.3.1, uses the supported optimized ProGuard default, and
sets these compatibility flags for the current Expo/React Native Gradle integrations:

```properties
android.newDsl=false
android.builtInKotlin=false
android.sourceset.disallowProvider=false
```

The source-set flag preserves Expo's existing Provider-based source registration.
Expo explicitly makes its `preBuild` task depend on generated module registration,
so that task dependency does not rely on the source-set Provider.

Two small, versioned [patches](../example/patches/) address framework integration
issues. They are applied with `patch-package --error-on-fail` during workspace install:

- `expo-modules-core@57.0.18`: stop setting `targetSdk` on Android libraries. AGP 9
  removed that setter; the application continues to control its target SDK.
- `@react-native/gradle-plugin@0.86.2` (retargeted from 0.86.3 for the TV fork): register each library's BuildConfig and
  namespace callbacks only once. Repeated registration after DSL finalization is
  rejected by AGP 9. This preserves the original library-wide configuration while
  avoiding the repeated callbacks, addressing the same lifecycle issue handled in
  [React Native 0.87.1](https://github.com/facebook/react-native/blob/v0.87.1/packages/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/AgpConfiguratorUtils.kt).

The library plugin does not silently upgrade consumer AGP/Gradle versions or patch
consumer dependencies. An Expo 57 consumer using Mux Android 1.6.0 needs equivalent
host configuration and patches, or a newer upstream toolchain that resolves these
issues. Reassess the patches when upgrading their exact dependency versions; this
is a tested repository baseline, not a claim of stock Expo 57 compatibility.

## iOS Swift package integration

The library podspec now requires Mux Player Swift >= 1.8.1 and < 2.0.0. Refresh Pods
and let Xcode resolve packages after upgrading. The example's generated
`Package.resolved` is ignored; the distributed requirement lives in the podspec.

React Native 0.86.3 still has the CocoaPods package-reference UUID collision fixed
upstream in [React Native #57576](https://github.com/facebook/react-native/pull/57576).
The example plugin adds a collision-checking UUID generator before
`react_native_post_install` so that repeated Pods generation cannot overwrite an
existing project object. This replaces the previous manual example-only workaround
with repeatable configuration. It does not modify Mux Swift's source.

## Verification

- Clean workspace `npm ci`: pass; both versioned patches apply automatically.
- Expo Doctor: all 21 checks pass.
- Library and example TypeScript checks: pass.
- Unit tests: all 42 pass, including native configuration preservation/idempotence.
- Library JavaScript/types build and plugin syntax: pass.
- Production iOS and Android JavaScript exports: pass.
- iOS Debug simulator build: pass with Mux Swift 1.8.1 (arm64 and x86_64).
- iPhone 17 Pro / iOS 26.5 simulator: app loads, video plays, playback time advances,
  and pause updates the JavaScript status to `paused`.
- Android Debug APK: `:app:assembleDebug` passes for all four configured ABIs
  (arm64-v8a, armeabi-v7a, x86, x86_64), including Mux Player 1.6.0.
- Installable npm tarball: generated locally as
  `build/artifacts/mux-mux-react-native-player-0.1.15.tgz`; no npm release was published.
- Android runtime playback, physical-device playback, DRM, release signing, and TV
  runtime behavior are not covered by these checks.

The workspace dependency audit reports 21 advisories (2 critical, 4 high, 14 moderate,
1 low), including development-tool dependencies such as Vitest. This compatibility
baseline does not resolve those advisories or certify a production security review.
