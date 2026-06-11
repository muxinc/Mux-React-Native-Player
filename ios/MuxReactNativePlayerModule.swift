import ExpoModulesCore
import UIKit

public final class MuxReactNativePlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MuxReactNativePlayer")

    AsyncFunction("lockFullscreenLandscape") {
      DispatchQueue.main.async {
        Self.requestOrientation(.landscapeRight, mask: .landscape)
      }
    }

    AsyncFunction("unlockFullscreenOrientation") {
      DispatchQueue.main.async {
        Self.requestOrientation(.portrait, mask: .allButUpsideDown)
      }
    }

    View(MuxVideoView.self) {
      Events(
        "onStatusChange",
        "onPlayingChange",
        "onTimeUpdate",
        "onSourceLoad",
        "onSourceError"
      )

      Prop("source") { (view: MuxVideoView, source: MuxVideoSourceRecord?) in
        view.setSource(source)
      }

      Prop("nativeControls") { (view: MuxVideoView, enabled: Bool) in
        view.setNativeControls(enabled)
      }

      Prop("contentFit") { (view: MuxVideoView, contentFit: String) in
        view.setContentFit(contentFit)
      }

      Prop("allowsFullscreen") { (_: MuxVideoView, _: Bool) in
        // Fullscreen is managed by the React Native wrapper for custom controls.
      }

      Prop("allowsPictureInPicture") { (view: MuxVideoView, enabled: Bool) in
        view.setAllowsPictureInPicture(enabled)
      }

      Prop("enableNowPlaying") { (view: MuxVideoView, enabled: Bool) in
        view.setEnableNowPlaying(enabled)
      }

      Prop("timeUpdateEventInterval") { (view: MuxVideoView, interval: Double) in
        view.setTimeUpdateEventInterval(interval)
      }

      Prop("startupBufferDuration") { (view: MuxVideoView, duration: Double) in
        view.setStartupBufferDuration(duration)
      }

      Prop("playWhenReady") { (view: MuxVideoView, playWhenReady: Bool) in
        view.setPlayWhenReady(playWhenReady)
      }

      Prop("muted") { (view: MuxVideoView, muted: Bool) in
        view.setMuted(muted)
      }

      Prop("volume") { (view: MuxVideoView, volume: Double) in
        view.setVolume(volume)
      }

      Prop("loop") { (view: MuxVideoView, loop: Bool) in
        view.setLoop(loop)
      }

      Prop("playbackRate") { (view: MuxVideoView, rate: Double) in
        view.setPlaybackRate(rate)
      }

      AsyncFunction("play") { (view: MuxVideoView) in
        view.play()
      }

      AsyncFunction("pause") { (view: MuxVideoView) in
        view.pause()
      }

      AsyncFunction("replay") { (view: MuxVideoView) in
        view.replay()
      }

      AsyncFunction("seekBy") { (view: MuxVideoView, seconds: Double) in
        view.seekBy(seconds)
      }

      AsyncFunction("seekTo") { (view: MuxVideoView, seconds: Double) in
        view.seekTo(seconds)
      }

      AsyncFunction("setMuted") { (view: MuxVideoView, muted: Bool) in
        view.setMuted(muted)
      }

      AsyncFunction("setVolume") { (view: MuxVideoView, volume: Double) in
        view.setVolume(volume)
      }

      AsyncFunction("setLoop") { (view: MuxVideoView, loop: Bool) in
        view.setLoop(loop)
      }

      AsyncFunction("setPlaybackRate") { (view: MuxVideoView, rate: Double) in
        view.setPlaybackRate(rate)
      }

      AsyncFunction("setCaptionTrack") { (view: MuxVideoView, trackId: String?) in
        view.setCaptionTrack(trackId)
      }

      AsyncFunction("release") { (view: MuxVideoView) in
        view.release()
      }
    }
  }

  private static func requestOrientation(_ orientation: UIInterfaceOrientation, mask: UIInterfaceOrientationMask) {
    guard let windowScene = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive })
      ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
      return
    }

    if #available(iOS 16.0, *) {
      windowScene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
      windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    } else {
      UIDevice.current.setValue(orientation.rawValue, forKey: "orientation")
      UIViewController.attemptRotationToDeviceOrientation()
    }
  }
}
