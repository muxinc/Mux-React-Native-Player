import type { MuxVideoControls } from './types';

/** Explicit controls selection is preserved across phone and TV presentations. */
export function resolveMuxControls(
  controls: MuxVideoControls | undefined,
  nativeControls: boolean,
  _isTV: boolean
): MuxVideoControls {
  return controls ?? (nativeControls ? 'native' : 'none');
}
