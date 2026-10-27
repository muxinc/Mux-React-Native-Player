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
import type { AccessibilityActionEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type {
  MuxMaxResolution,
  MuxPlayerStatus,
  MuxVideoAudioTrack,
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
import {
  CaptionsGlyph,
  ConcaveCorner,
  ControlIcon,
  copySummary,
  chipStyle,
  chipTextStyle,
  defaultHiddenRobots,
  designFontStyle,
  DESIGN,
  DESIGN_COLORS,
  FADE_HEIGHT,
  FadingCardRow,
  FONT,
  formatClock,
  linkTextStyle,
  mobileDesignScale,
  ProgressTrack,
  px,
  ROBOTS_LABELS,
  ROBOTS_ORDER,
  RobotsGlyph,
  SeekGlyph,
  summaryCopyAction,
  type RobotsKind,
  type TrackMarks,
  useDesignFonts,
} from './controlsDesign';

type ControlsColors = Required<
  Omit<MuxVideoControlsTheme, 'buttonSize' | 'playButtonSize' | 'fullscreenButtonSize' | 'trackHeight'>
>;
type RobotsPanel = RobotsKind;
type Scale = (value: number) => number;

type MuxVideoControlsProps = {
  player: MuxVideoPlayer;
  status: MuxPlayerStatus;
  shouldPlay: boolean;
  source?: NormalizedMuxVideoSource;
  thumbnailPreviews?: boolean;
  settingsMenu?: boolean | { speed?: boolean; quality?: boolean };
  allowsAirPlay?: boolean;
  /**
   * Keeps interactive controls clear of display cutouts while the root view —
   * and with it the tap-to-dismiss scrim and gradients — spans the full screen.
   */
  safeAreaInsets?: { left: number; right: number };
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
const emptyAudioTracks: MuxVideoAudioTrack[] = [];
const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;
const QUALITY_OPTIONS: MuxMaxResolution[] = ['720p', '1080p', '1440p', '2160p'];
const SEEK_ACCESSIBILITY_ACTIONS = [
  { name: 'increment', label: 'Skip forward' },
  { name: 'decrement', label: 'Skip back' },
];
/** Below this much room under the tab, Summary and Transcript take over the bar too. */
const COMPACT_PANEL_HEIGHT = 380;

const defaultColors: ControlsColors = {
  accentColor: DESIGN_COLORS.accent,
  backgroundColor: 'transparent',
  buttonBackgroundColor: DESIGN_COLORS.surface,
  panelBackgroundColor: DESIGN_COLORS.surface,
  buttonTextColor: DESIGN_COLORS.text,
  progressTrackColor: DESIGN_COLORS.progress,
  bufferedTrackColor: DESIGN_COLORS.buffered,
  trackColor: DESIGN_COLORS.track,
  textColor: DESIGN_COLORS.text,
  seekSeconds: 10,
};

export function MuxVideoControls({
  player,
  status,
  shouldPlay,
  source,
  thumbnailPreviews = true,
  settingsMenu = true,
  allowsAirPlay = true,
  safeAreaInsets,
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
  const colors = React.useMemo<ControlsColors>(
    () => ({ ...defaultColors, ...stripUndefined(theme) }),
    [theme]
  );

  const [hidden, setHidden] = React.useState(false);
  const [interactionTick, setInteractionTick] = React.useState(0);
  const [trackWidth, setTrackWidth] = React.useState(0);
  const [trackOffsetX, setTrackOffsetX] = React.useState(0);
  const [barWidth, setBarWidth] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [containerHeight, setContainerHeight] = React.useState(0);
  const [containerPageX, setContainerPageX] = React.useState(0);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [scrubTime, setScrubTime] = React.useState(0);
  const [pendingTarget, setPendingTarget] = React.useState<number | null>(null);
  const [activeRobotsPanel, setActiveRobotsPanel] = React.useState<RobotsPanel | null>(null);
  const [robotsLoading, setRobotsLoading] = React.useState<RobotsPanel | null>(null);
  const [robotsError, setRobotsError] = React.useState<string | null>(null);
  const [robotsVisibility, setRobotsVisibility] = React.useState<Partial<Record<RobotsKind, boolean>>>({});
  const [captionsOpen, setCaptionsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
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
  const audioTracks = status.audioTracks ?? emptyAudioTracks;
  const selectedAudioTrackId = status.selectedAudioTrackId ?? null;
  const canSummarize = robotsEnabled && (!!summary || (!!robotsAssetId && !!robots?.onSummarize));
  const canGenerateChapters = robotsEnabled && (chapters.length > 0 || (!!robotsAssetId && !!robots?.onGenerateChapters));
  const canFindKeyMoments = robotsEnabled && (keyMoments.length > 0 || (!!robotsAssetId && !!robots?.onFindKeyMoments));
  const canTranscribe =
    robotsEnabled &&
    ((transcript?.cues.length ?? 0) > 0 || (!!robotsAssetId && !!robots?.onTranscribe));
  const availableRobots = ROBOTS_ORDER.filter(kind => ({
    summary: canSummarize,
    chapters: canGenerateChapters,
    moments: canFindKeyMoments,
    transcript: canTranscribe,
  })[kind]);
  const hasRobotsActions = availableRobots.length > 0;
  const defaultHidden = defaultHiddenRobots(availableRobots);
  const isRobotVisible = (kind: RobotsKind) => robotsVisibility[kind] ?? !defaultHidden.includes(kind);
  const visibleRobots = availableRobots.filter(isRobotVisible);
  const isRobotsFocused = activeRobotsPanel !== null;
  const hasCaptionTracks = captionTracks.length > 0;
  // A single audio track offers no alternative language, so hide the section.
  const hasAudioTrackChoices = audioTracks.length > 1;
  const showCaptionsButton = hasCaptionTracks || hasAudioTrackChoices;
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
    if (!showCaptionsButton) {
      setCaptionsOpen(false);
    }
  }, [showCaptionsButton]);

  React.useEffect(() => {
    if (!hasRobotsActions) {
      setMoreOpen(false);
    }
  }, [hasRobotsActions]);

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

  // Chapter and key-moment marks show only while their panel is open, so the
  // timeline stays uncluttered the rest of the time.
  const trackMarks = React.useMemo<TrackMarks>(
    () =>
      duration > 0
        ? {
            // The first chapter starts the timeline, so it is not a boundary.
            markers:
              activeRobotsPanel === 'chapters'
                ? visibleChapters.slice(1).map(chapter => clamp(chapter.startTime / duration, 0, 1))
                : [],
            ranges:
              activeRobotsPanel === 'moments'
                ? visibleKeyMoments.map(moment => [
                    clamp(moment.startTime / duration, 0, 1),
                    clamp(moment.endTime / duration, 0, 1),
                  ])
                : [],
          }
        : { markers: [], ranges: [] },
    [activeRobotsPanel, duration, visibleChapters, visibleKeyMoments]
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
  // Fold the safe-area insets into the offscreen ones: both push interactive
  // controls inward while the scrim and gradients keep covering the full view.
  const offscreenLeftInset = Math.max(0, -containerPageX) + (safeAreaInsets?.left ?? 0);
  const offscreenRightInset =
    (viewportWidth > 0 && containerWidth > 0
      ? Math.max(0, containerPageX + containerWidth - viewportWidth)
      : 0) + (safeAreaInsets?.right ?? 0);
  const isPortraitControls =
    containerWidth > 0 && containerHeight > 0 && containerHeight / containerWidth > 1.25;
  const visibleControlsWidth =
    containerWidth > 0
      ? Math.max(0, containerWidth - offscreenLeftInset - offscreenRightInset)
      : 0;
  const scale = mobileDesignScale(visibleControlsWidth, containerHeight);
  const u: Scale = value => value * scale;
  const leftInset = u(DESIGN.inset) + offscreenLeftInset;
  const rightInset = u(DESIGN.inset) + offscreenRightInset;
  const contentWidth = Math.max(0, containerWidth - leftInset - rightInset);
  // Tall (9:16) layouts get a proportional top offset — a fixed one hugs the
  // status bar and strands the UI far from the content.
  const topInset = px(isPortraitControls
    ? Math.min(140, Math.max(24, Math.floor(containerHeight * 0.16)))
    : u(DESIGN.inset));
  // Keep the bottom bar above an app-level tab bar in tall, feed-style
  // layouts. Scale the inset slightly with the viewport while keeping it in
  // the range of common iOS and Android tab bars.
  const bottomInset = isPortraitControls
    ? Math.min(96, Math.max(72, Math.floor(containerHeight * 0.1)))
    : u(DESIGN.bottomInset);
  const barHeight = px(u(DESIGN.barHeight));
  const barTop = containerHeight - bottomInset - barHeight;
  const panelTop = px(topInset + u(DESIGN.tabHeight));
  const iconSize = theme?.fullscreenButtonSize ?? u(DESIGN.icon);
  const playSize = theme?.playButtonSize ?? u(DESIGN.playCircle);
  const seekSize = theme?.buttonSize ?? u(DESIGN.seekCircle);
  const trackHeight = theme?.trackHeight ?? u(DESIGN.trackHeight);
  // Centre the transport on the video unless it would crowd the bar; then
  // centre it between the top row and the bar, as the inline phone frame does.
  const centerY =
    containerHeight / 2 + playSize / 2 + u(DESIGN.inset) <= barTop
      ? containerHeight / 2
      : (topInset + u(DESIGN.circle) + barTop) / 2;
  const roomUnderTab = barTop - u(DESIGN.panelGap) - panelTop;
  const textPanelTakesBar =
    (activeRobotsPanel === 'summary' || activeRobotsPanel === 'transcript') &&
    roomUnderTab < u(COMPACT_PANEL_HEIGHT);
  const showBar = !textPanelTakesBar;
  const robotsPanelMaxHeight = Math.max(
    u(DESIGN.cardHeight),
    (textPanelTakesBar ? containerHeight - bottomInset : barTop - u(DESIGN.panelGap)) - panelTop
  );
  // The settings and captions panels sit above the bar; cap them to the space
  // left in the video view so their tops don't get clipped on inline layouts.
  const anchoredPanelMaxHeight = Math.max(u(160), barTop - u(DESIGN.panelGap) - topInset);
  const timeInTopRow = !!activeChapter && !isLive;
  // The "…" menu hangs from the top-right and the settings/captions panels
  // stand on the bar's right end; on short players they would overlap, so
  // there only one opens at a time (landscape frames show both together).
  const stackHeight = (rows: number, rowHeight: number) =>
    u(DESIGN.menuPadding) * (rows + 1) + rows * u(rowHeight);
  const anchoredRows = Math.max(
    1,
    (showQualityControl ? 1 : 0) + (showSpeedControl ? 1 : 0),
    (hasCaptionTracks ? 1 : 0) + (hasAudioTrackChoices ? 1 : 0)
  );
  const menusCollide =
    topInset + u(DESIGN.circle) + stackHeight(availableRobots.length, DESIGN.toggle) + u(DESIGN.panelGap) >
    barTop - u(DESIGN.panelGap) - stackHeight(anchoredRows, DESIGN.chipHeight);
  // Those same short players have no room for the transport beside an open
  // menu, so the portrait frames drop it while one is showing.
  const menuCoversTransport = menusCollide && (moreOpen || settingsOpen || captionsOpen);

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

  const dismissMoreMenu = React.useCallback(() => {
    setMoreOpen(false);
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

    if (moreOpen) {
      dismissMoreMenu();
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
  }, [activeRobotsPanel, captionsOpen, dismissCaptionsPanel, dismissMoreMenu, dismissRobotsPanel, dismissSettingsPanel, fadeIn, fadeOut, hidden, moreOpen, robotsLoading, settingsOpen]);

  React.useEffect(() => {
    if (hidden || scrubbing || activeRobotsPanel || robotsLoading || captionsOpen || settingsOpen || moreOpen) {
      return;
    }
    const timer = setTimeout(fadeOut, 3000);
    return () => clearTimeout(timer);
  }, [hidden, scrubbing, activeRobotsPanel, robotsLoading, captionsOpen, settingsOpen, moreOpen, interactionTick, fadeOut]);

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
      const { width, x } = event.nativeEvent.layout;
      setTrackWidth(width);
      setTrackOffsetX(x);
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

  const seekSecondsRef = React.useRef(colors.seekSeconds);
  seekSecondsRef.current = colors.seekSeconds;

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

  const closeRobotsForPanel = React.useCallback(() => {
    if (activeRobotsPanel || robotsLoading) {
      robotsRequestRef.current += 1;
      setActiveRobotsPanel(null);
      setRobotsLoading(null);
      setRobotsError(null);
    }
  }, [activeRobotsPanel, robotsLoading]);

  const toggleCaptionsPanel = React.useCallback(() => {
    keepAlive();
    setSettingsOpen(false);
    closeRobotsForPanel();
    if (menusCollide) {
      setMoreOpen(false);
    }
    setCaptionsOpen(open => !open);
  }, [closeRobotsForPanel, keepAlive, menusCollide]);

  const toggleSettingsPanel = React.useCallback(() => {
    keepAlive();
    setCaptionsOpen(false);
    closeRobotsForPanel();
    if (menusCollide) {
      setMoreOpen(false);
    }
    setSettingsOpen(open => !open);
  }, [closeRobotsForPanel, keepAlive, menusCollide]);

  const toggleMoreMenu = React.useCallback(() => {
    keepAlive();
    closeRobotsForPanel();
    if (menusCollide) {
      setCaptionsOpen(false);
      setSettingsOpen(false);
    }
    setMoreOpen(open => !open);
  }, [closeRobotsForPanel, keepAlive, menusCollide]);

  const toggleRobotVisibility = React.useCallback(
    (kind: RobotsKind) => {
      keepAlive();
      const visible = robotsVisibility[kind] ?? !defaultHidden.includes(kind);
      setRobotsVisibility(current => ({ ...current, [kind]: !visible }));
      if (visible && activeRobotsPanel === kind) {
        dismissRobotsPanel();
      }
    },
    [activeRobotsPanel, defaultHidden, dismissRobotsPanel, keepAlive, robotsVisibility]
  );

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

  const openRobotsPanel = React.useCallback(
    (kind: RobotsKind) => {
      // Robots panels overlap the anchored menus, so only one is open at a time.
      setCaptionsOpen(false);
      setSettingsOpen(false);
      setMoreOpen(false);
      ({ summary: loadSummary, chapters: loadChapters, moments: loadKeyMoments, transcript: loadTranscript })[kind]();
    },
    [loadChapters, loadKeyMoments, loadSummary, loadTranscript]
  );

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
      player.setCaptionTrack(trackId).catch(() => {
        // Caption selection failures are non-fatal and native status will correct UI state.
      });
    },
    [keepAlive, player]
  );

  const selectAudioTrack = React.useCallback(
    (trackId: string) => {
      keepAlive();
      player.setAudioTrack(trackId).catch(() => {
        // Audio selection failures are non-fatal and native status will correct UI state.
      });
    },
    [keepAlive, player]
  );

  const timeLabel = isLive ? (
    <Pressable
      accessibilityLabel="Go to live edge"
      accessibilityRole="button"
      hitSlop={8}
      onPress={seekToLive}
      style={({ pressed }) => [styles.liveRow, { gap: u(14) }, pressed && styles.pressed]}
    >
      <View
        style={{
          backgroundColor: atLiveEdge ? colors.accentColor : colors.trackColor,
          borderRadius: u(9),
          height: u(18),
          width: u(18),
        }}
      />
      <Text numberOfLines={1} style={[styles.barText, { color: colors.textColor, fontSize: u(DESIGN.text) }]}>
        {atLiveEdge ? 'LIVE' : `LIVE −${formatClock(behindLiveEdge)}`}
      </Text>
    </Pressable>
  ) : (
    <Text
      numberOfLines={1}
      style={[styles.barText, styles.tabular, { color: colors.textColor, fontSize: u(DESIGN.text) }]}
    >
      {formatClock(displayTime)} / {formatClock(duration)}
    </Text>
  );

  const previewWidth = Math.max(96, u(DESIGN.cardWidth));
  const previewLeft = clamp(
    u(DESIGN.barPaddingX) + trackOffsetX + clamp(progress, 0, 1) * trackWidth - previewWidth / 2,
    0,
    Math.max(0, barWidth - previewWidth)
  );

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
            colors={[DESIGN_COLORS.fadeStart, DESIGN_COLORS.fadeEnd]}
            pointerEvents="none"
            style={styles.gradientTop}
          />
          <LinearGradient
            colors={[DESIGN_COLORS.fadeEnd, DESIGN_COLORS.fadeStart]}
            pointerEvents="none"
            style={styles.gradientBottom}
          />

          {!isRobotsFocused && !menuCoversTransport ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.centerCluster,
                {
                  gap: u(DESIGN.seekGap) * (seekSize / u(DESIGN.seekCircle)),
                  height: playSize,
                  left: offscreenLeftInset,
                  right: offscreenRightInset,
                  top: centerY - playSize / 2,
                },
              ]}
            >
              <CircleButton
                accessibilityLabel={`Skip back ${colors.seekSeconds} seconds`}
                backgroundColor={colors.buttonBackgroundColor}
                onPress={seekBack}
                size={seekSize}
              >
                <SeekGlyph
                  color={colors.buttonTextColor}
                  direction="back"
                  seconds={colors.seekSeconds}
                  size={seekSize * (DESIGN.seekGlyph / DESIGN.seekCircle)}
                  variant="mobile"
                />
              </CircleButton>
              <CircleButton
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                backgroundColor={colors.buttonBackgroundColor}
                onPress={togglePlayback}
                size={playSize}
              >
                <ControlIcon
                  color={colors.buttonTextColor}
                  name={isPlaying ? 'pause' : 'play'}
                  size={playSize * (DESIGN.playGlyph / DESIGN.playCircle)}
                />
              </CircleButton>
              <CircleButton
                accessibilityLabel={`Skip forward ${colors.seekSeconds} seconds`}
                backgroundColor={colors.buttonBackgroundColor}
                onPress={seekForward}
                size={seekSize}
              >
                <SeekGlyph
                  color={colors.buttonTextColor}
                  direction="forward"
                  seconds={colors.seekSeconds}
                  size={seekSize * (DESIGN.seekGlyph / DESIGN.seekCircle)}
                  variant="mobile"
                />
              </CircleButton>
            </View>
          ) : null}

          {externalPlaybackActive && !isRobotsFocused ? (
            <View
              pointerEvents="none"
              style={[styles.airPlayRow, { top: panelTop, left: leftInset, right: rightInset }]}
            >
              <View
                style={{
                  backgroundColor: colors.buttonBackgroundColor,
                  borderRadius: u(DESIGN.barRadius),
                  paddingHorizontal: u(28),
                  paddingVertical: u(10),
                }}
              >
                <Text style={[styles.barText, { color: colors.textColor, fontSize: u(DESIGN.text) }]}>
                  Playing via AirPlay
                </Text>
              </View>
            </View>
          ) : null}

          {showBar ? (
            <View
              onLayout={event => setBarWidth(event.nativeEvent.layout.width)}
              pointerEvents="box-none"
              style={[
                styles.bar,
                { bottom: bottomInset, height: barHeight, left: leftInset, right: rightInset },
              ]}
            >
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: colors.panelBackgroundColor,
                    borderRadius: u(DESIGN.barRadius),
                    paddingHorizontal: u(DESIGN.barPaddingX),
                    paddingTop: u(DESIGN.barPaddingTop),
                  },
                ]}
              >
                <View style={[styles.barRow, { height: u(DESIGN.textRow) }]}>
                  {timeInTopRow ? timeLabel : null}
                  <View
                    accessibilityActions={SEEK_ACCESSIBILITY_ACTIONS}
                    accessibilityLabel={isLive ? 'Seek live stream' : 'Seek video'}
                    accessibilityRole="adjustable"
                    accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                    onAccessibilityAction={handleAccessibilitySeek}
                    onLayout={onTrackLayout}
                    style={[
                      styles.trackHitArea,
                      {
                        // Taller than the row so the thin track is easy to grab.
                        height: u(DESIGN.textRow) + 16,
                        marginLeft: timeInTopRow ? u(DESIGN.timeGap) : 0,
                        marginVertical: -8,
                      },
                    ]}
                    {...panResponder.panHandlers}
                  >
                    <View ref={trackRef} collapsable={false}>
                      <ProgressTrack
                        buffered={buffered}
                        colors={{
                          buffered: colors.bufferedTrackColor,
                          marker: colors.textColor,
                          progress: colors.progressTrackColor,
                          range: colors.progressTrackColor,
                          playedRange: colors.textColor,
                          track: colors.trackColor,
                        }}
                        height={scrubbing ? trackHeight * 1.5 : trackHeight}
                        markerHeight={u(DESIGN.markerHeight)}
                        markerWidth={u(DESIGN.markerWidth)}
                        marks={trackMarks}
                        progress={progress}
                      />
                    </View>
                  </View>
                </View>
                <View style={[styles.barRow, { height: u(DESIGN.icon), marginTop: u(DESIGN.barRowGap) }]}>
                  <View style={styles.barTitle}>
                    {timeInTopRow && activeChapter ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.barText, { color: colors.textColor, fontSize: u(DESIGN.text) }]}
                      >
                        {activeChapter.title}
                      </Text>
                    ) : (
                      timeLabel
                    )}
                  </View>
                  <View style={[styles.barIcons, { gap: u(DESIGN.iconGap), marginLeft: u(DESIGN.iconGap) }]}>
                    {showCaptionsButton ? (
                      <IconButton
                        accessibilityLabel={captionsOpen ? 'Hide captions options' : 'Show captions options'}
                        onPress={toggleCaptionsPanel}
                        size={iconSize}
                      >
                        <CaptionsGlyph
                          active={selectedCaptionTrackId !== null}
                          color={colors.buttonTextColor}
                          size={iconSize}
                        />
                      </IconButton>
                    ) : null}
                    {showAirPlayButton && NativeAirPlayButton ? (
                      <View style={{ height: iconSize, width: iconSize }}>
                        {/* AVRoutePickerView draws a fixed-size glyph; keep it as the
                            invisible touch target and show the Figma icon instead. */}
                        <NativeAirPlayButton
                          activeTintColor="transparent"
                          style={StyleSheet.absoluteFill}
                          tintColor="transparent"
                        />
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                          <ControlIcon
                            color={externalPlaybackActive ? colors.accentColor : colors.buttonTextColor}
                            name="airplay"
                            size={iconSize}
                          />
                        </View>
                      </View>
                    ) : null}
                    {showSettingsButton ? (
                      <IconButton
                        accessibilityLabel={settingsOpen ? 'Hide playback settings' : 'Show playback settings'}
                        onPress={toggleSettingsPanel}
                        size={iconSize}
                      >
                        <ControlIcon
                          color={colors.buttonTextColor}
                          name={settingsOpen ? 'settingsOn' : 'settings'}
                          size={iconSize}
                        />
                      </IconButton>
                    ) : null}
                    {allowsFullscreen && onToggleFullscreen ? (
                      <IconButton
                        accessibilityLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onPress={handleToggleFullscreen}
                        size={iconSize}
                      >
                        <ControlIcon
                          color={colors.buttonTextColor}
                          name={isFullscreen ? 'fullscreenExit' : 'fullscreenEnter'}
                          size={iconSize}
                        />
                      </IconButton>
                    ) : null}
                  </View>
                </View>
              </View>
              {scrubbing && thumbnailPreviews && source && trackWidth > 0 ? (
                <ScrubPreview
                  bottom={barHeight + u(DESIGN.panelGap)}
                  left={previewLeft}
                  source={source}
                  storyboard={storyboard}
                  time={displayTime}
                  u={u}
                  width={previewWidth}
                />
              ) : null}
              {captionsOpen ? (
                <AnchoredPanel
                  backgroundColor={colors.panelBackgroundColor}
                  bottom={barHeight + u(DESIGN.panelGap)}
                  maxHeight={anchoredPanelMaxHeight}
                  maxWidth={contentWidth}
                  u={u}
                >
                  {hasCaptionTracks ? (
                    <ChipRow label="Captions" labelWidth={DESIGN.tracksLabelWidth} textColor={colors.textColor} u={u}>
                      <Chip
                        label="Off"
                        onPress={() => selectCaptionTrack(null)}
                        selected={selectedCaptionTrackId === null}
                        u={u}
                      />
                      {captionTracks.map(track => (
                        <Chip
                          key={track.id}
                          label={track.label || track.language || 'Caption track'}
                          onPress={() => selectCaptionTrack(track.id)}
                          selected={selectedCaptionTrackId === track.id}
                          u={u}
                        />
                      ))}
                    </ChipRow>
                  ) : null}
                  {hasAudioTrackChoices ? (
                    <ChipRow label="Audio" labelWidth={DESIGN.tracksLabelWidth} textColor={colors.textColor} u={u}>
                      {audioTracks.map(track => (
                        <Chip
                          key={track.id}
                          label={track.label || track.language || 'Audio track'}
                          onPress={() => selectAudioTrack(track.id)}
                          selected={selectedAudioTrackId === track.id}
                          u={u}
                        />
                      ))}
                    </ChipRow>
                  ) : null}
                </AnchoredPanel>
              ) : null}
              {settingsOpen ? (
                <AnchoredPanel
                  backgroundColor={colors.panelBackgroundColor}
                  bottom={barHeight + u(DESIGN.panelGap)}
                  maxHeight={anchoredPanelMaxHeight}
                  maxWidth={contentWidth}
                  u={u}
                >
                  {showQualityControl ? (
                    <ChipRow label="Quality" textColor={colors.textColor} u={u}>
                      <Chip
                        label="Auto"
                        onPress={() => selectMaxResolution(undefined)}
                        selected={source?.maxResolution == null}
                        u={u}
                      />
                      {QUALITY_OPTIONS.map(resolution => (
                        <Chip
                          key={resolution}
                          label={resolution.replace('p', '')}
                          onPress={() => selectMaxResolution(resolution)}
                          selected={source?.maxResolution === resolution}
                          u={u}
                        />
                      ))}
                    </ChipRow>
                  ) : null}
                  {showSpeedControl ? (
                    <ChipRow label="Speed" textColor={colors.textColor} u={u}>
                      {SPEED_OPTIONS.map(rate => (
                        <Chip
                          key={rate}
                          label={`${rate}x`}
                          onPress={() => selectPlaybackRate(rate)}
                          selected={Math.abs(status.playbackRate - rate) < 0.001}
                          u={u}
                        />
                      ))}
                    </ChipRow>
                  ) : null}
                </AnchoredPanel>
              ) : null}
            </View>
          ) : null}

          {hasRobotsActions ? (
            <>
              {activeRobotsPanel ? (
                <RobotsPanelView
                  activePanel={activeRobotsPanel}
                  backgroundColor={colors.panelBackgroundColor}
                  chapters={visibleChapters}
                  error={robotsError}
                  keyMoments={visibleKeyMoments}
                  loading={robotsLoading === activeRobotsPanel}
                  maxHeight={robotsPanelMaxHeight}
                  onSeek={seekToRobotsTime}
                  source={thumbnailPreviews ? source : undefined}
                  style={
                    activeRobotsPanel === 'summary'
                      ? {
                          left: leftInset + Math.max(0, (contentWidth - u(DESIGN.summaryWidth)) / 2),
                          top: panelTop,
                          width: Math.min(contentWidth, u(DESIGN.summaryWidth)),
                        }
                      : { left: leftInset, right: rightInset, top: panelTop }
                  }
                  summary={summary}
                  textColor={colors.textColor}
                  transcript={transcript}
                  u={u}
                />
              ) : null}
              <View
                pointerEvents="box-none"
                style={[styles.topRow, { gap: u(DESIGN.circleGap), left: leftInset, right: rightInset, top: topInset }]}
              >
                {visibleRobots.map(kind =>
                  kind === activeRobotsPanel ? (
                    <RobotsTab
                      color={colors.panelBackgroundColor}
                      key={kind}
                      kind={kind}
                      onPress={() => openRobotsPanel(kind)}
                      textColor={colors.textColor}
                      u={u}
                    />
                  ) : (
                    <CircleButton
                      accessibilityLabel={`Show ${ROBOTS_LABELS[kind].toLowerCase()} video AI results`}
                      backgroundColor={colors.buttonBackgroundColor}
                      key={kind}
                      onPress={() => openRobotsPanel(kind)}
                      size={u(DESIGN.circle)}
                    >
                      <RobotsGlyph color={colors.buttonTextColor} kind={kind} size={u(DESIGN.icon)} />
                    </CircleButton>
                  )
                )}
              </View>
              <View pointerEvents="box-none" style={[styles.moreAnchor, { right: rightInset, top: topInset }]}>
                {moreOpen ? (
                  <MoreMenu
                    available={availableRobots}
                    color={colors.panelBackgroundColor}
                    isVisible={isRobotVisible}
                    onClose={toggleMoreMenu}
                    onToggle={toggleRobotVisibility}
                    textColor={colors.textColor}
                    u={u}
                  />
                ) : (
                  <CircleButton
                    accessibilityLabel="Choose Mux Robots features"
                    backgroundColor={colors.buttonBackgroundColor}
                    onPress={toggleMoreMenu}
                    size={u(DESIGN.circle)}
                  >
                    <ControlIcon color={colors.buttonTextColor} name="more" size={u(DESIGN.icon)} />
                  </CircleButton>
                )}
              </View>
            </>
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}

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
  bottom,
  left,
  source,
  storyboard,
  time,
  u,
  width,
}: {
  bottom: number;
  left: number;
  source: NormalizedMuxVideoSource;
  storyboard: ParsedStoryboard | null;
  time: number;
  u: Scale;
  width: number;
}) {
  const tile = storyboard ? tileForTime(storyboard, time) : undefined;
  const aspect =
    tile && tile.height > 0 ? tile.width / tile.height : PREVIEW_FALLBACK_ASPECT;
  const height = Math.round(width / aspect);

  let inner: React.ReactNode = null;
  if (tile && storyboard && storyboard.spriteWidth > 0) {
    const scale = width / tile.width;
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
            width: Math.round(width * 2),
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
        {
          borderColor: DESIGN_COLORS.text,
          borderRadius: u(DESIGN.cardRadius),
          borderWidth: u(DESIGN.cardBorder),
          bottom,
          height,
          left,
          width,
        },
      ]}
    >
      {inner}
      <View pointerEvents="none" style={[styles.scrubPreviewTimeRow, { paddingVertical: u(6) }]}>
        <Text style={[styles.barText, styles.tabular, { color: DESIGN_COLORS.text, fontSize: u(DESIGN.smallText) }]}>
          {formatClock(time)}
        </Text>
      </View>
    </View>
  );
}

const CircleButton = React.memo(function CircleButton({
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
        styles.center,
        { backgroundColor, borderRadius: size / 2, height: size, width: size },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
});

const IconButton = React.memo(function IconButton({
  accessibilityLabel,
  children,
  onPress,
  size,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
  size: number;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.center, { height: size, width: size }, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
});

/** The active Robots button grows into a labelled tab that flares into its panel. */
function RobotsTab({
  color,
  kind,
  onPress,
  textColor,
  u,
}: {
  color: string;
  kind: RobotsKind;
  onPress: () => void;
  textColor: string;
  u: Scale;
}) {
  const radius = u(DESIGN.panelRadius);
  return (
    <View
      style={{
        backgroundColor: color,
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        height: px(u(DESIGN.tabHeight)),
        minWidth: u(DESIGN.tabMinWidth),
      }}
    >
      <Pressable
        accessibilityLabel={`Hide ${ROBOTS_LABELS[kind].toLowerCase()} video AI results`}
        accessibilityRole="button"
        accessibilityState={{ expanded: true }}
        hitSlop={8}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tabContent,
          {
            gap: u(DESIGN.tabLabelGap),
            height: u(DESIGN.circle),
            paddingLeft: u(DESIGN.tabPaddingLeft),
            paddingRight: u(DESIGN.tabPaddingRight),
          },
          pressed && styles.pressed,
        ]}
      >
        <RobotsGlyph color={textColor} kind={kind} size={u(DESIGN.icon)} />
        <Text numberOfLines={1} style={[styles.barText, { color: textColor, fontSize: u(DESIGN.text) }]}>
          {ROBOTS_LABELS[kind]}
        </Text>
      </Pressable>
      <ConcaveCorner color={color} radius={radius} side="left" />
      <ConcaveCorner color={color} radius={radius} side="right" />
    </View>
  );
}

/** "…" opens a dropdown that chooses which Robots features the top row shows. */
function MoreMenu({
  available,
  color,
  isVisible,
  onClose,
  onToggle,
  textColor,
  u,
}: {
  available: RobotsKind[];
  color: string;
  isVisible: (kind: RobotsKind) => boolean;
  onClose: () => void;
  onToggle: (kind: RobotsKind) => void;
  textColor: string;
  u: Scale;
}) {
  const radius = u(DESIGN.menuRadius);
  return (
    <View style={styles.moreMenu}>
      <View
        style={{
          backgroundColor: color,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          height: px(u(DESIGN.circle)),
          width: u(DESIGN.circle),
        }}
      >
        <Pressable
          accessibilityLabel="Close Mux Robots features"
          accessibilityRole="button"
          accessibilityState={{ expanded: true }}
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.center, StyleSheet.absoluteFill, pressed && styles.pressed]}
        >
          <ControlIcon color={textColor} name="more" size={u(DESIGN.icon)} />
        </Pressable>
        <ConcaveCorner color={color} radius={radius} side="left" />
      </View>
      <View
        style={{
          backgroundColor: color,
          borderBottomLeftRadius: radius,
          borderBottomRightRadius: radius,
          borderTopLeftRadius: radius,
          gap: u(DESIGN.menuPadding),
          minWidth: u(DESIGN.menuWidth),
          padding: u(DESIGN.menuPadding),
        }}
      >
        {available.map(kind => {
          const on = isVisible(kind);
          return (
            <Pressable
              accessibilityLabel={`Show ${ROBOTS_LABELS[kind]} button`}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
              hitSlop={6}
              key={kind}
              onPress={() => onToggle(kind)}
              style={({ pressed }) => [styles.menuRow, { gap: u(DESIGN.toggleLabelGap) }, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={[styles.barText, { color: textColor, fontSize: u(DESIGN.text) }]}>
                {ROBOTS_LABELS[kind]}
              </Text>
              <View
                style={{
                  backgroundColor: on ? textColor : 'transparent',
                  borderColor: textColor,
                  borderRadius: u(DESIGN.toggle / 2),
                  borderWidth: u(DESIGN.toggleBorder),
                  height: u(DESIGN.toggle),
                  width: u(DESIGN.toggle),
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AnchoredPanel({
  backgroundColor,
  bottom,
  children,
  maxHeight,
  maxWidth,
  u,
}: {
  backgroundColor: string;
  bottom: number;
  children: React.ReactNode;
  maxHeight: number;
  maxWidth: number;
  u: Scale;
}) {
  return (
    <View
      style={[
        styles.anchoredPanel,
        {
          backgroundColor,
          borderRadius: u(DESIGN.barRadius),
          bottom,
          maxHeight,
          maxWidth,
          // Never narrower than the Figma settings panel.
          minWidth: Math.min(maxWidth, u(DESIGN.settingsPanelWidth)),
        },
      ]}
    >
      <ScrollView
        bounces={false}
        contentContainerStyle={{ gap: u(DESIGN.menuPadding), padding: u(DESIGN.menuPadding) }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function ChipRow({
  children,
  label,
  labelWidth = DESIGN.settingsLabelWidth,
  textColor,
  u,
}: {
  children: React.ReactNode;
  label: string;
  labelWidth?: number;
  textColor: string;
  u: Scale;
}) {
  const fontsReady = useDesignFonts();
  return (
    <View style={styles.chipRow}>
      <Text
        numberOfLines={1}
        style={[
          styles.barText,
          designFontStyle(fontsReady),
          { color: textColor, fontSize: u(DESIGN.text), marginRight: u(DESIGN.menuPadding), width: u(labelWidth) },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        bounces={false}
        contentContainerStyle={{ gap: u(DESIGN.chipGap) }}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroller}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  onPress,
  selected,
  u,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
  u: Scale;
}) {
  const fontsReady = useDesignFonts();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [chipStyle(u, selected), pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={chipTextStyle(u, selected, fontsReady)}>
        {label}
      </Text>
    </Pressable>
  );
}

function RobotsPanelView({
  activePanel,
  backgroundColor,
  chapters,
  error,
  keyMoments,
  loading,
  maxHeight,
  onSeek,
  source,
  style,
  summary,
  textColor,
  transcript,
  u,
}: {
  activePanel: RobotsPanel;
  backgroundColor: string;
  chapters: MuxVideoChapter[];
  error: string | null;
  keyMoments: MuxVideoKeyMoment[];
  loading: boolean;
  maxHeight: number;
  onSeek: (time: number) => void;
  source?: NormalizedMuxVideoSource;
  style: { left: number; top: number; right?: number; width?: number };
  summary?: MuxVideoSummary;
  textColor: string;
  transcript?: MuxVideoTranscript;
  u: Scale;
}) {
  const isCards = activePanel === 'chapters' || activePanel === 'moments';
  const message = (text: string) => (
    <Text style={[styles.panelText, { color: textColor, fontSize: u(DESIGN.text), lineHeight: u(DESIGN.bodyLineHeight) }]}>
      {text}
    </Text>
  );
  let content: React.ReactNode;
  if (loading) {
    content = message('Generating results...');
  } else if (error) {
    content = message(error);
  } else if (activePanel === 'summary') {
    content = summary ? <SummaryPanel summary={summary} textColor={textColor} u={u} /> : message('No summary yet.');
  } else if (activePanel === 'chapters') {
    content = chapters.length > 0
      ? <ChapterCards chapters={chapters} onSeek={onSeek} textColor={textColor} u={u} />
      : message('No chapters yet.');
  } else if (activePanel === 'moments') {
    content = keyMoments.length > 0
      ? <MomentCards keyMoments={keyMoments} onSeek={onSeek} source={source} textColor={textColor} u={u} />
      : message('No key moments yet.');
  } else {
    content = (transcript?.cues.length ?? 0) > 0 && transcript
      ? <TranscriptPanel onSeek={onSeek} textColor={textColor} transcript={transcript} u={u} />
      : message('No transcript yet.');
  }
  const showsCards = isCards && !loading && !error && (activePanel === 'chapters' ? chapters.length : keyMoments.length) > 0;

  return (
    <View
      style={[
        styles.robotsPanel,
        style,
        {
          backgroundColor,
          borderRadius: u(DESIGN.panelRadius),
          maxHeight,
          paddingBottom: showsCards ? u(DESIGN.cardsPaddingBottom) : u(DESIGN.summaryPaddingY),
          paddingHorizontal: showsCards ? 0 : u(DESIGN.summaryPaddingX),
          paddingTop: showsCards ? u(DESIGN.cardsPaddingTop) : u(DESIGN.summaryPaddingY),
        },
      ]}
    >
      {content}
    </View>
  );
}

function SummaryPanel({
  summary,
  textColor,
  u,
}: {
  summary: MuxVideoSummary;
  textColor: string;
  u: Scale;
}) {
  const action = summaryCopyAction();
  return (
    <View style={styles.summaryBody}>
      <View style={[styles.summaryHeader, { gap: u(DESIGN.menuPadding) }]}>
        <Text
          numberOfLines={2}
          style={[styles.summaryTitle, { color: textColor, fontSize: u(DESIGN.titleText) }]}
        >
          {summary.title}
        </Text>
        <Pressable
          accessibilityLabel={action === 'copy' ? 'Copy summary' : 'Share summary'}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            copySummary(`${summary.title}\n\n${summary.description}`).catch(() => {
              // Copying is a convenience; failures leave the summary on screen.
            });
          }}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={linkTextStyle(u, textColor)}>{action === 'copy' ? 'COPY' : 'SHARE'}</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} style={[styles.summaryScroll, { marginTop: u(14) }]}>
        <Text style={[styles.panelText, { color: textColor, fontSize: u(DESIGN.text), lineHeight: u(DESIGN.bodyLineHeight) }]}>
          {summary.description}
        </Text>
      </ScrollView>
    </View>
  );
}

function ChapterCards({
  chapters,
  onSeek,
  textColor,
  u,
}: {
  chapters: MuxVideoChapter[];
  onSeek: (time: number) => void;
  textColor: string;
  u: Scale;
}) {
  return (
    <FadingCardRow
      cardWidths={chapters.map(() => u(DESIGN.cardWidth))}
      gap={u(DESIGN.cardGap)}
      paddingX={u(DESIGN.cardsPaddingX)}
    >
      {chapters.map(chapter => (
        <Pressable
          accessibilityLabel={`Seek to chapter ${chapter.title}`}
          accessibilityRole="button"
          key={`${chapter.startTime}-${chapter.title}`}
          onPress={() => onSeek(chapter.startTime)}
          style={({ pressed }) => [cardStyle(u, DESIGN.cardWidth), pressed && styles.pressed]}
        >
          <Text numberOfLines={2} style={[styles.barText, { color: textColor, fontSize: u(DESIGN.text) }]}>
            {chapter.title}
          </Text>
          <Text style={[styles.barText, styles.tabular, { color: textColor, fontSize: u(DESIGN.text) }]}>
            {formatClock(chapter.startTime)}
          </Text>
        </Pressable>
      ))}
    </FadingCardRow>
  );
}

function MomentCards({
  keyMoments,
  onSeek,
  source,
  textColor,
  u,
}: {
  keyMoments: MuxVideoKeyMoment[];
  onSeek: (time: number) => void;
  source?: NormalizedMuxVideoSource;
  textColor: string;
  u: Scale;
}) {
  const [failedThumbnails, setFailedThumbnails] = React.useState<Record<string, true>>({});
  const thumbnailFor = (moment: MuxVideoKeyMoment) =>
    source && !failedThumbnails[momentKey(moment)]
      ? buildMuxThumbnailUrl(source, {
          time: Math.floor(moment.startTime),
          width: 608,
          token: source.thumbnailToken,
        })
      : undefined;
  const widthFor = (moment: MuxVideoKeyMoment) =>
    thumbnailFor(moment) ? DESIGN.momentCardWidth : DESIGN.cardWidth;

  return (
    <FadingCardRow
      cardWidths={keyMoments.map(moment => u(widthFor(moment)))}
      gap={u(DESIGN.cardGap)}
      paddingX={u(DESIGN.cardsPaddingX)}
    >
      {keyMoments.map(moment => {
        const thumbnail = thumbnailFor(moment);
        const key = momentKey(moment);
        return (
          <Pressable
            accessibilityLabel={`Seek to key moment ${moment.title}`}
            accessibilityRole="button"
            key={key}
            onPress={() => onSeek(moment.startTime)}
            style={({ pressed }) => [
              cardStyle(u, widthFor(moment)),
              thumbnail ? styles.momentWithThumbnail : null,
              thumbnail ? { paddingLeft: 0 } : null,
              pressed && styles.pressed,
            ]}
          >
            {thumbnail ? (
              <Image
                accessible={false}
                onError={() => setFailedThumbnails(current => ({ ...current, [key]: true }))}
                source={{ uri: thumbnail }}
                style={{
                  borderBottomLeftRadius: u(DESIGN.cardRadius - 1),
                  borderTopLeftRadius: u(DESIGN.cardRadius - 1),
                  height: '100%',
                  marginRight: u(DESIGN.cardPadding),
                  width: u(DESIGN.momentThumbWidth),
                }}
              />
            ) : null}
            <View style={styles.momentText}>
              <Text numberOfLines={1} style={[styles.barText, { color: textColor, fontSize: u(DESIGN.text) }]}>
                {moment.title}
              </Text>
              {moment.description ? (
                <Text numberOfLines={1} style={[styles.smallText, { color: textColor, fontSize: u(DESIGN.smallText), lineHeight: u(DESIGN.smallLineHeight) }]}>
                  {moment.description}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={[styles.smallText, styles.tabular, { color: textColor, fontSize: u(DESIGN.smallText), lineHeight: u(DESIGN.smallLineHeight) }]}>
                {formatClock(moment.startTime)}-{formatClock(moment.endTime)}
                {Number.isFinite(moment.score) ? (
                  <Text style={styles.scoreText}>{` • Score: ${(moment.score as number).toFixed(2)}`}</Text>
                ) : null}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </FadingCardRow>
  );
}

function TranscriptPanel({
  onSeek,
  textColor,
  transcript,
  u,
}: {
  onSeek: (time: number) => void;
  textColor: string;
  transcript: MuxVideoTranscript;
  u: Scale;
}) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.summaryScroll}>
      {transcript.cues.map((cue, index) => (
        <Pressable
          accessibilityLabel={`Seek to ${formatClock(cue.startTime)}`}
          accessibilityRole="button"
          key={`${cue.startTime}-${index}`}
          onPress={() => onSeek(cue.startTime)}
          style={({ pressed }) => [styles.transcriptCue, { gap: u(DESIGN.cardPadding), paddingVertical: u(8) }, pressed && styles.pressed]}
        >
          <Text style={[styles.smallText, styles.tabular, { color: textColor, fontSize: u(DESIGN.smallText), lineHeight: u(DESIGN.bodyLineHeight), width: u(96) }]}>
            {formatClock(cue.startTime)}
          </Text>
          <Text style={[styles.panelText, styles.transcriptText, { color: textColor, fontSize: u(DESIGN.text), lineHeight: u(DESIGN.bodyLineHeight) }]}>
            {cue.speaker ? `${cue.speaker}: ` : ''}
            {cue.text}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function cardStyle(u: Scale, width: number) {
  return {
    borderColor: DESIGN_COLORS.text,
    borderRadius: u(DESIGN.cardRadius),
    borderWidth: u(DESIGN.cardBorder),
    height: u(DESIGN.cardHeight),
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    paddingHorizontal: u(DESIGN.cardPadding),
    width: u(width),
  };
}

function momentKey(moment: MuxVideoKeyMoment): string {
  return `${moment.startTime}-${moment.endTime}-${moment.title}`;
}

function stripUndefined<T extends object>(value?: T): Partial<T> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
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
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientTop: {
    height: FADE_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  gradientBottom: {
    bottom: 0,
    height: FADE_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  centerCluster: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    position: 'absolute',
  },
  airPlayRow: {
    alignItems: 'center',
    position: 'absolute',
  },
  topRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'center',
    position: 'absolute',
  },
  moreAnchor: {
    alignItems: 'flex-end',
    position: 'absolute',
  },
  moreMenu: {
    alignItems: 'flex-end',
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  tabContent: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  bar: {
    position: 'absolute',
  },
  barRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 0,
  },
  barTitle: {
    flex: 1,
    minWidth: 0,
  },
  barIcons: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  barText: {
    fontWeight: FONT.semibold,
    includeFontPadding: false,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  liveRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
  },
  trackHitArea: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  scrubPreview: {
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'absolute',
  },
  scrubPreviewTimeRow: {
    alignItems: 'center',
    backgroundColor: DESIGN_COLORS.surface,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  anchoredPanel: {
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  chipScroller: {
    flexGrow: 0,
    flexShrink: 1,
  },
  robotsPanel: {
    overflow: 'hidden',
    position: 'absolute',
  },
  panelText: {
    fontWeight: FONT.regular,
  },
  smallText: {
    fontWeight: FONT.light,
  },
  scoreText: {
    fontWeight: FONT.bold,
  },
  summaryBody: {
    flexShrink: 1,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  summaryTitle: {
    flex: 1,
    fontWeight: FONT.semibold,
  },
  summaryScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  momentWithThumbnail: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  momentText: {
    flex: 1,
    minWidth: 0,
  },
  transcriptCue: {
    flexDirection: 'row',
  },
  transcriptText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
