import type { MuxMaxResolution, MuxPlayerStatus } from '../types';

export type TVControlsPanel = 'seek' | 'tracks' | 'settings' | 'more' | 'summary' | 'chapters' | 'moments' | 'transcript' | null;
export type TVRemoteAction = 'toggle' | 'play' | 'pause' | 'backward' | 'forward' | 'previewBackward' | 'previewForward' | 'leaveMenu' | 'enterPanel';
/**
 * Focused surfaces with their own remote handling: the bar's timeline and the open
 * preview bubble claim Left/Right, and Left leaves the … menu. The playback bar can
 * operate below Robots content, while tabs and panel contents retain ownership of
 * their own input.
 */
export type TVRemoteFocus = 'timeline' | 'playback' | 'preview' | 'tab' | 'menu' | null;

export const TV_SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;
/** Pace of seek steps while an arrow or seek key is held, on either platform. */
export const TV_HOLD_REPEAT_MS = 150;
/** Scan speeds as the preview shows them; the slowest moves one step per hold repeat. */
export const TV_SCAN_SPEEDS = [2, 4, 8, 16] as const;
export const TV_SCRUB_RAMP_MS = 1000;

/** A held arrow scans faster the longer it is held: one speed per ramp interval. */
export function tvScrubSpeed(heldMs: number): number {
  const level = Math.floor(Math.max(0, finite(heldMs)) / TV_SCRUB_RAMP_MS);
  return TV_SCAN_SPEEDS[Math.min(level, TV_SCAN_SPEEDS.length - 1)];
}

/** A seek-preview scan: it keeps moving the preview until stopped. */
export type TVScan = { direction: -1 | 1; speed: number };

/** Preview steps one hold repeat of a scan moves. */
export function tvScanSteps(speed: number): number {
  return speed / TV_SCAN_SPEEDS[0];
}

/**
 * One Left/Right press in the seek preview, like the native tvOS player. With no
 * scan running, a press steps once. A hold starts scanning that way, and the scan
 * carries on after release. While it runs, a press the same way speeds it up and
 * one the other way slows it down, stopping it below the slowest speed.
 */
export function tvScanPress(scan: TVScan | null, direction: -1 | 1, held: boolean): { scan: TVScan | null; step: boolean } {
  if (held) return { scan: scan?.direction === direction ? scan : { direction, speed: TV_SCAN_SPEEDS[0] }, step: false };
  if (!scan) return { scan: null, step: true };
  const speeds: readonly number[] = TV_SCAN_SPEEDS;
  const index = speeds.indexOf(scan.speed) + (direction === scan.direction ? 1 : -1);
  if (index < 0) return { scan: null, step: false };
  return { scan: { direction: scan.direction, speed: speeds[Math.min(index, speeds.length - 1)] }, step: false };
}
export const TV_QUALITIES: MuxMaxResolution[] = ['720p', '1080p', '1440p', '2160p'];

export type TVBackSubscriptionRef = { current: { remove: () => void } | null };

export function clearTVBackSubscription(ref: TVBackSubscriptionRef): void {
  ref.current?.remove();
  ref.current = null;
}

/** Re-prioritize synchronously: a key event cannot interleave this JS call. */
export function refreshTVBackSubscription(ref: TVBackSubscriptionRef,
  subscribe: (handler: () => boolean) => { remove: () => void }, handler: () => boolean): void {
  clearTVBackSubscription(ref);
  ref.current = subscribe(handler);
}

/** A hidden surface belongs only to the source on which the user hid controls. */
export function tvControlsPresentation(hiddenSourceKey: string | null, sourceKey: string, active: boolean) {
  const hidden = !!sourceKey && hiddenSourceKey === sourceKey;
  return { showChrome: active && !hidden, showReveal: active && hidden };
}

export function tvTimeline(status: Pick<MuxPlayerStatus, 'isLive' | 'seekableStart' | 'seekableEnd' | 'duration'>) {
  const start = status.isLive ? Math.max(0, finite(status.seekableStart)) : 0;
  const end = Math.max(start, status.isLive ? finite(status.seekableEnd) : finite(status.duration));
  return { start, end, duration: end - start };
}

export function clampTVTime(time: number, timeline: { start: number; end: number }): number {
  return Math.max(timeline.start, Math.min(timeline.end, finite(time, timeline.start)));
}

export function tvSeekStep(seconds?: number): number {
  return seconds == null || !Number.isFinite(seconds) ? 10 : Math.max(1, Math.min(120, seconds));
}

export function advanceTVPreview(time: number, direction: -1 | 1, step: number, timeline: { start: number; end: number }, speed = 1): number {
  return clampTVTime(time + direction * tvSeekStep(step) * speed, timeline);
}

export function formatTVTime(seconds: number): string {
  const value = Math.floor(Math.max(0, finite(seconds)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** DM Sans SemiBold advance widths, in ems, of the characters in a clock label. */
const CLOCK_ADVANCES: Record<string, number> = {
  '0': 0.698, '1': 0.348, '2': 0.577, '3': 0.599, '4': 0.638, '5': 0.618, '6': 0.633, '7': 0.536, '8': 0.625, '9': 0.633,
  ':': 0.239, ' ': 0.244, '/': 0.417,
};
/** Kerning only tightens these digits, apart from "71" (+0.015em) at most a few times a label. */
export const TV_CLOCK_KERNING_SLACK = 0.05;

/** A clock label's width in ems of DM Sans SemiBold, before kerning. */
export function tvClockTextWidth(label: string): number {
  return [...label].reduce((sum, char) => sum + (CLOCK_ADVANCES[char] ?? 1), 0);
}

/**
 * Width, in ems of DM Sans SemiBold, that fits every "elapsed / duration" label
 * while playing to `duration`. Its digits differ in width (a "0" is twice a "1")
 * and it has no tabular figures, so a column this wide keeps the track beside
 * the clock still as it runs.
 */
export function tvClockLabelWidth(duration: number): number {
  const end = Math.floor(Math.max(0, finite(duration)));
  let elapsed = 0;
  // Minutes and seconds add independently: a whole minute is widest at ":00",
  // so only the last, partial minute needs its seconds searched.
  for (let minute = 0; minute * 60 <= end; minute++) {
    const lastSecond = Math.min(59, end - minute * 60);
    for (let second = 0; second <= (lastSecond === 59 ? 0 : lastSecond); second++) {
      elapsed = Math.max(elapsed, tvClockTextWidth(formatTVTime(minute * 60 + second)));
    }
  }
  return elapsed + tvClockTextWidth(` / ${formatTVTime(end)}`) + TV_CLOCK_KERNING_SLACK;
}

/** Select is owned by Pressable; Back is owned by BackHandler; never handle either here. */
export function tvRemoteAction(
  event: { eventType: string; eventKeyAction?: number },
  panel: TVControlsPanel,
  focus: TVRemoteFocus,
  platform: 'android' | 'ios' = 'android',
): TVRemoteAction | null {
  // RN TV's tvOS taps are UITapGestureRecognizer ended events (up=1).
  // Android emits down AND up; accepting both would apply transport twice.
  // Apple long-arrow gestures begin at down=0 and end at up=1.
  const action = platform === 'ios' && !event.eventType.startsWith('long') ? 1 : 0;
  if (event.eventKeyAction !== action) return null;
  const robotsOpen = panel === 'summary' || panel === 'chapters' || panel === 'moments' || panel === 'transcript';
  // Robots panels are not modal and the video plays on behind them, so remote
  // transport keys keep working from their tabs and content too.
  const playbackAllowed = panel === null || robotsOpen;
  // Left/Right on the focused timeline start a preview; the timeline still
  // reports focus while it hands off to the bubble, so it may keep stepping.
  const scrubbing = focus === 'preview' ? panel === 'seek' : focus === 'timeline' && (playbackAllowed || panel === 'seek');
  if (scrubbing) {
    if (event.eventType === 'left' || event.eventType === 'longLeft') return 'previewBackward';
    if (event.eventType === 'right' || event.eventType === 'longRight') return 'previewForward';
  }
  // The … menu is one column hanging below its button, so nothing in it lies to
  // the left: Left returns to the Robots buttons beside it, as Back would.
  if (panel === 'more' && focus === 'menu' && event.eventType === 'left') return 'leaveMenu';
  // Native Down cannot leave the tab row while a workflow is open: just after a
  // tab switch its panel may not have mounted yet, and the stale link led to the
  // timeline. The tab enters its content here instead, once the content exists.
  if (robotsOpen && focus === 'tab' && event.eventType === 'down') return 'enterPanel';
  // Up/Down follow native focus links, including tabs -> playback bar. Handling
  // them again here could undo the focus move when its event arrives first.
  if (!playbackAllowed) return null;
  switch (event.eventType) {
    case 'playPause': return 'toggle';
    case 'play': return 'play';
    case 'pause': return 'pause';
    case 'rewind': case 'longRewind': return 'backward';
    case 'fastForward': case 'longFastForward': return 'forward';
    default: return null;
  }
}

/** Re-enters open Robots content at its last focused item. */
export const TV_PANEL_FOCUS = 'panel';
/** Starts open Robots content at its entry row: the current chapter, cue or first moment. */
export const TV_PANEL_ENTRY_FOCUS = 'panel-entry';

export type TVFocusLinks = { up?: string; down?: string; left?: string; right?: string };

/**
 * The overlay's focusable rows from top to bottom, each in visual order. Open
 * Robots content sits between the top row and the timeline.
 */
export type TVFocusLayout = {
  top: string[];
  /** The open Robots workflow's tab. */
  openTab?: string;
  /** False while the open workflow has nothing to focus (a summary): focus passes over it. */
  panelFocusable?: boolean;
  timeline?: string;
  bar: string[];
};

/** The last focused control in each row, so the opposite arrow returns to it. */
export type TVFocusMemory = { top?: string; bar?: string };

/**
 * Remote arrows move one row or one control at a time, in screen order, like
 * other TV players: top row, open Robots content, timeline, then the button
 * row. Rows do not wrap; an edge keeps focus where it is.
 */
export function tvFocusLinks(id: string, layout: TVFocusLayout, memory: TVFocusMemory = {}): TVFocusLinks {
  const { top, openTab, timeline, bar } = layout;
  const topEntry = openTab ?? tvFocusEntry(top, memory.top);
  const barEntry = tvFocusEntry(bar, memory.bar);
  const content = !!openTab && layout.panelFocusable !== false;
  const topIndex = top.indexOf(id);
  if (topIndex >= 0) {
    // With a workflow open, any top-row control is (or is becoming) its tab.
    return { up: id, down: content ? TV_PANEL_ENTRY_FOCUS : timeline ?? barEntry ?? id,
      left: top[topIndex - 1] ?? id, right: top[topIndex + 1] ?? id };
  }
  // Left/Right scrub on the timeline instead of moving focus.
  if (id === timeline) return { up: content ? TV_PANEL_FOCUS : topEntry ?? id, down: barEntry ?? id, left: id, right: id };
  const barIndex = bar.indexOf(id);
  if (barIndex >= 0) {
    return { up: timeline ?? (content ? TV_PANEL_FOCUS : topEntry) ?? id, down: id,
      left: bar[barIndex - 1] ?? id, right: bar[barIndex + 1] ?? id };
  }
  return {};
}

/** Where focus enters a row: its last focused control while still present, else its first. */
export function tvFocusEntry(row: string[], last?: string): string | undefined {
  return last && row.includes(last) ? last : row[0];
}

/** RN Android defaults to up-only taps, but hosts may enable key-down events. */
export class TVRemoteInput {
  private pressed = new Map<string, number>();
  private stepped = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  reset() { this.pressed.clear(); this.stepped.clear(); }

  /** How long the event's key has been held, from its first key-down; 0 once released. */
  heldMs(eventType: string): number {
    const since = this.pressed.get(keyFor(eventType));
    return since === undefined ? 0 : this.now() - since;
  }

  action(event: { eventType: string; eventKeyAction?: number }, panel: TVControlsPanel,
    focus: TVRemoteFocus, platform: 'android' | 'ios'): TVRemoteAction | null {
    if (platform === 'ios') return tvRemoteAction(event, panel, focus, platform);
    const isLong = event.eventType.startsWith('long');
    const key = keyFor(event.eventType);
    if (event.eventKeyAction === 0) {
      const repeating = this.pressed.has(key);
      if (!repeating) this.pressed.set(key, this.now());
      // A held Play/Pause must not rapidly flip intent; relative seek repeats
      // still accumulate when the host enables down events.
      if (repeating && !['left', 'right', 'rewind', 'fastForward'].includes(key)) return null;
      // Remote auto-repeat arrives about every 50ms; pace it like the tvOS hold.
      const at = this.now();
      if (repeating && at - (this.stepped.get(key) ?? -Infinity) < TV_HOLD_REPEAT_MS) return null;
      this.stepped.set(key, at);
    } else if (event.eventKeyAction === 1) {
      if (this.pressed.delete(key) || isLong) return null;
    } else return null;
    return tvRemoteAction({ ...event, eventKeyAction: 0 }, panel, focus, 'android');
  }
}

export function tvSettingsSections(settings: boolean | { speed?: boolean; quality?: boolean }) {
  return {
    speed: settings !== false && (settings === true || settings.speed !== false),
    quality: settings !== false && (settings === true || settings.quality !== false),
  };
}

export function tvQualityOptions(minResolution?: string): MuxMaxResolution[] {
  const minimum = Number.parseInt(minResolution ?? '', 10);
  return TV_QUALITIES.filter(quality => !Number.isFinite(minimum) || Number.parseInt(quality, 10) >= minimum);
}

function keyFor(eventType: string): string {
  const suffix = eventType.startsWith('long') ? eventType.slice(4) : eventType;
  return suffix.charAt(0).toLowerCase() + suffix.slice(1);
}

function finite(value: number | undefined, fallback = 0): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}
