import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android', isTV: true } }));

const require = createRequire(import.meta.url);
const {
  isTVConfig, configureMuxPodfile, getIosAppTargetUuid,
  addMuxIosEmbedFrameworksPhase, addMuxIosSignatureFixPhase,
  addMuxTvEmbedFrameworksPhase, createMuxTvEmbedFrameworksScript,
  addMuxTvSignatureFixPhase, createMuxTvSignatureFixScript,
} = require('../plugin/withMuxReactNativePlayer.js');

function projectFor(sdk: string) {
  const objects: any = {
    PBXNativeTarget: {
      extension: { productType: '"com.apple.product-type.app-extension"' },
      app: { productType: '"com.apple.product-type.application"', buildConfigurationList: 'list' },
    },
    XCConfigurationList: { list: { buildConfigurations: [{ value: 'debug' }] } },
    XCBuildConfiguration: { debug: { buildSettings: { SDKROOT: sdk } } },
    PBXShellScriptBuildPhase: {},
  };
  return {
    hash: { project: { objects } },
    addBuildPhase: vi.fn((_files, _type, name, target, options) => {
      objects.PBXShellScriptBuildPhase[name] = { name: `"${name}"`, target, ...options };
    }),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('example Metro library watches', () => {
  it.each([
    ['example', 'workspace'], ['example-tv', 'workspace'],
    ['example', 'packed'], ['example-tv', 'packed'],
  ])('%s watches resolved library inputs in a %s install', (example, layout) => {
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'mux-metro-watch-')));
    try {
      const appRoot = path.join(temp, 'app');
      const installedRoot = path.join(appRoot, 'node_modules/@mux/mux-react-native-player');
      const libraryRoot = layout === 'workspace' ? path.join(temp, 'library') : installedRoot;
      for (const folder of ['build', 'src', 'assets']) mkdirSync(path.join(libraryRoot, folder), { recursive: true });
      writeFileSync(path.join(libraryRoot, 'package.json'), JSON.stringify({ name: '@mux/mux-react-native-player', exports: { '.': { 'react-native': './src/index.ts', default: './build/index.js' } } }));
      writeFileSync(path.join(libraryRoot, 'build/index.js'), 'module.exports = {};');
      if (layout === 'workspace') {
        mkdirSync(path.dirname(installedRoot), { recursive: true });
        symlinkSync(libraryRoot, installedRoot, 'dir');
      }
      const appRequire = createRequire(path.join(appRoot, 'metro.config.js'));
      const defaults = { watchFolders: [appRoot, path.join(libraryRoot, 'src')], resolver: { marker: true } };
      const configRequire = Object.assign((id: string) => id === 'expo/metro-config' ? { getDefaultConfig: () => defaults } : appRequire(id), { resolve: appRequire.resolve });
      const module = { exports: {} as typeof defaults };
      runInNewContext(readFileSync(path.resolve(example, 'metro.config.js'), 'utf8'), { require: configRequire, module, __dirname: appRoot });
      expect(module.exports.watchFolders).toEqual([appRoot, path.join(libraryRoot, 'src'), path.join(libraryRoot, 'assets')]);
      expect(module.exports.resolver).toBe(defaults.resolver);
      expect(module.exports.watchFolders).not.toContain(libraryRoot);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe('TV native configuration', () => {
  it('recognizes TV intent before config-tv changes SDKROOT, in either environment spelling', () => {
    vi.stubEnv('EXPO_TV', '0');
    expect(isTVConfig({ plugins: [['@react-native-tvos/config-tv', { isTV: true }]] })).toBe(true);
    expect(isTVConfig({ plugins: ['@react-native-tvos/config-tv'] })).toBe(false);
    for (const value of ['1', 'true']) {
      vi.stubEnv('EXPO_TV', value);
      expect(isTVConfig({})).toBe(true);
    }
  });

  it('persists the TV dependency flag before any Podfile autolinking, without changing mobile', () => {
    const input = "require 'autolinking'\nplatform :ios, '16.4'\n";
    expect(configureMuxPodfile(input, false)).toBe(input);
    const output = configureMuxPodfile(input, true);
    expect(output.startsWith("ENV['RCT_BUILD_FOR_TV'] = '1'")).toBe(true);
    expect(configureMuxPodfile(output, true)).toBe(output);
    expect(configureMuxPodfile(input.replace(':ios', ':tvos'), false)).toContain("ENV['RCT_BUILD_FOR_TV'] = '1'");
  });

  it('keeps iOS framework workarounds on the application target, exactly once', () => {
    const project = projectFor('iphoneos');
    expect(getIosAppTargetUuid(project)).toBe('app');
    for (let n = 0; n < 2; n++) {
      addMuxIosEmbedFrameworksPhase(project);
      addMuxIosSignatureFixPhase(project);
    }
    expect(project.addBuildPhase).toHaveBeenCalledTimes(2);
    expect(project.addBuildPhase.mock.calls.every(call => call[3] === 'app')).toBe(true);
  });

  it('uses the TV embed phase and never adds iOS framework/signature phases to tvOS', () => {
    const project = projectFor('appletvos');
    expect(getIosAppTargetUuid(project)).toBeUndefined();
    addMuxIosEmbedFrameworksPhase(project);
    addMuxIosSignatureFixPhase(project);
    addMuxTvEmbedFrameworksPhase(project);
    addMuxTvEmbedFrameworksPhase(project);
    addMuxTvSignatureFixPhase(project);
    addMuxTvSignatureFixPhase(project);
    expect(project.addBuildPhase).toHaveBeenCalledTimes(2);
    expect(project.addBuildPhase.mock.calls[0][2]).toBe('[Mux] Embed MuxCore tvOS framework');
    expect(project.addBuildPhase.mock.calls[1][2]).toBe('[Mux] Remove duplicate tvOS xcframework signatures');
  });

  it('removes only the duplicate TV archive signature, preserving the framework, pod signature and iOS artifacts', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'mux-tv-signature-'));
    try {
      for (const name of ['MuxCore.xcframework-tvos.signature', 'MuxCore.xcframework-ios.signature', 'MuxCore.framework/MuxCore', 'MuxReactNativePlayer/MuxCore.xcframework-tvos.signature']) {
        const file = path.join(temp, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'preserve');
      }
      const run = (platform: string) => spawnSync('/bin/sh', ['-c', createMuxTvSignatureFixScript()], {
        env: { ...process.env, PLATFORM_NAME: platform, CONFIGURATION_BUILD_DIR: temp },
      });
      expect(run('iphoneos').status).toBe(0);
      expect(existsSync(path.join(temp, 'MuxCore.xcframework-tvos.signature'))).toBe(true);
      expect(run('appletvos').status).toBe(0);
      expect(existsSync(path.join(temp, 'MuxCore.xcframework-tvos.signature'))).toBe(false);
      for (const name of ['MuxCore.xcframework-ios.signature', 'MuxCore.framework/MuxCore', 'MuxReactNativePlayer/MuxCore.xcframework-tvos.signature']) {
        expect(readFileSync(path.join(temp, name), 'utf8')).toBe('preserve');
      }
      expect(run('appletvos').status).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ['appletvos', 'tvos-arm64'],
    ['appletvsimulator', 'tvos-arm64_x86_64-simulator'],
  ])('embeds the correct %s MuxCore artifact slice when no staged product exists', (platform, slice) => {
    const temp = mkdtempSync(path.join(tmpdir(), 'mux-tv-embed-'));
    try {
      const source = path.join(temp, 'SourcePackages/artifacts/stats-sdk-objc/MuxCore/MuxCore.xcframework', slice, 'MuxCore.framework');
      mkdirSync(source, { recursive: true });
      writeFileSync(path.join(source, 'MuxCore'), platform);
      const build = path.join(temp, 'Build/Products');
      mkdirSync(build, { recursive: true });
      const destination = path.join(temp, 'App');
      const result = spawnSync('/bin/bash', ['-c', createMuxTvEmbedFrameworksScript().replaceAll('\\n', '\n')], {
        env: { ...process.env, PLATFORM_NAME: platform, BUILD_DIR: build, BUILT_PRODUCTS_DIR: build, TARGET_BUILD_DIR: destination, FRAMEWORKS_FOLDER_PATH: 'Frameworks', CODE_SIGNING_ALLOWED: 'NO' },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(path.join(destination, 'Frameworks/MuxCore.framework/MuxCore'), 'utf8')).toBe(platform);
      expect(existsSync(path.join(destination, 'Frameworks/MuxCore.framework'))).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('pins one workspace RN TV alias, preserves mobile config, and explicitly disables default cleaning', () => {
    const root = require('../package.json');
    const mobile = require('../example/package.json');
    const tv = require('../example-tv/package.json');
    expect(root.devDependencies['react-native']).toBe('npm:react-native-tvos@0.86.2-0');
    expect(mobile.dependencies['react-native']).toBe(root.devDependencies['react-native']);
    expect(tv.dependencies['react-native']).toBe(root.devDependencies['react-native']);
    expect(root.overrides['react-native']).toBe('$react-native');
    expect(require('../example/app.json').expo.plugins.flat()).not.toContain('@react-native-tvos/config-tv');
    expect(tv.scripts.prebuild).toContain('--no-clean');
    expect(tv.scripts['ios:pods']).toContain('RCT_BUILD_FOR_TV=1');
    expect(tv.scripts['ios:build']).toContain('RCT_BUILD_FOR_TV=1');
    expect(require('../expo-module.config.json').platforms).toContain('tvos');
  });
});

describe('local TV fixtures', () => {
  it('offers all four supplied sample panels in custom controls and the same public video with native controls', async () => {
    vi.resetModules();
    const { videos } = await import('../example-tv/fixtures');
    const custom = videos.find(video => video.id === 'tears-of-steel');
    const native = videos.find(video => video.id === 'native-controls');
    expect(custom?.controls).toBe('custom');
    expect(custom?.robots?.summary?.title).toContain('Sample');
    expect(custom?.robots?.summary?.description).toBeTruthy();
    expect(custom?.robots?.chapters?.length).toBeGreaterThan(0);
    expect(custom?.robots?.keyMoments?.length).toBeGreaterThan(0);
    expect(custom?.robots?.transcript?.cues.length).toBeGreaterThan(0);
    for (const callback of ['onSummarize', 'onGenerateChapters', 'onFindKeyMoments', 'onTranscribe'] as const) {
      expect(custom?.robots?.[callback]).toBeUndefined();
    }
    expect(native?.controls).toBe('native');
    expect(native?.robots).toBeUndefined();
    expect(native?.source.playbackId).toBe(custom?.source.playbackId);
    expect(custom?.source.playbackToken).toBeUndefined();
    expect(native?.source.playbackToken).toBeUndefined();
  });

  it.each([
    ['', '', false],
    ['test-asset', '', false],
    ['', 'test-playback', false],
    ['test-asset', 'test-playback', true],
  ])('requires both connected Robots IDs (asset=%s, playback=%s)', async (assetId, playbackId, included) => {
    vi.stubEnv('EXPO_PUBLIC_MUX_ROBOTS_ASSET_ID', assetId);
    vi.stubEnv('EXPO_PUBLIC_MUX_ROBOTS_PLAYBACK_ID', playbackId);
    vi.resetModules();
    const { videos } = await import('../example-tv/fixtures');
    const cards = videos.filter(video => video.id === 'connected-robots');
    expect(cards).toHaveLength(included ? 1 : 0);
    if (included) {
      const connected = cards[0];
      expect(videos[0]).toBe(connected);
      expect(connected.controls).toBe('custom');
      expect(connected.source).toMatchObject({ assetId, playbackId });
      expect(connected.robots?.onSummarize).toBeTypeOf('function');
      expect(connected.robots?.onGenerateChapters).toBeTypeOf('function');
      expect(connected.robots?.onFindKeyMoments).toBeTypeOf('function');
      expect(connected.robots?.onTranscribe).toBeTypeOf('function');
      // Real generation must not be shadowed by the sample card's supplied data.
      expect(connected.robots?.summary).toBeUndefined();
      expect(connected.robots?.chapters).toBeUndefined();
      expect(connected.robots?.keyMoments).toBeUndefined();
      expect(connected.robots?.transcript).toBeUndefined();
    }
  });

  it('omits signed/live cards without local configuration', async () => {
    for (const key of ['EXPO_PUBLIC_MUX_SIGNED_PLAYBACK_ID', 'EXPO_PUBLIC_MUX_PLAYBACK_TOKEN', 'EXPO_PUBLIC_MUX_LIVE_PLAYBACK_ID', 'EXPO_PUBLIC_MUX_ROBOTS_ASSET_ID', 'EXPO_PUBLIC_MUX_ROBOTS_PLAYBACK_ID']) vi.stubEnv(key, '');
    vi.resetModules();
    const { videos } = await import('../example-tv/fixtures');
    expect(videos.map(video => video.id)).toEqual(['tears-of-steel', 'native-controls', 'invalid-source']);
  });

  it('keeps playback and thumbnail JWTs separate and tags all fixtures with the configured Data environment', async () => {
    vi.stubEnv('EXPO_PUBLIC_MUX_ROBOTS_ASSET_ID', '');
    vi.stubEnv('EXPO_PUBLIC_MUX_ROBOTS_PLAYBACK_ID', '');
    vi.stubEnv('EXPO_PUBLIC_MUX_ENV_KEY', 'test-environment');
    vi.stubEnv('EXPO_PUBLIC_MUX_SIGNED_PLAYBACK_ID', 'signed-test-id');
    vi.stubEnv('EXPO_PUBLIC_MUX_PLAYBACK_TOKEN', 'test-playback-jwt');
    vi.stubEnv('EXPO_PUBLIC_MUX_THUMBNAIL_TOKEN', 'test-image-jwt');
    vi.stubEnv('EXPO_PUBLIC_MUX_LIVE_PLAYBACK_ID', 'live-test-id');
    vi.resetModules();
    const { videos } = await import('../example-tv/fixtures');
    expect(videos).toHaveLength(5);
    expect(videos.every(video => video.source.metadata?.envKey === 'test-environment')).toBe(true);
    expect(videos.find(video => video.id === 'signed-vod')?.source).toMatchObject({ playbackToken: 'test-playback-jwt', thumbnailToken: 'test-image-jwt' });
    expect(videos.every(video => !video.source.drmToken)).toBe(true);
  });
});
