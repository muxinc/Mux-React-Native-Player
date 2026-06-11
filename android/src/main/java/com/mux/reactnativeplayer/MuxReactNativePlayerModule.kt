package com.mux.reactnativeplayer

import android.app.Activity
import android.content.pm.ActivityInfo
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MuxReactNativePlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MuxReactNativePlayer")

    AsyncFunction("lockFullscreenLandscape") {
      runOnActivity { activity ->
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      }
    }

    AsyncFunction("unlockFullscreenOrientation") {
      runOnActivity { activity ->
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }

    View(MuxVideoView::class) {
      OnViewDestroys { view: MuxVideoView ->
        view.release()
      }

      Events(
        "onStatusChange",
        "onPlayingChange",
        "onTimeUpdate",
        "onSourceLoad",
        "onSourceError"
      )

      Prop("source") { view: MuxVideoView, source: MuxVideoSourceRecord? ->
        view.setSource(source)
      }

      Prop("nativeControls", true) { view: MuxVideoView, enabled: Boolean ->
        view.setNativeControls(enabled)
      }

      Prop("contentFit", "contain") { view: MuxVideoView, contentFit: String ->
        view.setContentFit(contentFit)
      }

      Prop("allowsFullscreen", true) { _: MuxVideoView, _: Boolean ->
        // Android Media3 PlayerView exposes fullscreen through app UI; accepted for API parity.
      }

      Prop("allowsPictureInPicture", false) { _: MuxVideoView, _: Boolean ->
        // PiP requires host Activity integration and is intentionally left to a future pass.
      }

      Prop("enableNowPlaying", false) { view: MuxVideoView, enabled: Boolean ->
        view.setEnableNowPlaying(enabled)
      }

      Prop("timeUpdateEventInterval", 0.5) { view: MuxVideoView, interval: Double ->
        view.setTimeUpdateEventInterval(interval)
      }

      Prop("startupBufferDuration", 0.0) { view: MuxVideoView, duration: Double ->
        view.setStartupBufferDuration(duration)
      }

      Prop("playWhenReady", false) { view: MuxVideoView, playWhenReady: Boolean ->
        view.setPlayWhenReady(playWhenReady)
      }

      Prop("muted", false) { view: MuxVideoView, muted: Boolean ->
        view.setMuted(muted)
      }

      Prop("volume", 1.0) { view: MuxVideoView, volume: Double ->
        view.setVolume(volume)
      }

      Prop("loop", false) { view: MuxVideoView, loop: Boolean ->
        view.setLoop(loop)
      }

      Prop("playbackRate", 1.0) { view: MuxVideoView, rate: Double ->
        view.setPlaybackRate(rate)
      }

      AsyncFunction("play") { view: MuxVideoView ->
        view.play()
      }

      AsyncFunction("pause") { view: MuxVideoView ->
        view.pause()
      }

      AsyncFunction("replay") { view: MuxVideoView ->
        view.replay()
      }

      AsyncFunction("seekBy") { view: MuxVideoView, seconds: Double ->
        view.seekBy(seconds)
      }

      AsyncFunction("seekTo") { view: MuxVideoView, seconds: Double ->
        view.seekTo(seconds)
      }

      AsyncFunction("setMuted") { view: MuxVideoView, muted: Boolean ->
        view.setMuted(muted)
      }

      AsyncFunction("setVolume") { view: MuxVideoView, volume: Double ->
        view.setVolume(volume)
      }

      AsyncFunction("setLoop") { view: MuxVideoView, loop: Boolean ->
        view.setLoop(loop)
      }

      AsyncFunction("setPlaybackRate") { view: MuxVideoView, rate: Double ->
        view.setPlaybackRate(rate)
      }

      AsyncFunction("setCaptionTrack") { view: MuxVideoView, trackId: String? ->
        view.setCaptionTrack(trackId)
      }

      AsyncFunction("release") { view: MuxVideoView ->
        view.release()
      }
    }
  }

  private fun runOnActivity(block: (Activity) -> Unit) {
    val activity = appContext.activityProvider?.currentActivity ?: return
    activity.runOnUiThread { block(activity) }
  }
}
