import * as React from 'react';
import {
  Animated,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type {
  MuxPlayerStatus,
  MuxVideoCaptionTrack,
  MuxVideoChapter,
  MuxVideoControlsTheme,
  MuxVideoKeyMoment,
  MuxVideoRobotsConfig,
  MuxVideoSummary,
  NormalizedMuxVideoSource,
} from './types';
import { MuxVideoPlayer } from './MuxVideoPlayer';
import { buildMuxStoryboardVttUrl, buildMuxThumbnailUrl } from './muxImageUrls';
import {
  parseStoryboardVtt,
  tileForTime,
  type ParsedStoryboard,
} from './storyboard';

type RequiredControlsTheme = Required<MuxVideoControlsTheme>;
type RobotsPanel = 'summary' | 'chapters' | 'moments';

type MuxVideoControlsProps = {
  player: MuxVideoPlayer;
  status: MuxPlayerStatus;
  shouldPlay: boolean;
  source?: NormalizedMuxVideoSource;
  thumbnailPreviews?: boolean;
  theme?: MuxVideoControlsTheme;
  robots?: MuxVideoRobotsConfig;
  allowsFullscreen?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  generatedSummary?: MuxVideoSummary;
  generatedChapters?: MuxVideoChapter[];
  generatedKeyMoments?: MuxVideoKeyMoment[];
  onGeneratedSummaryChange?: (summary: MuxVideoSummary | undefined) => void;
  onGeneratedChaptersChange?: (chapters: MuxVideoChapter[] | undefined) => void;
  onGeneratedKeyMomentsChange?: (keyMoments: MuxVideoKeyMoment[] | undefined) => void;
};

const emptyChapters: MuxVideoChapter[] = [];
const emptyKeyMoments: MuxVideoKeyMoment[] = [];
const emptyCaptionTracks: MuxVideoCaptionTrack[] = [];
const robotImages = {
  summary: require('../assets/MuxRobot_03.gif'),
  chapters: require('../assets/MuxRobot_02.gif'),
  moments: require('../assets/MuxRobot_05.gif'),
} as const;

const defaultTheme: RequiredControlsTheme = {
  accentColor: '#FA50B5',
  backgroundColor: 'transparent',
  buttonBackgroundColor: 'rgba(20, 28, 38, 0.28)',
  buttonTextColor: '#f8fbff',
  buttonSize: 48,
  playButtonSize: 72,
  fullscreenButtonSize: 26,
  progressTrackColor: '#FA50B5',
  bufferedTrackColor: 'rgba(248, 251, 255, 0.28)',
  trackColor: 'rgba(248, 251, 255, 0.16)',
  trackHeight: 4,
  textColor: '#f8fbff',
  seekSeconds: 10,
};

const frostBorderColor = 'rgba(255, 255, 255, 0.18)';
const frostBorderWidth = StyleSheet.hairlineWidth * 2;

export function MuxVideoControls({
  player,
  status,
  shouldPlay,
  source,
  thumbnailPreviews = true,
  theme,
  robots,
  allowsFullscreen = false,
  isFullscreen = false,
  onToggleFullscreen,
  generatedSummary,
  generatedChapters,
  generatedKeyMoments,
  onGeneratedSummaryChange,
  onGeneratedChaptersChange,
  onGeneratedKeyMomentsChange,
}: MuxVideoControlsProps) {
  const controlsTheme = React.useMemo<RequiredControlsTheme>(
    () => ({ ...defaultTheme, ...theme }),
    [theme]
  );

  const [hidden, setHidden] = React.useState(false);
  const [interactionTick, setInteractionTick] = React.useState(0);
  const [trackWidth, setTrackWidth] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [containerHeight, setContainerHeight] = React.useState(0);
  const [containerPageX, setContainerPageX] = React.useState(0);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [scrubTime, setScrubTime] = React.useState(0);
  const [pendingTarget, setPendingTarget] = React.useState<number | null>(null);
  const [activeRobotsPanel, setActiveRobotsPanel] = React.useState<RobotsPanel | null>(null);
  const [robotsLoading, setRobotsLoading] = React.useState<RobotsPanel | null>(null);
  const [robotsError, setRobotsError] = React.useState<string | null>(null);
  const [captionsOpen, setCaptionsOpen] = React.useState(false);
  const robotsRequestRef = React.useRef(0);
  const controlsRootRef = React.useRef<View>(null);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const { width: windowWidth } = useWindowDimensions();
  const storyboard = useStoryboard(thumbnailPreviews ? source : undefined);
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const playerTime = clamp(status.currentTime, 0, duration || 0);
  const displayTime = scrubbing
    ? clamp(scrubTime, 0, duration || 0)
    : pendingTarget !== null
      ? clamp(pendingTarget, 0, duration || 0)
      : playerTime;

  React.useEffect(() => {
    if (pendingTarget === null) {
      return;
    }
    if (Math.abs(playerTime - pendingTarget) < 0.5) {
      setPendingTarget(null);
      return;
    }
    const timeout = setTimeout(() => setPendingTarget(null), 1500);
    return () => clearTimeout(timeout);
  }, [pendingTarget, playerTime]);
  const bufferedPosition = clamp(status.bufferedPosition, 0, duration || 0);
  const progress = duration > 0 ? displayTime / duration : 0;
  const buffered = duration > 0 ? bufferedPosition / duration : 0;
  const isPlaying = status.status === 'playing' || shouldPlay;
  const robotsEnabled = robots != null && robots.enabled !== false;
  const robotsAssetId = robots?.assetId;
  const summary = generatedSummary ?? robots?.summary;
  const chapters = generatedChapters ?? robots?.chapters ?? emptyChapters;
  const keyMoments = generatedKeyMoments ?? robots?.keyMoments ?? emptyKeyMoments;
  const captionTracks = status.captionTracks ?? emptyCaptionTracks;
  const selectedCaptionTrackId = status.selectedCaptionTrackId ?? null;
  const canSummarize = robotsEnabled && (!!summary || (!!robotsAssetId && !!robots?.onSummarize));
  const canGenerateChapters = robotsEnabled && (chapters.length > 0 || (!!robotsAssetId && !!robots?.onGenerateChapters));
  const canFindKeyMoments = robotsEnabled && (keyMoments.length > 0 || (!!robotsAssetId && !!robots?.onFindKeyMoments));
  const hasRobotsActions = canSummarize || canGenerateChapters || canFindKeyMoments;
  const isRobotsFocused = activeRobotsPanel !== null;
  const hasCaptionTracks = captionTracks.length > 0;

  React.useEffect(() => {
    robotsRequestRef.current += 1;
    setActiveRobotsPanel(null);
    setRobotsLoading(null);
    setRobotsError(null);
  }, [robotsAssetId]);

  React.useEffect(() => {
    if (!hasCaptionTracks) {
      setCaptionsOpen(false);
    }
  }, [hasCaptionTracks]);

  const visibleChapters = React.useMemo(
    () =>
      chapters
        .filter(chapter => chapter.title && chapter.startTime >= 0 && (duration <= 0 || chapter.startTime <= duration))
        .slice()
        .sort((a, b) => a.startTime - b.startTime),
    [chapters, duration]
  );

  const visibleKeyMoments = React.useMemo(
    () =>
      keyMoments
        .filter(moment => moment.title && moment.startTime >= 0 && moment.endTime > moment.startTime)
        .slice()
        .sort((a, b) => a.startTime - b.startTime),
    [keyMoments]
  );

  const activeChapter = React.useMemo(() => {
    if (visibleChapters.length === 0) {
      return undefined;
    }
    let current: MuxVideoChapter | undefined;
    for (const chapter of visibleChapters) {
      if (chapter.startTime > displayTime) {
        break;
      }
      current = chapter;
    }
    return current;
  }, [displayTime, visibleChapters]);

  const measureControlsRoot = React.useCallback(() => {
    controlsRootRef.current?.measureInWindow((x, _y, width) => {
      if (Number.isFinite(x)) {
        setContainerPageX(x);
      }
      if (Number.isFinite(width) && width > 0) {
        setContainerWidth(width);
      }
    });
  }, []);

  const handleControlsLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setContainerWidth(width);
      setContainerHeight(height);
      measureControlsRoot();
    },
    [measureControlsRoot]
  );

  React.useEffect(() => {
    measureControlsRoot();
  }, [measureControlsRoot, windowWidth]);

  const viewportWidth = windowWidth > 0 ? windowWidth : containerWidth;
  const offscreenLeftInset = Math.max(0, -containerPageX);
  const offscreenRightInset =
    viewportWidth > 0 && containerWidth > 0
      ? Math.max(0, containerPageX + containerWidth - viewportWidth)
      : 0;
  const isPortraitControls =
    containerWidth > 0 && containerHeight > 0 && containerHeight / containerWidth > 1.25;
  const visibleControlsWidth =
    containerWidth > 0
      ? Math.max(0, containerWidth - offscreenLeftInset - offscreenRightInset)
      : 0;
  const isCompactHeight = containerHeight > 0 && containerHeight < 240;
  const isNarrowControls =
    isCompactHeight ||
    isPortraitControls ||
    (visibleControlsWidth > 0 && visibleControlsWidth < 360);
  const baseHorizontalInset =
    visibleControlsWidth > 0 && visibleControlsWidth < 340 ? 10 : isPortraitControls ? 12 : 16;
  const timelineLeftInset = baseHorizontalInset + offscreenLeftInset;
  const timelineRightInset = baseHorizontalInset + offscreenRightInset;
  const centerHorizontalPadding = isNarrowControls ? 10 : 16;
  const centerHorizontalGap = isNarrowControls ? 18 : 28;
  const trackHorizontalPadding = isNarrowControls ? 8 : 10;
  const trackVerticalPadding = isNarrowControls ? 8 : 10;
  const timePillHorizontalPadding = isNarrowControls ? 8 : 10;
  const timeFontSize = isNarrowControls ? 11 : 12;
  const buttonSize = Math.max(36, isNarrowControls ? 40 : controlsTheme.buttonSize);
  const playButtonSize = Math.max(
    buttonSize,
    isCompactHeight ? 52 : isNarrowControls ? 56 : controlsTheme.playButtonSize
  );
  const centerVerticalGap = isCompactHeight ? 8 : isPortraitControls ? 14 : 20;
  const fullscreenButtonSize = Math.max(22, isNarrowControls ? 24 : controlsTheme.fullscreenButtonSize);
  const trackHeight = Math.max(3, controlsTheme.trackHeight);

  const fadeOut = React.useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setHidden(true);
      }
    });
  }, [opacity]);

  const fadeIn = React.useCallback(() => {
    setHidden(false);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  const keepAlive = React.useCallback(() => {
    setInteractionTick(t => t + 1);
  }, []);

  const dismissRobotsPanel = React.useCallback(() => {
    robotsRequestRef.current += 1;
    setActiveRobotsPanel(null);
    setRobotsLoading(null);
    setRobotsError(null);
    keepAlive();
  }, [keepAlive]);

  const dismissCaptionsPanel = React.useCallback(() => {
    setCaptionsOpen(false);
    keepAlive();
  }, [keepAlive]);

  const handleBackgroundTap = React.useCallback(() => {
    if (captionsOpen) {
      dismissCaptionsPanel();
      return;
    }

    if (activeRobotsPanel || robotsLoading) {
      dismissRobotsPanel();
      return;
    }

    if (hidden) {
      fadeIn();
      setInteractionTick(t => t + 1);
    } else {
      fadeOut();
    }
  }, [activeRobotsPanel, captionsOpen, dismissCaptionsPanel, dismissRobotsPanel, fadeIn, fadeOut, hidden, robotsLoading]);

  React.useEffect(() => {
    if (hidden || scrubbing || activeRobotsPanel || robotsLoading || captionsOpen) {
      return;
    }
    const timer = setTimeout(fadeOut, 3000);
    return () => clearTimeout(timer);
  }, [hidden, scrubbing, activeRobotsPanel, robotsLoading, captionsOpen, interactionTick, fadeOut]);

  const trackRef = React.useRef<View>(null);
  const scrubStateRef = React.useRef({
    trackWidth: 0,
    trackPageX: 0,
    duration: 0,
    lastSeekAt: 0,
    currentTime: 0,
    wasPlaying: false,
  });

  const measureTrack = React.useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      if (Number.isFinite(x)) {
        scrubStateRef.current.trackPageX = x;
      }
      if (Number.isFinite(width) && width > 0) {
        scrubStateRef.current.trackWidth = width;
      }
    });
  }, []);

  const onTrackLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      setTrackWidth(event.nativeEvent.layout.width);
      measureTrack();
    },
    [measureTrack]
  );

  React.useEffect(() => {
    scrubStateRef.current.trackWidth = trackWidth;
    scrubStateRef.current.duration = duration;
  }, [trackWidth, duration]);

  const computeTimeFromX = React.useCallback((x: number): number => {
    const { trackWidth: width, duration: dur } = scrubStateRef.current;
    if (width <= 0 || dur <= 0) {
      return 0;
    }
    return clamp(x / width, 0, 1) * dur;
  }, []);

  const isPlayingRef = React.useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const finishScrub = React.useCallback(
    (commitX: number | null) => {
      if (scrubStateRef.current.duration > 0) {
        const localX = commitX ?? -1;
        const target =
          localX >= 0
            ? computeTimeFromX(localX)
            : scrubStateRef.current.currentTime;
        scrubStateRef.current.currentTime = target;
        setPendingTarget(target);
        runPlayerCommand(player.seekTo(target));
      }
      setScrubbing(false);
      setInteractionTick(prev => prev + 1);
    },
    [computeTimeFromX, player]
  );

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (_evt, gestureState) => {
          if (scrubStateRef.current.duration <= 0) {
            return;
          }
          measureTrack();
          const localX = gestureState.x0 - scrubStateRef.current.trackPageX;
          const t = computeTimeFromX(localX);
          scrubStateRef.current.currentTime = t;
          setScrubbing(true);
          setScrubTime(t);
        },
        onPanResponderMove: (_evt, gestureState) => {
          if (scrubStateRef.current.duration <= 0) {
            return;
          }
          const localX = gestureState.moveX - scrubStateRef.current.trackPageX;
          const t = computeTimeFromX(localX);
          scrubStateRef.current.currentTime = t;
          setScrubTime(t);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const localX = gestureState.moveX - scrubStateRef.current.trackPageX;
          finishScrub(localX);
        },
        onPanResponderTerminate: (_evt, gestureState) => {
          const localX = gestureState.moveX - scrubStateRef.current.trackPageX;
          finishScrub(localX);
        },
      }),
    [computeTimeFromX, finishScrub, measureTrack]
  );

  const seekSecondsRef = React.useRef(controlsTheme.seekSeconds);
  seekSecondsRef.current = controlsTheme.seekSeconds;

  const seekBack = React.useCallback(() => {
    keepAlive();
    runPlayerCommand(player.seekBy(-seekSecondsRef.current));
  }, [keepAlive, player]);

  const seekForward = React.useCallback(() => {
    keepAlive();
    runPlayerCommand(player.seekBy(seekSecondsRef.current));
  }, [keepAlive, player]);

  const togglePlayback = React.useCallback(() => {
    keepAlive();
    if (isPlayingRef.current) {
      runPlayerCommand(player.pause());
      return;
    }
    runPlayerCommand(player.play());
  }, [keepAlive, player]);

  const handleToggleFullscreen = React.useCallback(() => {
    keepAlive();
    setCaptionsOpen(false);
    onToggleFullscreen?.();
  }, [keepAlive, onToggleFullscreen]);

  const toggleCaptionsPanel = React.useCallback(() => {
    keepAlive();
    setCaptionsOpen(open => !open);
  }, [keepAlive]);

  const toggleRobotsPanel = React.useCallback(
    (panel: RobotsPanel) => {
      keepAlive();
      setRobotsError(null);
      if (activeRobotsPanel === panel) {
        setActiveRobotsPanel(null);
        return;
      }
      if (robotsLoading !== null) {
        robotsRequestRef.current += 1;
        setRobotsLoading(null);
      }
      setActiveRobotsPanel(panel);
    },
    [activeRobotsPanel, keepAlive, robotsLoading]
  );

  const loadSummary = React.useCallback(() => {
    if (activeRobotsPanel === 'summary' || robotsLoading === 'summary') {
      dismissRobotsPanel();
      return;
    }
    if (summary || !robotsAssetId || !robots?.onSummarize) {
      toggleRobotsPanel('summary');
      return;
    }
    keepAlive();
    const requestId = robotsRequestRef.current + 1;
    robotsRequestRef.current = requestId;
    setActiveRobotsPanel('summary');
    setRobotsLoading('summary');
    setRobotsError(null);
    robots
      .onSummarize({
        assetId: robotsAssetId,
        currentTime: displayTime,
        duration,
      })
      .then(result => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        onGeneratedSummaryChange?.(result);
        setActiveRobotsPanel('summary');
      })
      .catch(error => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        setRobotsError(getRobotsErrorMessage(error, 'Summary is not available yet.'));
        setActiveRobotsPanel('summary');
      })
      .finally(() => {
        if (robotsRequestRef.current === requestId) {
          setRobotsLoading(null);
        }
      });
  }, [activeRobotsPanel, dismissRobotsPanel, displayTime, duration, keepAlive, robots, robotsAssetId, robotsLoading, summary, toggleRobotsPanel]);

  const loadChapters = React.useCallback(() => {
    if (activeRobotsPanel === 'chapters' || robotsLoading === 'chapters') {
      dismissRobotsPanel();
      return;
    }
    if (chapters.length > 0 || !robotsAssetId || !robots?.onGenerateChapters) {
      toggleRobotsPanel('chapters');
      return;
    }
    keepAlive();
    const requestId = robotsRequestRef.current + 1;
    robotsRequestRef.current = requestId;
    setActiveRobotsPanel('chapters');
    setRobotsLoading('chapters');
    setRobotsError(null);
    robots
      .onGenerateChapters({
        assetId: robotsAssetId,
        currentTime: displayTime,
        duration,
      })
      .then(result => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        onGeneratedChaptersChange?.(result);
        setActiveRobotsPanel('chapters');
      })
      .catch(error => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        setRobotsError(getRobotsErrorMessage(error, 'Chapters are not available yet.'));
        setActiveRobotsPanel('chapters');
      })
      .finally(() => {
        if (robotsRequestRef.current === requestId) {
          setRobotsLoading(null);
        }
      });
  }, [activeRobotsPanel, chapters.length, dismissRobotsPanel, displayTime, duration, keepAlive, robots, robotsAssetId, robotsLoading, toggleRobotsPanel]);

  const loadKeyMoments = React.useCallback(() => {
    if (activeRobotsPanel === 'moments' || robotsLoading === 'moments') {
      dismissRobotsPanel();
      return;
    }
    if (keyMoments.length > 0 || !robotsAssetId || !robots?.onFindKeyMoments) {
      toggleRobotsPanel('moments');
      return;
    }
    keepAlive();
    const requestId = robotsRequestRef.current + 1;
    robotsRequestRef.current = requestId;
    setActiveRobotsPanel('moments');
    setRobotsLoading('moments');
    setRobotsError(null);
    robots
      .onFindKeyMoments({
        assetId: robotsAssetId,
        currentTime: displayTime,
        duration,
      })
      .then(result => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        onGeneratedKeyMomentsChange?.(result);
        setActiveRobotsPanel('moments');
      })
      .catch(error => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        setRobotsError(getRobotsErrorMessage(error, 'Key moments are not available yet.'));
        setActiveRobotsPanel('moments');
      })
      .finally(() => {
        if (robotsRequestRef.current === requestId) {
          setRobotsLoading(null);
        }
      });
  }, [activeRobotsPanel, dismissRobotsPanel, displayTime, duration, keepAlive, keyMoments.length, robots, robotsAssetId, robotsLoading, toggleRobotsPanel]);

  const seekToRobotsTime = React.useCallback(
    (target: number) => {
      keepAlive();
      setRobotsError(null);
      setPendingTarget(target);
      player.seekTo(target).catch(() => {
        // Seeking from generated navigation is best-effort.
      });
    },
    [keepAlive, player]
  );

  const selectCaptionTrack = React.useCallback(
    (trackId: string | null) => {
      keepAlive();
      setCaptionsOpen(false);
      player.setCaptionTrack(trackId).catch(() => {
        // Caption selection failures are non-fatal and native status will correct UI state.
      });
    },
    [keepAlive, player]
  );

  const defaultPanelMaxHeight = containerHeight > 0
    ? Math.max(96, Math.min(168, Math.floor(containerHeight * 0.45)))
    : 168;
  const summaryPanelMaxHeight = containerHeight > 0
    ? Math.max(140, Math.min(280, Math.floor(containerHeight * 0.65)))
    : 260;
  const panelMaxHeight =
    activeRobotsPanel === 'summary' ? summaryPanelMaxHeight : defaultPanelMaxHeight;

  return (
    <View
      ref={controlsRootRef}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.controlsRoot]}
      onLayout={handleControlsLayout}
    >
      {hidden ? (
        <Pressable
          accessibilityLabel="Show video controls"
          accessibilityRole="button"
          onPress={handleBackgroundTap}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { opacity }]}
        >
          <Pressable
            accessibilityLabel={activeRobotsPanel ? 'Hide Mux Robots results' : 'Hide video controls'}
            accessibilityRole="button"
            onPress={handleBackgroundTap}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
            pointerEvents="none"
            style={styles.gradientTop}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
            pointerEvents="none"
            style={styles.gradientBottom}
          />
          <View
            pointerEvents="box-none"
            style={[
              styles.centerWrap,
              {
                gap: centerVerticalGap,
                left: offscreenLeftInset,
                paddingBottom: hasRobotsActions ? 88 : 0,
                paddingHorizontal: centerHorizontalPadding,
                right: offscreenRightInset,
              },
            ]}
          >
            {hasRobotsActions ? (
              <View style={styles.robotsArea}>
                <ScrollView
                  horizontal
                  bounces={false}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.robotsButtonRow}
                  style={styles.robotsButtonScroller}
                >
                  {canSummarize ? (
                    <RobotsActionButton
                      active={activeRobotsPanel === 'summary'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      label="Summary"
                      onPress={loadSummary}
                      robotSource={robotImages.summary}
                      textColor={controlsTheme.buttonTextColor}
                    />
                  ) : null}
                  {canGenerateChapters ? (
                    <RobotsActionButton
                      active={activeRobotsPanel === 'chapters'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      label="Chapters"
                      onPress={loadChapters}
                      robotSource={robotImages.chapters}
                      textColor={controlsTheme.buttonTextColor}
                    />
                  ) : null}
                  {canFindKeyMoments ? (
                    <RobotsActionButton
                      active={activeRobotsPanel === 'moments'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      label="Moments"
                      onPress={loadKeyMoments}
                      robotSource={robotImages.moments}
                      textColor={controlsTheme.buttonTextColor}
                    />
                  ) : null}
                </ScrollView>
                {activeRobotsPanel ? (
                  <RobotsPanelView
                    activePanel={activeRobotsPanel}
                    backgroundColor={controlsTheme.buttonBackgroundColor}
                    chapters={visibleChapters}
                    error={robotsError}
                    keyMoments={visibleKeyMoments}
                    loading={robotsLoading === activeRobotsPanel}
                    maxHeight={panelMaxHeight}
                    onSeek={seekToRobotsTime}
                    summary={summary}
                    textColor={controlsTheme.textColor}
                  />
                ) : null}
              </View>
            ) : null}
            <View
              pointerEvents={isRobotsFocused ? 'none' : 'box-none'}
              style={[
                styles.centerCluster,
                { gap: centerHorizontalGap },
                isRobotsFocused && styles.centerClusterHidden,
              ]}
            >
              <IconButton
                accessibilityLabel={`Skip back ${controlsTheme.seekSeconds} seconds`}
                backgroundColor={controlsTheme.buttonBackgroundColor}
                onPress={seekBack}
                size={buttonSize}
              >
                <SkipIcon
                  color={controlsTheme.buttonTextColor}
                  direction="back"
                  seconds={controlsTheme.seekSeconds}
                  size={buttonSize}
                />
              </IconButton>
              <IconButton
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                backgroundColor={controlsTheme.buttonBackgroundColor}
                onPress={togglePlayback}
                size={playButtonSize}
              >
                {isPlaying ? (
                  <PauseIcon color={controlsTheme.buttonTextColor} size={playButtonSize} />
                ) : (
                  <PlayIcon color={controlsTheme.buttonTextColor} size={playButtonSize} />
                )}
              </IconButton>
              <IconButton
                accessibilityLabel={`Skip forward ${controlsTheme.seekSeconds} seconds`}
                backgroundColor={controlsTheme.buttonBackgroundColor}
                onPress={seekForward}
                size={buttonSize}
              >
                <SkipIcon
                  color={controlsTheme.buttonTextColor}
                  direction="forward"
                  seconds={controlsTheme.seekSeconds}
                  size={buttonSize}
                />
              </IconButton>
            </View>
          </View>

          {!isRobotsFocused ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.timeline,
              { left: timelineLeftInset, right: timelineRightInset },
            ]}
          >
            {scrubbing && thumbnailPreviews && source ? (
              <ScrubPreview
                progress={progress}
                source={source}
                storyboard={storyboard}
                time={displayTime}
                trackPadding={trackHorizontalPadding}
                trackWidth={trackWidth}
              />
            ) : null}
            {activeChapter ? (
              <View pointerEvents="none" style={styles.chapterPillRow}>
                <View
                  style={[
                    styles.chapterPill,
                    { backgroundColor: controlsTheme.buttonBackgroundColor },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.chapterPillText, { color: controlsTheme.textColor }]}
                  >
                    {activeChapter.title}
                  </Text>
                </View>
              </View>
            ) : null}
            <View
              accessibilityLabel="Seek video"
              accessibilityRole="adjustable"
              style={[
                styles.trackHitArea,
                {
                  backgroundColor: controlsTheme.buttonBackgroundColor,
                  paddingHorizontal: trackHorizontalPadding,
                  paddingVertical: trackVerticalPadding,
                },
              ]}
              {...panResponder.panHandlers}
            >
              <View
                ref={trackRef}
                onLayout={onTrackLayout}
                style={[
                  styles.track,
                  {
                    backgroundColor: controlsTheme.trackColor,
                    height: scrubbing ? trackHeight + 2 : trackHeight,
                    borderRadius: trackHeight,
                  },
                ]}
              >
                <View
                  style={[
                    styles.trackFill,
                    {
                      backgroundColor: controlsTheme.bufferedTrackColor,
                      borderRadius: trackHeight,
                      width: `${buffered * 100}%`,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.trackFill,
                    {
                      backgroundColor: controlsTheme.progressTrackColor,
                      borderRadius: trackHeight,
                      width: `${progress * 100}%`,
                    },
                    ]}
                  />
                {duration > 0
                  ? visibleKeyMoments.map(moment => {
                      const start = clamp(moment.startTime / duration, 0, 1);
                      const end = clamp(moment.endTime / duration, 0, 1);
                      return (
                        <View
                          key={`${moment.startTime}-${moment.endTime}-${moment.title}`}
                          pointerEvents="none"
                          style={[
                            styles.momentRange,
                            {
                              backgroundColor: controlsTheme.accentColor,
                              left: `${start * 100}%`,
                              width: `${Math.max(0, end - start) * 100}%`,
                            },
                          ]}
                        />
                      );
                    })
                  : null}
                {duration > 0
                  ? visibleChapters.slice(1).map(chapter => (
                      <View
                        key={`${chapter.startTime}-${chapter.title}`}
                        pointerEvents="none"
                        style={[
                          styles.chapterMarker,
                          {
                            backgroundColor: controlsTheme.buttonTextColor,
                            left: `${clamp(chapter.startTime / duration, 0, 1) * 100}%`,
                          },
                        ]}
                      />
                    ))
                  : null}
              </View>
            </View>
            <View style={styles.timeRow}>
              <View
                style={[
                  styles.timePill,
                  {
                    backgroundColor: controlsTheme.buttonBackgroundColor,
                    paddingHorizontal: timePillHorizontalPadding,
                  },
                ]}
              >
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  numberOfLines={1}
                  style={[
                    styles.timeText,
                    { color: controlsTheme.textColor, fontSize: timeFontSize },
                  ]}
                >
                  {formatTime(displayTime)} / {formatTime(duration)}
                </Text>
              </View>
              <View style={styles.timeControls}>
                {hasCaptionTracks ? (
                  <View style={styles.captionControlWrap}>
                    {captionsOpen ? (
                      <CaptionTracksPanel
                        backgroundColor={controlsTheme.buttonBackgroundColor}
                        onSelect={selectCaptionTrack}
                        selectedTrackId={selectedCaptionTrackId}
                        textColor={controlsTheme.textColor}
                        tracks={captionTracks}
                      />
                    ) : null}
                    <IconButton
                      accessibilityLabel={captionsOpen ? 'Hide captions options' : 'Show captions options'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      onPress={toggleCaptionsPanel}
                      size={fullscreenButtonSize}
                    >
                      <CaptionsIcon
                        active={selectedCaptionTrackId !== null}
                        color={controlsTheme.buttonTextColor}
                        size={fullscreenButtonSize}
                      />
                    </IconButton>
                  </View>
                ) : null}
                {allowsFullscreen && onToggleFullscreen ? (
                  <IconButton
                    accessibilityLabel={
                      isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
                    }
                    backgroundColor={controlsTheme.buttonBackgroundColor}
                    onPress={handleToggleFullscreen}
                    size={fullscreenButtonSize}
                  >
                    <FullscreenIcon
                      color={controlsTheme.buttonTextColor}
                      expanded={isFullscreen}
                      size={fullscreenButtonSize}
                    />
                  </IconButton>
                ) : null}
              </View>
            </View>
          </View>
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}

const PREVIEW_WIDTH = 132;
const PREVIEW_FALLBACK_ASPECT = 16 / 9;

function useStoryboard(source?: NormalizedMuxVideoSource): ParsedStoryboard | null {
  const [storyboard, setStoryboard] = React.useState<ParsedStoryboard | null>(null);
  const playbackId = source?.playbackId;
  const storyboardToken = source?.storyboardToken;
  const customDomain = source?.customDomain;

  React.useEffect(() => {
    if (!playbackId) {
      setStoryboard(null);
      return;
    }
    let cancelled = false;
    setStoryboard(null);
    const url = buildMuxStoryboardVttUrl(
      { playbackId, customDomain },
      storyboardToken
    );
    fetch(url)
      .then(response => (response.ok ? response.text() : null))
      .then(text => {
        if (cancelled || !text) {
          return;
        }
        setStoryboard(parseStoryboardVtt(text, url));
      })
      .catch(() => {
        // Storyboards are best-effort; scrubbing still works without previews.
      });
    return () => {
      cancelled = true;
    };
  }, [playbackId, storyboardToken, customDomain]);

  return storyboard;
}

function ScrubPreview({
  progress,
  source,
  storyboard,
  time,
  trackPadding,
  trackWidth,
}: {
  progress: number;
  source: NormalizedMuxVideoSource;
  storyboard: ParsedStoryboard | null;
  time: number;
  trackPadding: number;
  trackWidth: number;
}) {
  if (trackWidth <= 0) {
    return null;
  }

  const tile = storyboard ? tileForTime(storyboard, time) : undefined;
  const aspect =
    tile && tile.height > 0 ? tile.width / tile.height : PREVIEW_FALLBACK_ASPECT;
  const previewHeight = Math.round(PREVIEW_WIDTH / aspect);

  const timelineWidth = trackWidth + trackPadding * 2;
  const thumbCenter = trackPadding + clamp(progress, 0, 1) * trackWidth;
  const left = clamp(thumbCenter - PREVIEW_WIDTH / 2, 0, Math.max(0, timelineWidth - PREVIEW_WIDTH));

  let inner: React.ReactNode = null;
  if (tile && storyboard && storyboard.spriteWidth > 0) {
    const scale = PREVIEW_WIDTH / tile.width;
    inner = (
      <Image
        source={{ uri: storyboard.spriteUrl }}
        style={{
          position: 'absolute',
          width: storyboard.spriteWidth * scale,
          height: storyboard.spriteHeight * scale,
          left: -tile.x * scale,
          top: -tile.y * scale,
        }}
      />
    );
  } else {
    inner = (
      <Image
        source={{
          uri: buildMuxThumbnailUrl(source, {
            time: Math.floor(time),
            width: PREVIEW_WIDTH * 2,
            token: source.thumbnailToken,
          }),
        }}
        style={StyleSheet.absoluteFill}
      />
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.scrubPreview,
        { width: PREVIEW_WIDTH, height: previewHeight, left },
      ]}
    >
      {inner}
      <View pointerEvents="none" style={styles.scrubPreviewTimeRow}>
        <Text style={styles.scrubPreviewTime}>{formatTime(time)}</Text>
      </View>
    </View>
  );
}

const IconButton = React.memo(function IconButton({
  accessibilityLabel,
  backgroundColor,
  children,
  onPress,
  size,
}: {
  accessibilityLabel: string;
  backgroundColor: string;
  children: React.ReactNode;
  onPress: () => void;
  size: number;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          backgroundColor,
          borderColor: frostBorderColor,
          borderRadius: size / 2,
          borderWidth: frostBorderWidth,
          height: size,
          justifyContent: 'center',
          width: size,
        },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
});

const RobotsActionButton = React.memo(function RobotsActionButton({
  active,
  backgroundColor,
  disabled = false,
  label,
  onPress,
  robotSource,
  textColor,
}: {
  active: boolean;
  backgroundColor: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  robotSource: ImageSourcePropType;
  textColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`Show ${label.toLowerCase()} video AI results`}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.robotsButton,
        {
          backgroundColor,
          borderColor: active ? textColor : frostBorderColor,
          opacity: disabled ? 0.65 : 1,
        },
        pressed && styles.pressed,
      ]}
    >
      <Image source={robotSource} style={styles.robotsButtonImage} />
      <Text style={[styles.robotsButtonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
});

function RobotsPanelView({
  activePanel,
  backgroundColor,
  chapters,
  error,
  keyMoments,
  loading,
  maxHeight,
  onSeek,
  summary,
  textColor,
}: {
  activePanel: RobotsPanel;
  backgroundColor: string;
  chapters: MuxVideoChapter[];
  error: string | null;
  keyMoments: MuxVideoKeyMoment[];
  loading: boolean;
  maxHeight: number;
  onSeek: (time: number) => void;
  summary?: MuxVideoSummary;
  textColor: string;
}) {
  const title =
    activePanel === 'summary'
      ? 'Summary'
      : activePanel === 'chapters'
        ? 'Chapters'
        : 'Key Moments';

  return (
    <View style={[styles.robotsPanel, { backgroundColor, maxHeight }]}>
      {activePanel === 'summary' ? null : (
        <Text style={[styles.robotsPanelTitle, { color: textColor }]}>{title}</Text>
      )}
      {loading ? (
        <Text style={[styles.robotsPanelText, { color: textColor }]}>Generating results...</Text>
      ) : error ? (
        <Text style={[styles.robotsPanelText, { color: textColor }]}>{error}</Text>
      ) : activePanel === 'summary' ? (
        <SummaryPanel summary={summary} textColor={textColor} />
      ) : activePanel === 'chapters' ? (
        <ChapterPanel chapters={chapters} onSeek={onSeek} textColor={textColor} />
      ) : (
        <KeyMomentsPanel keyMoments={keyMoments} onSeek={onSeek} textColor={textColor} />
      )}
    </View>
  );
}

function SummaryPanel({
  summary,
  textColor,
}: {
  summary?: MuxVideoSummary;
  textColor: string;
}) {
  if (!summary) {
    return <Text style={[styles.robotsPanelText, { color: textColor }]}>No summary yet.</Text>;
  }
  return (
    <View style={styles.robotsPanelBody}>
      <Text numberOfLines={2} style={[styles.summaryTitle, { color: textColor }]}>
        {summary.title}
      </Text>
      <Text numberOfLines={10} style={[styles.robotsPanelText, { color: textColor }]}>
        {summary.description}
      </Text>
    </View>
  );
}

function ChapterPanel({
  chapters,
  onSeek,
  textColor,
}: {
  chapters: MuxVideoChapter[];
  onSeek: (time: number) => void;
  textColor: string;
}) {
  if (chapters.length === 0) {
    return <Text style={[styles.robotsPanelText, { color: textColor }]}>No chapters yet.</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.robotsScroll}>
      {chapters.map(chapter => (
        <Pressable
          accessibilityLabel={`Seek to chapter ${chapter.title}`}
          accessibilityRole="button"
          key={`${chapter.startTime}-${chapter.title}`}
          onPress={() => onSeek(chapter.startTime)}
          style={({ pressed }) => [styles.robotsListItem, pressed && styles.pressed]}
        >
          <Text style={[styles.robotsItemTime, { color: textColor }]}>
            {formatTime(chapter.startTime)}
          </Text>
          <Text numberOfLines={2} style={[styles.robotsItemTitle, { color: textColor }]}>
            {chapter.title}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function KeyMomentsPanel({
  keyMoments,
  onSeek,
  textColor,
}: {
  keyMoments: MuxVideoKeyMoment[];
  onSeek: (time: number) => void;
  textColor: string;
}) {
  if (keyMoments.length === 0) {
    return <Text style={[styles.robotsPanelText, { color: textColor }]}>No key moments yet.</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.robotsScroll}>
      {keyMoments.map(moment => (
        <Pressable
          accessibilityLabel={`Seek to key moment ${moment.title}`}
          accessibilityRole="button"
          key={`${moment.startTime}-${moment.endTime}-${moment.title}`}
          onPress={() => onSeek(moment.startTime)}
          style={({ pressed }) => [styles.robotsListItem, pressed && styles.pressed]}
        >
          <Text style={[styles.robotsItemTime, { color: textColor }]}>
            {formatTime(moment.startTime)} - {formatTime(moment.endTime)}
          </Text>
          <Text numberOfLines={2} style={[styles.robotsItemTitle, { color: textColor }]}>
            {moment.title}
          </Text>
          {moment.description ? (
            <Text numberOfLines={2} style={[styles.robotsItemDescription, { color: textColor }]}>
              {moment.description}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CaptionTracksPanel({
  backgroundColor,
  onSelect,
  selectedTrackId,
  textColor,
  tracks,
}: {
  backgroundColor: string;
  onSelect: (trackId: string | null) => void;
  selectedTrackId: string | null;
  textColor: string;
  tracks: MuxVideoCaptionTrack[];
}) {
  return (
    <View style={[styles.captionPanel, { backgroundColor }]}>
      <Text style={[styles.captionPanelTitle, { color: textColor }]}>Captions</Text>
      <CaptionTrackOption
        active={selectedTrackId === null}
        label="Off"
        onPress={() => onSelect(null)}
        textColor={textColor}
      />
      {tracks.map(track => (
        <CaptionTrackOption
          active={selectedTrackId === track.id}
          key={track.id}
          label={track.label || track.language || 'Caption track'}
          meta={track.language}
          onPress={() => onSelect(track.id)}
          textColor={textColor}
        />
      ))}
    </View>
  );
}

function CaptionTrackOption({
  active,
  label,
  meta,
  onPress,
  textColor,
}: {
  active: boolean;
  label: string;
  meta?: string;
  onPress: () => void;
  textColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`Select captions ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.captionOption,
        active && styles.captionOptionActive,
        pressed && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.captionOptionText, { color: textColor }]}>
        {label}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={[styles.captionOptionMeta, { color: textColor }]}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

function PlayIcon({ color, size }: { color: string; size: number }) {
  const half = size * 0.18;
  return (
    <View
      pointerEvents="none"
      style={{
        borderBottomColor: 'transparent',
        borderBottomWidth: half,
        borderLeftColor: color,
        borderLeftWidth: half * 1.15,
        borderTopColor: 'transparent',
        borderTopWidth: half,
        height: 0,
        marginLeft: half * 0.3,
        width: 0,
      }}
    />
  );
}

function PauseIcon({ color, size }: { color: string; size: number }) {
  const barWidth = size * 0.1;
  const barHeight = size * 0.36;
  return (
    <View pointerEvents="none" style={{ alignItems: 'center', flexDirection: 'row', gap: barWidth * 1.1 }}>
      <View style={{ backgroundColor: color, borderRadius: 2, height: barHeight, width: barWidth }} />
      <View style={{ backgroundColor: color, borderRadius: 2, height: barHeight, width: barWidth }} />
    </View>
  );
}

function SkipIcon({
  color,
  direction,
  seconds,
  size,
}: {
  color: string;
  direction: 'back' | 'forward';
  seconds: number;
  size: number;
}) {
  return (
    <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text
        allowFontScaling={false}
        style={{
          color,
          fontSize: Math.round(size * 0.5),
          fontWeight: '700',
          lineHeight: Math.round(size * 0.5),
        }}
      >
        {direction === 'back' ? '↺' : '↻'}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          color,
          fontSize: Math.round(size * 0.26),
          fontWeight: '800',
          marginTop: 1,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}

function CaptionsIcon({
  active,
  color,
  size,
}: {
  active: boolean;
  color: string;
  size: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.captionsIconFrame,
        {
          borderColor: color,
          height: Math.round(size * 0.58),
          width: Math.round(size * 0.78),
        },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[
          styles.captionsIconText,
          {
            color,
            fontSize: Math.max(8, Math.round(size * 0.24)),
            opacity: active ? 1 : 0.72,
          },
        ]}
      >
        CC
      </Text>
    </View>
  );
}

function FullscreenIcon({
  color,
  expanded,
  size,
}: {
  color: string;
  expanded: boolean;
  size: number;
}) {
  const stroke = Math.max(2, Math.round(size * 0.1));
  const arm = Math.round(size * 0.36);
  const inset = expanded ? Math.round(size * 0.24) : Math.round(size * 0.2);
  const cornerStyle = (
    vertical: 'top' | 'bottom',
    horizontal: 'left' | 'right'
  ) => ({
    [vertical]: inset,
    [horizontal]: inset,
  });
  const armStyle = (
    vertical: 'top' | 'bottom',
    horizontal: 'left' | 'right',
    orientation: 'horizontal' | 'vertical'
  ) => ({
    position: 'absolute' as const,
    backgroundColor: color,
    borderRadius: stroke,
    width: orientation === 'horizontal' ? arm : stroke,
    height: orientation === 'horizontal' ? stroke : arm,
    [vertical]: 0,
    [horizontal]: 0,
  });
  const renderBracket = (
    key: string,
    vertical: 'top' | 'bottom',
    horizontal: 'left' | 'right'
  ) => (
    <View
      key={key}
      style={{ position: 'absolute', ...cornerStyle(vertical, horizontal) }}
    >
      <View style={armStyle(vertical, horizontal, 'horizontal')} />
      <View style={armStyle(vertical, horizontal, 'vertical')} />
    </View>
  );
  return (
    <View pointerEvents="none" style={{ height: size, width: size }}>
      {expanded
        ? [
            renderBracket('tr', 'top', 'right'),
            renderBracket('bl', 'bottom', 'left'),
          ]
        : [
            renderBracket('tl', 'top', 'left'),
            renderBracket('br', 'bottom', 'right'),
          ]}
    </View>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function runPlayerCommand(command: Promise<void>): void {
  command.catch(() => {
    // Command failures are already reflected through player status/source events.
  });
}

function getRobotsErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

const styles = StyleSheet.create({
  controlsRoot: {
    overflow: 'hidden',
  },
  centerWrap: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    gap: 20,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 16,
  },
  gradientTop: {
    height: '32%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  gradientBottom: {
    bottom: 0,
    height: '40%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  centerCluster: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  centerClusterHidden: {
    opacity: 0,
  },
  timeline: {
    bottom: 6,
    gap: 4,
    left: 16,
    minWidth: 0,
    position: 'absolute',
    right: 16,
  },
  trackHitArea: {
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: frostBorderWidth,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  track: {
    overflow: 'hidden',
    width: '100%',
  },
  trackFill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  momentRange: {
    bottom: 0,
    opacity: 0.45,
    position: 'absolute',
    top: 0,
  },
  chapterMarker: {
    bottom: 0,
    opacity: 0.85,
    position: 'absolute',
    top: 0,
    width: 2,
  },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  timeControls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 8,
    justifyContent: 'flex-end',
  },
  captionControlWrap: {
    position: 'relative',
  },
  captionPanel: {
    borderColor: frostBorderColor,
    borderRadius: 14,
    borderWidth: frostBorderWidth,
    bottom: 34,
    gap: 6,
    minWidth: 176,
    padding: 8,
    position: 'absolute',
    right: 0,
  },
  captionPanelTitle: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 6,
  },
  captionOption: {
    backgroundColor: 'rgba(248, 251, 255, 0.08)',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  captionOptionActive: {
    borderColor: frostBorderColor,
    backgroundColor: 'rgba(248, 251, 255, 0.16)',
  },
  captionOptionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  captionOptionMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
    opacity: 0.72,
  },
  timePill: {
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: frostBorderWidth,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrubPreview: {
    backgroundColor: '#000',
    borderColor: frostBorderColor,
    borderRadius: 10,
    borderWidth: frostBorderWidth,
    bottom: '100%',
    marginBottom: 10,
    overflow: 'hidden',
    position: 'absolute',
  },
  scrubPreviewTimeRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    left: 0,
    paddingVertical: 2,
    position: 'absolute',
    right: 0,
  },
  scrubPreviewTime: {
    color: '#f8fbff',
    fontSize: 11,
    fontWeight: '800',
  },
  chapterPillRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  chapterPill: {
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: frostBorderWidth,
    maxWidth: 140,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chapterPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  robotsArea: {
    alignItems: 'center',
    gap: 6,
    maxWidth: 420,
    width: '100%',
  },
  robotsButtonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  robotsButtonScroller: {
    maxWidth: '100%',
    width: '100%',
  },
  robotsButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  robotsButtonImage: {
    height: 18,
    resizeMode: 'contain',
    width: 18,
  },
  robotsButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  robotsPanel: {
    borderColor: frostBorderColor,
    borderRadius: 16,
    borderWidth: frostBorderWidth,
    gap: 6,
    left: 0,
    marginTop: 6,
    overflow: 'hidden',
    padding: 10,
    position: 'absolute',
    right: 0,
    top: '100%',
  },
  robotsPanelTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  robotsPanelBody: {
    gap: 6,
  },
  robotsPanelText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    opacity: 0.92,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    backgroundColor: 'rgba(248, 251, 255, 0.08)',
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  robotsScroll: {
    maxHeight: 92,
  },
  robotsListItem: {
    backgroundColor: 'rgba(248, 251, 255, 0.08)',
    borderColor: frostBorderColor,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
    padding: 8,
    width: 152,
  },
  robotsItemTime: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
    opacity: 0.78,
  },
  robotsItemTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  robotsItemDescription: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: 3,
    opacity: 0.82,
  },
  captionsIconFrame: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
  },
  captionsIconText: {
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
});
