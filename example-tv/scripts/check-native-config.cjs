const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const podfile = read('ios/Podfile');
assert.match(podfile, /^ENV\['RCT_BUILD_FOR_TV'\] = '1'/);
assert.match(podfile, /platform :tvos/);
assert.match(podfile, /define_singleton_method\(:generate_uuid\)/);
const project = read('ios/MuxPlayerTV.xcodeproj/project.pbxproj');
assert.match(project, /SDKROOT = appletvos/);
assert.match(project, /TVOS_DEPLOYMENT_TARGET = 16\.4/);
assert.match(project, /\[Mux\] Embed MuxCore tvOS framework/);
assert.match(project, /\[Mux\] Remove duplicate tvOS xcframework signatures/);
assert.doesNotMatch(project, /\[Mux\] (Embed Mux Player Swift frameworks|Remove duplicate xcframework signatures)/);
const manifest = read('android/app/src/main/AndroidManifest.xml');
assert.match(manifest, /android.intent.category.LEANBACK_LAUNCHER/);
assert.match(manifest, /android:name="android.hardware.touchscreen" android:required="false"/);
assert.match(manifest, /android:name="android.software.leanback" android:required="true"/);
assert.doesNotMatch(manifest, /android:screenOrientation="portrait"/);
assert.match(read('android/build.gradle'), /com.android.tools.build:gradle:9.1.1/);
assert.match(read('android/gradle/wrapper/gradle-wrapper.properties'), /gradle-9.3.1-bin.zip/);
for (const entry of ['android.compileSdkVersion=37', 'android.newDsl=false', 'android.builtInKotlin=false', 'android.sourceset.disallowProvider=false']) {
  assert.ok(read('android/gradle.properties').includes(entry), `Missing ${entry}`);
}
console.log('TV native configuration contract passed.');
