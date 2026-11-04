import * as React from 'react';
import { Animated, Image, PixelRatio, Platform, Share, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType, TextStyle, ViewStyle } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { isLoaded, loadAsync } from 'expo-font';

/**
 * Tokens from the "React Native Players" Figma file, in Figma pixels. The TV
 * frames are 1920×1080 tvOS points; the phone frames are iPhone @3x renders
 * (1179px = 393pt), so phone controls draw every value at a third of its size.
 */
export const DESIGN = {
  /** Gap between the video edge and the top row, panels and bottom bar. */
  inset: 28,
  bottomInset: 38,
  barHeight: 140,
  barRadius: 28,
  barPaddingX: 42,
  barPaddingTop: 12,
  barRowGap: 6,
  /** Height of one line of 36px text; the first bar row is this tall. */
  textRow: 47,
  icon: 56,
  iconGap: 28,
  timeGap: 28,
  /** TV: the clock's column and its gap; the track and chapter title both start 296px in. */
  tvTimeWidth: 194,
  tvTimeGap: 32,
  trackHeight: 14,
  markerWidth: 7,
  markerHeight: 28,
  circle: 84,
  circleGap: 42,
  playCircle: 252,
  playGlyph: 118,
  seekCircle: 140,
  seekGlyph: 156.8,
  /** Space between the play circle and each seek circle. */
  seekGap: 140,
  tabHeight: 98,
  tabMinWidth: 298,
  tabPaddingLeft: 28,
  tabPaddingRight: 42,
  tabLabelGap: 14,
  panelRadius: 42,
  panelGap: 14,
  summaryWidth: 1112,
  summaryPaddingX: 56,
  summaryPaddingY: 42,
  cardsPaddingX: 57,
  cardsPaddingTop: 55,
  cardsPaddingBottom: 56,
  cardWidth: 410,
  cardHeight: 173,
  cardGap: 56,
  cardRadius: 24,
  cardBorder: 2,
  cardPadding: 28,
  momentThumbWidth: 304,
  momentCardWidth: 615,
  tvCardWidth: 440,
  tvCardHeight: 374,
  tvThumbHeight: 220,
  menuWidth: 330,
  menuRadius: 28,
  menuPadding: 28,
  toggle: 48,
  toggleBorder: 3,
  toggleLabelGap: 31,
  chipWidth: 114,
  chipHeight: 48,
  chipBorder: 3,
  chipGap: 14,
  settingsLabelWidth: 130,
  /** Not in Figma: the captions panel's column fits "Captions" (157px in DM Sans). */
  tracksLabelWidth: 160,
  settingsPanelWidth: 584,
  text: 36,
  /** Not in Figma: TV timeline and settings text, a step down from `text`. */
  tvText: 32,
  titleText: 48,
  smallText: 24,
  smallLineHeight: 32,
  bodyLineHeight: 47,
  /** TV focus disc behind bar icons; kept under 65px so it never reaches the track row above. */
  focusCircle: 64,
} as const;

export const DESIGN_COLORS = {
  /** Charcoal (#242628) at the 80% opacity Figma uses for every surface. */
  surface: 'rgba(36, 38, 40, 0.8)',
  charcoal: '#242628',
  text: '#FFFFFF',
  selectedText: '#112A63',
  accent: '#0072E3',
  progress: 'rgba(0, 114, 227, 0.8)',
  buffered: 'rgba(208, 210, 200, 0.6)',
  track: 'rgba(208, 210, 200, 0.3)',
  fadeStart: 'rgba(0, 0, 0, 0.5)',
  fadeEnd: 'rgba(0, 0, 0, 0)',
} as const;

/** Top and bottom shades each cover 630.857 of the 1080px frame. */
export const FADE_HEIGHT = '58.4%';

export const FONT = {
  regular: '400',
  light: '300',
  semibold: '600',
  bold: '700',
  black: '900',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

/**
 * DM Sans cut at Figma's 14pt optical size, and JetBrains Mono for text links;
 * SIL OFL, see assets/fonts. Each face is its own family.
 */
const DESIGN_FONTS = {
  'DMSans-Light': require('../assets/fonts/DMSans-Light.ttf'),
  'DMSans-Regular': require('../assets/fonts/DMSans-Regular.ttf'),
  'DMSans-SemiBold': require('../assets/fonts/DMSans-SemiBold.ttf'),
  'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
};
const DESIGN_FACES: Record<string, keyof typeof DESIGN_FONTS> = {
  [FONT.light]: 'DMSans-Light',
  [FONT.regular]: 'DMSans-Regular',
  [FONT.semibold]: 'DMSans-SemiBold',
};
let designFontLoad: Promise<void> | null = null;

/** Whether the design fonts have loaded; until then, or if loading fails, text uses the system font. */
export function useDesignFonts(): boolean {
  const [ready, setReady] = React.useState(() => Object.keys(DESIGN_FONTS).every(isLoaded));
  React.useEffect(() => {
    if (ready) return;
    let mounted = true;
    designFontLoad ??= loadAsync(DESIGN_FONTS);
    designFontLoad.then(() => { if (mounted) setReady(true); }, () => { designFontLoad = null; });
    return () => { mounted = false; };
  }, [ready]);
  return ready;
}

/**
 * DM Sans at `weight` once loaded, else the system font at that weight. The
 * loaded face already has its weight; adding one would synthesize bold on Android.
 */
export function designFontStyle(ready: boolean, weight: TextStyle['fontWeight'] = FONT.semibold): TextStyle {
  const face = ready && weight != null ? DESIGN_FACES[String(weight)] : undefined;
  return face ? { fontFamily: face, fontWeight: 'normal' } : { fontWeight: weight };
}

/** White PNGs rasterized from the Figma vectors; tint them with `tintColor`. */
export const CONTROL_ICONS = {
  play: require('../assets/controls/play.png'),
  pause: require('../assets/controls/pause.png'),
  seekBack: require('../assets/controls/seek-back.png'),
  seekBackTV: require('../assets/controls/seek-back-tv.png'),
  summary: require('../assets/controls/summary.png'),
  chapters: require('../assets/controls/chapters.png'),
  moments: require('../assets/controls/moments.png'),
  more: require('../assets/controls/more.png'),
  settings: require('../assets/controls/settings.png'),
  settingsOn: require('../assets/controls/settings-on.png'),
  fullscreenEnter: require('../assets/controls/fullscreen-enter.png'),
  fullscreenExit: require('../assets/controls/fullscreen-exit.png'),
  airplay: require('../assets/controls/airplay.png'),
} satisfies Record<string, ImageSourcePropType>;

export type ControlIconName = keyof typeof CONTROL_ICONS;
export type RobotsKind = 'summary' | 'chapters' | 'moments' | 'transcript';

export const ROBOTS_ORDER: RobotsKind[] = ['summary', 'chapters', 'moments', 'transcript'];
export const ROBOTS_LABELS: Record<RobotsKind, string> = {
  summary: 'Summary',
  chapters: 'Chapters',
  moments: 'Moments',
  transcript: 'Transcript',
};

/**
 * The design's top row shows Summary, Chapters and Moments; Transcript starts
 * switched off in the "…" menu unless it is the only Robots feature on offer.
 */
export function defaultHiddenRobots(available: RobotsKind[]): RobotsKind[] {
  return available.length > 1 && available.includes('transcript') ? ['transcript'] : [];
}

/** Phone frames are @3x; shrink further when the view is smaller than the 393×221pt mock. */
export function mobileDesignScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1 / 3;
  return Math.min(1, Math.max(0.72, Math.min(width / 393, height / 221))) / 3;
}

/** TV frames are 1920 points wide on tvOS; Android TV reports fewer density-independent pixels. */
export function tvDesignScale(windowWidth: number): number {
  return windowWidth > 0 ? windowWidth / 1920 : 1;
}

export function px(value: number): number {
  return PixelRatio.roundToNearestPixel(value);
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function ControlIcon({ name, size, color }: { name: ControlIconName; size: number; color: string }) {
  return (
    <Image
      accessible={false}
      source={CONTROL_ICONS[name]}
      style={{ width: size, height: size, tintColor: color }}
    />
  );
}

/** The Figma CC glyph is a stroked box with Aeonik "CC"; "on" fills the box. */
export function CaptionsGlyph({ size, color, active, knockoutColor = DESIGN_COLORS.charcoal }: {
  size: number;
  color: string;
  active: boolean;
  knockoutColor?: string;
}) {
  return (
    <View pointerEvents="none" style={[styles.center, { width: size, height: size }]}>
      <View
        style={[
          styles.center,
          {
            backgroundColor: active ? color : 'transparent',
            borderColor: color,
            borderWidth: size * 0.05,
            height: size * 0.6,
            width: size * 0.8,
          },
        ]}
      >
        <Text
          allowFontScaling={false}
          style={{
            color: active ? knockoutColor : color,
            fontSize: size * 0.4,
            fontWeight: FONT.semibold,
            includeFontPadding: false,
            lineHeight: size * 0.48,
          }}
        >
          CC
        </Text>
      </View>
    </View>
  );
}

/** The Figma file has no transcript icon; this matches the stroke of the other line icons. */
export function TranscriptGlyph({ size, color }: { size: number; color: string }) {
  const stroke = size * 0.05;
  const line = (width: number) => (
    <View style={{ backgroundColor: color, height: stroke, width: size * width }} />
  );
  return (
    <View pointerEvents="none" style={[styles.center, { width: size, height: size }]}>
      <View
        style={{
          borderColor: color,
          borderWidth: stroke,
          gap: size * 0.08,
          height: size * 0.6,
          justifyContent: 'center',
          paddingHorizontal: size * 0.1,
          width: size * 0.8,
        }}
      >
        {line(0.5)}
        {line(0.36)}
        {line(0.44)}
      </View>
    </View>
  );
}

export function RobotsGlyph({ kind, size, color }: { kind: RobotsKind; size: number; color: string }) {
  return kind === 'transcript'
    ? <TranscriptGlyph color={color} size={size} />
    : <ControlIcon color={color} name={kind} size={size} />;
}

/**
 * Seek arrow plus the seconds label. Forward mirrors the back arrow exactly as
 * the Figma component does, and the label stays live so `seekSeconds` shows.
 */
export function SeekGlyph({ direction, seconds, size, color, variant }: {
  direction: 'back' | 'forward';
  seconds: number;
  size: number;
  color: string;
  variant: 'mobile' | 'tv';
}) {
  const tv = variant === 'tv';
  const fontSize = size * (tv ? 0.3 : 0.2143);
  const letterSpacing = size * (tv ? 0.024 : 0.0171);
  const offsetY = size * (tv ? 0.05 : 0.009);
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <Image
        accessible={false}
        source={tv ? CONTROL_ICONS.seekBackTV : CONTROL_ICONS.seekBack}
        style={{
          height: size,
          tintColor: color,
          transform: direction === 'forward' ? [{ scaleX: -1 }] : undefined,
          width: size,
        }}
      />
      <View style={[StyleSheet.absoluteFill, styles.center, { transform: [{ translateY: offsetY }] }]}>
        <Text
          allowFontScaling={false}
          style={{
            color,
            fontSize,
            fontWeight: FONT.black,
            includeFontPadding: false,
            letterSpacing,
            // Trailing letter spacing would push the digits off-centre.
            paddingLeft: letterSpacing,
          }}
        >
          {seconds}
        </Text>
      </View>
    </View>
  );
}

/**
 * Fills the square beside a tab's foot outside a quarter circle, so the tab
 * flares into the panel below like the Figma union shape. Place inside the tab.
 */
export function ConcaveCorner({ radius, color, side }: { radius: number; color: string; side: 'left' | 'right' }) {
  // The ring must reach the square's far corner (√2·r from the circle centre).
  const ring = radius * 0.5;
  const diameter = 2 * (radius + ring);
  return (
    <View
      pointerEvents="none"
      style={{
        bottom: 0,
        height: radius,
        overflow: 'hidden',
        position: 'absolute',
        width: radius,
        [side === 'left' ? 'left' : 'right']: -radius,
      }}
    >
      <View
        style={{
          borderColor: color,
          borderRadius: diameter / 2,
          borderWidth: ring,
          height: diameter,
          left: side === 'left' ? -(radius + ring) : -ring,
          position: 'absolute',
          top: -(radius + ring),
          width: diameter,
        }}
      />
    </View>
  );
}

export type TrackMarks = {
  /** Chapter boundaries as 0–1 positions. */
  markers: number[];
  /** Key-moment ranges as 0–1 [start, end] pairs. */
  ranges: [number, number][];
};

export function ProgressTrack({
  buffered,
  colors,
  height,
  knob,
  markerHeight,
  markerWidth,
  marks,
  progress,
}: {
  buffered: number;
  colors: { track: string; buffered: string; progress: string; range: string; playedRange: string; marker: string };
  height: number;
  knob?: { position: number; size: number; color: string };
  markerHeight: number;
  markerWidth: number;
  marks: TrackMarks;
  progress: number;
}) {
  const radius = height / 2;
  return (
    <View pointerEvents="none" style={{ height: Math.max(markerHeight, knob?.size ?? 0), justifyContent: 'center' }}>
      <View style={{ backgroundColor: colors.track, borderRadius: radius, height, overflow: 'hidden' }}>
        <View style={[styles.fill, { backgroundColor: colors.buffered, borderRadius: radius, width: percent(buffered) }]} />
        <View style={[styles.fill, { backgroundColor: colors.progress, borderRadius: radius, width: percent(progress) }]} />
        {/* Ranges share the progress colour, so the played part of each turns
            `playedRange` rather than vanish into the progress fill. */}
        {marks.ranges.map(([start, end]) => {
          const played = Math.min(progress, end) - start;
          return (
            <React.Fragment key={`${start}-${end}`}>
              <View style={[styles.fill, { backgroundColor: colors.range, borderRadius: radius, left: percent(start), width: percent(end - start) }]} />
              {played > 0 ? (
                <View style={[styles.fill, { backgroundColor: colors.playedRange, borderRadius: radius, left: percent(start), width: percent(played) }]} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
      {marks.markers.map(position => (
        <View
          key={position}
          style={{
            backgroundColor: colors.marker,
            borderRadius: markerWidth,
            height: markerHeight,
            left: percent(position),
            marginLeft: -markerWidth / 2,
            position: 'absolute',
            width: markerWidth,
          }}
        />
      ))}
      {knob ? (
        <View
          style={{
            backgroundColor: knob.color,
            borderRadius: knob.size / 2,
            height: knob.size,
            left: percent(knob.position),
            marginLeft: -knob.size / 2,
            position: 'absolute',
            width: knob.size,
          }}
        />
      ) : null}
    </View>
  );
}

export function chipStyle(u: (value: number) => number, selected: boolean, minWidth = DESIGN.chipWidth): ViewStyle {
  return {
    alignItems: 'center',
    backgroundColor: selected ? DESIGN_COLORS.text : 'transparent',
    borderColor: DESIGN_COLORS.text,
    borderRadius: u(DESIGN.chipHeight / 2),
    borderWidth: u(DESIGN.chipBorder),
    height: u(DESIGN.chipHeight),
    justifyContent: 'center',
    minWidth: u(minWidth),
    paddingBottom: u(1),
    paddingHorizontal: u(16),
  };
}

/**
 * The 47px DM Sans line is taller than the pill's 41px inside, and Figma centres
 * it there, overflowing both edges. Without room, React Native squeezes the text
 * to that inside height, top-aligned: iOS then clips descenders and Android draws
 * them over the border. Negative margins give it the room; centring is unchanged.
 */
export function chipTextStyle(u: (value: number) => number, selected: boolean, fontsReady = false, size: number = DESIGN.text): TextStyle {
  return {
    color: selected ? DESIGN_COLORS.selectedText : DESIGN_COLORS.text,
    fontSize: u(size),
    ...designFontStyle(fontsReady),
    includeFontPadding: false,
    marginVertical: -u(DESIGN.chipHeight / 2),
  };
}

export function textStyle(u: (value: number) => number, color: string, size: number = DESIGN.text, weight: TextStyle['fontWeight'] = FONT.semibold): TextStyle {
  return { color, fontSize: u(size), fontWeight: weight };
}

export function linkTextStyle(u: (value: number) => number, color: string, fontsReady = false): TextStyle {
  return {
    color,
    ...(fontsReady ? { fontFamily: 'JetBrainsMono-Regular', fontWeight: 'normal' } : { fontFamily: FONT.mono }),
    fontSize: u(DESIGN.text),
    textDecorationLine: 'underline',
    textTransform: 'uppercase',
  };
}

type ClipboardModule = { setStringAsync?: (text: string, options: object) => Promise<boolean> };
let clipboard: ClipboardModule | null | undefined;

/** expo-clipboard is optional; without it the summary link shares instead of copying. */
export function summaryCopyAction(): 'copy' | 'share' {
  if (clipboard === undefined) {
    try {
      clipboard = requireOptionalNativeModule<ClipboardModule>('ExpoClipboard');
    } catch {
      clipboard = null;
    }
  }
  return clipboard?.setStringAsync ? 'copy' : 'share';
}

export function copySummary(text: string): Promise<unknown> {
  if (summaryCopyAction() === 'copy' && clipboard?.setStringAsync) {
    return clipboard.setStringAsync(text, {});
  }
  return Share.share({ message: text });
}

/**
 * Horizontal card list whose cards fade as they reach the right edge, standing
 * in for the Figma gradient mask (React Native has no alpha masks without a
 * native dependency). Cards end fully visible once the list is scrolled to its end.
 */
export function FadingCardRow({
  cardWidths,
  children,
  gap,
  paddingX,
  paddingY = 0,
  tv = false,
}: {
  cardWidths: number[];
  children: React.ReactNode;
  gap: number;
  paddingX: number;
  /** Room for focused cards that scale up past the row's bounds. */
  paddingY?: number;
  tv?: boolean;
}) {
  const scrollX = React.useRef(new Animated.Value(0)).current;
  const [viewport, setViewport] = React.useState(0);
  const items = React.Children.toArray(children);
  const rights: number[] = [];
  cardWidths.reduce((right, width, index) => {
    const next = right + (index ? gap : 0) + width;
    rights.push(next);
    return next;
  }, paddingX);
  const maxScroll = (rights[rights.length - 1] ?? 0) + paddingX - viewport;

  return (
    <Animated.ScrollView
      bounces={false}
      contentContainerStyle={{ gap, paddingHorizontal: paddingX, paddingVertical: paddingY }}
      // A focusable tvOS scroll ancestor prevents its cards receiving focus.
      focusable={tv ? false : undefined}
      horizontal
      onLayout={event => setViewport(event.nativeEvent.layout.width)}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
    >
      {items.map((child, index) => {
        let opacity: Animated.AnimatedInterpolation<number> | number = 1;
        if (viewport > 0 && maxScroll > 0) {
          // Opaque while the card ends inside the list's padding; fades as it
          // runs past the edge. At full scroll the last card ends exactly there.
          const end = rights[index] - viewport + paddingX;
          opacity = scrollX.interpolate({
            extrapolate: 'clamp',
            inputRange: [end - Math.max(1, paddingX * 1.5), end],
            outputRange: [0.3, 1],
          });
        }
        return (
          <Animated.View key={React.isValidElement(child) && child.key != null ? child.key : index} style={{ opacity }}>
            {child}
          </Animated.View>
        );
      })}
    </Animated.ScrollView>
  );
}

function percent(value: number): `${number}%` {
  return `${Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100}%`;
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
});
