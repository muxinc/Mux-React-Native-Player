import { describe, expect, it, vi } from 'vitest';

import { MuxVideoPlayer } from '../src/MuxVideoPlayer';
import type { MuxNativeViewRef } from '../src/types';

function createNativeRef(overrides: Partial<MuxNativeViewRef> = {}): MuxNativeViewRef {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    replay: vi.fn().mockResolvedValue(undefined),
    seekBy: vi.fn().mockResolvedValue(undefined),
    seekTo: vi.fn().mockResolvedValue(undefined),
    seekToLive: vi.fn().mockResolvedValue(undefined),
    setMuted: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setLoop: vi.fn().mockResolvedValue(undefined),
    setPlaybackRate: vi.fn().mockResolvedValue(undefined),
    setCaptionTrack: vi.fn().mockResolvedValue(undefined),
    setAudioTrack: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MuxVideoPlayer', () => {
  it('rejects an initial paused event queued before an asynchronous play request', async () => {
    const player = new MuxVideoPlayer('video');
    const initial = player._getSnapshot();
    await player.play();
    const playingIntent = player._getSnapshot();
    player._handleStatusChange({ ...initial.status, status: 'paused', playWhenReady: false, playbackIntentRevision: initial.playbackIntentRevision });
    expect(player._getSnapshot()).toBe(playingIntent);
    player._handleStatusChange({ ...initial.status, status: 'playing', playWhenReady: true, playbackIntentRevision: playingIntent.playbackIntentRevision });
    expect(player.status).toBe('playing');
    // A native remote pause at the acknowledged revision is still authoritative.
    player._handleStatusChange({ ...initial.status, status: 'paused', playWhenReady: false, playbackIntentRevision: playingIntent.playbackIntentRevision });
    expect(player._getSnapshot().shouldPlay).toBe(false);
  });

  it('keeps a newer pause command from being overwritten by an earlier playing event', async () => {
    const player = new MuxVideoPlayer('video');
    await player.play();
    const old = player._getSnapshot();
    await player.pause();
    const pausedIntent = player._getSnapshot();
    player._handleStatusChange({ ...old.status, status: 'playing', playWhenReady: true, playbackIntentRevision: old.playbackIntentRevision });
    expect(player._getSnapshot()).toBe(pausedIntent);
  });

  it('keeps identical replacement idempotent so native first-frame state remains valid', () => {
    const player = new MuxVideoPlayer({ playbackId: 'same', metadata: { videoId: 'id', videoTitle: 'title' } });
    player._handleSourceLoad({ playbackId: 'same', duration: 100 });
    const before = player._getSnapshot();
    player.replace({ metadata: { videoTitle: 'title', videoId: 'id' }, playbackId: 'same' });
    expect(player._getSnapshot()).toBe(before);
  });

  it('rejects queued events across token refresh for the same playback ID', () => {
    const player = new MuxVideoPlayer({ playbackId: 'same', playbackToken: 'old' });
    const oldSource = player._getSnapshot().source!;
    player.replace({ playbackId: 'same', playbackToken: 'new' });
    const current = player._getSnapshot();
    expect(current.source?.sourceId).not.toBe(oldSource.sourceId);
    expect(current.source?.sourceId).not.toContain('new');
    player._handleSourceError({ playbackId: 'same', sourceId: oldSource.sourceId, message: 'expired' });
    player._handleSourceLoad({ playbackId: 'same', sourceId: oldSource.sourceId, duration: 200 });
    player._handleStatusChange({ ...current.status, playbackId: 'same', sourceId: oldSource.sourceId, status: 'error' });
    expect(player._getSnapshot()).toBe(current);
    expect(player._isCurrentSourceEvent({ playbackId: 'same', sourceId: oldSource.sourceId })).toBe(false);
    expect(player._isCurrentSourceEvent({ playbackId: 'same', sourceId: current.source?.sourceId })).toBe(true);
    expect(player._isCurrentSourceEvent({ playbackId: '' })).toBe(false);
  });

  it('keeps remote pause intent when replacing the source', async () => {
    const player = new MuxVideoPlayer('first');
    await player.play();
    player._handleStatusChange({ ...player._getSnapshot().status, status: 'paused' });
    player.replace('second');
    expect(player._getSnapshot().shouldPlay).toBe(false);
  });

  it('preserves explicit native playback intent through a lifecycle suspension', async () => {
    const player = new MuxVideoPlayer('first');
    await player.play();
    player._handleStatusChange({ ...player._getSnapshot().status, status: 'paused', playWhenReady: true });
    expect(player._getSnapshot().shouldPlay).toBe(true);
    player._handleStatusChange({ ...player._getSnapshot().status, status: 'paused', playWhenReady: false });
    expect(player._getSnapshot().shouldPlay).toBe(false);
  });

  it('does not replay queued seeks or release an unrelated player on a later mount', async () => {
    const player = new MuxVideoPlayer('first');
    await player.seekTo(100);
    await player.release();
    player.replace('second');
    const ref = createNativeRef();
    player._attachNativeRef(ref);
    expect(ref.seekTo).not.toHaveBeenCalled();
    expect(ref.release).not.toHaveBeenCalled();
  });

  it('ignores source events from replaced and released native items', async () => {
    const player = new MuxVideoPlayer('first');
    player.replace('second');
    player._handleSourceLoad({ playbackId: 'first', duration: 99 });
    player._handleSourceError({ playbackId: 'first', message: 'old error' });
    player._handleTimeUpdate({ playbackId: 'first', currentTime: 98, duration: 99, bufferedPosition: 99 });
    expect(player.status).toBe('loading');
    expect(player.currentTime).toBe(0);
    expect(player.error).toBeUndefined();
    await player.release();
    player._handleStatusChange({ ...player._getSnapshot().status, status: 'playing' });
    player._handleSourceLoad({ playbackId: 'second', duration: 50 });
    expect(player.status).toBe('idle');
    expect(player._getSnapshot().shouldPlay).toBe(false);
  });

  it('publishes playback intent when play is requested', async () => {
    const player = new MuxVideoPlayer('abc123');
    const nativeRef = createNativeRef();
    const listener = vi.fn();

    player._attachNativeRef(nativeRef);
    player._subscribe(listener);

    await player.play();

    expect(player._getSnapshot().shouldPlay).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(nativeRef.play).toHaveBeenCalledOnce();
  });

  it('keeps queued playback intent in the snapshot before native attach', async () => {
    const player = new MuxVideoPlayer('abc123');
    const nativeRef = createNativeRef();

    await player.play();

    expect(player._getSnapshot().shouldPlay).toBe(true);

    player._attachNativeRef(nativeRef);

    expect(nativeRef.play).toHaveBeenCalledOnce();
  });

  it('caps resolution on the active source and resumes from position', () => {
    const player = new MuxVideoPlayer('abc123');
    player._handleSourceLoad({ playbackId: 'abc123', duration: 100 });
    player._handleTimeUpdate({ currentTime: 42, duration: 100, bufferedPosition: 50 });

    player.setMaxResolution('720p');

    const snapshot = player._getSnapshot();
    expect(snapshot.source?.maxResolution).toBe('720p');
    expect(snapshot.status.status).toBe('loading');

    // Reloading the capped source seeks back to the prior position.
    const seekTo = vi.fn().mockResolvedValue(undefined);
    player._attachNativeRef(createNativeRef({ seekTo }));
    player._handleSourceLoad({ playbackId: 'abc123', duration: 100 });
    expect(seekTo).toHaveBeenCalledWith(42);
  });

  it('ignores setMaxResolution when value is unchanged', () => {
    const player = new MuxVideoPlayer({ playbackId: 'abc123', maxResolution: '1080p' });
    const listener = vi.fn();
    player._subscribe(listener);

    player.setMaxResolution('1080p');

    expect(listener).not.toHaveBeenCalled();
    expect(player.maxResolution).toBe('1080p');
  });

  it('reflects live status and forwards seekToLive to the native ref', async () => {
    const player = new MuxVideoPlayer('abc123');
    const seekToLive = vi.fn().mockResolvedValue(undefined);
    player._attachNativeRef(createNativeRef({ seekToLive }));

    expect(player.isLive).toBe(false);
    player._handleStatusChange({
      status: 'playing',
      currentTime: 95,
      duration: 0,
      bufferedPosition: 95,
      muted: false,
      volume: 1,
      loop: false,
      playbackRate: 1,
      isLive: true,
      seekableStart: 0,
      seekableEnd: 100,
    });
    expect(player.isLive).toBe(true);
    expect(player._getSnapshot().status.seekableEnd).toBe(100);

    await player.seekToLiveEdge();
    expect(seekToLive).toHaveBeenCalledOnce();
  });

  it('updates caption selection and forwards native command', async () => {
    const player = new MuxVideoPlayer('abc123');
    const nativeRef = createNativeRef();
    const listener = vi.fn();

    player._attachNativeRef(nativeRef);
    player._subscribe(listener);

    await player.setCaptionTrack('0');
    await player.setCaptionTrack(null);

    expect(player._getSnapshot().status.selectedCaptionTrackId).toBeNull();
    expect(listener).toHaveBeenCalled();
    expect(nativeRef.setCaptionTrack).toHaveBeenNthCalledWith(1, '0');
    expect(nativeRef.setCaptionTrack).toHaveBeenNthCalledWith(2, null);
  });
});
