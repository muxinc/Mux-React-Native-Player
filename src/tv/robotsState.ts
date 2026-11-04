import type { MuxPlayerStatus, MuxVideoRobotsConfig, MuxVideoRobotsContext, NormalizedMuxVideoSource } from '../types';

export type TVRobotsPanel = 'summary' | 'chapters' | 'moments' | 'transcript';
export type RobotsRow = { title: string; detail?: string; startTime: number; endTime?: number; score?: number };
export type RobotsContent = { title?: string; description?: string; tags?: string[]; rows: RobotsRow[] };
export type RobotsResult =
  | { phase: 'idle' | 'loading' | 'error' }
  | { phase: 'ready'; content: RobotsContent };
type Snapshot = Record<TVRobotsPanel, RobotsResult>;

export const ROBOTS_ERROR = 'Could not load this content. Please try again.';
export const ROBOTS_SEEK_ERROR = 'Could not jump to that time. Please try again.';
const idle = (): Snapshot => ({ summary: { phase: 'idle' }, chapters: { phase: 'idle' }, moments: { phase: 'idle' }, transcript: { phase: 'idle' } });
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Validate callback results at the boundary; backend exception text is never retained. */
export function normalizeRobotsContent(panel: TVRobotsPanel, value: unknown): RobotsContent {
  if (panel === 'summary') {
    if (!record(value) || typeof value.title !== 'string' || typeof value.description !== 'string') throw new Error(ROBOTS_ERROR);
    return { title: text(value.title), description: text(value.description), tags: Array.isArray(value.tags) ? value.tags.map(text).filter(Boolean) : [], rows: [] };
  }
  const entries = panel === 'transcript' && record(value) ? value.cues : value;
  if (!Array.isArray(entries)) throw new Error(ROBOTS_ERROR);
  const rows: RobotsRow[] = [];
  for (const entry of entries) {
    if (!record(entry)) continue;
    const title = text(panel === 'transcript' ? entry.text : entry.title);
    if (!title) continue;
    // Retain readable content with bad timestamps, but mark it unseekable.
    const endTime = entry.endTime === undefined && panel !== 'moments' ? undefined : typeof entry.endTime === 'number' ? entry.endTime : NaN;
    const row: RobotsRow = { title, detail: text(panel === 'transcript' ? entry.speaker : entry.description) || undefined, startTime: typeof entry.startTime === 'number' ? entry.startTime : NaN, endTime };
    if (panel === 'moments' && typeof entry.score === 'number' && Number.isFinite(entry.score)) row.score = entry.score;
    rows.push(row);
  }
  return { rows };
}

export function robotsInput(panel: TVRobotsPanel, robots?: MuxVideoRobotsConfig) {
  switch (panel) {
    case 'summary': return { provided: robots?.summary, generate: robots?.onSummarize };
    case 'chapters': return { provided: robots?.chapters, generate: robots?.onGenerateChapters };
    case 'moments': return { provided: robots?.keyMoments, generate: robots?.onFindKeyMoments };
    case 'transcript': return { provided: robots?.transcript, generate: robots?.onTranscribe };
  }
}

/** One cache per source/asset generation. Closing the panel does not discard work. */
export class RobotsRequestCache {
  private snapshot = idle();
  private generation = 0;
  private sequence: Record<TVRobotsPanel, number> = { summary: 0, chapters: 0, moments: 0, transcript: 0 };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(panel: TVRobotsPanel, result: RobotsResult) {
    this.snapshot = { ...this.snapshot, [panel]: result };
    this.listeners.forEach(listener => listener());
  }
  cancelPending() {
    this.generation++;
    // Also supports React Strict Mode's effect cleanup/setup replay.
    for (const panel of Object.keys(this.snapshot) as TVRobotsPanel[]) {
      if (this.snapshot[panel].phase === 'loading') this.set(panel, { phase: 'idle' });
    }
  }
  async request(panel: TVRobotsPanel, generate: (context: MuxVideoRobotsContext) => Promise<unknown>, context: MuxVideoRobotsContext, retry = false) {
    if (!retry && this.snapshot[panel].phase !== 'idle') return;
    const generation = this.generation;
    const sequence = ++this.sequence[panel];
    const current = () => generation === this.generation && sequence === this.sequence[panel];
    this.set(panel, { phase: 'loading' });
    try {
      const result = await generate(context);
      if (current()) this.set(panel, { phase: 'ready', content: normalizeRobotsContent(panel, result) });
    } catch {
      if (current()) this.set(panel, { phase: 'error' });
    }
  }
}

export function robotsContext(assetId: string, status: MuxPlayerStatus): MuxVideoRobotsContext {
  return { assetId, duration: Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0, currentTime: Number.isFinite(status.currentTime) && status.currentTime >= 0 ? status.currentTime : 0 };
}

/** Reject stale, malformed and expired cues rather than silently seeking elsewhere. */
export function robotsSeekTarget(row: RobotsRow, status: MuxPlayerStatus, source?: NormalizedMuxVideoSource): number | null {
  if (status.status === 'idle' || status.status === 'loading' || status.status === 'error') return null;
  if (source?.sourceId && status.sourceId && source.sourceId !== status.sourceId) return null;
  if (source && status.playbackId && source.playbackId !== status.playbackId) return null;
  const target = row.startTime;
  if (!Number.isFinite(target) || target < 0) return null;
  if (row.endTime !== undefined && (!Number.isFinite(row.endTime) || row.endTime < target)) return null;
  if (status.isLive && (status.seekableStart === undefined || status.seekableEnd === undefined)) return null;
  const start = status.seekableStart ?? 0;
  const end = status.seekableEnd ?? (status.isLive ? NaN : status.duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return target >= start && target <= end ? target : null;
}

export async function seekRobotsRow(row: RobotsRow, status: MuxPlayerStatus, source: NormalizedMuxVideoSource | undefined, seek: (seconds: number) => Promise<void>, isCurrent: () => boolean): Promise<'seeked' | 'unavailable' | 'stale' | 'error'> {
  if (!isCurrent()) return 'stale';
  const target = robotsSeekTarget(row, status, source);
  if (target === null) return 'unavailable';
  try {
    await seek(target);
    return isCurrent() ? 'seeked' : 'stale';
  } catch {
    return isCurrent() ? 'error' : 'stale';
  }
}
