import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOptionalNativeModule = vi.fn();

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => requireOptionalNativeModule(name),
}));

function createNativeModule() {
  return {
    preload: vi.fn().mockResolvedValue(undefined),
    cancelPreload: vi.fn().mockResolvedValue(undefined),
    cancelAllPreloads: vi.fn().mockResolvedValue(undefined),
  };
}

async function loadPreloadModule() {
  // The module caches the native module lookup, so each test re-imports fresh.
  vi.resetModules();
  return import('../src/preload');
}

describe('preloadMuxVideo', () => {
  beforeEach(() => {
    requireOptionalNativeModule.mockReset();
  });

  it('normalizes the source and forwards it with the default buffer target', async () => {
    const nativeModule = createNativeModule();
    requireOptionalNativeModule.mockReturnValue(nativeModule);
    const { preloadMuxVideo } = await loadPreloadModule();

    await preloadMuxVideo(' abc123 ');

    expect(nativeModule.preload).toHaveBeenCalledTimes(1);
    const [source, bufferAheadSeconds] = nativeModule.preload.mock.calls[0];
    expect(source.playbackId).toBe('abc123');
    expect(source.renditionOrder).toBe('default');
    expect(bufferAheadSeconds).toBe(5);
  });

  it('clamps the requested buffer target', async () => {
    const nativeModule = createNativeModule();
    requireOptionalNativeModule.mockReturnValue(nativeModule);
    const { preloadMuxVideo } = await loadPreloadModule();

    await preloadMuxVideo('abc123', { bufferAheadSeconds: 120 });
    await preloadMuxVideo('def456', { bufferAheadSeconds: -3 });

    expect(nativeModule.preload.mock.calls[0][1]).toBe(30);
    expect(nativeModule.preload.mock.calls[1][1]).toBe(5);
  });

  it('never preloads DRM sources', async () => {
    const nativeModule = createNativeModule();
    requireOptionalNativeModule.mockReturnValue(nativeModule);
    const { preloadMuxVideo } = await loadPreloadModule();

    await preloadMuxVideo({
      playbackId: 'abc123',
      playbackToken: 'playback-token',
      drmToken: 'drm-token',
    });

    expect(nativeModule.preload).not.toHaveBeenCalled();
  });

  it('resolves without error when the native module is missing', async () => {
    requireOptionalNativeModule.mockReturnValue(null);
    const { preloadMuxVideo, cancelMuxVideoPreload, cancelAllMuxVideoPreloads } =
      await loadPreloadModule();

    await expect(preloadMuxVideo('abc123')).resolves.toBeUndefined();
    await expect(cancelMuxVideoPreload('abc123')).resolves.toBeUndefined();
    await expect(cancelAllMuxVideoPreloads()).resolves.toBeUndefined();
  });

  it('swallows native rejections — preload is best-effort', async () => {
    const nativeModule = createNativeModule();
    nativeModule.preload.mockRejectedValue(new Error('native failure'));
    requireOptionalNativeModule.mockReturnValue(nativeModule);
    const { preloadMuxVideo } = await loadPreloadModule();

    await expect(preloadMuxVideo('abc123')).resolves.toBeUndefined();
  });
});

describe('isMuxVideoPreloadSupported', () => {
  beforeEach(() => {
    requireOptionalNativeModule.mockReset();
  });

  it('is true only when the native module exposes preload', async () => {
    requireOptionalNativeModule.mockReturnValue(createNativeModule());
    const withModule = await loadPreloadModule();
    expect(withModule.isMuxVideoPreloadSupported()).toBe(true);

    requireOptionalNativeModule.mockReturnValue({});
    const withoutPreload = await loadPreloadModule();
    expect(withoutPreload.isMuxVideoPreloadSupported()).toBe(false);

    requireOptionalNativeModule.mockReturnValue(null);
    const withoutModule = await loadPreloadModule();
    expect(withoutModule.isMuxVideoPreloadSupported()).toBe(false);
  });
});

describe('cancelMuxVideoPreload', () => {
  beforeEach(() => {
    requireOptionalNativeModule.mockReset();
  });

  it('forwards the playback ID to the native module', async () => {
    const nativeModule = createNativeModule();
    requireOptionalNativeModule.mockReturnValue(nativeModule);
    const { cancelMuxVideoPreload, cancelAllMuxVideoPreloads } = await loadPreloadModule();

    await cancelMuxVideoPreload('abc123');
    await cancelAllMuxVideoPreloads();

    expect(nativeModule.cancelPreload).toHaveBeenCalledWith('abc123');
    expect(nativeModule.cancelAllPreloads).toHaveBeenCalledTimes(1);
  });
});
