# Orientation & Fullscreen

The custom controls include a fullscreen ("theater mode") button. When the user taps it — or rotates the device to landscape — the player expands to fill the screen and the library asks the OS to rotate the app to landscape. When fullscreen exits, the orientation lock is released.

**This only works if your app is allowed to rotate.** Most React Native apps are locked to portrait by default, which silently prevents the player from entering landscape. This page covers the configuration needed on each platform.

## Expo apps (managed workflow)

Two settings in `app.json`:

### 1. Set `orientation` to `"default"`

```json
{
  "expo": {
    "orientation": "default"
  }
}
```

`"default"` allows both portrait and landscape. If this is set to `"portrait"` (the template default), the OS rejects the player's landscape request and the fullscreen button appears to do nothing.

### 2. Declare the supported orientations in the iOS Info.plist

Expo's `ios.infoPlist` key lets you set this without touching native code:

```json
{
  "expo": {
    "orientation": "default",
    "ios": {
      "infoPlist": {
        "UISupportedInterfaceOrientations": [
          "UIInterfaceOrientationPortrait",
          "UIInterfaceOrientationLandscapeLeft",
          "UIInterfaceOrientationLandscapeRight"
        ]
      }
    }
  }
}
```

Then regenerate the native project so the plist change is applied:

```sh
npx expo prebuild --platform ios
npx expo run:ios
```

> **Tip:** the orientations listed here are the ceiling for what iOS will ever allow your app to rotate to. The player locks to landscape *within* this set while fullscreen, and returns to the portrait-allowed set on exit. Leaving out the two landscape entries is the most common reason fullscreen rotation doesn't work.

## Bare React Native apps

Edit `ios/<YourApp>/Info.plist` directly and make sure the supported orientations include both landscape directions:

```xml
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
  <string>UIInterfaceOrientationLandscapeLeft</string>
  <string>UIInterfaceOrientationLandscapeRight</string>
</array>
```

Also check the Xcode target's **General → Deployment Info → Device Orientation** checkboxes — they write to the same plist key and Xcode may overwrite manual edits if they disagree.

If your `AppDelegate` implements `application(_:supportedInterfaceOrientationsFor:)` and returns `.portrait`, that overrides the plist — return `.allButUpsideDown` (or remove the override) instead.

## Android

Android needs less ceremony: the player sets the activity's requested orientation at runtime (`SENSOR_LANDSCAPE` while fullscreen, back to unspecified on exit), which overrides the manifest value.

- **Expo:** `"orientation": "default"` in `app.json` is all you need.
- **Bare RN:** avoid hard-locking the activity in `AndroidManifest.xml` (`android:screenOrientation="portrait"` still gets overridden at runtime, but your non-player screens will then rotate freely after exit if you rely on it — prefer handling orientation per-screen in JS if you need portrait elsewhere).

## How fullscreen behaves

With the app configured as above:

- **Tapping the fullscreen button** locks the app to landscape (iOS: `landscapeRight` initially, sensor-driven after), expands the player, and hides the rest of your screen.
- **Rotating the device to landscape** while the video is on screen also enters fullscreen automatically; rotating back to portrait exits it.
- **Exiting fullscreen** restores portrait and releases the orientation lock (iOS returns to "all but upside down", Android to "unspecified").

## Keeping the rest of your app portrait

If your app should stay portrait everywhere except the video, keep `"orientation": "default"` plus the full `UISupportedInterfaceOrientations` list (the player needs both), and lock individual screens back to portrait with [`expo-screen-orientation`](https://docs.expo.dev/versions/latest/sdk/screen-orientation/):

```tsx
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFocusEffect } from 'expo-router';

useFocusEffect(() => {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  return () => {
    ScreenOrientation.unlockAsync();
  };
});
```

## Opting out

Pass `allowsFullscreen={false}` to `MuxVideoView` to remove the fullscreen button and disable rotate-to-fullscreen entirely. In that case none of the configuration on this page is required.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Fullscreen button does nothing on iOS | `UISupportedInterfaceOrientations` missing the landscape entries, or `expo.orientation` is `"portrait"` |
| Player goes fullscreen but stays portrait | Same as above — the OS rejected the rotation request |
| Worked in dev, broken after prebuild | `app.json` changes weren't applied — re-run `npx expo prebuild` |
| Whole app now rotates | Expected with `"orientation": "default"` — lock non-video screens with `expo-screen-orientation` (see above) |
