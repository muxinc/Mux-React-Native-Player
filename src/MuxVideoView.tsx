import * as React from 'react';
import { Dimensions, Modal, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

const IOS_LANDSCAPE_SAFE_INSET = 50;

import { MuxVideoPlayer } from './MuxVideoPlayer';
import { MuxVideoControls } from './MuxVideoControls';
import NativeMuxVideoView from './NativeMuxVideoView';
import {
  lockOrientationLandscape,
  unlockOrientation,
} from './screenOrientation';
import type {
  MuxNativeViewRef,
  MuxVideoChapter,
  MuxVideoKeyMoment,
  MuxVideoSource,
  MuxVideoSummary,
  MuxVideoViewProps,
} from './types';

export type MuxVideoViewRef = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  replay: () => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setLoop: (loop: boolean) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setCaptionTrack: (trackId: string | null) => Promise<void>;
  release: () => Promise<void>;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
};

export const MuxVideoView = React.forwardRef<MuxVideoViewRef, MuxVideoViewProps>(
  (
    {
      player,
      controls,
      controlsTheme,
      robots,
      nativeControls = true,
      contentFit = 'contain',
      allowsFullscreen = true,
      allowsPictureInPicture = false,
      timeUpdateEventInterval = 0.5,
      startupBufferDuration,
      onStatusChange,
      onPlayingChange,
      onTimeUpdate,
      onSourceLoad,
      onSourceError,
      onFullscreenChange,
      ...viewProps
    },
    ref
  ) => {
    const nativeRef = React.useRef<MuxNativeViewRef>(null);
    const [fullscreen, setFullscreen] = React.useState(false);
    const [fullscreenReady, setFullscreenReady] = React.useState(false);
    const enteredViaRotationRef = React.useRef(false);
    const suppressRotationEntryRef = React.useRef(false);
    const pendingExitRef = React.useRef(false);
    const [generatedSummary, setGeneratedSummary] = React.useState<MuxVideoSummary>();
    const [generatedChapters, setGeneratedChapters] = React.useState<MuxVideoChapter[]>();
    const [generatedKeyMoments, setGeneratedKeyMoments] = React.useState<MuxVideoKeyMoment[]>();
    const snapshot = React.useSyncExternalStore(
      player._subscribe,
      player._getSnapshot,
      player._getSnapshot
    );

    const enterFullscreen = React.useCallback(() => {
      player._markResumePoint();
      enteredViaRotationRef.current = false;
      suppressRotationEntryRef.current = false;
      pendingExitRef.current = false;
      const { width, height } = Dimensions.get('window');
      setFullscreenReady(width > height);
      setFullscreen(true);
    }, [player]);
    const beginExit = React.useCallback(() => {
      player._markResumePoint();
      enteredViaRotationRef.current = false;
      suppressRotationEntryRef.current = true;
      setFullscreenReady(false);
      const { width, height } = Dimensions.get('window');
      if (width <= height) {
        pendingExitRef.current = false;
        setFullscreen(false);
        return;
      }
      pendingExitRef.current = true;
      void unlockOrientation();
      setTimeout(() => {
        if (pendingExitRef.current) {
          pendingExitRef.current = false;
          setFullscreen(false);
        }
      }, 600);
    }, [player]);
    const exitFullscreen = React.useCallback(() => {
      beginExit();
    }, [beginExit]);
    const toggleFullscreen = React.useCallback(() => {
      if (fullscreen) {
        beginExit();
        return;
      }
      player._markResumePoint();
      enteredViaRotationRef.current = false;
      suppressRotationEntryRef.current = false;
      pendingExitRef.current = false;
      const { width, height } = Dimensions.get('window');
      setFullscreenReady(width > height);
      setFullscreen(true);
    }, [beginExit, fullscreen, player]);

    React.useEffect(() => {
      if (!allowsFullscreen) {
        return;
      }
      const subscription = Dimensions.addEventListener('change', ({ window }) => {
        const isLandscape = window.width > window.height;
        if (!isLandscape) {
          suppressRotationEntryRef.current = false;
          if (pendingExitRef.current) {
            pendingExitRef.current = false;
            setFullscreenReady(false);
            setFullscreen(false);
            return;
          }
        } else if (pendingExitRef.current) {
          pendingExitRef.current = false;
        }
        setFullscreenReady(isLandscape);
        setFullscreen(prev => {
          if (isLandscape && !prev) {
            if (suppressRotationEntryRef.current) {
              return prev;
            }
            enteredViaRotationRef.current = true;
            player._markResumePoint();
            return true;
          }
          if (!isLandscape && prev && enteredViaRotationRef.current) {
            enteredViaRotationRef.current = false;
            player._markResumePoint();
            return false;
          }
          return prev;
        });
      });
      return () => subscription.remove();
    }, [allowsFullscreen, player]);

    React.useImperativeHandle(
      ref,
      () => ({
        play: () => player.play(),
        pause: () => player.pause(),
        replay: () => player.replay(),
        seekBy: seconds => player.seekBy(seconds),
        seekTo: seconds => player.seekTo(seconds),
        setMuted: muted => player.setMuted(muted),
        setVolume: volume => player.setVolume(volume),
        setLoop: loop => player.setLoop(loop),
        setPlaybackRate: rate => player.setPlaybackRate(rate),
        setCaptionTrack: trackId => player.setCaptionTrack(trackId),
        release: () => player.release(),
        enterFullscreen,
        exitFullscreen,
      }),
      [player, enterFullscreen, exitFullscreen]
    );

    React.useEffect(() => {
      player._attachNativeRef(nativeRef.current);
      return () => {
        player._attachNativeRef(null);
      };
    }, [player, fullscreen]);

    React.useEffect(() => {
      onFullscreenChange?.(fullscreen);
      if (!fullscreen) {
        return;
      }
      const entryViaRotation = enteredViaRotationRef.current;
      if (!entryViaRotation) {
        void lockOrientationLandscape();
      }
      return () => {
        if (!entryViaRotation) {
          void unlockOrientation();
        }
      };
    }, [fullscreen, onFullscreenChange]);

    const controlsMode = controls ?? (nativeControls ? 'native' : 'none');
    const showCustomControls = controlsMode === 'custom';
    const showNativeControls = controlsMode === 'native';
    const controlsRobots = React.useMemo(
      () =>
        robots && robots.assetId == null && snapshot.source?.assetId
          ? { ...robots, assetId: snapshot.source.assetId }
          : robots,
      [robots, snapshot.source?.assetId]
    );
    const robotsAssetId = controlsRobots?.assetId;

    React.useEffect(() => {
      setGeneratedSummary(undefined);
      setGeneratedChapters(undefined);
      setGeneratedKeyMoments(undefined);
    }, [robotsAssetId]);

    const sharedNativeProps = {
      startupBufferDuration,
      source: snapshot.source,
      playWhenReady: snapshot.shouldPlay,
      muted: snapshot.muted,
      volume: snapshot.volume,
      loop: snapshot.loop,
      playbackRate: snapshot.playbackRate,
      contentFit,
      allowsFullscreen,
      allowsPictureInPicture,
      timeUpdateEventInterval,
      onStatusChange: (event: { nativeEvent: any }) => {
        player._handleStatusChange(event.nativeEvent);
        onStatusChange?.(event.nativeEvent);
      },
      onPlayingChange: (event: { nativeEvent: any }) => {
        onPlayingChange?.(event.nativeEvent);
      },
      onTimeUpdate: (event: { nativeEvent: any }) => {
        player._handleTimeUpdate(event.nativeEvent);
        onTimeUpdate?.(event.nativeEvent);
      },
      onSourceLoad: (event: { nativeEvent: any }) => {
        player._handleSourceLoad(event.nativeEvent);
        onSourceLoad?.(event.nativeEvent);
      },
      onSourceError: (event: { nativeEvent: any }) => {
        player._handleSourceError(event.nativeEvent);
        onSourceError?.(event.nativeEvent);
      },
    } as const;

    if (showNativeControls) {
      return (
        <NativeMuxVideoView
          {...viewProps}
          {...sharedNativeProps}
          ref={nativeRef}
          nativeControls
        />
      );
    }

    const renderManagedBody = (
      containerStyle: StyleProp<ViewStyle>,
      controlsInset: { left: number; right: number } = { left: 0, right: 0 }
    ) => (
      <View style={containerStyle}>
        <NativeMuxVideoView
          {...sharedNativeProps}
          ref={nativeRef}
          nativeControls={false}
          style={StyleSheet.absoluteFill}
        />
        {showCustomControls ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: controlsInset.left,
              right: controlsInset.right,
            }}
          >
            <MuxVideoControls
              player={player}
              status={snapshot.status}
              shouldPlay={snapshot.shouldPlay}
              theme={controlsTheme}
              robots={controlsRobots}
              allowsFullscreen={allowsFullscreen}
              isFullscreen={fullscreen}
              onToggleFullscreen={allowsFullscreen ? toggleFullscreen : undefined}
              generatedSummary={generatedSummary}
              generatedChapters={generatedChapters}
              generatedKeyMoments={generatedKeyMoments}
              onGeneratedSummaryChange={setGeneratedSummary}
              onGeneratedChaptersChange={setGeneratedChapters}
              onGeneratedKeyMomentsChange={setGeneratedKeyMoments}
            />
          </View>
        ) : null}
      </View>
    );

    const inlineContainerStyle: StyleProp<ViewStyle> = [
      styles.customControlsContainer,
      viewProps.style,
    ];

    if (!fullscreen) {
      return renderManagedBody(inlineContainerStyle);
    }

    const fullscreenControlsInset =
      Platform.OS === 'ios' && fullscreenReady
        ? { left: IOS_LANDSCAPE_SAFE_INSET, right: IOS_LANDSCAPE_SAFE_INSET }
        : { left: 0, right: 0 };

    return (
      <>
        <View
          {...viewProps}
          style={[inlineContainerStyle, styles.placeholderInline]}
          pointerEvents="none"
        />
        <Modal
          animationType="fade"
          visible
          supportedOrientations={[
            'portrait',
            'landscape',
            'landscape-left',
            'landscape-right',
          ]}
          statusBarTranslucent
          presentationStyle="overFullScreen"
          transparent
          onRequestClose={exitFullscreen}
        >
          <View style={styles.fullscreenContainer}>
            {renderManagedBody(StyleSheet.absoluteFill, fullscreenControlsInset)}
            {!fullscreenReady ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.fullscreenCover]}
              />
            ) : null}
          </View>
        </Modal>
      </>
    );
  }
);

MuxVideoView.displayName = 'MuxVideoView';

export function useMuxVideoPlayer(
  source?: MuxVideoSource,
  setup?: (player: MuxVideoPlayer) => void
): MuxVideoPlayer {
  const playerRef = React.useRef<MuxVideoPlayer | null>(null);
  const sourceKey = source == null ? undefined : JSON.stringify(source);

  if (playerRef.current == null) {
    playerRef.current = new MuxVideoPlayer(source);
  }

  React.useEffect(() => {
    if (source != null) {
      playerRef.current?.replace(source);
    }
  }, [sourceKey]);

  React.useEffect(() => {
    if (playerRef.current && setup) {
      setup(playerRef.current);
    }
  }, [setup]);

  React.useEffect(() => {
    const player = playerRef.current;
    return () => {
      player?.release().catch(() => {
        // React cleanup may run after the native view has already detached.
      });
    };
  }, []);

  return playerRef.current;
}

const styles = StyleSheet.create({
  customControlsContainer: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
    position: 'relative',
  },
  placeholderInline: {
    backgroundColor: 'transparent',
  },
  fullscreenContainer: {
    backgroundColor: '#000',
    flex: 1,
  },
  fullscreenCover: {
    backgroundColor: '#000',
  },
});
