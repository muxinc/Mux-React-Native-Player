import { describe, expect, it, vi } from 'vitest';
import { normalizeRobotsContent, robotsContext, robotsInput, RobotsRequestCache, robotsSeekTarget, seekRobotsRow } from '../src/tv/robotsState';
import type { MuxPlayerStatus, NormalizedMuxVideoSource } from '../src/types';

const status: MuxPlayerStatus = { status: 'playing', currentTime: 4, duration: 120, bufferedPosition: 20, muted: false, volume: 1, loop: false, playbackRate: 1, sourceId: 'source-a', playbackId: 'public-id' };
const source: NormalizedMuxVideoSource = { playbackId: 'public-id', sourceId: 'source-a', renditionOrder: 'default', assetId: 'asset-a' };
const context = { assetId: 'asset-a', currentTime: 4, duration: 120 };
const summary = { title: 'A film', description: 'A short description.' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('TV Robots content and request lifecycle', () => {
  it('maps all supplied content and callback shapes, including explicitly empty content', () => {
    const onTranscribe = vi.fn();
    const robots = { summary, chapters: [], keyMoments: [{ startTime: 5, endTime: 8, title: 'Moment' }], transcript: { cues: [] }, onTranscribe };
    expect(robotsInput('summary', robots).provided).toBe(summary);
    expect(robotsInput('chapters', robots).provided).toEqual([]);
    expect(robotsInput('moments', robots).provided).toBe(robots.keyMoments);
    expect(robotsInput('transcript', robots)).toEqual({ provided: robots.transcript, generate: onTranscribe });
    expect(normalizeRobotsContent('transcript', robots.transcript).rows).toEqual([]);
  });

  it('loads on demand, deduplicates pending loads and retains a ready result on reopen', async () => {
    const cache = new RobotsRequestCache();
    const pending = deferred<typeof summary>();
    const generate = vi.fn(() => pending.promise);
    const changes = vi.fn();
    const unsubscribe = cache.subscribe(changes);
    const request = cache.request('summary', generate, context);
    expect(cache.getSnapshot().summary.phase).toBe('loading');
    await cache.request('summary', generate, context);
    pending.resolve(summary);
    await request;
    await cache.request('summary', generate, context);
    expect(generate).toHaveBeenCalledExactlyOnceWith(context);
    expect(cache.getSnapshot().summary).toMatchObject({ phase: 'ready', content: summary });
    expect(changes).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('keeps empty generated content ready instead of generating repeatedly', async () => {
    const cache = new RobotsRequestCache();
    const generate = vi.fn(async () => []);
    await cache.request('chapters', generate, context);
    await cache.request('chapters', generate, context);
    expect(generate).toHaveBeenCalledOnce();
    expect(cache.getSnapshot().chapters).toEqual({ phase: 'ready', content: { rows: [] } });
  });

  it('discards completions after source/asset disposal or unmount and permits effect replay', async () => {
    const cache = new RobotsRequestCache();
    const pending = deferred<typeof summary>();
    const request = cache.request('summary', () => pending.promise, context);
    cache.cancelPending();
    await cache.request('summary', async () => ({ ...summary, title: 'New generation' }), { ...context, assetId: 'asset-b' });
    pending.resolve(summary);
    await request;
    expect(cache.getSnapshot().summary).toMatchObject({ phase: 'ready', content: { title: 'New generation' } });
  });

  it('does not retain backend errors or credentials, and retries only when requested', async () => {
    const cache = new RobotsRequestCache();
    const generate = vi.fn(async () => { throw new Error('Bearer secret.jwt; https://backend/private'); });
    await cache.request('summary', generate, context);
    expect(cache.getSnapshot().summary).toEqual({ phase: 'error' });
    await cache.request('summary', generate, context);
    expect(generate).toHaveBeenCalledOnce();
    await cache.request('summary', async () => summary, context, true);
    expect(cache.getSnapshot().summary.phase).toBe('ready');
  });

  it('contains synchronous callback throws and malformed callback payloads', async () => {
    const cache = new RobotsRequestCache();
    await cache.request('summary', () => { throw 'private exception'; }, context);
    expect(cache.getSnapshot().summary).toEqual({ phase: 'error' });
    await cache.request('summary', async () => ({ error: 'private backend body' }), context, true);
    expect(cache.getSnapshot().summary).toEqual({ phase: 'error' });
  });

  it('ignores an older request that resolves after its retry and isolates panel caches', async () => {
    const cache = new RobotsRequestCache();
    const old = deferred<typeof summary>();
    const request = cache.request('summary', () => old.promise, context);
    await cache.request('summary', async () => ({ ...summary, title: 'Retry' }), context, true);
    await cache.request('chapters', async () => [{ title: 'Chapter', startTime: 0 }], context);
    old.reject(new Error('Old request'));
    await request;
    expect(cache.getSnapshot().summary).toMatchObject({ phase: 'ready', content: { title: 'Retry' } });
    expect(cache.getSnapshot().chapters.phase).toBe('ready');
  });

  it('preserves readable rows with invalid timing but excludes malformed text entries', () => {
    const normalized = normalizeRobotsContent('moments', [null, { title: {} }, { title: ' No time ' }, { title: 'Good', startTime: 1, endTime: 2 }]);
    expect(normalized.rows).toHaveLength(2);
    expect(normalized.rows[0].title).toBe('No time');
    expect(robotsSeekTarget(normalized.rows[0], status)).toBeNull();
    expect(robotsSeekTarget(normalized.rows[1], status)).toBe(1);
    const transcript = normalizeRobotsContent('transcript', { cues: [{ text: 'Hello', speaker: 'Narrator', startTime: 3 }] });
    expect(transcript.rows[0]).toEqual({ title: 'Hello', detail: 'Narrator', startTime: 3, endTime: undefined });
  });

  it('passes only finite playback context and the asset ID to generation callbacks', () => {
    expect(robotsContext('asset-a', { ...status, duration: Infinity, currentTime: NaN })).toEqual({ assetId: 'asset-a', duration: 0, currentTime: 0 });
    expect(robotsContext('asset-a', status)).toEqual(context);
  });
});

describe('TV Robots timed navigation', () => {
  const row = { title: 'Chapter', startTime: 20 };
  it('accepts VOD boundaries and rejects malformed or out-of-range targets', () => {
    for (const time of [0, 20, 120]) expect(robotsSeekTarget({ ...row, startTime: time }, status, source)).toBe(time);
    for (const time of [NaN, Infinity, -1, 121]) expect(robotsSeekTarget({ ...row, startTime: time }, status, source)).toBeNull();
    for (const endTime of [NaN, Infinity, 19]) expect(robotsSeekTarget({ ...row, endTime }, status)).toBeNull();
    expect(robotsSeekTarget({ ...row, endTime: 20 }, status)).toBe(20);
  });

  it('rejects unknown duration, inactive playback and obsolete source events', () => {
    for (const duration of [0, -1, NaN, Infinity]) expect(robotsSeekTarget(row, { ...status, duration })).toBeNull();
    for (const state of ['idle', 'loading', 'error'] as const) expect(robotsSeekTarget(row, { ...status, status: state })).toBeNull();
    expect(robotsSeekTarget(row, { ...status, sourceId: 'old-source' }, source)).toBeNull();
    expect(robotsSeekTarget(row, { ...status, playbackId: 'old-playback' }, source)).toBeNull();
  });

  it('requires a known live DVR window and rejects expired cues', () => {
    const live = { ...status, isLive: true, duration: Infinity, seekableStart: 40, seekableEnd: 80 };
    expect(robotsSeekTarget(row, live)).toBeNull();
    expect(robotsSeekTarget({ ...row, startTime: 40 }, live)).toBe(40);
    expect(robotsSeekTarget({ ...row, startTime: 80 }, live)).toBe(80);
    expect(robotsSeekTarget({ ...row, startTime: 81 }, live)).toBeNull();
    expect(robotsSeekTarget(row, { ...live, seekableStart: undefined })).toBeNull();
    expect(robotsSeekTarget(row, { ...live, seekableEnd: undefined })).toBeNull();
    expect(robotsSeekTarget(row, { ...live, seekableEnd: 30 })).toBeNull();
  });

  it('never issues an invalid seek and only reports success after native completion', async () => {
    const done = deferred<void>();
    const seek = vi.fn(() => done.promise);
    expect(await seekRobotsRow({ ...row, startTime: NaN }, status, source, seek, () => true)).toBe('unavailable');
    expect(seek).not.toHaveBeenCalled();
    const request = seekRobotsRow(row, status, source, seek, () => true);
    expect(seek).toHaveBeenCalledExactlyOnceWith(20);
    done.resolve();
    expect(await request).toBe('seeked');
  });

  it('does not close a replaced source/unmounted panel and safely contains rejected seeks', async () => {
    let current = true;
    const done = deferred<void>();
    const request = seekRobotsRow(row, status, source, () => done.promise, () => current);
    current = false;
    done.resolve();
    expect(await request).toBe('stale');
    const seek = vi.fn(async () => { throw new Error('private native error'); });
    expect(await seekRobotsRow(row, status, source, seek, () => false)).toBe('stale');
    expect(seek).not.toHaveBeenCalled();
    expect(await seekRobotsRow(row, status, source, seek, () => true)).toBe('error');
  });
});
