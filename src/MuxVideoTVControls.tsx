import * as React from 'react';
import { Animated, AppState, BackHandler, Easing, Image, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler, useWindowDimensions } from 'react-native';
import type { ImageResizeMode } from 'react-native';
import type { HWEvent, TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { MuxVideoPlayer } from './MuxVideoPlayer';
import type { MuxContentFit, MuxPlayerStatus, MuxVideoControlsTheme, MuxVideoRobotsConfig, NormalizedMuxVideoSource } from './types';
import { buildMuxStoryboardVttUrl, buildMuxThumbnailUrl } from './muxImageUrls';
import { parseStoryboardVtt, tileForTime, type ParsedStoryboard } from './storyboard';
import { CaptionsGlyph, chipStyle, chipTextStyle, ConcaveCorner, ControlIcon, defaultHiddenRobots,
  designFontStyle, DESIGN, DESIGN_COLORS, FADE_HEIGHT, FONT, formatClock, ProgressTrack, ROBOTS_LABELS, ROBOTS_ORDER, RobotsGlyph, SeekGlyph, tvDesignScale, type RobotsKind, type TrackMarks, useDesignFonts } from './controlsDesign';
import { MuxTVRobotsPanel, robotsPanelFocusable } from './tv/MuxTVRobotsPanel';
import { TVButton, type TVButtonProps } from './tv/TVButton';
import { useTVRobots } from './tv/useTVRobots';
import { advanceTVPreview, clampTVTime, clearTVBackSubscription, refreshTVBackSubscription, tvClockLabelWidth, tvFocusEntry, tvFocusLinks, tvQualityOptions, TVRemoteInput, tvScanPress, tvScanSteps, tvScrubSpeed, tvSeekStep,
  tvControlsPresentation, tvSettingsSections, tvTimeline, TV_HOLD_REPEAT_MS, TV_PANEL_ENTRY_FOCUS, TV_PANEL_FOCUS, TV_SPEEDS,
  type TVControlsPanel, type TVFocusLayout, type TVFocusMemory, type TVScan } from './tv/controls';

export type MuxVideoTVControlsProps = {
  player: MuxVideoPlayer;
  status: MuxPlayerStatus;
  shouldPlay: boolean;
  source?: NormalizedMuxVideoSource;
  thumbnailPreviews?: boolean;
  settingsMenu?: boolean | { speed?: boolean; quality?: boolean };
  theme?: MuxVideoControlsTheme;
  robots?: MuxVideoRobotsConfig;
  /** How the video fills the view, so a full-screen seek frame lines up with it. */
  contentFit?: MuxContentFit;
  /** Hosts keeping a playback screen mounted behind another screen can suspend input. */
  active?: boolean;
};

/** Idle time before the overlay hides during playback; any remote input brings it back. */
const AUTO_HIDE_MS = 3000;
/** Controls ease away when they hide, and come back quickly on input. */
const CHROME_FADE_OUT_MS = 600;
const CHROME_FADE_IN_MS = 200;
/**
 * tvOS will not focus a view inside a fully transparent ancestor, so a reveal
 * from fully hidden starts the fade-in here and the returning control can take focus.
 */
const CHROME_REVEAL_OPACITY = 0.3;
/** How long Down or Select on a tab waits for a just-made tab switch to reach React. */
const PANEL_ENTRY_SETTLE_MS = 50;
/** Once the seek preview rests this long, a sharp frame of that moment fills the screen. */
const SEEK_FRAME_SETTLE_MS = 400;
/** After Select, that frame stays up until the seek lands, or at most this long. */
const SEEK_FRAME_HOLD_MS = 2000;
/** Once the seek lands, the frame waits this long for the video to draw that moment. */
const SEEK_FRAME_REVEAL_MS = 300;
const REVEAL_KEYS = new Set(['up', 'down', 'left', 'right', 'longUp', 'longDown', 'longLeft', 'longRight']);
const PLAYBACK_CONTROLS = new Set(['play', 'backward', 'forward', 'live', 'tracks', 'settings']);

const AnimatedFocusGuideView = Animated.createAnimatedComponent(TVFocusGuideView);

/** Mount only for custom TV controls. Native/none modes must not mount this input owner. */
export function MuxVideoTVControls({ player, status, shouldPlay, source, thumbnailPreviews = true,
  settingsMenu = true, theme, robots, contentFit = 'contain', active = true }: MuxVideoTVControlsProps) {
  const [panel, setPanel] = React.useState<TVControlsPanel>(null);
  const panelRef = React.useRef<TVControlsPanel>(null);
  const [previewTime, setPreviewTime] = React.useState(0);
  const previewRef = React.useRef<{ sourceKey: string; time: number } | null>(null);
  /** Whether choosing a spot paused playback, so leaving the preview resumes it. */
  const seekResume = React.useRef(false);
  const [settledPreview, setSettledPreview] = React.useState<number | null>(null);
  const [shownFrame, setShownFrame] = React.useState<string | null>(null);
  const [heldFrame, setHeldFrame] = React.useState<{ uri: string; time: number } | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<string | null>('play');
  const focusRequestRef = React.useRef(focusRequest);
  focusRequestRef.current = focusRequest;
  const [hiddenSourceKey, setHiddenSourceKey] = React.useState<string | null>(null);
  /**
   * The reveal surface stays mounted (and focused) until the returning control
   * takes focus. Removing a focused view first lets the system pick its own
   * default: Android shows the overlay's first control (…) for a frame, and tvOS
   * may keep the top-left one, Summary, instead of the requested control.
   */
  const [revealHandoff, setRevealHandoff] = React.useState(false);
  const [robotsVisibility, setRobotsVisibility] = React.useState<Partial<Record<RobotsKind, boolean>>>({});
  /** False while browsing the tabs: the panel shown must not pull focus down from them. */
  const [panelClaimsFocus, setPanelClaimsFocus] = React.useState(true);
  const [focusRegion, setFocusRegion] = React.useState<'timeline' | 'playback' | 'panel' | 'other'>('other');
  const [focusMemory, setFocusMemory] = React.useState<TVFocusMemory>({});
  const [panelFocusTarget, setPanelFocusTarget] = React.useState<View | null>(null);
  // Only a panel child can enable the guide back to the workflow tabs. Every
  // outside button replaces this region on focus; bubbled blur events between
  // cards must not clear it.
  const markPanelFocused = React.useCallback(() => setFocusRegion('panel'), []);
  const panelEntry = React.useRef<View | null>(null);
  /** Set while Down or Select on a tab waits to enter its panel. */
  const enteringPanel = React.useRef(false);
  const [panelEntryTarget, setPanelEntryTarget] = React.useState<View | null>(null);
  // Ref objects alone do not rerender the tabs when a panel mounts or replaces
  // its loading state with cards. Publish the mounted entry as a focus target.
  const updatePanelEntry = React.useCallback((view: View | null) => {
    panelEntry.current = view;
    setPanelEntryTarget(view);
    if (view) handlers.current.enterPendingPanel();
  }, []);
  const [scrubbing, setScrubbing] = React.useState<TVScan | null>(null);
  const [interaction, setInteraction] = React.useState(0);
  const [layout, setLayout] = React.useState({ width: 0, height: 0 });
  const [track, setTrack] = React.useState({ x: 0, width: 0 });
  const focusRefs = React.useRef(new Map<string, React.RefObject<View | null>>());
  const focusedControl = React.useRef<string | null>(null);
  const scopeFocused = React.useRef(false);
  const scopeTarget = React.useRef<number | null>(null);
  const remoteInput = React.useRef(new TVRemoteInput());
  const holdTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const scanRef = React.useRef<TVScan | null>(null);
  const scanTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const backSubscription = React.useRef<ReturnType<typeof BackHandler.addEventListener> | null>(null);
  const returnFocus = React.useRef('play');
  const mounted = React.useRef(false);
  const appActive = React.useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const sourceKey = identity(source);
  const presentation = tvControlsPresentation(hiddenSourceKey, sourceKey, active);
  const hiddenRef = React.useRef(presentation.showReveal);
  hiddenRef.current = presentation.showReveal;
  const sourceKeyRef = React.useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const [commandError, setCommandError] = React.useState<string | null>(null);
  const storyboard = useTVStoryboard(thumbnailPreviews ? source : undefined);
  const window = useWindowDimensions();
  const width = layout.width || window.width;
  const height = layout.height || window.height;
  const scale = tvDesignScale(width);
  const u = (value: number) => value * scale;
  const accent = theme?.accentColor ?? DESIGN_COLORS.accent;
  const textColor = theme?.textColor ?? DESIGN_COLORS.text;
  const iconColor = theme?.buttonTextColor ?? DESIGN_COLORS.text;
  const surface = theme?.panelBackgroundColor ?? DESIGN_COLORS.surface;
  const fontsReady = useDesignFonts();
  const circleColor = theme?.buttonBackgroundColor ?? DESIGN_COLORS.surface;
  const step = tvSeekStep(theme?.seekSeconds);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const timeline = tvTimeline(status);
  const currentTime = clampTVTime(status.currentTime, timeline);
  const progress = timeline.duration ? (currentTime - timeline.start) / timeline.duration : 0;
  const buffered = timeline.duration ? (clampTVTime(status.bufferedPosition, timeline) - timeline.start) / timeline.duration : 0;
  const previewProgress = timeline.duration ? (clampTVTime(previewTime, timeline) - timeline.start) / timeline.duration : 0;
  const sections = tvSettingsSections(settingsMenu);
  const isPlaying = shouldPlay;
  const isEnded = status.status === 'ended';
  const robotPanel = isRobotsPanel(panel) ? panel : null;
  const modalOpen = panel !== null;
  // Robots content can stay open while the user operates the playback bar.
  const playbackBlocked = modalOpen && !robotPanel;
  // The control that opened a modal stays focusable while the modal traps the
  // arrows, so focus never falls back to another control as it opens or closes.
  const opener = modalOpen ? returnFocus.current : null;
  const chromeBlocked = playbackBlocked || !presentation.showChrome || !active;
  // Chrome fades rather than vanishing; its buttons stop taking focus as soon as it hides.
  const chromeOpacity = React.useRef(new Animated.Value(presentation.showChrome ? 1 : 0)).current;
  const chromeFade = { opacity: chromeOpacity };
  const chromeFadedOut = React.useRef(!presentation.showChrome);
  /** Hidden and blocked state for one overlay group; always a native view, so it never re-parents. */
  const chromeGroup = {
    collapsable: false,
    pointerEvents: playbackBlocked || !presentation.showChrome ? 'none' as const : 'auto' as const,
    accessibilityElementsHidden: chromeBlocked,
    importantForAccessibility: chromeBlocked ? 'no-hide-descendants' as const : 'auto' as const,
  };
  // Hidden chrome is inert, not disabled: a disabled button dims, which would jump mid-fade.
  const baseDisabled = !source;
  const configuredRobots = React.useMemo(() => robots && !robots.assetId && source?.assetId
    ? { ...robots, assetId: source.assetId } : robots, [robots, source?.assetId]);
  const robotsState = useTVRobots(active ? robotPanel : null, source, configuredRobots, status);
  const panelFocusable = !robotPanel || robotsPanelFocusable(robotPanel, robotsState.result);
  const availability = robotAvailability(configuredRobots);
  const availableRobots = ROBOTS_ORDER.filter(kind => availability[kind]);
  const defaultHidden = defaultHiddenRobots(availableRobots);
  const isRobotVisible = (kind: RobotsKind) => robotsVisibility[kind] ?? !defaultHidden.includes(kind);
  const visibleRobots = availableRobots.filter(isRobotVisible);
  // Returning upward preserves the expanded workflow. With no open workflow,
  // enter the Robots row at its first visible button.
  const robotsUpKind = robotPanel && visibleRobots.includes(robotPanel) ? robotPanel : visibleRobots[0];
  const robotsUpId = robotsUpKind ? `robot-${robotsUpKind}` : undefined;
  const robotsUpTarget = robotsUpId ? refFor(robotsUpId).current : undefined;
  const hasCaptionTracks = !!status.captionTracks?.length;
  const hasAudioChoices = (status.audioTracks?.length ?? 0) > 1;
  // Rows list what is focusable apart from hidden chrome, in screen order; the
  // button row matches the bar's left-to-right layout.
  const focusLayout: TVFocusLayout = {
    // … stays beside the tabs while a workflow is open; other panels trap focus.
    top: [...visibleRobots.map(kind => `robot-${kind}`), ...(availableRobots.length && !playbackBlocked ? ['more'] : [])],
    openTab: robotPanel && visibleRobots.includes(robotPanel) ? `robot-${robotPanel}` : undefined,
    panelFocusable,
    timeline: timeline.duration ? 'seek' : undefined,
    bar: ['play', ...(timeline.duration ? ['backward', 'forward'] : []), ...(status.isLive ? ['live'] : []),
      ...(hasCaptionTracks || hasAudioChoices ? ['tracks'] : []), ...(sections.speed || sections.quality ? ['settings'] : [])],
  };
  const topEntryId = focusLayout.openTab ?? tvFocusEntry(focusLayout.top, focusMemory.top);
  const barEntryId = tvFocusEntry(focusLayout.bar, focusMemory.bar) ?? 'play';
  const playbackEntryId = focusLayout.timeline ?? barEntryId;
  const playbackFocused = focusRegion === 'timeline' || focusRegion === 'playback';
  // UIKit skips the focus guides tvOS adds for nextFocus links wherever another
  // view covers them, which the bar and the top row do. Overlay guides stacked
  // above them route the moves geometry gets wrong. Android follows the links.
  const appleGuides = Platform.OS === 'ios' && active && presentation.showChrome;
  const upFromPlayback = robotPanel && panelFocusable ? panelFocusTarget : appleGuides && topEntryId ? refFor(topEntryId).current : null;
  const timelineContent = useTimelineContent(configuredRobots, robotsState.snapshot);
  // Chapter and key-moment marks show only while their workflow is expanded,
  // so the timeline stays uncluttered the rest of the time.
  const marks = React.useMemo<TrackMarks>(() => status.isLive || !timeline.duration ? { markers: [], ranges: [] } : {
    markers: robotPanel === 'chapters'
      ? timelineContent.chapters.slice(1).map(chapter => (chapter.startTime - timeline.start) / timeline.duration)
      : [],
    ranges: robotPanel === 'moments'
      ? timelineContent.moments.map(moment => [
        (moment.startTime - timeline.start) / timeline.duration,
        (moment.endTime - timeline.start) / timeline.duration,
      ])
      : [],
  }, [robotPanel, status.isLive, timeline.duration, timeline.start, timelineContent]);
  const activeChapter = status.isLive ? undefined
    : timelineContent.chapters.reduce<{ title: string } | undefined>((found, chapter) => chapter.startTime <= currentTime ? chapter : found, undefined);
  const timeInTopRow = !!activeChapter;
  const errorMessage = commandError ?? (status.status === 'error' ? 'Playback unavailable. Choose another video or try again.' : null);

  const barHeight = u(DESIGN.barHeight);
  const barBottom = u(DESIGN.bottomInset);
  const barTop = height - barBottom - barHeight;
  const panelTop = u(DESIGN.inset + DESIGN.tabHeight);
  const anchoredBottom = barBottom + barHeight + u(DESIGN.panelGap);
  const topRowInset = u(DESIGN.inset + (availableRobots.length ? DESIGN.circle + DESIGN.circleGap : 0));

  function refFor(id: string) {
    let ref = focusRefs.current.get(id);
    if (!ref) { ref = React.createRef<View>(); focusRefs.current.set(id, ref); }
    return ref;
  }

  /**
   * Explicit arrow neighbours, so geometric search cannot skip or leave a row.
   * Android follows them throughout; tvOS only where nothing covers the guide.
   */
  function focusLinks(id: string): Partial<TVButtonProps> {
    const links = tvFocusLinks(id, focusLayout, focusMemory);
    const self = refFor(id).current;
    // Until a target mounts, stay put: clearing a focused control's link
    // removes its tvOS guide until it refocuses.
    const target = (link?: string) => link === TV_PANEL_FOCUS ? panelFocusTarget ?? self
      : link === TV_PANEL_ENTRY_FOCUS ? panelEntryTarget ?? self
      : link ? refFor(link).current ?? self : undefined;
    return { nextFocusUp: target(links.up), nextFocusDown: target(links.down), nextFocusLeft: target(links.left), nextFocusRight: target(links.right) };
  }

  function rememberFocus(id: string) {
    // While a requested control is pending, or a modal panel takes over, Android
    // first focuses whichever control comes first in the tree. That interim
    // stop is not the user's.
    if (focusRequestRef.current && focusRequestRef.current !== id) return;
    if (panelRef.current !== null && !isRobotsPanel(panelRef.current)) return;
    const row = id.startsWith('robot-') || id === 'more' ? 'top' : PLAYBACK_CONTROLS.has(id) ? 'bar' : null;
    if (row) setFocusMemory(memory => memory[row] === id ? memory : { ...memory, [row]: id });
  }

  function canAct() {
    return mounted.current && activeRef.current && appActive.current &&
      !!sourceKeyRef.current && identity(player._getSnapshot().source) === sourceKeyRef.current;
  }

  function changePanel(next: TVControlsPanel) {
    if (panelRef.current !== next) {
      panelEntry.current = null;
      setPanelEntryTarget(null);
      setPanelFocusTarget(null);
      setFocusRegion('other');
    }
    panelRef.current = next;
    setPanel(next);
  }

  function closePanel() {
    stopHold();
    setScan(null);
    if (!mounted.current) return;
    // Leaving the preview without choosing a spot resumes where playback was.
    if (panelRef.current === 'seek' && seekResume.current) {
      seekResume.current = false;
      run(() => player.play());
    }
    // Focus the destination before the panel unmounts. Otherwise both platforms
    // briefly fall back to another control, such as the first Robots button.
    refFor(returnFocus.current).current?.requestTVFocus();
    changePanel(null);
    previewRef.current = null;
    setFocusRequest(returnFocus.current);
  }

  function hideControls() {
    if (!canAct() || panelRef.current !== null) return;
    const focused = focusedControl.current;
    returnFocus.current = focused && focused !== 'show-controls' ? focused : 'play';
    setHiddenSourceKey(sourceKeyRef.current);
    setFocusRequest('show-controls');
  }

  function showControls(focus = returnFocus.current) {
    if (!canAct()) return;
    if (hiddenRef.current) setRevealHandoff(true);
    setHiddenSourceKey(null);
    setFocusRequest(focus);
  }

  function run(command: () => Promise<void> | void) {
    if (!canAct()) return;
    const key = sourceKeyRef.current;
    setCommandError(null);
    try {
      Promise.resolve(command()).catch(() => {
        if (mounted.current && key === sourceKeyRef.current) setCommandError('That action could not be completed. Try again.');
      });
    } catch {
      setCommandError('That action could not be completed. Try again.');
    }
  }

  function togglePlayback() {
    const snapshot = player._getSnapshot();
    run(() => snapshot.status.status === 'ended' ? player.replay()
      : snapshot.shouldPlay ? player.pause() : player.play());
  }

  function pressHiddenPlayback() {
    // Select belongs to this Pressable, not the global remote listener. Restore
    // Play so a second center press toggles again, even if a Robots tab was
    // focused before the controls faded out.
    togglePlayback();
    showControls('play');
  }

  function seek(direction: -1 | 1) {
    const snapshot = player._getSnapshot();
    const bounds = tvTimeline(snapshot.status);
    if (!bounds.duration) return;
    // Native relative seeks accumulate even when several key-downs arrive before
    // the next time event updates the JS snapshot.
    run(() => player.seekBy(direction * stepRef.current));
  }

  function openPanel(next: Exclude<TVControlsPanel, null>, buttonId: string) {
    if (!canAct()) return;
    returnFocus.current = buttonId;
    setFocusRequest(null);
    setPanelClaimsFocus(true);
    if (next === 'seek') {
      const snapshot = player._getSnapshot();
      const bounds = tvTimeline(snapshot.status);
      if (!bounds.duration) return;
      const time = clampTVTime(snapshot.status.currentTime, bounds);
      previewRef.current = { sourceKey: identity(snapshot.source), time };
      setPreviewTime(time);
      // Video holds still while the viewer picks a spot; live keeps up with the edge.
      seekResume.current = snapshot.shouldPlay && !snapshot.status.isLive;
      if (seekResume.current) run(() => player.pause());
      setHeldFrame(null);
    }
    changePanel(next);
    refreshBackHandler();
  }

  /** Moving along the tabs shows each workflow's panel; focus stays on the tabs. */
  function switchRobotPanel(kind: RobotsKind) {
    if (!canAct()) return;
    returnFocus.current = `robot-${kind}`;
    setPanelClaimsFocus(false);
    changePanel(kind);
  }

  /**
   * Down or Select on a tab enters its panel at the entry row (Close, the current
   * chapter or cue, or the first moment). Right after a tab switch that row may
   * not exist yet; focus then waits on the tab, which traps Down, until it mounts.
   */
  function enterPanel() {
    if (!canAct()) return;
    enteringPanel.current = true;
    // A key pressed right after a tab switch can reach JS before that switch's
    // focus event does (Android sends keys first), so let the switch land.
    setTimeout(() => handlers.current.enterPendingPanel(), PANEL_ENTRY_SETTLE_MS);
  }

  function enterPendingPanel() {
    if (!enteringPanel.current || !mounted.current) return;
    const tab = focusedControl.current;
    if (!tab?.startsWith('robot-')) {
      enteringPanel.current = false;
      return;
    }
    // The tab's panel is still switching in; its entry row calls back on mount.
    if (tab !== `robot-${panelRef.current}`) return;
    if (!panelFocusable) {
      enteringPanel.current = false;
      refFor(playbackEntryId).current?.requestTVFocus();
      return;
    }
    if (!panelEntry.current) return;
    enteringPanel.current = false;
    setPanelClaimsFocus(true);
    panelEntry.current.requestTVFocus();
  }

  function refreshBackHandler() {
    if (!mounted.current || !activeRef.current) return;
    refreshTVBackSubscription(backSubscription,
      handler => BackHandler.addEventListener('hardwareBackPress', handler), () => handlers.current.back());
  }

  /** Returns whether the preview moved, so a held key stops at either end. */
  function adjustPreview(direction: -1 | 1, speed = 1): boolean {
    const preview = previewRef.current;
    if (!canAct() || !preview || preview.sourceKey !== identity(player._getSnapshot().source)) return false;
    const time = advanceTVPreview(preview.time, direction, stepRef.current, tvTimeline(player._getSnapshot().status), speed);
    // Update the ref before React renders so repeated remote key-downs accumulate.
    previewRef.current = { ...preview, time };
    setPreviewTime(time);
    return time !== preview.time;
  }

  /**
   * Left/Right on the timeline open the preview already one step along. Like the
   * native tvOS player, a press steps; a hold scans, faster the longer it is held,
   * and keeps scanning after release; presses while scanning change its speed.
   */
  function scrub(direction: -1 | 1, held: boolean) {
    if (panelRef.current === null || isRobotsPanel(panelRef.current)) openPanel('seek', 'seek');
    const next = tvScanPress(scanRef.current, direction, held);
    if (next.step) {
      adjustPreview(direction);
      return;
    }
    setScan(next.scan);
    if (!held || !next.scan) return;
    // A long press reports only its begin and end, so ramp on a timer until release.
    const start = Date.now();
    stopHold();
    holdTimer.current = setInterval(() => rampScan(direction, Date.now() - start), TV_HOLD_REPEAT_MS);
  }

  /** A hold only ever speeds its scan up; presses may have already passed the ramp. */
  function rampScan(direction: -1 | 1, heldMs: number) {
    const speed = tvScrubSpeed(heldMs);
    const scan = scanRef.current;
    if (scan?.direction === direction && speed > scan.speed) setScan({ direction, speed });
  }

  /** Starts, changes or (with null) stops the scan, which moves the preview each repeat. */
  function setScan(scan: TVScan | null) {
    scanRef.current = scan;
    if (mounted.current) setScrubbing(scan);
    if (!scan) {
      if (scanTimer.current) clearInterval(scanTimer.current);
      scanTimer.current = null;
      return;
    }
    if (scanTimer.current) return;
    const advance = () => {
      const current = scanRef.current;
      // Either end of the timeline stops the scan there.
      if (!current || !adjustPreview(current.direction, tvScanSteps(current.speed))) setScan(null);
    };
    advance();
    if (scanRef.current) scanTimer.current = setInterval(advance, TV_HOLD_REPEAT_MS);
  }

  /** Ends a hold's ramp. A scan it started keeps going. */
  function stopHold() {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
  }

  function commitPreview() {
    const preview = previewRef.current;
    const resume = seekResume.current;
    seekResume.current = false;
    if (preview && preview.sourceKey === identity(player._getSnapshot().source)) {
      const time = clampTVTime(preview.time, tvTimeline(player._getSnapshot().status));
      // The sharp frame already shows the new spot; dropping it before the seek
      // lands would flash back to the paused picture.
      if (frameUri && shownFrame === frameUri) setHeldFrame({ uri: frameUri, time });
      run(async () => {
        await player.seekTo(time);
        if (resume) await player.play();
      });
    } else if (resume) run(() => player.play());
    closePanel();
  }

  /** Closes the … menu onto the Robots button beside it. With none shown, the menu stays. */
  function leaveMenu() {
    const nearest = visibleRobots[visibleRobots.length - 1];
    if (!nearest) return;
    returnFocus.current = `robot-${nearest}`;
    closePanel();
  }

  function toggleRobotVisibility(kind: RobotsKind) {
    const visible = isRobotVisible(kind);
    setRobotsVisibility(current => ({ ...current, [kind]: !visible }));
  }

  const handlers = React.useRef<{ back: () => boolean; remote: (event: HWEvent) => void; enterPendingPanel: () => void }>({
    back: () => false, remote: () => {}, enterPendingPanel: () => {},
  });
  handlers.current = {
    enterPendingPanel,
    back: () => {
      // An open modal owns Back even during the brief focus transfer from its
      // initiating button to its preferred control.
      if (!canAct() || panelRef.current === null) return false;
      closePanel();
      return true;
    },
    remote: event => {
      // Any press, including the held arrow's release, ends a hold's speed ramp;
      // the focus hand-off from timeline to bubble must not.
      if (event.eventType !== 'focus' && event.eventType !== 'blur') stopHold();
      if (!canAct() || !scopeFocused.current) { remoteInput.current.reset(); return; }
      setInteraction(value => value + 1);
      if (hiddenRef.current && REVEAL_KEYS.has(event.eventType)) {
        showControls((event.eventType === 'up' || event.eventType === 'longUp') && topEntryId ? topEntryId : returnFocus.current);
      }
      const focused = focusedControl.current;
      const focus = focused === 'seek-preview' ? 'preview' : focused === 'seek' ? 'timeline'
        : focused?.startsWith('robot-') ? 'tab' : focused?.startsWith('more-') ? 'menu'
        : PLAYBACK_CONTROLS.has(focused ?? '') ? 'playback' : null;
      const action = remoteInput.current.action(event, panelRef.current, focus, Platform.OS === 'ios' ? 'ios' : 'android');
      // Both platforms report a held arrow as a long press: once as it begins, once on release.
      const held = event.eventType.startsWith('long');
      switch (action) {
        case 'toggle': togglePlayback(); break;
        case 'play': run(() => player._getSnapshot().status.status === 'ended' ? player.replay() : player.play()); break;
        case 'pause': run(() => player.pause()); break;
        case 'backward': seek(-1); break;
        case 'forward': seek(1); break;
        case 'previewBackward': scrub(-1, held); break;
        case 'previewForward': scrub(1, held); break;
        case 'leaveMenu': leaveMenu(); break;
        case 'enterPanel': enterPanel(); break;
      }
    },
  };
  useTVEventHandler(React.useCallback((event: HWEvent) => handlers.current.remote(event), []));

  React.useEffect(() => {
    mounted.current = true;
    const appSubscription = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      remoteInput.current.reset();
    });
    return () => {
      mounted.current = false;
      scopeFocused.current = false;
      stopHold();
      setScan(null);
      appSubscription.remove();
    };
  }, []);

  React.useEffect(() => {
    remoteInput.current.reset();
    if (!active) { scopeFocused.current = false; return; }
    setFocusRequest(hiddenSourceKey === sourceKey && sourceKey ? 'show-controls' : returnFocus.current);
    // Opening a panel also refreshes priority synchronously, so a host's later
    // passive mount effect cannot preempt panel dismissal. Close keeps it stable.
    refreshBackHandler();
    return () => clearTVBackSubscription(backSubscription);
  }, [active]);

  React.useEffect(() => {
    remoteInput.current.reset();
    stopHold();
    setScan(null);
    panelRef.current = null;
    setPanel(null);
    previewRef.current = null;
    seekResume.current = false;
    setHeldFrame(null);
    setRevealHandoff(false);
    setHiddenSourceKey(null);
    setCommandError(null);
    setFocusRequest(returnFocus.current);
  }, [sourceKey, player]);

  React.useEffect(() => {
    if (!active || playbackBlocked || !focusRequest || !sourceKey) return;
    const frame = requestAnimationFrame(() => {
      if (mounted.current && activeRef.current && appActive.current && sourceKeyRef.current === sourceKey) {
        (focusRefs.current.get(focusRequest)?.current ?? focusRefs.current.get('play')?.current)?.requestTVFocus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, focusRequest, playbackBlocked, sourceKey]);

  // The sharp frame waits until the preview rests, so a held scrub does not
  // fetch a full-size image for every step it passes.
  React.useEffect(() => {
    setSettledPreview(null);
    if (panel !== 'seek') return;
    const timer = setTimeout(() => setSettledPreview(previewTime), SEEK_FRAME_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [panel, previewTime]);

  // A held frame gives way once the video shows that moment: the seek has landed
  // nearby and stopped buffering. It never outlasts the hold limit.
  const frameLanded = !!heldFrame && Math.abs(status.currentTime - heldFrame.time) < 1
    && status.status !== 'buffering' && status.status !== 'loading';
  React.useEffect(() => {
    if (!heldFrame) return;
    const timer = setTimeout(() => setHeldFrame(null), frameLanded ? SEEK_FRAME_REVEAL_MS : SEEK_FRAME_HOLD_MS);
    return () => clearTimeout(timer);
  }, [heldFrame, frameLanded]);

  React.useEffect(() => {
    const show = presentation.showChrome;
    if (show && chromeFadedOut.current) chromeOpacity.setValue(CHROME_REVEAL_OPACITY);
    chromeFadedOut.current = false;
    Animated.timing(chromeOpacity, {
      toValue: show ? 1 : 0,
      duration: show ? CHROME_FADE_IN_MS : CHROME_FADE_OUT_MS,
      easing: show ? Easing.out(Easing.quad) : Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => { if (!show && finished) chromeFadedOut.current = true; });
  }, [chromeOpacity, presentation.showChrome]);

  // A hand-off whose focus request never lands must not leave the surface up.
  React.useEffect(() => {
    if (!revealHandoff) return;
    const timer = setTimeout(() => setRevealHandoff(false), 500);
    return () => clearTimeout(timer);
  }, [revealHandoff]);

  // The design has no hide button: the overlay steps aside after a few seconds
  // without input, playing or paused, and returns on the next remote input,
  // keeping video and captions unobstructed. At the end it stays for Replay.
  React.useEffect(() => {
    if (!active || !presentation.showChrome || modalOpen || isEnded || errorMessage) return;
    const timer = setTimeout(hideControls, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [active, presentation.showChrome, modalOpen, isEnded, isPlaying, errorMessage, interaction]);

  function button(id: string, label: string, onPress: () => void, { onFocus, ...options }: Partial<TVButtonProps> = {}) {
    return <TVButton key={id} ref={refFor(id)} label={label} onPress={onPress}
      onFocus={() => {
        setRevealHandoff(false);
        focusedControl.current = id;
        scopeFocused.current = true;
        setFocusRegion(id === 'seek' ? 'timeline' : PLAYBACK_CONTROLS.has(id) ? 'playback' : 'other');
        rememberFocus(id);
        setInteraction(value => value + 1);
        setFocusRequest(request => request === id ? null : request);
        // Late Robots results must not take focus back from the playback bar.
        if (id === 'seek' || PLAYBACK_CONTROLS.has(id)) setPanelClaimsFocus(false);
        onFocus?.();
      }}
      onBlur={() => { if (focusedControl.current === id) focusedControl.current = null; }}
      {...options} inert={options.inert || !presentation.showChrome} />;
  }

  /**
   * Top-row circle that turns white with a dark glyph while focused, or the tab
   * its open menu hangs from. Like the Robots tabs, it stays one mounted control.
   */
  function circleButton(id: string, label: string, onPress: () => void, glyph: (color: string) => React.ReactNode, options: Partial<TVButtonProps> = {}) {
    const isTab = panel === id;
    return button(id, label, onPress, {
      inert: playbackBlocked && opener !== id,
      ...focusLinks(id),
      ...options,
      style: ({ focused }) => isTab ? [styles.center, {
        backgroundColor: surface,
        borderTopLeftRadius: u(DESIGN.menuRadius),
        borderTopRightRadius: u(DESIGN.menuRadius),
        height: u(DESIGN.circle),
        width: u(DESIGN.circle),
      }] : [styles.center, {
        backgroundColor: focused ? DESIGN_COLORS.text : circleColor,
        borderRadius: u(DESIGN.circle / 2),
        height: u(DESIGN.circle),
        width: u(DESIGN.circle),
      }, focused && styles.focusScale],
      children: ({ focused }) => isTab ? <>
        {glyph(iconColor)}
        <ConcaveCorner color={surface} radius={u(DESIGN.menuRadius)} side="left" />
      </> : glyph(focused ? DESIGN_COLORS.charcoal : iconColor),
    });
  }

  /**
   * A Robots workflow: a circle, or the tab of its open panel. It stays one mounted,
   * focusable control as it changes shape, so focus never drops to its neighbours.
   */
  function robotButton(kind: RobotsKind) {
    const id = `robot-${kind}`;
    const isTab = kind === robotPanel;
    return button(id, ROBOTS_LABELS[kind], () => isTab ? enterPanel() : openPanel(kind, id), {
      disabled: baseDisabled,
      // Behind the … menu they stay focusable, so Left from it can hand focus
      // straight to one; the menu itself traps the arrows.
      inert: modalOpen && !robotPanel && panel !== 'more',
      selected: isTab,
      accessibilityHint: isTab
        ? 'Left and right switch Robots tabs. Down or Select enters the panel; Down from its last item goes to playback controls. Back closes the panel.'
        : 'Select opens this Robots panel. Left and right move along the top row. Down goes to playback controls.',
      onFocus: () => {
        setPanelClaimsFocus(false);
        if (isRobotsPanel(panelRef.current) && panelRef.current !== kind) switchRobotPanel(kind);
      },
      // Explicit neighbours keep horizontal focus in order as the active tab
      // expands and the other tabs shrink back to circles.
      ...focusLinks(id),
      style: ({ focused }) => isTab ? [styles.tab, {
        backgroundColor: surface,
        borderTopLeftRadius: u(DESIGN.panelRadius),
        borderTopRightRadius: u(DESIGN.panelRadius),
        height: u(DESIGN.tabHeight),
        minWidth: u(DESIGN.tabMinWidth),
        paddingBottom: u(DESIGN.tabHeight - DESIGN.circle),
        paddingLeft: u(DESIGN.tabPaddingLeft),
        paddingRight: u(DESIGN.tabPaddingRight),
      }] : [styles.center, {
        backgroundColor: focused ? DESIGN_COLORS.text : circleColor,
        borderRadius: u(DESIGN.circle / 2),
        height: u(DESIGN.circle),
        width: u(DESIGN.circle),
      }, focused && styles.focusScale],
      children: ({ focused }) => {
        if (!isTab) return <RobotsGlyph color={focused ? DESIGN_COLORS.charcoal : iconColor} kind={kind} size={u(DESIGN.icon)} />;
        // Focus underlines the bold name.
        return <>
          <View style={[styles.row, {
            gap: u(DESIGN.tabLabelGap),
            height: u(DESIGN.circle),
          }]}>
            <RobotsGlyph color={iconColor} kind={kind} size={u(DESIGN.icon)} />
            <Text style={[text(DESIGN.tvText), { color: iconColor }, focused && styles.underline]}>{ROBOTS_LABELS[kind]}</Text>
          </View>
          <ConcaveCorner color={surface} radius={u(DESIGN.panelRadius)} side="left" />
          <ConcaveCorner color={surface} radius={u(DESIGN.panelRadius)} side="right" />
        </>;
      },
    });
  }

  /**
   * Bottom-bar icon; focus draws a white disc behind it. Without `focusDisc`,
   * as in Figma for play, captions and settings, the glyph shows any state itself.
   */
  function barButton(id: string, label: string, onPress: () => void, glyph: (color: string, focused: boolean) => React.ReactNode,
    options: Partial<TVButtonProps> = {}, focusDisc = true) {
    return button(id, label, onPress, {
      inert: playbackBlocked && opener !== id,
      ...focusLinks(id),
      ...options,
      style: ({ focused }) => [styles.center, {
        backgroundColor: focused && focusDisc ? DESIGN_COLORS.text : 'transparent',
        borderRadius: u(DESIGN.focusCircle / 2),
        height: u(DESIGN.focusCircle),
        width: u(DESIGN.focusCircle),
      }],
      children: ({ focused }) => glyph(focused && focusDisc ? DESIGN_COLORS.charcoal : iconColor, focused),
    });
  }

  /**
   * A setting pill, white when selected. Focus fills an unselected pill half
   * white inside its full white border; a selected pill, already white, shows
   * no extra focus mark.
   */
  function chip(id: string, label: string, selected: boolean, onPress: () => void, options: Partial<TVButtonProps> = {}) {
    return button(id, label, onPress, {
      selected,
      ...options,
      style: ({ focused }) => [chipStyle(u, selected), focused && !selected && styles.chipFocusFill],
      children: <Text numberOfLines={1} style={chipTextStyle(u, selected, fontsReady, DESIGN.tvText)}>{label}</Text>,
    });
  }

  function chipRow(title: string, children: React.ReactNode, note?: string, titleWidth: number = DESIGN.settingsLabelWidth) {
    const labelWidth = u(titleWidth + DESIGN.menuPadding);
    return (
      <View style={{ gap: u(DESIGN.panelGap) }}>
        <View style={styles.chipRow}>
          <Text numberOfLines={1} style={[text(DESIGN.tvText), { width: labelWidth }]}>{title}</Text>
          {/* Focus scrolls long rows. */}
          <ScrollView focusable={false} horizontal showsHorizontalScrollIndicator={false}
            style={styles.chipScroller} contentContainerStyle={{ gap: u(DESIGN.chipGap) }}>
            {children}
          </ScrollView>
        </View>
        {note ? <Text style={[text(DESIGN.smallText, FONT.light), { marginLeft: labelWidth }]}>{note}</Text> : null}
      </View>
    );
  }

  function selectOption(command: () => Promise<void> | void) {
    run(command);
    closePanel();
  }

  function text(size: number, weight: TextStyle['fontWeight'] = FONT.semibold): TextStyle {
    return { color: textColor, fontSize: u(size), ...designFontStyle(fontsReady, weight), includeFontPadding: false };
  }

  // DM Sans digits differ in width, so the clock gets a column sized for its
  // widest label at this duration: the track beside it stays put as it runs.
  const timeColumn = u(fontsReady ? Math.max(DESIGN.tvTimeWidth, DESIGN.tvText * tvClockLabelWidth(timeline.end)) : DESIGN.tvTimeWidth);
  const timeText = (
    <Text numberOfLines={1} style={[text(DESIGN.tvText), styles.tabular, { minWidth: timeColumn }]}>
      {formatClock(currentTime)} / {formatClock(timeline.end)}
    </Text>
  );
  // The chapter title (or, without chapters, the clock) starts where the track
  // does, as in Figma: 296px in, or further when a long video widens the clock.
  const transportEnd = u(61 + 2 * 73.5 + DESIGN.focusCircle / 2 - DESIGN.barPaddingX);
  const slotLeft = timeInTopRow ? Math.max(track.x, timeColumn + u(DESIGN.tvTimeGap)) : u(DESIGN.tvTimeWidth + DESIGN.tvTimeGap);
  // Storyboard tiles are too small to fill a TV, so the resting preview fetches
  // a frame sized for the screen. Live previews keep to the card.
  const frameUri = active && panel === 'seek' && thumbnailPreviews && source && settledPreview !== null && !status.isLive
    ? buildMuxThumbnailUrl(source, { time: settledPreview, width: Math.min(1920, PixelRatio.getPixelSizeForLayoutSize(width)), token: source.thumbnailToken })
    : undefined;
  const frame = heldFrame?.uri ?? frameUri;
  const firstSettingsRow = sections.quality ? 'quality' : 'speed';
  const bubbleWidth = u(DESIGN.tvCardWidth);
  const bubbleLeft = Math.min(Math.max(
    u(DESIGN.inset + DESIGN.barPaddingX) + track.x + previewProgress * track.width - bubbleWidth / 2,
    u(DESIGN.inset)), width - u(DESIGN.inset) - bubbleWidth);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={active ? 'box-none' : 'none'}
      onLayout={event => setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      // Swapping panels can deliver the old control's blur after the new one's
      // focus; only a blur from the control that last took focus leaves scope.
      onFocus={event => { scopeFocused.current = true; scopeTarget.current = event.nativeEvent.target; }}
      onBlur={event => { if (event.nativeEvent.target === scopeTarget.current) scopeFocused.current = false; }}>
      {/* Hidden chrome stays mounted and fades out, its buttons inert. tvOS resolves each
          nextFocus link to a native view once; unmounting the bar on hide
          would strand every link into or out of it after the first reveal.
          Each group carries the hidden and blocked state itself, with no
          shared wrapper: a wrapper changing those props would switch between
          flattened and native, re-parenting the focused control and dropping
          its focus for a frame. (As one native view, it also kept tvOS from
          following the guides that route Up and Down.) */}
      {frame && <SeekFrame key={frame} uri={frame} resizeMode={contentFit === 'cover' ? 'cover' : contentFit === 'fill' ? 'stretch' : 'contain'}
        onShown={() => setShownFrame(frame)} />}
      <>
        <Animated.View pointerEvents="none" style={[styles.topShade, chromeFade]}>
          <LinearGradient colors={[DESIGN_COLORS.fadeStart, DESIGN_COLORS.fadeEnd]} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.bottomShade, chromeFade]}>
          <LinearGradient colors={[DESIGN_COLORS.fadeEnd, DESIGN_COLORS.fadeStart]} style={StyleSheet.absoluteFill} />
        </Animated.View>

        {availableRobots.length > 0 && <>
          <Animated.View {...chromeGroup} style={[styles.moreAnchor, { right: u(DESIGN.inset), top: u(DESIGN.inset) }, chromeFade]}>
            {circleButton('more', 'Choose Mux Robots features', () => openPanel('more', 'more'),
              color => <ControlIcon color={color} name="more" size={u(DESIGN.icon)} />, { disabled: baseDisabled })}
          </Animated.View>
        </>}

        {errorMessage ? (
          <Animated.View {...chromeGroup} pointerEvents="none" style={[styles.errorRow, { bottom: anchoredBottom }, chromeFade]}>
            <Text accessibilityRole="alert" style={[text(DESIGN.text, FONT.regular), {
              backgroundColor: surface, borderRadius: u(DESIGN.barRadius), overflow: 'hidden', paddingHorizontal: u(28), paddingVertical: u(14),
            }]}>{errorMessage}</Text>
          </Animated.View>
        ) : null}

        <Animated.View {...chromeGroup} style={[styles.bar, {
          backgroundColor: surface,
          borderRadius: u(DESIGN.barRadius),
          bottom: barBottom,
          height: barHeight,
          left: u(DESIGN.inset),
          paddingHorizontal: u(DESIGN.barPaddingX),
          paddingTop: u(DESIGN.barPaddingTop),
          right: u(DESIGN.inset),
        }, chromeFade]}>
          {/* The timeline returns to the open panel before its workflow tabs. */}
          {button('seek', `Seek, ${formatClock(currentTime)} of ${formatClock(timeline.end)}${status.isLive ? ', live' : ''}`,
            togglePlayback, {
              disabled: baseDisabled || !timeline.duration,
              inert: playbackBlocked && opener !== 'seek',
              // Up enters the panel's focus environment, which remembers its last
              // focused card. A time-selected entry may have scrolled offscreen.
              // Left/Right scrub here instead of moving focus along the bar.
              ...focusLinks('seek'),
              accessibilityHint: 'Select plays or pauses. Left and right preview a seek; Select applies the preview; Back cancels.',
              style: [styles.row, { height: u(DESIGN.textRow) }],
              children: ({ focused }) => <>
                {timeInTopRow ? timeText : null}
                <View style={[styles.flex, { marginLeft: timeInTopRow ? u(DESIGN.tvTimeGap) : 0 }]}
                  onLayout={event => setTrack({ x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width })}>
                  <ProgressTrack
                    buffered={buffered}
                    colors={{
                      buffered: theme?.bufferedTrackColor ?? DESIGN_COLORS.buffered,
                      marker: textColor,
                      progress: theme?.progressTrackColor ?? DESIGN_COLORS.progress,
                      range: theme?.progressTrackColor ?? DESIGN_COLORS.progress,
                      playedRange: textColor,
                      track: theme?.trackColor ?? DESIGN_COLORS.track,
                    }}
                    height={focused ? u(20) : u(theme?.trackHeight ?? DESIGN.trackHeight)}
                    knob={focused || panel === 'seek'
                      ? { color: DESIGN_COLORS.text, position: panel === 'seek' ? previewProgress : progress, size: u(DESIGN.markerHeight + 8) }
                      : undefined}
                    markerHeight={u(DESIGN.markerHeight)}
                    markerWidth={u(DESIGN.markerWidth)}
                    marks={marks}
                    progress={progress}
                  />
                </View>
              </>,
            })}
          <View style={[styles.row, { height: u(DESIGN.icon), marginTop: u(DESIGN.barRowGap) }]}>
            {/* Focus discs sit on the 56px icons' Figma centres (play 89, seek 162
                and 236, i.e. 61px into the bar and 73.5px apart). */}
            <View style={[styles.row, { gap: u(73.5 - DESIGN.focusCircle), marginLeft: u(61 - DESIGN.focusCircle / 2 - DESIGN.barPaddingX) }]}>
              {barButton('play', isEnded ? 'Replay' : isPlaying ? 'Pause' : 'Play', togglePlayback,
                (color, focused) => <View style={focused && styles.skipFocus}>
                  <ControlIcon color={color} name={isPlaying && !isEnded ? 'pause' : 'play'} size={u(DESIGN.icon * 0.9)} />
                </View>,
                { disabled: baseDisabled, preferredFocus: !playbackBlocked && focusRequest === 'play' }, false)}
              {/* No focus disc on the skip buttons, as in Figma: focus lifts the icon instead. */}
              {barButton('backward', `Seek back ${step} seconds`, () => seek(-1),
                (color, focused) => <View style={focused && styles.skipFocus}>
                  <SeekGlyph color={color} direction="back" seconds={step} size={u(DESIGN.icon)} variant="tv" />
                </View>,
                { disabled: baseDisabled || !timeline.duration }, false)}
              {barButton('forward', `Seek forward ${step} seconds`, () => seek(1),
                (color, focused) => <View style={focused && styles.skipFocus}>
                  <SeekGlyph color={color} direction="forward" seconds={step} size={u(DESIGN.icon)} variant="tv" />
                </View>,
                { disabled: baseDisabled || !timeline.duration }, false)}
            </View>
            <View style={[styles.flex, { marginLeft: slotLeft - transportEnd }]}>
              {status.isLive ? button('live', 'Go to live edge', () => run(() => player.seekToLiveEdge()), {
                disabled: baseDisabled,
                inert: playbackBlocked,
                ...focusLinks('live'),
                style: ({ focused }) => [styles.liveButton, { borderRadius: u(DESIGN.chipHeight / 2), gap: u(14), paddingHorizontal: u(14) },
                  focused && { backgroundColor: DESIGN_COLORS.text }],
                children: ({ focused }) => <>
                  <View style={{ backgroundColor: accent, borderRadius: u(9), height: u(18), width: u(18) }} />
                  <Text style={[text(DESIGN.tvText), focused && { color: DESIGN_COLORS.charcoal }]}>
                    {timeline.end - currentTime < 5 ? 'LIVE' : `LIVE −${formatClock(timeline.end - currentTime)}`}
                  </Text>
                </>,
              }) : activeChapter ? (
                <Text numberOfLines={1} style={text(DESIGN.tvText)}>{activeChapter.title}</Text>
              ) : timeText}
            </View>
            <View style={[styles.row, { gap: u(DESIGN.iconGap + DESIGN.icon - DESIGN.focusCircle), marginRight: u(-(DESIGN.focusCircle - DESIGN.icon) / 2) }]}>
              {(hasCaptionTracks || hasAudioChoices) &&
                barButton('tracks', 'Audio and captions', () => openPanel('tracks', 'tracks'),
                  // Like settings, it keeps its focused look while its panel is open.
                  (color, focused) => <CaptionsGlyph active={focused || panel === 'tracks' || !!status.selectedCaptionTrackId} color={color}
                    knockoutColor={DESIGN_COLORS.charcoal} size={u(DESIGN.icon)} />,
                  { disabled: baseDisabled }, false)}
              {(sections.speed || sections.quality) &&
                barButton('settings', 'Playback settings', () => openPanel('settings', 'settings'),
                  (color, focused) => <ControlIcon color={color} name={focused || panel === 'settings' ? 'settingsOn' : 'settings'} size={u(DESIGN.icon)} />,
                  { disabled: baseDisabled }, false)}
            </View>
          </View>
          {/* Down from the timeline returns to the button focus came from, not
              the one nearest the timeline's centre. It fills the gap between
              the rows and lives inside the bar: UIKit prefers candidates in the
              focused control's own container over guides outside it. */}
          {appleGuides && focusRegion === 'timeline' && refFor(barEntryId).current && (
            <TVFocusGuideView destinations={[refFor(barEntryId).current]}
              style={{ position: 'absolute', left: 0, right: 0, top: u(DESIGN.barPaddingTop + DESIGN.textRow), height: u(2) }} />
          )}
        </Animated.View>
      </>

      {/* During the hand-off it shrinks to a corner: tvOS will not focus controls it covers. */}
      {(presentation.showReveal || revealHandoff) && <Pressable ref={refFor('show-controls')}
        style={presentation.showReveal ? StyleSheet.absoluteFill : styles.revealHandoff}
        accessible accessibilityRole="button" accessibilityLabel={isEnded ? 'Replay and show controls' : isPlaying ? 'Pause and show controls' : 'Play and show controls'}
        accessibilityHint="Select to play or pause and show playback controls. Arrow keys show controls." focusable
        hasTVPreferredFocus={focusRequest === 'show-controls'}
        onFocus={() => {
          focusedControl.current = 'show-controls';
          scopeFocused.current = true;
          setFocusRegion('other');
          setFocusRequest(request => request === 'show-controls' ? null : request);
        }}
        onBlur={() => { if (focusedControl.current === 'show-controls') focusedControl.current = null; }}
        onPress={pressHiddenPlayback} />}

      {active && panel === 'seek' && (
        <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight
          style={[styles.anchored, { backgroundColor: surface, borderRadius: u(DESIGN.barRadius), bottom: anchoredBottom, left: bubbleLeft, padding: u(DESIGN.panelGap), width: bubbleWidth }]}>
          {button('seek-preview', `Seek to ${formatClock(previewTime)}`, commitPreview, { preferredFocus: true, disabled: !active,
            nextFocusLeft: refFor('seek-preview').current, nextFocusRight: refFor('seek-preview').current,
            accessibilityHint: `Left and right move the preview ${step} seconds. Hold to scan; while scanning, press the same way to speed up or the other way to slow down. Select seeks to ${formatClock(previewTime)}. Back cancels.`,
            // The bubble is the only focusable thing while it is open, so it needs no focus ring.
            style: [styles.seekPreview, { borderRadius: u(DESIGN.cardRadius), gap: u(10), padding: u(10) }],
            children: <>
              {thumbnailPreviews && source && <SeekPreview source={source} storyboard={storyboard} time={previewTime}
                exactUri={frameUri && shownFrame === frameUri ? frameUri : undefined}
                width={bubbleWidth - u(2 * DESIGN.panelGap + 20)} radius={u(DESIGN.panelGap)} hint={text(DESIGN.smallText, FONT.light)} />}
              <View style={[styles.row, { gap: u(DESIGN.panelGap) }]}>
                <Text style={[text(DESIGN.tvText), styles.tabular]}>
                  {formatClock(previewTime)}{status.isLive ? ` · ${formatClock(Math.max(0, timeline.end - previewTime))} behind live` : ''}
                </Text>
                {scrubbing && (
                  <Text accessibilityLabel={`Scrubbing ${scrubbing.direction < 0 ? 'back' : 'forward'} at ${scrubbing.speed} times`}
                    style={[text(DESIGN.smallText), styles.tabular, styles.speedBadge, {
                      backgroundColor: accent, borderRadius: u(DESIGN.chipHeight / 2), paddingHorizontal: u(14), paddingVertical: u(4),
                    }]}>
                    {scrubbing.speed}×
                  </Text>
                )}
              </View>
            </>,
          })}
        </TVFocusGuideView>
      )}

      {active && (panel === 'tracks' || panel === 'settings') && (
        <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight
          style={[styles.anchored, {
            backgroundColor: surface,
            borderRadius: u(DESIGN.barRadius),
            bottom: anchoredBottom,
            maxHeight: barTop - u(DESIGN.panelGap + DESIGN.inset),
            maxWidth: width - u(2 * DESIGN.inset),
            minWidth: u(DESIGN.settingsPanelWidth),
            right: u(DESIGN.inset),
          }]}>
          <ScrollView focusable={false} contentContainerStyle={{ gap: u(DESIGN.menuPadding), padding: u(DESIGN.menuPadding) }}>
            {panel === 'tracks' ? <>
              {hasCaptionTracks && chipRow('Captions', <>
                {chip('caption-off', 'Off', !status.selectedCaptionTrackId, () => selectOption(() => player.setCaptionTrack(null)),
                  { disabled: !active, preferredFocus: !status.selectedCaptionTrackId })}
                {status.captionTracks?.map(item => chip(`caption-${item.id}`, item.label || item.language || 'Captions',
                  item.id === status.selectedCaptionTrackId, () => selectOption(() => player.setCaptionTrack(item.id)),
                  { disabled: !active, preferredFocus: item.id === status.selectedCaptionTrackId }))}
              </>, undefined, DESIGN.tracksLabelWidth)}
              {hasAudioChoices && chipRow('Audio', <>
                {chip('audio-auto', 'Auto', !status.selectedAudioTrackId, () => selectOption(() => player.setAudioTrack(null)),
                  { disabled: !active, preferredFocus: !hasCaptionTracks && !status.selectedAudioTrackId })}
                {status.audioTracks?.map(item => chip(`audio-${item.id}`, item.label || item.language || 'Audio',
                  item.id === status.selectedAudioTrackId, () => selectOption(() => player.setAudioTrack(item.id)),
                  { disabled: !active, preferredFocus: !hasCaptionTracks && item.id === status.selectedAudioTrackId }))}
              </>, undefined, DESIGN.tracksLabelWidth)}
              {!hasCaptionTracks && !hasAudioChoices && <Text style={text(DESIGN.tvText, FONT.regular)}>No additional tracks available.</Text>}
            </> : <>
              {sections.quality && chipRow('Quality', <>
                {chip('quality-auto', 'Auto', source?.maxResolution == null, () => selectOption(() => player.setMaxResolution(undefined)),
                  { disabled: !active || !!source?.playbackToken, preferredFocus: source?.maxResolution == null && !source?.playbackToken })}
                {tvQualityOptions(source?.minResolution).map(quality => chip(`quality-${quality}`, quality.replace('p', ''),
                  source?.maxResolution === quality, () => selectOption(() => player.setMaxResolution(quality)),
                  { disabled: !active || !!source?.playbackToken, preferredFocus: source?.maxResolution === quality && !source?.playbackToken }))}
              </>, source?.playbackToken ? 'This signed video’s resolution limit is set by its playback token.' : undefined)}
              {sections.speed && chipRow('Speed', <>
                {TV_SPEEDS.map(speed => chip(`speed-${speed}`, `${speed}x`, status.playbackRate === speed,
                  () => selectOption(() => player.setPlaybackRate(speed)),
                  { disabled: !active, preferredFocus: status.playbackRate === speed && (firstSettingsRow === 'speed' || !!source?.playbackToken) }))}
              </>)}
            </>}
          </ScrollView>
        </TVFocusGuideView>
      )}

      {active && panel === 'more' && (
        <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight
          style={[styles.moreMenu, {
            backgroundColor: surface,
            borderBottomLeftRadius: u(DESIGN.menuRadius),
            borderBottomRightRadius: u(DESIGN.menuRadius),
            borderTopLeftRadius: u(DESIGN.menuRadius),
            gap: u(DESIGN.panelGap),
            minWidth: u(DESIGN.menuWidth),
            paddingHorizontal: u(DESIGN.panelGap),
            paddingVertical: u(DESIGN.menuPadding - 7),
            right: u(DESIGN.inset),
            top: u(DESIGN.inset + DESIGN.circle),
          }]}>
          {availableRobots.map((kind, index) => {
            const on = isRobotVisible(kind);
            return button(`more-${kind}`, `Show ${ROBOTS_LABELS[kind]} button`, () => toggleRobotVisibility(kind), {
              accessibilityRole: 'switch',
              accessibilityHint: 'Select shows or hides this button. Left returns to the Robots buttons; Back closes the menu.',
              checked: on,
              disabled: !active,
              preferredFocus: index === 0,
              style: [styles.menuRow, {
                gap: u(DESIGN.toggleLabelGap),
                paddingHorizontal: u(DESIGN.panelGap),
                paddingVertical: u(7),
              }],
              // Focus underlines the label, as on the Robots tabs.
              children: ({ focused }) => <>
                <Text numberOfLines={1} style={[text(DESIGN.text), focused && styles.underline]}>{ROBOTS_LABELS[kind]}</Text>
                <View style={{
                  backgroundColor: on ? DESIGN_COLORS.text : 'transparent',
                  borderColor: DESIGN_COLORS.text,
                  borderRadius: u(DESIGN.toggle / 2),
                  borderWidth: u(DESIGN.toggleBorder),
                  height: u(DESIGN.toggle),
                  width: u(DESIGN.toggle),
                }} />
              </>,
            });
          })}
        </TVFocusGuideView>
      )}

      {/* Keep the native overlay bounded to its panel: a full-screen wrapper
          occludes the playback bar in UIKit's focus engine. Cache lives above. */}
      <MuxTVRobotsPanel panel={active ? robotPanel : null} player={player} status={status} source={source} state={robotsState}
        onClose={closePanel} backgroundColor={surface} thumbnails={thumbnailPreviews} u={u}
        containerRef={setPanelFocusTarget} onFocus={markPanelFocused}
        claimFocus={panelClaimsFocus} entryRef={updatePanelEntry} tabRef={robotsUpId ? refFor(robotsUpId) : undefined}
        playbackRef={refFor(playbackEntryId)}
        frame={{ containerWidth: width, maxHeight: Math.max(u(DESIGN.tvCardHeight), barTop - u(DESIGN.panelGap) - panelTop), top: panelTop }} />

      {/* Above the panel layer: its tabs stay reachable (Up) while it is open.
          Like the bar, it stays mounted while hidden; `enabled={false}` would
          unmount it and strand the links into and out of the row. Its frame
          stops short of the … button, which UIKit cannot focus while covered.
          Right is trapped only without …, whose link from the last tab leaves the row. */}
      {visibleRobots.length > 0 && (
        <AnimatedFocusGuideView trapFocusLeft={!!robotPanel} trapFocusRight={!!robotPanel && !focusLayout.top.includes('more')}
          trapFocusDown={!!robotPanel}
          pointerEvents={presentation.showChrome ? 'box-none' : 'none'}
          style={[styles.topRow, { gap: u(DESIGN.circleGap), left: topRowInset, right: topRowInset, top: u(DESIGN.inset) }, chromeFade]}
          accessibilityElementsHidden={(modalOpen && !robotPanel) || !presentation.showChrome || !active}
          importantForAccessibility={(modalOpen && !robotPanel) || !presentation.showChrome || !active ? 'no-hide-descendants' : 'auto'}>
          {visibleRobots.map(robotButton)}
        </AnimatedFocusGuideView>
      )}

      {/* This exposed guide sits outside the bar's padding. It catches Up
          from the timeline (or a button, when the timeline is unavailable)
          and enters an item in the open panel, else on tvOS the top-row
          control focus last came from. */}
      {active && presentation.showChrome && playbackFocused && upFromPlayback && (
        <TVFocusGuideView destinations={[upFromPlayback]}
          style={{ position: 'absolute', left: u(DESIGN.inset), right: u(DESIGN.inset), top: barTop - u(2), height: u(2) }} />
      )}

      {/* The upper guide belongs only to panel content. Enabling it from the
          playback bar creates a shortcut past the cards to the workflow header. */}
      {active && robotPanel && presentation.showChrome && focusRegion === 'panel' && (
        <TVFocusGuideView destinations={robotsUpTarget ? [robotsUpTarget] : []} focusable={!!robotsUpTarget}
          style={{ position: 'absolute', left: u(DESIGN.inset), right: u(DESIGN.inset), top: panelTop - u(2), height: u(2) }} />
      )}
    </View>
  );
}

function identity(source?: NormalizedMuxVideoSource): string { return source?.sourceId ?? source?.playbackId ?? ''; }

function isRobotsPanel(panel: TVControlsPanel): panel is RobotsKind {
  return panel !== null && (ROBOTS_ORDER as string[]).includes(panel);
}

function robotAvailability(robots?: MuxVideoRobotsConfig): Record<RobotsKind, boolean> {
  const enabled = !!robots && robots.enabled !== false;
  return {
    summary: enabled && (!!robots?.summary || (!!robots?.assetId && !!robots.onSummarize)),
    chapters: enabled && (!!robots?.chapters?.length || (!!robots?.assetId && !!robots.onGenerateChapters)),
    moments: enabled && (!!robots?.keyMoments?.length || (!!robots?.assetId && !!robots.onFindKeyMoments)),
    transcript: enabled && (!!robots?.transcript?.cues.length || (!!robots?.assetId && !!robots.onTranscribe)),
  };
}

/** Chapters and moments for the timeline: host-provided data, else whatever the panels generated. */
function useTimelineContent(robots: MuxVideoRobotsConfig | undefined, snapshot: ReturnType<typeof useTVRobots>['snapshot']) {
  const enabled = !!robots && robots.enabled !== false;
  const generatedChapters = snapshot.chapters.phase === 'ready' ? snapshot.chapters.content.rows : undefined;
  const generatedMoments = snapshot.moments.phase === 'ready' ? snapshot.moments.content.rows : undefined;
  return React.useMemo(() => {
    if (!enabled) return { chapters: [], moments: [] };
    const chapters = (robots?.chapters ?? generatedChapters ?? [])
      .filter(chapter => chapter.title && Number.isFinite(chapter.startTime) && chapter.startTime >= 0)
      .slice().sort((a, b) => a.startTime - b.startTime);
    const moments = (robots?.keyMoments ?? generatedMoments ?? [])
      .filter((moment): moment is typeof moment & { endTime: number } => !!moment.title && Number.isFinite(moment.startTime)
        && moment.endTime !== undefined && Number.isFinite(moment.endTime) && moment.endTime > moment.startTime);
    return { chapters, moments };
  }, [enabled, robots?.chapters, robots?.keyMoments, generatedChapters, generatedMoments]);
}

function useTVStoryboard(source?: NormalizedMuxVideoSource) {
  const [storyboard, setStoryboard] = React.useState<{ url: string; data: ParsedStoryboard | null } | null>(null);
  const playbackId = source?.playbackId;
  const token = source?.storyboardToken;
  const domain = source?.customDomain;
  const url = playbackId ? buildMuxStoryboardVttUrl({ playbackId, customDomain: domain }, token) : null;
  React.useEffect(() => {
    setStoryboard(null);
    if (!url) return;
    const abort = new AbortController();
    let current = true;
    const timeout = setTimeout(() => abort.abort(), 8000);
    fetch(url, { signal: abort.signal }).then(response => response.ok ? response.text() : '')
      .then(vtt => { if (current) setStoryboard({ url, data: parseStoryboardVtt(vtt, url) }); })
      .catch(() => { /* Preview failure must not interrupt playback or expose signed URLs. */ })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; abort.abort(); clearTimeout(timeout); };
  }, [url]);
  return storyboard?.url === url ? storyboard.data : null;
}

/**
 * A full-screen frame of the resting seek preview, over the paused video and
 * under the controls. It fades in once loaded; each new frame mounts fresh.
 */
function SeekFrame({ uri, resizeMode, onShown }: { uri: string; resizeMode: ImageResizeMode; onShown: () => void }) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.seekFrame, { opacity }]}>
      <Image accessible={false} source={{ uri }} resizeMode={resizeMode} style={StyleSheet.absoluteFill}
        onLoad={() => {
          onShown();
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }} />
    </Animated.View>
  );
}

function SeekPreview({ source, storyboard, time, exactUri, width, radius, hint }: {
  source: NormalizedMuxVideoSource;
  storyboard: ParsedStoryboard | null;
  time: number;
  /**
   * The resting preview's full-screen frame, once loaded. A storyboard tile spans
   * up to 15 seconds, so the card shows this exact frame too rather than disagree.
   */
  exactUri?: string;
  width: number;
  radius: number;
  hint: TextStyle;
}) {
  const [failedSprite, setFailedSprite] = React.useState(false);
  const [failedThumbnail, setFailedThumbnail] = React.useState(false);
  const uri = buildMuxThumbnailUrl(source, { time, width: 640, token: source.thumbnailToken });
  React.useEffect(() => { setFailedSprite(false); }, [storyboard?.spriteUrl]);
  React.useEffect(() => { setFailedThumbnail(false); }, [uri]);
  const candidate = storyboard && !failedSprite ? tileForTime(storyboard, time) : undefined;
  const tile = candidate && candidate.width > 0 && candidate.height > 0 ? candidate : undefined;
  const height = tile ? width * tile.height / tile.width : width * 9 / 16;
  return (
    <View style={[styles.preview, { borderRadius: radius, height, width }]} accessible accessibilityLabel={`Preview at ${formatClock(time)}`}>
      {exactUri ? <Image accessible={false} source={{ uri: exactUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        : tile && storyboard ? <Image accessible={false} source={{ uri: storyboard.spriteUrl }} onError={() => setFailedSprite(true)}
        style={{ position: 'absolute', width: storyboard.spriteWidth * width / tile.width,
          height: storyboard.spriteHeight * width / tile.width, left: -tile.x * width / tile.width, top: -tile.y * width / tile.width }} />
        : !failedThumbnail ? <Image accessible={false} source={{ uri }} onError={() => setFailedThumbnail(true)} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <Text style={hint}>Preview unavailable</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  seekFrame: { backgroundColor: '#000' },
  revealHandoff: { position: 'absolute', top: 0, left: 0, width: 1, height: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  row: { alignItems: 'center', flexDirection: 'row' },
  tabular: { fontVariant: ['tabular-nums'] },
  underline: { textDecorationLine: 'underline' },
  chipFocusFill: { backgroundColor: 'rgba(255, 255, 255, 0.5)' },
  speedBadge: { overflow: 'hidden' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: FADE_HEIGHT },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: FADE_HEIGHT },
  topRow: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  tab: { alignItems: 'center', flexDirection: 'row' },
  moreAnchor: { position: 'absolute' },
  focusScale: { transform: [{ scale: 1.1 }] },
  skipFocus: { transform: [{ scale: 1.2 }] },
  bar: { position: 'absolute' },
  liveButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row' },
  errorRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  anchored: { position: 'absolute', overflow: 'hidden' },
  seekPreview: { alignItems: 'center' },
  chipRow: { alignItems: 'center', flexDirection: 'row' },
  chipScroller: { flexGrow: 0, flexShrink: 1 },
  moreMenu: { position: 'absolute' },
  menuRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end' },
  preview: { overflow: 'hidden', backgroundColor: DESIGN_COLORS.charcoal, alignItems: 'center', justifyContent: 'center' },
});
