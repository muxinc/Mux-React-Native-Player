package com.mux.reactnativeplayer

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerNotificationManager
import androidx.media3.ui.PlayerView
import com.mux.player.MuxPlayer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@OptIn(UnstableApi::class)
class MuxVideoView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val onStatusChange by EventDispatcher()
  private val onPlayingChange by EventDispatcher()
  private val onTimeUpdate by EventDispatcher()
  private val onSourceLoad by EventDispatcher()
  private val onSourceError by EventDispatcher()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val playerView = (LayoutInflater.from(context)
    .inflate(R.layout.mux_video_player_view, this, false) as PlayerView).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.useController = true
    it.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    it.setKeepContentOnPlayerReset(true)
    addView(it)
  }

  private var player: MuxPlayer? = null
  private var sourceFingerprint: String? = null
  private var currentPlaybackId: String? = null
  private var didEmitSourceLoad = false
  private var muted = false
  private var volume = 1f
  private var loop = false
  private var playbackRate = 1f
  private var shouldPlay = false
  private var timeUpdateEventIntervalMs = 500L
  private var startupBufferDurationMs = 0L
  private var nowPlayingEnabled = false
  private var mediaSession: MediaSession? = null
  private var notificationManager: PlayerNotificationManager? = null

  private data class TextTrackSelection(
    val id: String,
    val trackGroup: TrackGroup,
    val trackIndex: Int,
  )

  private val timeUpdateRunnable = object : Runnable {
    override fun run() {
      sendTimeUpdate()
      mainHandler.postDelayed(this, timeUpdateEventIntervalMs)
    }
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_READY && !didEmitSourceLoad) {
        didEmitSourceLoad = true
        onSourceLoad(
          mapOf(
            "playbackId" to currentPlaybackId.orEmpty(),
            "duration" to durationSeconds(),
            "captionTracks" to captionTracksPayload(),
            "selectedCaptionTrackId" to selectedCaptionTrackId().orEmpty(),
          )
        )
      }
      if (playbackState == Player.STATE_READY && shouldPlay && player?.isPlaying != true) {
        player?.play()
      }
      sendStatusChange()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      onPlayingChange(mapOf("isPlaying" to isPlaying))
      sendStatusChange()
    }

    override fun onPlayerError(error: PlaybackException) {
      val message = error.localizedMessage ?: "Mux playback failed."
      onSourceError(
        mutableMapOf<String, Any>(
          "playbackId" to currentPlaybackId.orEmpty(),
          "message" to message,
          "code" to error.errorCodeName
        )
      )
      sendStatusChange("error", message)
    }

    override fun onTracksChanged(tracks: Tracks) {
      sendStatusChange()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    startTimeUpdates()
  }

  override fun onDetachedFromWindow() {
    stopTimeUpdates()
    super.onDetachedFromWindow()
  }

  fun setSource(source: MuxVideoSourceRecord?) {
    if (source == null) {
      release()
      return
    }

    if (source.fingerprint == sourceFingerprint) {
      return
    }

    releasePlayer()
    sourceFingerprint = source.fingerprint
    currentPlaybackId = source.playbackId
    didEmitSourceLoad = false
    sendStatusChange("loading")

    val bufferForPlaybackMs = startupBufferDurationMs.coerceAtLeast(500L).toInt()
    val bufferForPlaybackAfterRebufferMs = startupBufferDurationMs.coerceAtLeast(1_500L).toInt()
    val minBufferMs = startupBufferDurationMs.coerceAtLeast(3_000L).toInt()
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(
        minBufferMs,
        12_000,
        bufferForPlaybackMs,
        bufferForPlaybackAfterRebufferMs,
      )
      .setPrioritizeTimeOverSizeThresholds(true)
      .build()

    val builder = MuxPlayer.Builder(context)
      .enableSmartCache(true)
      .applyExoConfig {
        setLoadControl(loadControl)
      }
      .addMonitoringData(source.toCustomerData())

    source.metadata?.envKey?.takeIf { it.isNotBlank() }?.let {
      builder.setMuxDataEnv(it)
    }

    val nextPlayer = builder.build()
    nextPlayer.addListener(listener)
    nextPlayer.setMediaItem(source.toMediaItem())
    nextPlayer.playWhenReady = shouldPlay
    nextPlayer.prepare()

    player = nextPlayer
    playerView.player = nextPlayer
    applyPlayerConfiguration()

    if (nowPlayingEnabled) {
      attachNowPlaying()
    }
  }

  fun setEnableNowPlaying(enabled: Boolean) {
    if (enabled == nowPlayingEnabled) {
      return
    }
    nowPlayingEnabled = enabled
    if (enabled) {
      attachNowPlaying()
    } else {
      detachNowPlaying()
    }
  }

  fun setNativeControls(enabled: Boolean) {
    playerView.useController = enabled
  }

  fun setContentFit(contentFit: String) {
    playerView.resizeMode = when (contentFit) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun setTimeUpdateEventInterval(interval: Double) {
    timeUpdateEventIntervalMs = (interval.coerceAtLeast(0.1) * 1000).toLong()
    stopTimeUpdates()
    startTimeUpdates()
  }

  fun setStartupBufferDuration(duration: Double) {
    startupBufferDurationMs = (duration.coerceAtLeast(0.0) * 1000).toLong()
  }

  fun setPlayWhenReady(playWhenReady: Boolean) {
    if (shouldPlay == playWhenReady) {
      return
    }

    if (playWhenReady) {
      play()
    } else {
      pause()
    }
  }

  fun setMuted(muted: Boolean) {
    this.muted = muted
    player?.volume = if (muted) 0f else volume
    sendStatusChange()
  }

  fun setVolume(volume: Double) {
    this.volume = volume.coerceIn(0.0, 1.0).toFloat()
    if (!muted) {
      player?.volume = this.volume
    }
    sendStatusChange()
  }

  fun setLoop(loop: Boolean) {
    this.loop = loop
    player?.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    sendStatusChange()
  }

  fun setPlaybackRate(rate: Double) {
    playbackRate = rate.coerceIn(0.25, 4.0).toFloat()
    player?.setPlaybackSpeed(playbackRate)
    sendStatusChange()
  }

  fun setCaptionTrack(trackId: String?) {
    val currentPlayer = player ?: return
    val builder = currentPlayer.trackSelectionParameters.buildUpon()

    if (trackId == null) {
      currentPlayer.trackSelectionParameters = builder
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        .build()
      sendStatusChange()
      return
    }

    val selection = findTextTrack(trackId) ?: return
    currentPlayer.trackSelectionParameters = builder
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
      .setOverrideForType(
        TrackSelectionOverride(selection.trackGroup, listOf(selection.trackIndex))
      )
      .build()
    sendStatusChange()
  }

  fun play() {
    shouldPlay = true
    player?.play()
    sendStatusChange()
  }

  fun pause() {
    shouldPlay = false
    player?.pause()
    sendStatusChange()
  }

  fun replay() {
    shouldPlay = true
    seekTo(0.0)
    play()
  }

  fun seekBy(seconds: Double) {
    val current = (player?.currentPosition ?: 0L) / 1000.0
    seekTo(current + seconds)
  }

  fun seekTo(seconds: Double) {
    player?.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
    sendStatusChange()
    sendTimeUpdate()
  }

  fun seekToLive() {
    val currentPlayer = player ?: return
    if (currentPlayer.isCurrentMediaItemLive) {
      currentPlayer.seekToDefaultPosition()
      currentPlayer.play()
      shouldPlay = true
    }
    sendStatusChange()
    sendTimeUpdate()
  }

  fun release() {
    releasePlayer()
    sourceFingerprint = null
    currentPlaybackId = null
    didEmitSourceLoad = false
    shouldPlay = false
    sendStatusChange("idle")
  }

  private fun applyPlayerConfiguration() {
    player?.volume = if (muted) 0f else volume
    player?.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    player?.setPlaybackSpeed(playbackRate)
  }

  private fun releasePlayer() {
    detachNowPlaying()
    playerView.player = null
    player?.removeListener(listener)
    player?.release()
    player = null
  }

  private fun attachNowPlaying() {
    val currentPlayer = player ?: return
    val session = mediaSession ?: MediaSession.Builder(context, currentPlayer)
      .setId("mux-now-playing-${hashCode()}")
      .build()
      .also { mediaSession = it }

    if (notificationManager == null) {
      val manager = PlayerNotificationManager.Builder(
        context,
        NOW_PLAYING_NOTIFICATION_ID,
        NOW_PLAYING_CHANNEL_ID,
      )
        .setChannelNameResourceId(R.string.mux_now_playing_channel_name)
        .build()
      manager.setMediaSessionToken(session.sessionCompatToken)
      manager.setPlayer(currentPlayer)
      notificationManager = manager
    } else {
      notificationManager?.setPlayer(currentPlayer)
    }
  }

  private fun detachNowPlaying() {
    notificationManager?.setPlayer(null)
    notificationManager = null
    mediaSession?.release()
    mediaSession = null
  }

  private fun startTimeUpdates() {
    mainHandler.removeCallbacks(timeUpdateRunnable)
    mainHandler.postDelayed(timeUpdateRunnable, timeUpdateEventIntervalMs)
  }

  private fun stopTimeUpdates() {
    mainHandler.removeCallbacks(timeUpdateRunnable)
  }

  private fun sendTimeUpdate() {
    onTimeUpdate(
      mapOf(
        "currentTime" to currentTimeSeconds(),
        "duration" to durationSeconds(),
        "bufferedPosition" to bufferedPositionSeconds()
      )
    )
  }

  private fun sendStatusChange(status: String? = null, error: String? = null) {
    val payload = mutableMapOf<String, Any>(
      "status" to (status ?: inferStatus()),
      "currentTime" to currentTimeSeconds(),
      "duration" to durationSeconds(),
      "bufferedPosition" to bufferedPositionSeconds(),
      "muted" to muted,
      "volume" to volume.toDouble(),
      "loop" to loop,
      "playbackRate" to playbackRate.toDouble(),
      "captionTracks" to captionTracksPayload(),
      "selectedCaptionTrackId" to selectedCaptionTrackId().orEmpty(),
      // AirPlay is iOS-only; Android has no external-playback equivalent here.
      "externalPlaybackActive" to false,
      "isLive" to (player?.isCurrentMediaItemLive ?: false),
      // media3 normalizes the live/DVR timeline to the current window (0..duration).
      "seekableStart" to 0.0,
      "seekableEnd" to durationSeconds(),
    )

    if (error != null) {
      payload["error"] = error
    }

    onStatusChange(
      payload
    )
  }

  private fun inferStatus(): String {
    val player = player ?: return "idle"
    return when (player.playbackState) {
      Player.STATE_BUFFERING -> "buffering"
      Player.STATE_READY -> if (player.isPlaying) "playing" else "paused"
      Player.STATE_ENDED -> "ended"
      Player.STATE_IDLE -> if (currentPlaybackId == null) "idle" else "loading"
      else -> "idle"
    }
  }

  private fun currentTimeSeconds(): Double {
    return ((player?.currentPosition ?: 0L).coerceAtLeast(0L)) / 1000.0
  }

  private fun durationSeconds(): Double {
    val duration = player?.duration ?: C.TIME_UNSET
    return if (duration == C.TIME_UNSET || duration < 0) 0.0 else duration / 1000.0
  }

  private fun bufferedPositionSeconds(): Double {
    return ((player?.bufferedPosition ?: 0L).coerceAtLeast(0L)) / 1000.0
  }

  private fun captionTracksPayload(): List<Map<String, Any>> {
    val currentPlayer = player ?: return emptyList()
    val tracks = mutableListOf<Map<String, Any>>()
    var fallbackIndex = 1

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_TEXT) {
        return@forEachIndexed
      }

      for (trackIndex in 0 until group.length) {
        if (!group.isTrackSupported(trackIndex)) {
          continue
        }

        val format = group.getTrackFormat(trackIndex)
        val language = format.language
        val label = format.label
          ?.takeIf { it.isNotBlank() }
          ?: language?.takeIf { it.isNotBlank() }
          ?: "Captions ${fallbackIndex++}"
        val payload = mutableMapOf<String, Any>(
          "id" to "$groupIndex:$trackIndex",
          "label" to label,
          "kind" to captionTrackKind(format.selectionFlags, format.roleFlags),
        )

        language?.takeIf { it.isNotBlank() }?.let {
          payload["language"] = it
        }

        tracks.add(payload)
      }
    }

    return tracks
  }

  private fun selectedCaptionTrackId(): String? {
    val currentPlayer = player ?: return null

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_TEXT) {
        return@forEachIndexed
      }

      for (trackIndex in 0 until group.length) {
        if (group.isTrackSelected(trackIndex)) {
          return "$groupIndex:$trackIndex"
        }
      }
    }

    return null
  }

  private fun findTextTrack(trackId: String): TextTrackSelection? {
    val currentPlayer = player ?: return null

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_TEXT) {
        return@forEachIndexed
      }

      for (trackIndex in 0 until group.length) {
        if ("$groupIndex:$trackIndex" == trackId && group.isTrackSupported(trackIndex)) {
          return TextTrackSelection(trackId, group.mediaTrackGroup, trackIndex)
        }
      }
    }

    return null
  }

  private fun captionTrackKind(selectionFlags: Int, roleFlags: Int): String {
    return when {
      selectionFlags and C.SELECTION_FLAG_FORCED != 0 -> "forced"
      roleFlags and C.ROLE_FLAG_CAPTION != 0 -> "captions"
      else -> "subtitles"
    }
  }

  private companion object {
    const val NOW_PLAYING_NOTIFICATION_ID = 4711
    const val NOW_PLAYING_CHANNEL_ID = "mux_now_playing"
  }
}
