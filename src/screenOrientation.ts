import { requireOptionalNativeModule } from 'expo-modules-core';

type MuxReactNativePlayerModule = {
  lockFullscreenLandscape?: () => Promise<void>;
  unlockFullscreenOrientation?: () => Promise<void>;
};

let cached: MuxReactNativePlayerModule | null | undefined;

function loadModule(): MuxReactNativePlayerModule | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    cached = requireOptionalNativeModule(
      'MuxReactNativePlayer'
    ) as MuxReactNativePlayerModule | null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function lockOrientationLandscape(): Promise<void> {
  const mod = loadModule();
  if (!mod) {
    return;
  }
  try {
    await mod.lockFullscreenLandscape?.();
  } catch {
    // Locking can fail on devices that don't support orientation changes.
  }
}

export async function unlockOrientation(): Promise<void> {
  const mod = loadModule();
  if (!mod) {
    return;
  }
  try {
    await mod.unlockFullscreenOrientation?.();
  } catch {
    // ignore
  }
}
