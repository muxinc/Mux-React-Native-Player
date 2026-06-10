require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MuxReactNativePlayer'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = 'React Native bindings for Mux Player Swift and Mux Player Android.'
  s.license        = package['license']
  s.author         = 'Mux, Inc.'
  s.homepage       = 'https://github.com/muxinc/mux-react-native-player'
  s.source         = { :git => 'https://github.com/muxinc/mux-react-native-player.git', :tag => "#{s.version}" }
  s.platforms      = { :ios => '15.0' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.source_files = 'ios/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'

  if respond_to?(:spm_dependency, true)
    spm_dependency(
      s,
      url: 'https://github.com/muxinc/mux-player-swift.git',
      requirement: {
        kind: 'upToNextMajorVersion',
        minimumVersion: '1.5.0'
      },
      products: ['MuxPlayerSwift']
    )
  else
    raise <<~MSG
      MuxReactNativePlayer requires React Native's spm_dependency Podfile helper to consume MuxPlayerSwift.
      Upgrade React Native to 0.75 or newer, or add MuxPlayerSwift to the app target manually and patch this podspec.
    MSG
  end
end
