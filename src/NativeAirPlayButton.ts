import * as React from 'react';
import { Platform } from 'react-native';
import type { ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

export type AirPlayButtonProps = ViewProps & {
  tintColor?: string;
  activeTintColor?: string;
};

/**
 * Native AVRoutePickerView (AirPlay) button. iOS only — AirPlay is an Apple
 * technology with no Android equivalent. Returns `null` on other platforms.
 */
let NativeAirPlayButton: React.ComponentType<AirPlayButtonProps> | null = null;

if (Platform.OS === 'ios') {
  try {
    NativeAirPlayButton = requireNativeViewManager(
      'MuxAirPlayButton'
    ) as React.ComponentType<AirPlayButtonProps>;
  } catch {
    NativeAirPlayButton = null;
  }
}

export default NativeAirPlayButton;
