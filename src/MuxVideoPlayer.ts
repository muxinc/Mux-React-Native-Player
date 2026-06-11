import type {
  MuxMaxResolution,
  MuxNativeViewRef,
  MuxPlayerStatus,
  MuxPlaybackStatus,
  MuxSourceErrorEvent,
  MuxSourceLoadEvent,
  MuxStatusChangeEvent,
  MuxTimeUpdateEvent,
  MuxVideoSource,
  NormalizedMuxVideoSource,
} from './types';
import { normalizeMuxVideoSource } from './normalizeSource';

type Listener = () => void;
type NativeCommand = keyof MuxNativeViewRef;

export type MuxVideoPlayerSnapshot = {
  source?: NormalizedMuxVideoSource;
  shouldPlay: boolean;
  muted: boolean;
  volume: number;
  loop: boolean;
  playbackRate: number;
  status: MuxPlayerStatus;
};

const idleStatus: MuxPlayerStatus = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  bufferedPosition: 0,
  muted: false,
  volume: 1,
  loop: false,
  playbackRate: 1,
  captionTracks: [],
  selectedCaptionTrackId: null,
  externalPlaybackActive: false,
  isLive: false,
  seekableStart: 0,
  seekableEnd: 0,
};

export class MuxVideoPlayer {
  private source?: NormalizedMuxVideoSource;
  private nativeRef?: MuxNativeViewRef | null;
  private listeners = new Set<Listener>();
  private pendingCommands: Array<() => Promise<void>> = [];
  private statusState: MuxPlayerStatus = { ...idleStatus };
  private snapshot: MuxVideoPlayerSnapshot = this.createSnapshot();
  private shouldPlay = false;
  private resumeAt: number | null = null;

  muted = false;
  volume = 1;
  loop = false;
  playbackRate = 1;

  constructor(source?: MuxVideoSource) {
    if (source != null) {
      this.source = normalizeMuxVideoSource(source);
      this.statusState = { ...this.statusState, status: 'loading' };
      this.updateSnapshot();
    }
  }

  get status(): MuxPlaybackStatus {
    return this.statusState.status;
  }

  get currentTime(): number {
    return this.statusState.currentTime;
  }

  get duration(): number {
    return this.statusState.duration;
  }

  get bufferedPosition(): number {
    return this.statusState.bufferedPosition;
  }

  get error(): string | undefined {
    return this.statusState.error;
  }

  get isLive(): boolean {
    return this.statusState.isLive ?? false;
  }

  play(): Promise<void> {
    this.shouldPlay = true;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('play');
  }

  pause(): Promise<void> {
    this.shouldPlay = false;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('pause');
  }

  replay(): Promise<void> {
    this.shouldPlay = true;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('replay');
  }

  seekBy(seconds: number): Promise<void> {
    return this.runNativeCommand('seekBy', seconds);
  }

  seekTo(seconds: number): Promise<void> {
    return this.runNativeCommand('seekTo', seconds);
  }

  /** Seek a live stream to the current live edge. No-op for VOD. */
  seekToLiveEdge(): Promise<void> {
    this.shouldPlay = true;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('seekToLive');
  }

  setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('setMuted', muted);
  }

  setVolume(volume: number): Promise<void> {
    this.volume = clamp(volume, 0, 1);
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('setVolume', this.volume);
  }

  setLoop(loop: boolean): Promise<void> {
    this.loop = loop;
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('setLoop', loop);
  }

  setPlaybackRate(rate: number): Promise<void> {
    this.playbackRate = clamp(rate, 0.25, 4);
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('setPlaybackRate', this.playbackRate);
  }

  setCaptionTrack(trackId: string | null): Promise<void> {
    this.statusState = {
      ...this.statusState,
      selectedCaptionTrackId: trackId,
    };
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('setCaptionTrack', trackId);
  }

  get maxResolution(): MuxMaxResolution | undefined {
    return this.source?.maxResolution;
  }

  /**
   * Cap (or uncap, with `undefined`) the streaming resolution of the active
   * source. Reloads the source and resumes from the current position.
   */
  setMaxResolution(maxResolution?: MuxMaxResolution): void {
    if (!this.source || this.source.maxResolution === maxResolution) {
      return;
    }
    const resumeTime = this.statusState.currentTime;
    const next = { ...this.source, maxResolution };
    try {
      this.replace(next);
    } catch {
      // A previously-set minResolution may exceed the new cap; drop it.
      this.replace({ ...next, minResolution: undefined });
    }
    if (resumeTime > 0.5) {
      this.resumeAt = resumeTime;
    }
  }

  replace(source: MuxVideoSource): void {
    this.source = normalizeMuxVideoSource(source);
    this.resumeAt = null;
    this.statusState = { ...idleStatus, muted: this.muted, volume: this.volume, loop: this.loop, playbackRate: this.playbackRate, status: 'loading' };
    this.updateSnapshot();
    this.emitChange();
  }

  release(): Promise<void> {
    this.shouldPlay = false;
    this.source = undefined;
    this.resumeAt = null;
    this.statusState = { ...idleStatus };
    this.updateSnapshot();
    this.emitChange();
    return this.runNativeCommand('release');
  }

  _attachNativeRef(ref: MuxNativeViewRef | null): void {
    this.nativeRef = ref;
    if (!ref || this.pendingCommands.length === 0) {
      return;
    }

    const pending = this.pendingCommands.splice(0);
    for (const command of pending) {
      command().catch(() => {
        // The caller already received a resolved promise while the command was queued.
      });
    }
  }

  _subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  _getSnapshot = (): MuxVideoPlayerSnapshot => this.snapshot;

  _handleStatusChange(event: MuxStatusChangeEvent): void {
    this.statusState = {
      ...event,
      captionTracks: event.captionTracks ?? this.statusState.captionTracks ?? [],
      selectedCaptionTrackId: normalizeCaptionTrackId(
        event.selectedCaptionTrackId,
        this.statusState.selectedCaptionTrackId ?? null
      ),
      externalPlaybackActive:
        event.externalPlaybackActive ?? this.statusState.externalPlaybackActive ?? false,
      isLive: event.isLive ?? this.statusState.isLive ?? false,
      seekableStart: event.seekableStart ?? this.statusState.seekableStart ?? 0,
      seekableEnd: event.seekableEnd ?? this.statusState.seekableEnd ?? 0,
    };
    if (this.statusState.status === 'playing') {
      this.shouldPlay = true;
    } else if (this.statusState.status === 'ended' || this.statusState.status === 'idle' || this.statusState.status === 'error') {
      this.shouldPlay = false;
    }
    this.muted = this.statusState.muted;
    this.volume = this.statusState.volume;
    this.loop = this.statusState.loop;
    this.playbackRate = this.statusState.playbackRate;
    this.updateSnapshot();
    this.emitChange();
  }

  _handleTimeUpdate(event: MuxTimeUpdateEvent): void {
    this.statusState = {
      ...this.statusState,
      currentTime: event.currentTime,
      duration: event.duration,
      bufferedPosition: event.bufferedPosition,
    };
    this.updateSnapshot();
    this.emitChange();
  }

  _handleSourceLoad(event: MuxSourceLoadEvent): void {
    const resumeAt = this.resumeAt;
    this.resumeAt = null;
    this.statusState = {
      ...this.statusState,
      status: this.statusState.status === 'loading' ? 'ready' : this.statusState.status,
      duration: event.duration,
      captionTracks: event.captionTracks ?? this.statusState.captionTracks ?? [],
      selectedCaptionTrackId: normalizeCaptionTrackId(
        event.selectedCaptionTrackId,
        this.statusState.selectedCaptionTrackId ?? null
      ),
      error: undefined,
    };
    this.updateSnapshot();
    this.emitChange();

    if (resumeAt !== null && resumeAt > 0.5 && resumeAt < event.duration - 0.5) {
      this.runNativeCommand('seekTo', resumeAt).catch(() => {
        // Resume seek is best-effort; user can scrub if it fails.
      });
    }

    if (this.shouldPlay) {
      this.runNativeCommand('play').catch(() => {
        // Source load means the command is retryable through a later user action.
      });
    }
  }

  _markResumePoint(): void {
    if (this.statusState.currentTime > 0) {
      this.resumeAt = this.statusState.currentTime;
    }
  }

  _handleSourceError(event: MuxSourceErrorEvent): void {
    this.statusState = {
      ...this.statusState,
      status: 'error',
      error: event.message,
    };
    this.updateSnapshot();
    this.emitChange();
  }

  private runNativeCommand(command: NativeCommand, value?: number | boolean | string | null): Promise<void> {
    const call = () => {
      const ref = this.nativeRef;
      if (!ref) {
        return Promise.resolve();
      }
      if (typeof ref[command] !== 'function') {
        return Promise.resolve();
      }
      if (value === undefined) {
        return (ref[command] as () => Promise<void>).call(ref);
      }
      return (ref[command] as (argument: number | boolean | string | null) => Promise<void>).call(
        ref,
        value
      );
    };

    if (!this.nativeRef) {
      this.pendingCommands.push(call);
      return Promise.resolve();
    }

    return call();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private createSnapshot(): MuxVideoPlayerSnapshot {
    return {
      source: this.source,
      shouldPlay: this.shouldPlay,
      muted: this.muted,
      volume: this.volume,
      loop: this.loop,
      playbackRate: this.playbackRate,
      status: this.statusState,
    };
  }

  private updateSnapshot(): void {
    this.snapshot = this.createSnapshot();
  }
}

export function createMuxVideoPlayer(source?: MuxVideoSource): MuxVideoPlayer {
  return new MuxVideoPlayer(source);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeCaptionTrackId(
  trackId: string | null | undefined,
  fallback: string | null
): string | null {
  if (trackId === undefined) {
    return fallback;
  }
  return trackId === '' ? null : trackId;
}
