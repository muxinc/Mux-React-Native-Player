const {
  createRunOncePlugin,
  withAndroidManifest,
  withGradleProperties,
  withInfoPlist,
  withPodfile,
  withProjectBuildGradle,
  withSettingsGradle,
  withXcodeProject,
} = require('@expo/config-plugins');

const pkg = require('../package.json');

const MUX_MAVEN_URL = 'https://muxinc.jfrog.io/artifactory/default-maven-release-local';
const MUX_MAVEN_LINE = `        maven { url = uri("${MUX_MAVEN_URL}") }\n`;
const ANDROID_COMPILE_SDK = '37';
const MUX_IOS_EMBED_PHASE_NAME = '[Mux] Embed Mux Player Swift frameworks';
const MUX_IOS_SIGNATURE_FIX_PHASE_NAME = '[Mux] Remove duplicate xcframework signatures';
const MUX_TV_EMBED_PHASE_NAME = '[Mux] Embed MuxCore tvOS framework';
const MUX_TV_SIGNATURE_FIX_PHASE_NAME = '[Mux] Remove duplicate tvOS xcframework signatures';

function withMuxReactNativePlayer(config, props = {}) {
  config = withPodfile(config, mod => {
    mod.modResults.contents = configureMuxPodfile(mod.modResults.contents, isTVConfig(mod));
    return mod;
  });
  config = withInfoPlist(config, mod => {
    const shouldEnableBackgroundAudio =
      props.enableBackgroundAudio === true || props.enablePictureInPicture === true;

    if (shouldEnableBackgroundAudio) {
      const modes = new Set(mod.modResults.UIBackgroundModes || []);
      modes.add('audio');
      mod.modResults.UIBackgroundModes = Array.from(modes);
    }

    // AirPlay routes video (not just audio) only when the app declares the
    // long-form video route-sharing policy.
    if (!mod.modResults.AVInitialRouteSharingPolicy) {
      mod.modResults.AVInitialRouteSharingPolicy = 'LongFormVideo';
    }

    return mod;
  });

  config = withXcodeProject(config, mod => {
    // Config plugins may run before config-tv has changed SDKROOT. Check its
    // declared intent as well as the actual target, independent of plugin order.
    if (isTVConfig(mod) || (!getIosAppTargetUuid(mod.modResults) && getAppTargetUuid(mod.modResults, true))) {
      addMuxTvEmbedFrameworksPhase(mod.modResults);
      addMuxTvSignatureFixPhase(mod.modResults);
    } else {
      addMuxIosEmbedFrameworksPhase(mod.modResults);
      addMuxIosSignatureFixPhase(mod.modResults);
    }
    return mod;
  });

  config = withAndroidManifest(config, mod => {
    addAndroidPermission(mod.modResults.manifest, 'android.permission.INTERNET');
    addAndroidPermission(mod.modResults.manifest, 'android.permission.ACCESS_NETWORK_STATE');
    if (props.enableNowPlaying === true) {
      // Required for the lock-screen / Now Playing media notification.
      addAndroidPermission(mod.modResults.manifest, 'android.permission.POST_NOTIFICATIONS');
      addAndroidPermission(mod.modResults.manifest, 'android.permission.FOREGROUND_SERVICE');
      addAndroidPermission(
        mod.modResults.manifest,
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
      );
    }
    return mod;
  });

  config = withGradleProperties(config, mod => {
    setGradleProperty(mod.modResults, 'android.compileSdkVersion', ANDROID_COMPILE_SDK);
    setGradleProperty(mod.modResults, 'android.suppressUnsupportedCompileSdk', ANDROID_COMPILE_SDK);
    // NOTE: we deliberately do NOT force kotlinVersion/kspVersion. Pinning the
    // app-wide Kotlin version broke other libraries (e.g. react-native-gesture-handler,
    // which relies on Kotlin synthetic-property access that newer Kotlin rejects).
    // Mux Player ships as a precompiled AAR, so the host app's Expo-managed Kotlin
    // version is sufficient.
    return mod;
  });

  config = withSettingsGradle(config, mod => {
    mod.modResults.contents = addMuxMavenToSettingsGradle(mod.modResults.contents);
    return mod;
  });

  config = withProjectBuildGradle(config, mod => {
    mod.modResults.contents = addMuxMavenToProjectBuildGradle(mod.modResults.contents);
    return mod;
  });

  return config;
}

function addMuxIosEmbedFrameworksPhase(project) {
  const appTargetUuid = getIosAppTargetUuid(project);
  if (!appTargetUuid) return;
  const shellScriptPhases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const alreadyAdded = Object.values(shellScriptPhases).some(
    phase => phase && phase.name === `"${MUX_IOS_EMBED_PHASE_NAME}"`
  );

  if (alreadyAdded) {
    return;
  }

  project.addBuildPhase([], 'PBXShellScriptBuildPhase', MUX_IOS_EMBED_PHASE_NAME, appTargetUuid, {
    inputPaths: [],
    outputPaths: ['"$(TARGET_BUILD_DIR)/$(FRAMEWORKS_FOLDER_PATH)/MuxCore.framework"'],
    shellPath: '/bin/sh',
    shellScript: createMuxIosEmbedFrameworksScript(),
  });
}

// Xcode (15+) fails to archive when a signed binary xcframework consumed via
// SPM (MuxCore, MUXSDKStats from mux-player-swift) is reachable through both
// the static pod target and the app target: its code signature gets copied
// into the archive's Signatures/ folder twice, and the second copy fails with
// "MuxCore.xcframework-ios.signature couldn't be copied to Signatures because
// an item with the same name already exists". Removing the staged .signature
// folders from the intermediate build dir lets the archive step do the single
// authoritative copy. Same approach as maplibre-react-native#1490.
function addMuxIosSignatureFixPhase(project) {
  const appTargetUuid = getIosAppTargetUuid(project);
  if (!appTargetUuid) return;
  const shellScriptPhases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const alreadyAdded = Object.values(shellScriptPhases).some(
    phase => phase && phase.name === `"${MUX_IOS_SIGNATURE_FIX_PHASE_NAME}"`
  );

  if (alreadyAdded) {
    return;
  }

  project.addBuildPhase(
    [],
    'PBXShellScriptBuildPhase',
    MUX_IOS_SIGNATURE_FIX_PHASE_NAME,
    appTargetUuid,
    {
      inputPaths: [],
      outputPaths: [],
      shellPath: '/bin/sh',
      shellScript:
        'case "${PLATFORM_NAME:-}" in appletv*) exit 0 ;; esac; rm -rf "$CONFIGURATION_BUILD_DIR"/MuxCore.xcframework-ios.signature "$CONFIGURATION_BUILD_DIR"/MUXSDKStats.xcframework-ios.signature',
    }
  );
}

function getIosAppTargetUuid(project) {
  return getAppTargetUuid(project, false);
}

function getAppTargetUuid(project, includeTV) {
  const objects = project.hash.project.objects;
  const targets = objects.PBXNativeTarget || {};
  const appTarget = Object.entries(targets).find(([, target]) => {
    if (target?.productType !== '"com.apple.product-type.application"') return false;
    const list = objects.XCConfigurationList?.[target.buildConfigurationList];
    return includeTV || !(list?.buildConfigurations || []).some(({ value }) => {
      const settings = objects.XCBuildConfiguration?.[value]?.buildSettings || {};
      return /appletv/i.test(`${settings.SDKROOT || ''} ${settings.SUPPORTED_PLATFORMS || ''}`)
        || String(settings.TARGETED_DEVICE_FAMILY).replaceAll('"', '') === '3';
    });
  });

  return appTarget?.[0];
}

function addMuxTvEmbedFrameworksPhase(project) {
  const target = getAppTargetUuid(project, true);
  if (!target) return;
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  if (Object.values(phases).some(phase => phase?.name === `"${MUX_TV_EMBED_PHASE_NAME}"`)) return;
  project.addBuildPhase([], 'PBXShellScriptBuildPhase', MUX_TV_EMBED_PHASE_NAME, target, {
    inputPaths: [],
    outputPaths: ['"$(TARGET_BUILD_DIR)/$(FRAMEWORKS_FOLDER_PATH)/MuxCore.framework"'],
    shellPath: '/bin/sh',
    shellScript: createMuxTvEmbedFrameworksScript(),
  });
}

function createMuxTvEmbedFrameworksScript() {
  return [
    'set -euo pipefail',
    'case "${PLATFORM_NAME:-}" in',
    '  appletvos) MUX_SLICE="tvos-arm64" ;;',
    '  appletvsimulator) MUX_SLICE="tvos-arm64_x86_64-simulator" ;;',
    '  *) exit 0 ;;',
    'esac',
    'FRAMEWORK_NAME="MuxCore.framework"',
    'SOURCE_FRAMEWORK="${BUILT_PRODUCTS_DIR}/${FRAMEWORK_NAME}"',
    'DESTINATION_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
    'if [ ! -d "${SOURCE_FRAMEWORK}" ]; then',
    '  SOURCE_FRAMEWORK="${BUILT_PRODUCTS_DIR}/MuxReactNativePlayer/${FRAMEWORK_NAME}"',
    'fi',
    // Xcode normally stages the selected binary product in BUILT_PRODUCTS_DIR.
    // The artifact fallback covers SPM binaries linked via a static CocoaPod.
    'if [ ! -d "${SOURCE_FRAMEWORK}" ]; then',
    '  for MUX_ARTIFACT_ROOT in "${BUILD_DIR}/../../SourcePackages/artifacts" "${CLONED_SOURCE_PACKAGES_DIR_PATH:-}/artifacts"; do',
    '    if [ -d "${MUX_ARTIFACT_ROOT}" ]; then',
    '      MUX_FOUND=$(find "${MUX_ARTIFACT_ROOT}" -type d -path "*/MuxCore.xcframework/${MUX_SLICE}/${FRAMEWORK_NAME}" -print -quit)',
    '      if [ -n "${MUX_FOUND}" ]; then SOURCE_FRAMEWORK="${MUX_FOUND}"; break; fi',
    '    fi',
    '  done',
    'fi',
    'if [ ! -d "${SOURCE_FRAMEWORK}" ]; then',
    '  echo "error: MuxCore tvOS framework was not found for ${PLATFORM_NAME}. Resolve Swift packages before building."',
    '  exit 1',
    'fi',
    'mkdir -p "${DESTINATION_DIR}"',
    'rsync -a --delete "${SOURCE_FRAMEWORK}" "${DESTINATION_DIR}/"',
    'if [ "${CODE_SIGNING_ALLOWED:-NO}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then',
    '  /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements "${DESTINATION_DIR}/${FRAMEWORK_NAME}"',
    'fi',
  ].join('\\n');
}

function addMuxTvSignatureFixPhase(project) {
  const target = getAppTargetUuid(project, true);
  if (!target) return;
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  if (Object.values(phases).some(phase => phase?.name === `"${MUX_TV_SIGNATURE_FIX_PHASE_NAME}"`)) return;
  // SPM stages MuxCore's signature for both the static pod and the app. Xcode
  // archives both copies under the same name. Preserve the pod's copy and the
  // embedded dynamic framework; remove only the redundant root intermediate.
  project.addBuildPhase([], 'PBXShellScriptBuildPhase', MUX_TV_SIGNATURE_FIX_PHASE_NAME, target, {
    inputPaths: [],
    outputPaths: [],
    shellPath: '/bin/sh',
    shellScript: createMuxTvSignatureFixScript(),
  });
}

function createMuxTvSignatureFixScript() {
  return 'case "${PLATFORM_NAME:-}" in appletv*) rm -rf "$CONFIGURATION_BUILD_DIR"/MuxCore.xcframework-tvos.signature ;; esac';
}

function isTVConfig(config) {
  return process.env.EXPO_TV === '1' || process.env.EXPO_TV === 'true' ||
    (config.plugins || []).some(plugin => Array.isArray(plugin) &&
      plugin[0] === '@react-native-tvos/config-tv' && plugin[1]?.isTV === true);
}

function configureMuxPodfile(contents, isTV) {
  const marker = "ENV['RCT_BUILD_FOR_TV'] = '1' # Mux: select tvOS native dependencies";
  // Read the actual Podfile too, for hand-maintained tvOS projects.
  if (!(isTV || /^\s*platform\s+:tvos\b/m.test(contents))) return contents;
  if (contents.includes(marker)) return contents;
  // Set before autolinking evaluates the library podspec. Persisting this means
  // `cd ios && pod install` works without inheriting the prebuild environment.
  return `${marker}\n${contents}`;
}

function createMuxIosEmbedFrameworksScript() {
  return [
    'set -euo pipefail',
    'case "${PLATFORM_NAME:-}" in appletv*) exit 0 ;; esac',
    '',
    'FRAMEWORK_NAME="MuxCore.framework"',
    'DESTINATION_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
    'SOURCE_FRAMEWORK="${BUILT_PRODUCTS_DIR}/${FRAMEWORK_NAME}"',
    '',
    'if [ ! -d "${SOURCE_FRAMEWORK}" ]; then',
    '  SOURCE_FRAMEWORK="${BUILT_PRODUCTS_DIR}/MuxReactNativePlayer/${FRAMEWORK_NAME}"',
    'fi',
    '',
    'if [ ! -d "${SOURCE_FRAMEWORK}" ]; then',
    '  echo "warning: ${FRAMEWORK_NAME} was not found. Mux Player Swift may fail to load at runtime."',
    '  exit 0',
    'fi',
    '',
    'mkdir -p "${DESTINATION_DIR}"',
    'rsync -a --delete "${SOURCE_FRAMEWORK}" "${DESTINATION_DIR}/"',
    '',
    'if [ "${CODE_SIGNING_ALLOWED:-NO}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then',
    '  /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements "${DESTINATION_DIR}/${FRAMEWORK_NAME}"',
    'fi',
  ].join('\\n');
}

function addAndroidPermission(manifest, permission) {
  const usesPermission = manifest['uses-permission'] || [];
  const alreadyAdded = usesPermission.some(item => item.$?.['android:name'] === permission);

  if (!alreadyAdded) {
    usesPermission.push({ $: { 'android:name': permission } });
  }

  manifest['uses-permission'] = usesPermission;
}

function setGradleProperty(properties, key, value) {
  const property = properties.find(item => item.type === 'property' && item.key === key);
  if (property) {
    property.value = value;
  } else {
    properties.push({ type: 'property', key, value });
  }
}

function addMuxMavenToSettingsGradle(contents) {
  if (contents.includes(MUX_MAVEN_URL)) {
    return contents;
  }

  const dependencyRepositories = /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{\n)/m;
  if (dependencyRepositories.test(contents)) {
    return contents.replace(dependencyRepositories, `$1${MUX_MAVEN_LINE}`);
  }

  return `${contents.trimEnd()}

dependencyResolutionManagement {
    repositories {
${MUX_MAVEN_LINE}        google()
        mavenCentral()
    }
}
`;
}

function addMuxMavenToProjectBuildGradle(contents) {
  if (contents.includes(MUX_MAVEN_URL)) {
    return contents;
  }

  const allProjectsRepositories = /(allprojects\s*\{[\s\S]*?repositories\s*\{\n)/m;
  if (allProjectsRepositories.test(contents)) {
    return contents.replace(allProjectsRepositories, `$1${MUX_MAVEN_LINE}`);
  }

  return `${contents.trimEnd()}

allprojects {
    repositories {
${MUX_MAVEN_LINE}    }
}
`;
}

module.exports = createRunOncePlugin(withMuxReactNativePlayer, pkg.name, pkg.version);
module.exports.withMuxReactNativePlayer = withMuxReactNativePlayer;
module.exports.getIosAppTargetUuid = getIosAppTargetUuid;
module.exports.isTVConfig = isTVConfig;
module.exports.configureMuxPodfile = configureMuxPodfile;
module.exports.addMuxIosEmbedFrameworksPhase = addMuxIosEmbedFrameworksPhase;
module.exports.addMuxIosSignatureFixPhase = addMuxIosSignatureFixPhase;
module.exports.addMuxTvEmbedFrameworksPhase = addMuxTvEmbedFrameworksPhase;
module.exports.createMuxTvEmbedFrameworksScript = createMuxTvEmbedFrameworksScript;
module.exports.addMuxTvSignatureFixPhase = addMuxTvSignatureFixPhase;
module.exports.createMuxTvSignatureFixScript = createMuxTvSignatureFixScript;
module.exports.default = module.exports;
