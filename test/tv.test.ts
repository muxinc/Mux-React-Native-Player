import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMuxControls } from '../src/tv';

const platform = vi.hoisted(() => ({ isTV: false }));
const native = vi.hoisted(() => ({
  lockFullscreenLandscape: vi.fn(),
  unlockFullscreenOrientation: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => native }));

describe('TV presentation policy', () => {
  beforeEach(() => { vi.clearAllMocks(); platform.isTV = false; });

  it('preserves custom, native and no-controls selection on TV', () => {
    expect(resolveMuxControls('custom', true, true)).toBe('custom');
    expect(resolveMuxControls('custom', false, true)).toBe('custom');
    expect(resolveMuxControls(undefined, true, true)).toBe('native');
    expect(resolveMuxControls('none', true, true)).toBe('none');
    expect(resolveMuxControls(undefined, false, true)).toBe('none');
    expect(resolveMuxControls('custom', false, false)).toBe('custom');
  });

  it('never calls unavailable orientation APIs on TV and preserves mobile behavior', async () => {
    const { lockOrientationLandscape, unlockOrientation } = await import('../src/screenOrientation');
    platform.isTV = true;
    await lockOrientationLandscape();
    await unlockOrientation();
    expect(native.lockFullscreenLandscape).not.toHaveBeenCalled();
    expect(native.unlockFullscreenOrientation).not.toHaveBeenCalled();
    platform.isTV = false;
    await lockOrientationLandscape();
    await unlockOrientation();
    expect(native.lockFullscreenLandscape).toHaveBeenCalledOnce();
    expect(native.unlockFullscreenOrientation).toHaveBeenCalledOnce();
  });
});
