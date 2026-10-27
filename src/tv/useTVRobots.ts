import * as React from 'react';
import type { MuxPlayerStatus, MuxVideoRobotsConfig, NormalizedMuxVideoSource } from '../types';
import { normalizeRobotsContent, robotsContext, robotsInput, RobotsRequestCache, type RobotsResult, type TVRobotsPanel } from './robotsState';

export function useTVRobots(panel: TVRobotsPanel | null, source: NormalizedMuxVideoSource | undefined, robots: MuxVideoRobotsConfig | undefined, status: MuxPlayerStatus) {
  const assetId = robots?.assetId ?? source?.assetId;
  const enabled = robots?.enabled !== false;
  // sourceId changes for replacements (including signed-token replacements).
  // Object identity is the conservative fallback for callers without sourceId.
  const identity = source?.sourceId ?? source;
  const cache = React.useMemo(() => new RobotsRequestCache(), [identity, assetId, enabled]);
  const snapshot = React.useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const input = panel ? robotsInput(panel, robots) : undefined;
  const provided = input?.provided;
  const generate = input?.generate;
  const context = React.useRef(status);
  context.current = status;
  React.useEffect(() => () => cache.cancelPending(), [cache]);
  React.useEffect(() => {
    if (enabled && panel && provided === undefined && assetId && generate) {
      void cache.request(panel, generate, robotsContext(assetId, context.current));
    }
  }, [cache, enabled, panel, provided, assetId, generate]);
  const supplied = React.useMemo<RobotsResult | undefined>(() => {
    if (!panel || provided === undefined) return undefined;
    try { return { phase: 'ready', content: normalizeRobotsContent(panel, provided) }; }
    catch { return { phase: 'error' }; }
  }, [panel, provided]);
  const retry = React.useCallback(() => {
    if (enabled && panel && provided === undefined && assetId && generate) {
      void cache.request(panel, generate, robotsContext(assetId, context.current), true);
    }
  }, [cache, enabled, panel, provided, assetId, generate]);
  return {
    // Expose cache identity to guard an in-flight seek after source replacement.
    generation: cache,
    result: enabled && panel ? supplied ?? snapshot[panel] : { phase: 'idle' } as RobotsResult,
    // Generated results for every panel, so the timeline can mark chapters and moments.
    snapshot,
    canGenerate: enabled && provided === undefined && Boolean(assetId && generate),
    enabled,
    retry,
  };
}
