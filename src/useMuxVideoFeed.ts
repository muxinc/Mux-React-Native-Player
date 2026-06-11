import * as React from 'react';

import { createMuxVideoPlayer, MuxVideoPlayer } from './MuxVideoPlayer';
import type { MuxVideoSource } from './types';

export type MuxVideoFeedOptions = {
  /** How many items after the active index to preload. Default 1. */
  preloadAhead?: number;
  /** How many items before the active index to keep alive. Default 1. */
  preloadBehind?: number;
  /** Mute the active item too. Off-screen items are always muted. Default false. */
  muted?: boolean;
  /** Auto-play the active item. Default true. */
  autoplay?: boolean;
  /** Loop every feed item. Default true. */
  loop?: boolean;
};

export type MuxVideoFeedWindow = { start: number; end: number };

/**
 * Pure helper: the inclusive index range of players to keep alive around
 * `activeIndex`. Returns an empty range (`end < start`) for an empty list.
 */
export function muxFeedWindow(
  activeIndex: number,
  length: number,
  preloadBehind: number,
  preloadAhead: number
): MuxVideoFeedWindow {
  if (length <= 0) {
    return { start: 0, end: -1 };
  }
  const active = Math.max(0, Math.min(length - 1, activeIndex));
  const start = Math.max(0, active - Math.max(0, preloadBehind));
  const end = Math.min(length - 1, active + Math.max(0, preloadAhead));
  return { start, end };
}

export type MuxVideoFeed = {
  getPlayer: (index: number) => MuxVideoPlayer | null;
  window: MuxVideoFeedWindow;
  activeIndex: number;
};

/**
 * Manage a sliding window of `MuxVideoPlayer` instances for a vertical feed.
 * Players within the window are created and configured (mute/loop/play);
 * players that scroll out of the window are released, so native memory stays
 * bounded no matter how long the list is.
 */
export function useMuxVideoFeed(
  sources: MuxVideoSource[],
  activeIndex: number,
  options: MuxVideoFeedOptions = {}
): MuxVideoFeed {
  const {
    preloadAhead = 1,
    preloadBehind = 1,
    muted = false,
    autoplay = true,
    loop = true,
  } = options;

  const playersRef = React.useRef<Map<number, MuxVideoPlayer>>(new Map());
  const [, bump] = React.useReducer((count: number) => count + 1, 0);

  const sourcesKey = React.useMemo(() => sources.map(feedSourceKey).join('|'), [sources]);
  const window = muxFeedWindow(activeIndex, sources.length, preloadBehind, preloadAhead);
  const { start: windowStart, end: windowEnd } = window;

  React.useEffect(() => {
    const players = playersRef.current;

    // Release players outside the window — keeps native memory bounded.
    for (const [index, player] of Array.from(players.entries())) {
      if (index < windowStart || index > windowEnd || index >= sources.length) {
        runFeedCommand(player.release());
        players.delete(index);
      }
    }

    // Create + configure players inside the window.
    for (let index = windowStart; index <= windowEnd; index += 1) {
      let player = players.get(index);
      if (!player) {
        player = createMuxVideoPlayer(sources[index]);
        players.set(index, player);
      }
      runFeedCommand(player.setMuted(index === activeIndex ? muted : true));
      runFeedCommand(player.setLoop(loop));
      if (index === activeIndex && autoplay) {
        runFeedCommand(player.play());
      } else {
        runFeedCommand(player.pause());
      }
    }

    bump();
    // `sources` is referenced via sourcesKey + length to stay stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, autoplay, loop, muted, sourcesKey, windowStart, windowEnd, sources.length]);

  React.useEffect(() => {
    const players = playersRef.current;
    return () => {
      for (const player of players.values()) {
        runFeedCommand(player.release());
      }
      players.clear();
    };
  }, []);

  const getPlayer = React.useCallback(
    (index: number) => playersRef.current.get(index) ?? null,
    []
  );

  return { getPlayer, window, activeIndex };
}

function feedSourceKey(source: MuxVideoSource): string {
  if (typeof source === 'string') {
    return source;
  }
  return [source.playbackId, source.playbackToken ?? '', source.maxResolution ?? ''].join(':');
}

function runFeedCommand(command: Promise<void>): void {
  command.catch(() => {
    // Feed rows can unmount while player commands are still settling.
  });
}
