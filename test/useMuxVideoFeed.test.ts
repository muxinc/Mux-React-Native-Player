import { describe, expect, it } from 'vitest';

import { muxFeedWindow } from '../src/useMuxVideoFeed';

describe('muxFeedWindow', () => {
  it('returns an empty range for an empty list', () => {
    expect(muxFeedWindow(0, 0, 1, 1)).toEqual({ start: 0, end: -1 });
  });

  it('windows around the active index', () => {
    expect(muxFeedWindow(5, 20, 1, 2)).toEqual({ start: 4, end: 7 });
  });

  it('clamps to the start of the list', () => {
    expect(muxFeedWindow(0, 20, 2, 2)).toEqual({ start: 0, end: 2 });
  });

  it('clamps to the end of the list', () => {
    expect(muxFeedWindow(19, 20, 2, 2)).toEqual({ start: 17, end: 19 });
  });

  it('clamps an out-of-range active index', () => {
    expect(muxFeedWindow(99, 5, 1, 1)).toEqual({ start: 3, end: 4 });
    expect(muxFeedWindow(-3, 5, 1, 1)).toEqual({ start: 0, end: 1 });
  });

  it('treats negative preload counts as zero', () => {
    expect(muxFeedWindow(5, 20, -5, -5)).toEqual({ start: 5, end: 5 });
  });

  it('bounds the window size to preloadBehind + preloadAhead + 1', () => {
    const { start, end } = muxFeedWindow(10, 100, 2, 3);
    expect(end - start + 1).toBe(6);
  });
});
