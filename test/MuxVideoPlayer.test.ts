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
    setMuted: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setLoop: vi.fn().mockResolvedValue(undefined),
    setPlaybackRate: vi.fn().mockResolvedValue(undefined),
    setCaptionTrack: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MuxVideoPlayer', () => {
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
