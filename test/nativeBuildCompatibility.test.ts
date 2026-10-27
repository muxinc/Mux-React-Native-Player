import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { configurePodfile, configureProjectGradle, configureWrapper } = require(
  '../example/plugins/withNativeBuildCompatibility.js'
);

describe('example native build compatibility', () => {
  it('adds the UUID guard before React Native post-install and preserves host setup', () => {
    const input = `target 'Example' do
  post_install do |installer|
    react_native_post_install(installer, config[:reactNativePath])
    configure_other_pods(installer)
  end
end
`;
    const result = configurePodfile(input);
    expect(result.indexOf('define_singleton_method')).toBeLessThan(result.indexOf('react_native_post_install'));
    expect(result).toContain('configure_other_pods(installer)');
    expect(configurePodfile(result)).toBe(result);
  });

  it('handles generated and previously pinned AGP declarations without changing other dependencies', () => {
    for (const dependency of ["classpath('com.android.tools.build:gradle')", 'classpath("com.android.tools.build:gradle:8.12.0")']) {
      const result = configureProjectGradle(`${dependency}\nclasspath('com.facebook.react:react-native-gradle-plugin')`);
      expect(result).toContain("classpath('com.android.tools.build:gradle:9.1.1')");
      expect(result).toContain("classpath('com.facebook.react:react-native-gradle-plugin')");
      expect(configureProjectGradle(result)).toBe(result);
    }
  });

  it('preserves wrapper settings across repeat prebuilds', () => {
    const result = configureWrapper('distributionUrl=https\\://services.gradle.org/distributions/gradle-9.0.0-all.zip\nnetworkTimeout=10000\n');
    expect(result).toContain('gradle-9.3.1-bin.zip');
    expect(result).toContain('networkTimeout=10000');
    expect(configureWrapper(result)).toBe(result);
  });

  it('fails clearly if future native templates no longer match', () => {
    expect(() => configurePodfile('')).toThrow('post_install');
    expect(() => configureProjectGradle('')).toThrow('Android Gradle plugin');
    expect(() => configureWrapper('')).toThrow('Gradle wrapper');
  });
});
