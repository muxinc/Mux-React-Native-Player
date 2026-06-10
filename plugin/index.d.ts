import type { ConfigPlugin } from '@expo/config-plugins';

export type MuxReactNativePlayerPluginProps = {
  enableBackgroundAudio?: boolean;
  enablePictureInPicture?: boolean;
};

declare const withMuxReactNativePlayer: ConfigPlugin<MuxReactNativePlayerPluginProps | void>;

export default withMuxReactNativePlayer;
export { withMuxReactNativePlayer };
