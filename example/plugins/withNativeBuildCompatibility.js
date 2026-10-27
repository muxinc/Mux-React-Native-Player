const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withPodfile,
  withProjectBuildGradle,
} = require('expo/config-plugins');

const UUID_MARKER = '# Mux example: avoid React Native SPM UUID collisions (#57576).';

function configurePodfile(contents) {
  if (contents.includes(UUID_MARKER)) return contents;
  const anchor = 'post_install do |installer|';
  if (!contents.includes(anchor)) throw new Error('Cannot find the example Podfile post_install hook');
  return contents.replace(anchor, `${anchor}
    ${UUID_MARKER}
    installer.pods_project.define_singleton_method(:generate_uuid) do
      candidate = super()
      candidate = super() while objects_by_uuid.key?(candidate)
      candidate
    end`);
}

function configureProjectGradle(contents) {
  const dependency = /classpath\(['"]com\.android\.tools\.build:gradle(?::[^'"]+)?['"]\)/;
  if (!dependency.test(contents)) throw new Error('Cannot find the example Android Gradle plugin dependency');
  return contents.replace(dependency, "classpath('com.android.tools.build:gradle:9.1.1')");
}

function configureWrapper(contents) {
  const distribution = /gradle-[\d.]+-(bin|all)\.zip/;
  if (!distribution.test(contents)) throw new Error('Cannot find the example Gradle wrapper distribution');
  return contents.replace(distribution, 'gradle-9.3.1-bin.zip');
}

// Example-only host configuration. The library plugin does not migrate consumers'
// AGP/Gradle versions. Keep this paired with both versioned patches in ../patches.
function withNativeBuildCompatibility(config) {
  config = withProjectBuildGradle(config, mod => {
    mod.modResults.contents = configureProjectGradle(mod.modResults.contents);
    return mod;
  });
  config = withAppBuildGradle(config, mod => {
    mod.modResults.contents = mod.modResults.contents.replaceAll('proguard-android.txt', 'proguard-android-optimize.txt');
    return mod;
  });
  config = withGradleProperties(config, mod => {
    for (const key of ['android.newDsl', 'android.builtInKotlin', 'android.sourceset.disallowProvider']) {
      const entry = mod.modResults.find(item => item.type === 'property' && item.key === key);
      if (entry) entry.value = 'false';
      else mod.modResults.push({ type: 'property', key, value: 'false' });
    }
    return mod;
  });
  config = withDangerousMod(config, ['android', async mod => {
    const wrapper = path.join(mod.modRequest.platformProjectRoot, 'gradle/wrapper/gradle-wrapper.properties');
    await fs.writeFile(wrapper, configureWrapper(await fs.readFile(wrapper, 'utf8')));
    return mod;
  }]);
  return withPodfile(config, mod => {
    mod.modResults.contents = configurePodfile(mod.modResults.contents);
    return mod;
  });
}

module.exports = withNativeBuildCompatibility;
module.exports.configurePodfile = configurePodfile;
module.exports.configureProjectGradle = configureProjectGradle;
module.exports.configureWrapper = configureWrapper;
