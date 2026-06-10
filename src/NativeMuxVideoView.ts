import {
  requireNativeViewManager,
  requireOptionalNativeModule,
} from 'expo-modules-core';
import * as React from 'react';

import type { MuxNativeViewRef, NativeMuxVideoViewProps } from './types';

requireOptionalNativeModule('MuxReactNativePlayer');

const NativeMuxVideoView = requireNativeViewManager('MuxReactNativePlayer') as React.ComponentType<
  NativeMuxVideoViewProps & React.RefAttributes<MuxNativeViewRef>
>;

export default NativeMuxVideoView;
