import * as React from 'react';
import {
  AccessibilityInfo,
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
import type { AccessibilityActionEvent, ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type {
  MuxMaxResolution,
  MuxPlayerStatus,
  MuxVideoCaptionTrack,
  MuxVideoChapter,
  MuxVideoControlsTheme,
  MuxVideoKeyMoment,
  MuxVideoRobotsConfig,
  MuxVideoSummary,
  MuxVideoTranscript,
  NormalizedMuxVideoSource,
} from './types';
import { MuxVideoPlayer } from './MuxVideoPlayer';
import NativeAirPlayButton from './NativeAirPlayButton';
import { buildMuxStoryboardVttUrl, buildMuxThumbnailUrl } from './muxImageUrls';
import {
  parseStoryboardVtt,
  tileForTime,
  type ParsedStoryboard,
} from './storyboard';

type RequiredControlsTheme = Required<MuxVideoControlsTheme>;
type RobotsPanel = 'summary' | 'chapters' | 'moments' | 'transcript';

type MuxVideoControlsProps = {
  player: MuxVideoPlayer;
  status: MuxPlayerStatus;
  shouldPlay: boolean;
  source?: NormalizedMuxVideoSource;
  thumbnailPreviews?: boolean;
  settingsMenu?: boolean | { speed?: boolean; quality?: boolean };
  allowsAirPlay?: boolean;
  theme?: MuxVideoControlsTheme;
  robots?: MuxVideoRobotsConfig;
  allowsFullscreen?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  generatedSummary?: MuxVideoSummary;
  generatedChapters?: MuxVideoChapter[];
  generatedKeyMoments?: MuxVideoKeyMoment[];
  generatedTranscript?: MuxVideoTranscript;
  onGeneratedSummaryChange?: (summary: MuxVideoSummary | undefined) => void;
  onGeneratedChaptersChange?: (chapters: MuxVideoChapter[] | undefined) => void;
  onGeneratedKeyMomentsChange?: (keyMoments: MuxVideoKeyMoment[] | undefined) => void;
  onGeneratedTranscriptChange?: (transcript: MuxVideoTranscript | undefined) => void;
};

const emptyChapters: MuxVideoChapter[] = [];
const emptyKeyMoments: MuxVideoKeyMoment[] = [];
const emptyCaptionTracks: MuxVideoCaptionTrack[] = [];
const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;
const QUALITY_OPTIONS: MuxMaxResolution[] = ['720p', '1080p', '1440p', '2160p'];
const SEEK_ACCESSIBILITY_ACTIONS = [
  { name: 'increment', label: 'Skip forward' },
  { name: 'decrement', label: 'Skip back' },
];
const robotImages = {
  summary: require('../assets/MuxRobot_03.gif'),
  chapters: require('../assets/MuxRobot_02.gif'),
  moments: require('../assets/MuxRobot_05.gif'),
  transcript: require('../assets/MuxRobot_04.gif'),
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
  settingsMenu = true,
  allowsAirPlay = true,
  theme,
  robots,
  allowsFullscreen = false,
  isFullscreen = false,
  onToggleFullscreen,
  generatedSummary,
  generatedChapters,
  generatedKeyMoments,
  generatedTranscript,
  onGeneratedSummaryChange,
  onGeneratedChaptersChange,
  onGeneratedKeyMomentsChange,
  onGeneratedTranscriptChange,
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const robotsRequestRef = React.useRef(0);
  const controlsRootRef = React.useRef<View>(null);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const storyboard = useStoryboard(thumbnailPreviews ? source : undefined);
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const isLive = status.isLive === true;
  const seekableStart = Number.isFinite(status.seekableStart) ? (status.seekableStart as number) : 0;
  const seekableEnd = Number.isFinite(status.seekableEnd) ? (status.seekableEnd as number) : 0;
  const liveWindow = Math.max(0, seekableEnd - seekableStart);
  const timelineStart = isLive ? seekableStart : 0;
  const timelineDuration = isLive ? liveWindow : duration;
  const timelineEnd = timelineStart + timelineDuration;
  const playerTime = clamp(status.currentTime, timelineStart, timelineEnd || timelineStart);
  const displayTime = scrubbing
    ? clamp(scrubTime, timelineStart, timelineEnd || timelineStart)
    : pendingTarget !== null
      ? clamp(pendingTarget, timelineStart, timelineEnd || timelineStart)
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
  const bufferedPosition = clamp(status.bufferedPosition, timelineStart, timelineEnd || timelineStart);
  const progress =
    timelineDuration > 0 ? (displayTime - timelineStart) / timelineDuration : isLive ? 1 : 0;
  const buffered =
    timelineDuration > 0 ? (bufferedPosition - timelineStart) / timelineDuration : 0;
  const behindLiveEdge = isLive ? Math.max(0, timelineEnd - displayTime) : 0;
  const atLiveEdge = isLive && behindLiveEdge < 5;
  const isPlaying = status.status === 'playing' || shouldPlay;
  const robotsEnabled = robots != null && robots.enabled !== false;
  const robotsAssetId = robots?.assetId;
  const summary = generatedSummary ?? robots?.summary;
  const chapters = generatedChapters ?? robots?.chapters ?? emptyChapters;
  const keyMoments = generatedKeyMoments ?? robots?.keyMoments ?? emptyKeyMoments;
  const transcript = generatedTranscript ?? robots?.transcript;
  const captionTracks = status.captionTracks ?? emptyCaptionTracks;
  const selectedCaptionTrackId = status.selectedCaptionTrackId ?? null;
  const canSummarize = robotsEnabled && (!!summary || (!!robotsAssetId && !!robots?.onSummarize));
  const canGenerateChapters = robotsEnabled && (chapters.length > 0 || (!!robotsAssetId && !!robots?.onGenerateChapters));
  const canFindKeyMoments = robotsEnabled && (keyMoments.length > 0 || (!!robotsAssetId && !!robots?.onFindKeyMoments));
  const canTranscribe =
    robotsEnabled &&
    ((transcript?.cues.length ?? 0) > 0 || (!!robotsAssetId && !!robots?.onTranscribe));
  const hasRobotsActions = canSummarize || canGenerateChapters || canFindKeyMoments || canTranscribe;
  const isRobotsFocused = activeRobotsPanel !== null;
  const hasCaptionTracks = captionTracks.length > 0;
  const showSpeedControl =
    settingsMenu === true || (typeof settingsMenu === 'object' && settingsMenu.speed !== false);
  const showQualityControl =
    settingsMenu === true || (typeof settingsMenu === 'object' && settingsMenu.quality !== false);
  const showSettingsButton = settingsMenu !== false && (showSpeedControl || showQualityControl);
  const showAirPlayButton = allowsAirPlay && NativeAirPlayButton != null;
  const externalPlaybackActive = status.externalPlaybackActive === true;

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
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setHidden(true);
      }
    });
  }, [opacity, reduceMotion]);

  const fadeIn = React.useCallback(() => {
    setHidden(false);
    Animated.timing(opacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start();
  }, [opacity, reduceMotion]);

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

  const dismissSettingsPanel = React.useCallback(() => {
    setSettingsOpen(false);
    keepAlive();
  }, [keepAlive]);

  const handleBackgroundTap = React.useCallback(() => {
    if (captionsOpen) {
      dismissCaptionsPanel();
      return;
    }

    if (settingsOpen) {
      dismissSettingsPanel();
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
  }, [activeRobotsPanel, captionsOpen, dismissCaptionsPanel, dismissRobotsPanel, dismissSettingsPanel, fadeIn, fadeOut, hidden, robotsLoading, settingsOpen]);

  React.useEffect(() => {
    if (hidden || scrubbing || activeRobotsPanel || robotsLoading || captionsOpen || settingsOpen) {
      return;
    }
    const timer = setTimeout(fadeOut, 3000);
    return () => clearTimeout(timer);
  }, [hidden, scrubbing, activeRobotsPanel, robotsLoading, captionsOpen, settingsOpen, interactionTick, fadeOut]);

  const trackRef = React.useRef<View>(null);
  const scrubStateRef = React.useRef({
    trackWidth: 0,
    trackPageX: 0,
    duration: 0,
    offset: 0,
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
    scrubStateRef.current.duration = timelineDuration;
    scrubStateRef.current.offset = timelineStart;
  }, [trackWidth, timelineDuration, timelineStart]);

  const computeTimeFromX = React.useCallback((x: number): number => {
    const { trackWidth: width, duration: dur, offset } = scrubStateRef.current;
    if (width <= 0 || dur <= 0) {
      return offset;
    }
    return offset + clamp(x / width, 0, 1) * dur;
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

  const handleAccessibilitySeek = React.useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        seekForward();
      } else if (event.nativeEvent.actionName === 'decrement') {
        seekBack();
      }
    },
    [seekBack, seekForward]
  );

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
    setSettingsOpen(false);
    onToggleFullscreen?.();
  }, [keepAlive, onToggleFullscreen]);

  const seekToLive = React.useCallback(() => {
    keepAlive();
    setPendingTarget(null);
    runPlayerCommand(player.seekToLiveEdge());
  }, [keepAlive, player]);

  const toggleCaptionsPanel = React.useCallback(() => {
    keepAlive();
    setSettingsOpen(false);
    setCaptionsOpen(open => !open);
  }, [keepAlive]);

  const toggleSettingsPanel = React.useCallback(() => {
    keepAlive();
    setCaptionsOpen(false);
    setSettingsOpen(open => !open);
  }, [keepAlive]);

  const selectPlaybackRate = React.useCallback(
    (rate: number) => {
      keepAlive();
      runPlayerCommand(player.setPlaybackRate(rate));
    },
    [keepAlive, player]
  );

  const selectMaxResolution = React.useCallback(
    (resolution?: MuxMaxResolution) => {
      keepAlive();
      setSettingsOpen(false);
      player.setMaxResolution(resolution);
    },
    [keepAlive, player]
  );

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

  const loadTranscript = React.useCallback(() => {
    if (activeRobotsPanel === 'transcript' || robotsLoading === 'transcript') {
      dismissRobotsPanel();
      return;
    }
    if ((transcript?.cues.length ?? 0) > 0 || !robotsAssetId || !robots?.onTranscribe) {
      toggleRobotsPanel('transcript');
      return;
    }
    keepAlive();
    const requestId = robotsRequestRef.current + 1;
    robotsRequestRef.current = requestId;
    setActiveRobotsPanel('transcript');
    setRobotsLoading('transcript');
    setRobotsError(null);
    robots
      .onTranscribe({
        assetId: robotsAssetId,
        currentTime: displayTime,
        duration,
      })
      .then(result => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        onGeneratedTranscriptChange?.(result);
        setActiveRobotsPanel('transcript');
      })
      .catch(error => {
        if (robotsRequestRef.current !== requestId) {
          return;
        }
        setRobotsError(getRobotsErrorMessage(error, 'Transcript is not available yet.'));
        setActiveRobotsPanel('transcript');
      })
      .finally(() => {
        if (robotsRequestRef.current === requestId) {
          setRobotsLoading(null);
        }
      });
  }, [activeRobotsPanel, dismissRobotsPanel, displayTime, duration, keepAlive, robots, robotsAssetId, robotsLoading, toggleRobotsPanel, transcript?.cues.length, onGeneratedTranscriptChange]);

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
    activeRobotsPanel === 'summary' || activeRobotsPanel === 'transcript'
      ? summaryPanelMaxHeight
      : defaultPanelMaxHeight;

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
                  {canTranscribe ? (
                    <RobotsActionButton
                      active={activeRobotsPanel === 'transcript'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      label="Transcript"
                      onPress={loadTranscript}
                      robotSource={robotImages.transcript}
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
                    transcript={transcript}
                  />
                ) : null}
              </View>
            ) : null}
            {externalPlaybackActive ? (
              <View
                pointerEvents="none"
                style={[styles.airPlayPill, { backgroundColor: controlsTheme.buttonBackgroundColor }]}
              >
                <Text style={[styles.airPlayPillText, { color: controlsTheme.textColor }]}>
                  Playing via AirPlay
                </Text>
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
              accessibilityActions={SEEK_ACCESSIBILITY_ACTIONS}
              accessibilityLabel={isLive ? 'Seek live stream' : 'Seek video'}
              accessibilityRole="adjustable"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              onAccessibilityAction={handleAccessibilitySeek}
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
              {isLive ? (
                <Pressable
                  accessibilityLabel="Go to live edge"
                  accessibilityRole="button"
                  onPress={seekToLive}
                  style={({ pressed }) => [
                    styles.livePill,
                    {
                      backgroundColor: atLiveEdge
                        ? controlsTheme.accentColor
                        : controlsTheme.buttonBackgroundColor,
                      paddingHorizontal: timePillHorizontalPadding,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.liveDot,
                      { backgroundColor: atLiveEdge ? '#ffffff' : controlsTheme.accentColor },
                    ]}
                  />
                  <Text style={[styles.liveText, { color: controlsTheme.textColor, fontSize: timeFontSize }]}>
                    {atLiveEdge ? 'LIVE' : `LIVE −${formatTime(behindLiveEdge)}`}
                  </Text>
                </Pressable>
              ) : (
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
              )}
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
                {showAirPlayButton && NativeAirPlayButton ? (
                  <NativeAirPlayButton
                    activeTintColor={controlsTheme.accentColor}
                    style={{ height: fullscreenButtonSize, width: fullscreenButtonSize }}
                    tintColor={controlsTheme.buttonTextColor}
                  />
                ) : null}
                {showSettingsButton ? (
                  <View style={styles.captionControlWrap}>
                    {settingsOpen ? (
                      <SettingsPanel
                        accentColor={controlsTheme.accentColor}
                        backgroundColor={controlsTheme.buttonBackgroundColor}
                        currentMaxResolution={source?.maxResolution}
                        currentRate={status.playbackRate}
                        onSelectRate={selectPlaybackRate}
                        onSelectResolution={selectMaxResolution}
                        showQuality={showQualityControl}
                        showSpeed={showSpeedControl}
                        textColor={controlsTheme.textColor}
                      />
                    ) : null}
                    <IconButton
                      accessibilityLabel={settingsOpen ? 'Hide playback settings' : 'Show playback settings'}
                      backgroundColor={controlsTheme.buttonBackgroundColor}
                      onPress={toggleSettingsPanel}
                      size={fullscreenButtonSize}
                    >
                      <SettingsIcon color={controlsTheme.buttonTextColor} size={fullscreenButtonSize} />
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

function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // Reduced-motion preference is best-effort; default to animations on.
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

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
  transcript,
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
  transcript?: MuxVideoTranscript;
}) {
  const title =
    activePanel === 'summary'
      ? 'Summary'
      : activePanel === 'chapters'
        ? 'Chapters'
        : activePanel === 'transcript'
          ? 'Transcript'
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
      ) : activePanel === 'transcript' ? (
        <TranscriptPanel transcript={transcript} onSeek={onSeek} textColor={textColor} />
      ) : (
        <KeyMomentsPanel keyMoments={keyMoments} onSeek={onSeek} textColor={textColor} />
      )}
    </View>
  );
}

function TranscriptPanel({
  onSeek,
  textColor,
  transcript,
}: {
  onSeek: (time: number) => void;
  textColor: string;
  transcript?: MuxVideoTranscript;
}) {
  const cues = transcript?.cues ?? [];
  if (cues.length === 0) {
    return <Text style={[styles.robotsPanelText, { color: textColor }]}>No transcript yet.</Text>;
  }
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.transcriptScroll}>
      {cues.map((cue, index) => (
        <Pressable
          accessibilityLabel={`Seek to ${formatTime(cue.startTime)}`}
          accessibilityRole="button"
          key={`${cue.startTime}-${index}`}
          onPress={() => onSeek(cue.startTime)}
          style={({ pressed }) => [styles.transcriptCue, pressed && styles.pressed]}
        >
          <Text style={[styles.transcriptTime, { color: textColor }]}>
            {formatTime(cue.startTime)}
          </Text>
          <Text style={[styles.transcriptText, { color: textColor }]}>
            {cue.speaker ? `${cue.speaker}: ` : ''}
            {cue.text}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
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

function SettingsPanel({
  accentColor,
  backgroundColor,
  currentMaxResolution,
  currentRate,
  onSelectRate,
  onSelectResolution,
  showQuality,
  showSpeed,
  textColor,
}: {
  accentColor: string;
  backgroundColor: string;
  currentMaxResolution?: MuxMaxResolution;
  currentRate: number;
  onSelectRate: (rate: number) => void;
  onSelectResolution: (resolution?: MuxMaxResolution) => void;
  showQuality: boolean;
  showSpeed: boolean;
  textColor: string;
}) {
  return (
    <View style={[styles.settingsPanel, { backgroundColor }]}>
      {showSpeed ? (
        <View style={styles.settingsSection}>
          <Text style={[styles.settingsTitle, { color: textColor }]}>Speed</Text>
          <View style={styles.settingsOptionRow}>
            {SPEED_OPTIONS.map(rate => (
              <SettingsChip
                accentColor={accentColor}
                active={Math.abs(currentRate - rate) < 0.001}
                key={rate}
                label={rate === 1 ? 'Normal' : `${rate}×`}
                onPress={() => onSelectRate(rate)}
                textColor={textColor}
              />
            ))}
          </View>
        </View>
      ) : null}
      {showQuality ? (
        <View style={styles.settingsSection}>
          <Text style={[styles.settingsTitle, { color: textColor }]}>Quality</Text>
          <View style={styles.settingsOptionRow}>
            <SettingsChip
              accentColor={accentColor}
              active={currentMaxResolution == null}
              label="Auto"
              onPress={() => onSelectResolution(undefined)}
              textColor={textColor}
            />
            {QUALITY_OPTIONS.map(resolution => (
              <SettingsChip
                accentColor={accentColor}
                active={currentMaxResolution === resolution}
                key={resolution}
                label={resolution}
                onPress={() => onSelectResolution(resolution)}
                textColor={textColor}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SettingsChip({
  accentColor,
  active,
  label,
  onPress,
  textColor,
}: {
  accentColor: string;
  active: boolean;
  label: string;
  onPress: () => void;
  textColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsChip,
        active && { backgroundColor: accentColor, borderColor: accentColor },
        pressed && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.settingsChipText, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
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
  const arrowFontSize = Math.round(size * 0.66);
  const numberFontSize = Math.round(size * 0.24);
  return (
    <View
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text
        allowFontScaling={false}
        style={{
          color,
          fontSize: arrowFontSize,
          // Generous line height so the tall ↺/↻ glyphs are never clipped.
          lineHeight: size,
          fontWeight: '600',
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {direction === 'back' ? '↺' : '↻'}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          position: 'absolute',
          color,
          fontSize: numberFontSize,
          fontWeight: '800',
          textAlign: 'center',
          includeFontPadding: false,
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

function SettingsIcon({ color, size }: { color: string; size: number }) {
  return (
    <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center', height: size, width: size }}>
      <Text
        allowFontScaling={false}
        style={{ color, fontSize: Math.round(size * 0.82), lineHeight: Math.round(size * 0.92) }}
      >
        ⚙
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
  airPlayPill: {
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: frostBorderWidth,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  airPlayPillText: {
    fontSize: 12,
    fontWeight: '800',
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
  livePill: {
    alignItems: 'center',
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: frostBorderWidth,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  liveDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  transcriptScroll: {
    flexGrow: 0,
  },
  transcriptCue: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  transcriptTime: {
    fontSize: 11,
    fontWeight: '800',
    opacity: 0.7,
    width: 44,
  },
  transcriptText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
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
  settingsPanel: {
    borderColor: frostBorderColor,
    borderRadius: 14,
    borderWidth: frostBorderWidth,
    bottom: 34,
    gap: 10,
    maxWidth: 260,
    minWidth: 200,
    padding: 10,
    position: 'absolute',
    right: 0,
  },
  settingsSection: {
    gap: 6,
  },
  settingsTitle: {
    fontSize: 12,
    fontWeight: '800',
    opacity: 0.85,
  },
  settingsOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  settingsChip: {
    backgroundColor: 'rgba(248, 251, 255, 0.08)',
    borderColor: frostBorderColor,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  settingsChipText: {
    fontSize: 12,
    fontWeight: '800',
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
