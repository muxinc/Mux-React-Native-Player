import * as React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import type { RefObject } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { MuxVideoPlayer } from '../MuxVideoPlayer';
import type { MuxPlayerStatus, NormalizedMuxVideoSource } from '../types';
import { buildMuxThumbnailUrl } from '../muxImageUrls';
import { DESIGN, DESIGN_COLORS, designFontStyle, FadingCardRow, FONT, formatClock, linkTextStyle, useDesignFonts } from '../controlsDesign';
import { ROBOTS_ERROR, ROBOTS_SEEK_ERROR, robotsSeekTarget, seekRobotsRow, type RobotsRow, type TVRobotsPanel } from './robotsState';
import { TVButton } from './TVButton';
import type { useTVRobots } from './useTVRobots';

type Scale = (value: number) => number;

export type MuxTVRobotsPanelProps = {
  panel: TVRobotsPanel | null;
  player: MuxVideoPlayer;
  status: MuxPlayerStatus;
  source?: NormalizedMuxVideoSource;
  /** Owned by the controls so the timeline can share generated chapters and moments. */
  state: ReturnType<typeof useTVRobots>;
  onClose: () => void;
  backgroundColor?: string;
  thumbnails?: boolean;
  u: Scale;
  /** False when browsing tabs or playback controls; Select enters the content. */
  claimFocus?: boolean;
  /** Native focus environment; re-entry restores the last focused panel item. */
  containerRef?: React.Ref<React.ComponentRef<typeof TVFocusGuideView>>;
  /** Bubbles from selectable content so the host can enable the route to tabs. */
  onFocus?: () => void;
  /** Receives the entry row: the current chapter, cue or first moment. */
  entryRef?: React.Ref<View>;
  /** The open panel's tab; Up from the panel's top edge goes there. */
  tabRef?: RefObject<View | null>;
  /** Down from the panel's bottom edge returns to the timeline (or Play). */
  playbackRef?: RefObject<View | null>;
  /** Panel frame below the active tab, already clear of the bottom bar. */
  frame: { top: number; containerWidth: number; maxHeight: number };
};

const headings = { summary: 'Summary', chapters: 'Chapters', moments: 'Moments', transcript: 'Transcript' };

type RobotsResult = ReturnType<typeof useTVRobots>['result'];

/** Generated content to show; undefined while loading, after an error, or when empty. */
function readyRobotsContent(result: RobotsResult) {
  const content = result.phase === 'ready' ? result.content : undefined;
  const empty = content && !content.title && !content.description && !content.tags?.length && content.rows.length === 0;
  return content && !empty ? content : undefined;
}

/** A ready summary is read, not focused, so focus passes from its tab to playback. */
export function robotsPanelFocusable(panel: TVRobotsPanel, result: RobotsResult): boolean {
  return panel !== 'summary' || !readyRobotsContent(result);
}

/** The host owns Menu/Back and restores focus to the button that opened this panel. */
export function MuxTVRobotsPanel(props: MuxTVRobotsPanelProps) {
  if (props.panel === null) return null;
  return <OpenPanel key={props.panel} {...props} panel={props.panel} />;
}

function OpenPanel({ panel, player, status, source, onClose,
  backgroundColor = DESIGN_COLORS.surface, thumbnails = true, state, u, frame, claimFocus = true, containerRef, onFocus, entryRef, tabRef, playbackRef }: MuxTVRobotsPanelProps & { panel: TVRobotsPanel }) {
  const fontsReady = useDesignFonts();
  const [seekError, setSeekError] = React.useState(false);
  const [seeking, setSeeking] = React.useState(false);
  const alive = React.useRef(true);
  const seekingRef = React.useRef(false);
  const current = React.useRef({ generation: state.generation, player, enabled: state.enabled });
  current.current = { generation: state.generation, player, enabled: state.enabled };
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  React.useEffect(() => {
    setSeekError(false);
    setSeeking(false);
    seekingRef.current = false;
  }, [state.generation]);

  const select = async (row: RobotsRow) => {
    if (seekingRef.current || !state.enabled) return;
    const generation = state.generation;
    const isCurrent = () => {
      const activeSource = player._getSnapshot().source;
      const sameSource = !source || (source.sourceId ? activeSource?.sourceId === source.sourceId : activeSource === source);
      return alive.current && sameSource && current.current.generation === generation && current.current.player === player && current.current.enabled;
    };
    // Consult the player again at activation: live windows and sources can change
    // between the row's render and a remote Select event.
    const latest = player._getSnapshot();
    if (source?.sourceId && latest.source?.sourceId !== source.sourceId) return;
    seekingRef.current = true;
    setSeeking(true);
    setSeekError(false);
    const result = await seekRobotsRow(row, latest.status, source, time => player.seekTo(time), isCurrent);
    if (!isCurrent()) return;
    seekingRef.current = false;
    setSeeking(false);
    if (result === 'seeked') onClose();
    else if (result !== 'stale') setSeekError(true);
  };

  const { result } = state;
  const loading = result.phase === 'loading' || (result.phase === 'idle' && state.canGenerate);
  const ready = readyRobotsContent(result);
  const cards = !!ready && (panel === 'chapters' || panel === 'moments');
  const width = panel === 'summary' ? Math.min(frame.containerWidth - 2 * u(DESIGN.inset), u(DESIGN.summaryWidth)) : undefined;
  const frameStyle: ViewStyle = width
    ? { left: (frame.containerWidth - width) / 2, width }
    : { left: u(DESIGN.inset), right: u(DESIGN.inset) };
  const text = (size: number, weight: TextStyle['fontWeight'] = FONT.semibold): TextStyle =>
    ({ color: DESIGN_COLORS.text, fontSize: u(size), ...designFontStyle(fontsReady, weight) });
  const up = tabRef?.current ?? undefined;
  const down = playbackRef?.current ?? undefined;
  /** Focus props for a control the panel may start on. */
  const entry = (preferred: boolean) => ({ preferredFocus: claimFocus && preferred, ref: preferred ? entryRef : undefined });
  const close = (preferred: boolean) => (
    <TVButton label="Close" onPress={onClose} {...entry(preferred)} nextFocusUp={up} nextFocusDown={down}
      style={({ focused }) => [styles.link, { borderRadius: u(DESIGN.chipHeight / 2), paddingHorizontal: u(14) },
        focused && { backgroundColor: DESIGN_COLORS.text }]}>
      {({ focused }) => <Text style={[linkTextStyle(u, focused ? DESIGN_COLORS.charcoal : DESIGN_COLORS.text, fontsReady), { lineHeight: u(DESIGN.chipHeight + 12) }]}>CLOSE</Text>}
    </TVButton>
  );
  const message = (value: string, role?: 'alert') => (
    <Text accessibilityRole={role} accessibilityLiveRegion={role ? undefined : 'polite'}
      style={[text(DESIGN.text, FONT.regular), { lineHeight: u(DESIGN.bodyLineHeight) }]}>{value}</Text>
  );
  const retry = (label: string) => state.canGenerate && (
    <TVButton label={label} onPress={state.retry} {...entry(true)} nextFocusUp={up} nextFocusDown={down}
      style={({ focused }) => [styles.retry, { borderRadius: u(DESIGN.chipHeight / 2), borderWidth: u(DESIGN.chipBorder), height: u(DESIGN.chipHeight + 12), paddingHorizontal: u(28) },
        focused && { backgroundColor: DESIGN_COLORS.text }]}>
      {({ focused }) => <Text style={[text(DESIGN.text), focused && { color: DESIGN_COLORS.selectedText }]}>{label}</Text>}
    </TVButton>
  );

  const nowPlaying = status.currentTime;
  const currentIndex = ready ? ready.rows.reduce((found, row, index) => row.startTime <= nowPlaying ? index : found, 0) : 0;
  // Focus draws FocusStroke over the card rather than thickening this border,
  // which would push the content inward.
  const cardStyle = (cardWidth: number, cardHeight: number): StyleProp<ViewStyle> => [
    styles.card,
    {
      borderRadius: u(DESIGN.cardRadius),
      borderWidth: u(DESIGN.cardBorder),
      height: u(cardHeight),
      width: u(cardWidth),
    },
  ];

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={[styles.feedback, { gap: u(DESIGN.cardPadding) }]}>
        <ActivityIndicator size="large" color={DESIGN_COLORS.text} />
        {message(`Loading ${headings[panel].toLowerCase()}…`)}
        {close(true)}
      </View>
    );
  } else if (result.phase === 'error') {
    body = (
      <View style={[styles.feedback, { gap: u(DESIGN.cardPadding) }]}>
        {message(ROBOTS_ERROR, 'alert')}
        {retry('Retry')}
        {close(!state.canGenerate)}
      </View>
    );
  } else if (!ready) {
    body = (
      <View style={[styles.feedback, { gap: u(DESIGN.cardPadding) }]}>
        {message(state.enabled ? `No ${headings[panel].toLowerCase()} available.` : 'Robots content is disabled.')}
        {retry('Try again')}
        {close(!state.canGenerate)}
      </View>
    );
  } else if (panel === 'summary') {
    body = (
      <>
        <Text accessibilityRole="header" numberOfLines={2} style={text(DESIGN.titleText)}>
          {ready.title || headings.summary}
        </Text>
        {Boolean(ready.description) && (
          <Text style={[styles.scroll, text(DESIGN.text, FONT.regular), { lineHeight: u(DESIGN.bodyLineHeight), marginTop: u(14) }]}>
            {ready.description}
          </Text>
        )}
      </>
    );
  } else if (panel === 'transcript') {
    const lastEnabledRow = ready.rows.reduce((last, row, index) => robotsSeekTarget(row, status, source) === null ? last : index, -1);
    body = (
      <ScrollView focusable={false} showsVerticalScrollIndicator style={styles.scroll}>
        {ready.rows.map((row, index) => {
          const target = robotsSeekTarget(row, status, source);
          // Times sit 10px further in than the row's other padding, clear of the
          // highlight's rounded end; the smaller gap keeps the text in place.
          return (
            <TVButton key={index} label={`${row.detail ? `${row.detail}: ` : ''}${row.title}`} disabled={seeking || target === null}
              {...entry(index === currentIndex)} nextFocusUp={index === 0 ? up : undefined} onPress={() => { void select(row); }}
              nextFocusDown={index === lastEnabledRow ? down : undefined}
              accessibilityHint={target === null ? 'Time unavailable' : `Select to jump to ${formatClock(target)}`}
              style={({ focused }) => [styles.transcriptRow, { borderRadius: u(DESIGN.cardRadius), gap: u(DESIGN.cardPadding - 10), padding: u(14), paddingLeft: u(24) },
                focused && styles.focusedRow]}>
              <Text style={[text(DESIGN.smallText, FONT.light), styles.tabular, { lineHeight: u(DESIGN.bodyLineHeight), width: u(110) }]}>
                {target === null ? '–' : formatClock(target)}
              </Text>
              <Text style={[styles.flex, text(DESIGN.text, FONT.regular), { lineHeight: u(DESIGN.bodyLineHeight) }]}>
                {row.detail ? `${row.detail}: ` : ''}{row.title}
              </Text>
            </TVButton>
          );
        })}
      </ScrollView>
    );
  } else if (panel === 'chapters') {
    body = (
      <FadingCardRow tv cardWidths={ready.rows.map(() => u(DESIGN.cardWidth))} gap={u(DESIGN.cardGap)} paddingX={u(DESIGN.cardsPaddingX)}>
        {ready.rows.map((row, index) => {
          const target = robotsSeekTarget(row, status, source);
          return (
            <TVButton key={index} label={`Chapter ${row.title}`} disabled={seeking || target === null} parallax={false}
              {...entry(index === currentIndex)} nextFocusUp={up} nextFocusDown={down} onPress={() => { void select(row); }}
              accessibilityHint={target === null ? 'Time unavailable' : `Select to jump to ${formatClock(target)}`}
              style={[cardStyle(DESIGN.cardWidth, DESIGN.cardHeight), { justifyContent: 'center', paddingHorizontal: u(DESIGN.cardPadding) }]}>
              {({ focused }) => <>
                <Text numberOfLines={2} style={text(DESIGN.text)}>{row.title}</Text>
                <Text style={[text(DESIGN.text), styles.tabular]}>{target === null ? 'Time unavailable' : formatClock(target)}</Text>
                {focused && <FocusStroke u={u} />}
              </>}
            </TVButton>
          );
        })}
      </FadingCardRow>
    );
  } else {
    body = (
      <FadingCardRow tv cardWidths={ready.rows.map(() => u(DESIGN.tvCardWidth))} gap={u(DESIGN.cardGap)} paddingX={u(DESIGN.cardsPaddingX)}>
        {ready.rows.map((row, index) => {
          const target = robotsSeekTarget(row, status, source);
          const range = target === null ? 'Time unavailable'
            : `${formatClock(target)}${row.endTime !== undefined && Number.isFinite(row.endTime) ? `-${formatClock(row.endTime)}` : ''}`;
          return (
            <MomentCard key={index} row={row} range={range} disabled={seeking || target === null}
              focus={{ ...entry(index === 0), nextFocusUp: up, nextFocusDown: down }} onPress={() => { void select(row); }} u={u}
              thumbnail={thumbnails && source && Number.isFinite(row.startTime)
                ? buildMuxThumbnailUrl(source, { time: Math.floor(row.startTime), width: 640, token: source.thumbnailToken })
                : undefined}
              cardStyle={cardStyle(DESIGN.tvCardWidth, DESIGN.tvCardHeight)} />
          );
        })}
      </FadingCardRow>
    );
  }

  return (
    <TVFocusGuideView ref={containerRef} onFocus={onFocus} autoFocus trapFocusLeft trapFocusRight
      accessibilityLabel={headings[panel]}
      style={[styles.panel, frameStyle, {
        backgroundColor,
        borderRadius: u(DESIGN.panelRadius),
        maxHeight: frame.maxHeight,
        paddingBottom: cards ? u(DESIGN.cardsPaddingBottom) : u(DESIGN.summaryPaddingY),
        paddingHorizontal: cards ? 0 : u(DESIGN.summaryPaddingX),
        paddingTop: cards ? u(DESIGN.cardsPaddingTop) : u(DESIGN.summaryPaddingY),
        top: frame.top,
      }]}>
      {seekError && <Text accessibilityRole="alert" style={[text(DESIGN.smallText, FONT.regular), styles.notice, { marginBottom: u(14), paddingHorizontal: cards ? u(DESIGN.cardsPaddingX) : 0 }]}>{ROBOTS_SEEK_ERROR}</Text>}
      {seeking && <Text accessibilityLiveRegion="polite" style={[text(DESIGN.smallText, FONT.regular), styles.notice, { marginBottom: u(14), paddingHorizontal: cards ? u(DESIGN.cardsPaddingX) : 0 }]}>Jumping to video…</Text>}
      {body}
    </TVFocusGuideView>
  );
}

function MomentCard({ row, range, disabled, focus, onPress, thumbnail, cardStyle, u }: {
  row: RobotsRow;
  range: string;
  disabled: boolean;
  focus: { preferredFocus: boolean; ref?: React.Ref<View>; nextFocusUp?: View; nextFocusDown?: View };
  onPress: () => void;
  thumbnail?: string;
  cardStyle: StyleProp<ViewStyle>;
  u: Scale;
}) {
  const [failed, setFailed] = React.useState(false);
  const image = thumbnail && !failed ? thumbnail : undefined;
  const fontsReady = useDesignFonts();
  const small: TextStyle = { color: DESIGN_COLORS.text, fontSize: u(DESIGN.smallText), ...designFontStyle(fontsReady, FONT.light), lineHeight: u(DESIGN.smallLineHeight) };
  const title: TextStyle = { color: DESIGN_COLORS.text, fontSize: u(DESIGN.text), ...designFontStyle(fontsReady) };
  return (
    <TVButton label={`Key moment ${row.title}`} disabled={disabled} parallax={false} {...focus} onPress={onPress}
      accessibilityHint={`Select to jump to ${range}`} style={cardStyle}>
      {({ focused }) => <>
        {image ? (
          <>
            <Image accessible={false} source={{ uri: image }} onError={() => setFailed(true)}
              style={{ height: u(DESIGN.tvThumbHeight), width: '100%' }} />
            <View style={{ backgroundColor: DESIGN_COLORS.text, height: u(DESIGN.cardBorder) }} />
            <View style={[styles.flex, { justifyContent: 'center', paddingHorizontal: u(DESIGN.cardPadding) }]}>
              <Text numberOfLines={1} style={title}>{row.title}</Text>
              {Boolean(row.detail) && <Text numberOfLines={1} style={small}>{row.detail}</Text>}
              <Text numberOfLines={1} style={[small, styles.tabular]}>{range}</Text>
            </View>
          </>
        ) : (
          <View style={[styles.flex, { justifyContent: 'space-between', padding: u(DESIGN.cardPadding) }]}>
            <View>
              <Text numberOfLines={1} style={title}>{row.title}</Text>
              {Boolean(row.detail) && <Text numberOfLines={7} style={[small, { marginTop: u(14) }]}>{row.detail}</Text>}
            </View>
            <Text numberOfLines={1} style={[small, styles.tabular]}>{range}</Text>
          </View>
        )}
        {focused && <FocusStroke u={u} />}
      </>}
    </TVButton>
  );
}

/** The focused card's thicker stroke, laid over its own border so nothing inside moves. */
function FocusStroke({ u }: { u: Scale }) {
  // Absolute insets start inside the card's border; reach back to its outer edge.
  const outset = -u(DESIGN.cardBorder);
  return <View pointerEvents="none" style={[styles.focusStroke, {
    borderRadius: u(DESIGN.cardRadius), borderWidth: u(6), bottom: outset, left: outset, right: outset, top: outset,
  }]} />;
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', overflow: 'hidden', zIndex: 20 },
  flex: { flex: 1, minWidth: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  link: { justifyContent: 'center' },
  retry: { alignItems: 'center', borderColor: DESIGN_COLORS.text, justifyContent: 'center' },
  feedback: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  notice: { opacity: 0.9 },
  card: { borderColor: DESIGN_COLORS.text, overflow: 'hidden' },
  focusStroke: { borderColor: DESIGN_COLORS.text, position: 'absolute' },
  focusedRow: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  transcriptRow: { flexDirection: 'row' },
  tabular: { fontVariant: ['tabular-nums'] },
});
