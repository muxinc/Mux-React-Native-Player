const {
  createRunOncePlugin,
  withAndroidManifest,
  withGradleProperties,
  withInfoPlist,
  withProjectBuildGradle,
  withSettingsGradle,
  withXcodeProject,
} = require('@expo/config-plugins');

const pkg = require('../package.json');

const MUX_MAVEN_URL = 'https://muxinc.jfrog.io/artifactory/default-maven-release-local';
const MUX_MAVEN_LINE = `        maven { url = uri("${MUX_MAVEN_URL}") }\n`;
const ANDROID_COMPILE_SDK = '36';
const MUX_IOS_EMBED_PHASE_NAME = '[Mux] Embed Mux Player Swift frameworks';
const MUX_IOS_SIGNATURE_FIX_PHASE_NAME = '[Mux] Remove duplicate xcframework signatures';

function withMuxReactNativePlayer(config, props = {}) {
  config = withInfoPlist(config, mod => {
    const shouldEnableBackgroundAudio =
      props.enableBackgroundAudio === true || props.enablePictureInPicture === true;

    if (shouldEnableBackgroundAudio) {
      const modes = new Set(mod.modResults.UIBackgroundModes || []);
      modes.add('audio');
      mod.modResults.UIBackgroundModes = Array.from(modes);
    }

    return mod;
  });

  config = withXcodeProject(config, mod => {
    addMuxIosEmbedFrameworksPhase(mod.modResults);
    addMuxIosSignatureFixPhase(mod.modResults);
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
  const shellScriptPhases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const alreadyAdded = Object.values(shellScriptPhases).some(
    phase => phase && phase.name === `"${MUX_IOS_EMBED_PHASE_NAME}"`
  );

  if (alreadyAdded) {
    return;
  }

  const appTargetUuid = getIosAppTargetUuid(project);

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
  const shellScriptPhases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const alreadyAdded = Object.values(shellScriptPhases).some(
    phase => phase && phase.name === `"${MUX_IOS_SIGNATURE_FIX_PHASE_NAME}"`
  );

  if (alreadyAdded) {
    return;
  }

  const appTargetUuid = getIosAppTargetUuid(project);

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
        'rm -rf "$CONFIGURATION_BUILD_DIR"/MuxCore.xcframework-ios.signature "$CONFIGURATION_BUILD_DIR"/MUXSDKStats.xcframework-ios.signature',
    }
  );
}

function getIosAppTargetUuid(project) {
  const targets = project.hash.project.objects.PBXNativeTarget || {};
  const appTarget = Object.entries(targets).find(([, target]) => {
    return target?.productType === '"com.apple.product-type.application"';
  });

  return appTarget?.[0] || project.getFirstTarget().uuid;
}

function createMuxIosEmbedFrameworksScript() {
  return [
    'set -euo pipefail',
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
module.exports.default = module.exports;
