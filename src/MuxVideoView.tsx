import * as React from 'react';
import { Dimensions, Image, Modal, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

const IOS_LANDSCAPE_SAFE_INSET = 50;

import { MuxVideoPlayer } from './MuxVideoPlayer';
import { MuxVideoControls } from './MuxVideoControls';
import { MuxVideoTVControls } from './MuxVideoTVControls';
import { buildMuxThumbnailUrl } from './muxImageUrls';
import NativeMuxVideoView from './NativeMuxVideoView';
import { resolveMuxControls } from './tv';
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
  MuxVideoTranscript,
  MuxVideoViewProps,
} from './types';

export type MuxVideoViewRef = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  replay: () => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  seekToLiveEdge: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setLoop: (loop: boolean) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setCaptionTrack: (trackId: string | null) => Promise<void>;
  setAudioTrack: (trackId: string | null) => Promise<void>;
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
      poster,
      posterTime,
      thumbnailPreviews = true,
      captionStyle,
      settingsMenu = true,
      allowsFullscreen = true,
      allowsAirPlay = true,
      allowsPictureInPicture = false,
      enableNowPlaying = false,
      timeUpdateEventInterval = 0.5,
      startupBufferDuration,
      onStatusChange,
      onPlayingChange,
      onTimeUpdate,
      onSourceLoad,
      onSourceError,
      onFirstFrame,
      onFullscreenChange,
      ...viewProps
    },
    ref
  ) => {
    const nativeRef = React.useRef<MuxNativeViewRef>(null);
    const isTV = Platform.isTV;
    const [firstFrameSource, setFirstFrameSource] = React.useState<string>();
    const [fullscreen, setFullscreen] = React.useState(false);
    const [fullscreenReady, setFullscreenReady] = React.useState(false);
    const enteredViaRotationRef = React.useRef(false);
    const suppressRotationEntryRef = React.useRef(false);
    const pendingExitRef = React.useRef(false);
    const [generatedSummary, setGeneratedSummary] = React.useState<MuxVideoSummary>();
    const [generatedChapters, setGeneratedChapters] = React.useState<MuxVideoChapter[]>();
    const [generatedKeyMoments, setGeneratedKeyMoments] = React.useState<MuxVideoKeyMoment[]>();
    const [generatedTranscript, setGeneratedTranscript] = React.useState<MuxVideoTranscript>();
    const snapshot = React.useSyncExternalStore(
      player._subscribe,
      player._getSnapshot,
      player._getSnapshot
    );

    const enterFullscreen = React.useCallback(() => {
      // TV presentation is owned by the host screen; do not remount the player
      // in a phone-orientation modal (which also loses native remote focus).
      if (isTV || !allowsFullscreen) return;
      player._markResumePoint();
      enteredViaRotationRef.current = false;
      suppressRotationEntryRef.current = false;
      pendingExitRef.current = false;
      const { width, height } = Dimensions.get('window');
      setFullscreenReady(width > height);
      setFullscreen(true);
    }, [player, isTV, allowsFullscreen]);
    const beginExit = React.useCallback(() => {
      if (isTV) return;
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
    }, [player, isTV]);
    const exitFullscreen = React.useCallback(() => {
      beginExit();
    }, [beginExit]);
    const toggleFullscreen = React.useCallback(() => {
      if (isTV) return;
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
    }, [beginExit, fullscreen, player, isTV]);

    React.useEffect(() => {
      if (isTV || !allowsFullscreen) {
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
    }, [allowsFullscreen, player, isTV]);

    React.useImperativeHandle(
      ref,
      () => ({
        play: () => player.play(),
        pause: () => player.pause(),
        replay: () => player.replay(),
        seekBy: seconds => player.seekBy(seconds),
        seekTo: seconds => player.seekTo(seconds),
        seekToLiveEdge: () => player.seekToLiveEdge(),
        setMuted: muted => player.setMuted(muted),
        setVolume: volume => player.setVolume(volume),
        setLoop: loop => player.setLoop(loop),
        setPlaybackRate: rate => player.setPlaybackRate(rate),
        setCaptionTrack: trackId => player.setCaptionTrack(trackId),
        setAudioTrack: trackId => player.setAudioTrack(trackId),
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
      if (isTV || !fullscreen) {
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
    }, [fullscreen, onFullscreenChange, isTV]);

    const controlsMode = resolveMuxControls(controls, nativeControls, isTV);
    const showCustomControls = controlsMode === 'custom';
    const showNativeControls = controlsMode === 'native';

    const posterUri = React.useMemo(() => {
      if (poster === false) {
        return undefined;
      }
      if (typeof poster === 'string') {
        return poster;
      }
      if (poster && typeof poster === 'object') {
        return poster.uri;
      }
      const src = snapshot.source;
      if (!src) {
        return undefined;
      }
      return buildMuxThumbnailUrl(src, {
        time: posterTime,
        token: src.thumbnailToken,
      });
    }, [poster, posterTime, snapshot.source]);

    const playbackStatus = snapshot.status.status;
    const showPoster =
      posterUri != null &&
      (isTV
        ? snapshot.source != null && firstFrameSource !== snapshot.source.sourceId && playbackStatus !== 'error'
        : snapshot.status.currentTime <= 0 && (playbackStatus === 'idle' || playbackStatus === 'loading'));
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
      setGeneratedTranscript(undefined);
    }, [robotsAssetId]);

    const isCurrentEvent = (event: { playbackId?: string; sourceId?: string }) =>
      player._isCurrentSourceEvent(event);

    const sharedNativeProps = {
      playbackIntent: { revision: snapshot.playbackIntentRevision, playWhenReady: snapshot.shouldPlay },
      startupBufferDuration,
      source: snapshot.source,
      playWhenReady: snapshot.shouldPlay,
      muted: snapshot.muted,
      volume: snapshot.volume,
      loop: snapshot.loop,
      playbackRate: snapshot.playbackRate,
      contentFit,
      allowsFullscreen,
      allowsPictureInPicture: !isTV && allowsPictureInPicture,
      enableNowPlaying,
      captionStyle,
      timeUpdateEventInterval,
      onStatusChange: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        player._handleStatusChange(event.nativeEvent);
        onStatusChange?.(event.nativeEvent);
      },
      onPlayingChange: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        onPlayingChange?.(event.nativeEvent);
      },
      onTimeUpdate: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        player._handleTimeUpdate(event.nativeEvent);
        onTimeUpdate?.(event.nativeEvent);
      },
      onSourceLoad: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        player._handleSourceLoad(event.nativeEvent);
        onSourceLoad?.(event.nativeEvent);
      },
      onSourceError: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        player._handleSourceError(event.nativeEvent);
        onSourceError?.(event.nativeEvent);
      },
      onFirstFrame: (event: { nativeEvent: any }) => {
        if (!isCurrentEvent(event.nativeEvent)) return;
        setFirstFrameSource(player._getSnapshot().source?.sourceId);
        onFirstFrame?.(event.nativeEvent);
      },
    } as const;

    if (isTV) {
      return (
        <View {...viewProps} style={[styles.customControlsContainer, viewProps.style]}>
          <NativeMuxVideoView
            {...sharedNativeProps}
            ref={nativeRef}
            nativeControls={showNativeControls}
            style={StyleSheet.absoluteFill}
          />
          {showPoster ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                accessible={false}
                resizeMode={contentFit === 'cover' ? 'cover' : contentFit === 'fill' ? 'stretch' : 'contain'}
                source={{ uri: posterUri }}
                style={[StyleSheet.absoluteFill, styles.poster]}
              />
            </View>
          ) : null}
          {showCustomControls ? (
            <MuxVideoTVControls
              player={player}
              status={snapshot.status}
              shouldPlay={snapshot.shouldPlay}
              source={snapshot.source}
              thumbnailPreviews={thumbnailPreviews}
              settingsMenu={settingsMenu}
              theme={controlsTheme}
              robots={controlsRobots}
              contentFit={contentFit}
            />
          ) : null}
        </View>
      );
    }

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
        {showPoster ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode={contentFit === 'cover' ? 'cover' : 'contain'}
            source={{ uri: posterUri }}
            style={[StyleSheet.absoluteFill, styles.poster]}
          />
        ) : null}
        {showCustomControls ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <MuxVideoControls
              player={player}
              safeAreaInsets={controlsInset}
              status={snapshot.status}
              shouldPlay={snapshot.shouldPlay}
              source={snapshot.source}
              thumbnailPreviews={thumbnailPreviews}
              settingsMenu={settingsMenu}
              allowsAirPlay={allowsAirPlay}
              theme={controlsTheme}
              robots={controlsRobots}
              allowsFullscreen={allowsFullscreen}
              isFullscreen={fullscreen}
              onToggleFullscreen={allowsFullscreen ? toggleFullscreen : undefined}
              generatedSummary={generatedSummary}
              generatedChapters={generatedChapters}
              generatedKeyMoments={generatedKeyMoments}
              generatedTranscript={generatedTranscript}
              onGeneratedSummaryChange={setGeneratedSummary}
              onGeneratedChaptersChange={setGeneratedChapters}
              onGeneratedKeyMomentsChange={setGeneratedKeyMoments}
              onGeneratedTranscriptChange={setGeneratedTranscript}
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
  poster: {
    backgroundColor: '#000',
  },
});
