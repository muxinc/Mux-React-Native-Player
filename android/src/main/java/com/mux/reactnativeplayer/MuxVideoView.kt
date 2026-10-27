package com.mux.reactnativeplayer

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
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
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerNotificationManager
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import com.mux.player.MuxPlayer
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@OptIn(UnstableApi::class)
class MuxVideoView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext), LifecycleEventListener {
  private val isTv = context.isTelevision()
  override val shouldUseAndroidLayout: Boolean get() = isTv
  private var tvInitialized = false
  private var tvAttached = false
  private var hostResumed = false
  private var tvSuspended = true
  private var lifecycleContext: ReactContext? = null
  private val backPressHandler = TvBackPressHandler()
  private val onStatusChange by EventDispatcher()
  private val onPlayingChange by EventDispatcher()
  private val onTimeUpdate by EventDispatcher()
  private val onSourceLoad by EventDispatcher()
  private val onSourceError by EventDispatcher()
  private val onFirstFrame by EventDispatcher()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val playerView = (LayoutInflater.from(context)
    .inflate(R.layout.mux_video_player_view, this, false) as PlayerView).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.useController = true
    it.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    it.setKeepContentOnPlayerReset(!isTv)
    if (isTv) {
      it.isFocusable = true
      it.isFocusableInTouchMode = true
      it.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
      it.setControllerAnimationEnabled(false)
      it.setShowSubtitleButton(true)
    }
    addView(it)
  }

  private var player: MuxPlayer? = null
  private var sourceFingerprint: String? = null
  private var currentPlaybackId: String? = null
  private var currentSourceId: String? = null
  private var pendingSource: MuxVideoSourceRecord? = null
  private var hasPendingSource = false
  private var pendingPlaybackIntent: MuxPlaybackIntentRecord? = null
  private var playbackIntentRevision = 0
  private var didEmitSourceLoad = false
  private var didEmitFirstFrame = false
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
  private var playerListener: Player.Listener? = null

  private val requestTvFocus = Runnable {
    if (isTv && !tvSuspended && player != null && playerView.useController && !hasFocus()) {
      playerView.requestFocus()
    }
  }

  init {
    tvInitialized = true
  }

  private data class TrackSelection(
    val id: String,
    val trackGroup: TrackGroup,
    val trackIndex: Int,
  )

  private val timeUpdateRunnable = object : Runnable {
    override fun run() {
      if (!isAttachedToWindow || player == null || (isTv && tvSuspended)) return
      sendTimeUpdate()
      mainHandler.postDelayed(this, timeUpdateEventIntervalMs)
    }
  }

  private fun createPlayerListener(owner: MuxPlayer) = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (player !== owner) return
      if (playbackState == Player.STATE_READY && !didEmitSourceLoad) {
        didEmitSourceLoad = true
        onSourceLoad(
          sourceEventPayload(mapOf(
            "playbackId" to currentPlaybackId.orEmpty(),
            "duration" to durationSeconds(),
            "captionTracks" to captionTracksPayload(),
            "selectedCaptionTrackId" to selectedCaptionTrackId().orEmpty(),
            "audioTracks" to audioTracksPayload(),
            "selectedAudioTrackId" to selectedAudioTrackId().orEmpty(),
          ))
        )
      }
      sendStatusChange()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (player !== owner) return
      // Native controls and MediaSession commands must update intent too. Lifecycle
      // pauses preserve it so a foreground transition can resume only when wanted.
      if (!isTv || !tvSuspended) shouldPlay = playWhenReady
      // While buffering/suppressed, isPlaying may remain false for both play and
      // pause. Publish intent now, before source-load can replay an old JS intent.
      sendStatusChange()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (player !== owner) return
      onPlayingChange(sourceEventPayload(mapOf("playbackId" to currentPlaybackId.orEmpty(), "isPlaying" to isPlaying)))
      sendStatusChange()
    }

    override fun onPlayerError(error: PlaybackException) {
      if (player !== owner) return
      // Causes/localized messages can contain signed request URLs and DRM tokens.
      // The stable Media3 code is useful to callers without exposing credentials.
      val message = "Mux playback failed (${error.errorCodeName})."
      onSourceError(
        sourceEventPayload(mapOf(
          "playbackId" to currentPlaybackId.orEmpty(),
          "message" to message,
          "code" to error.errorCodeName
        ))
      )
      sendStatusChange("error", message)
    }

    override fun onTracksChanged(tracks: Tracks) {
      if (player !== owner) return
      sendStatusChange()
    }

    // The exact first-frame signal: the video renderer has handed a frame to
    // the surface. Event-driven, so a poster overlay can hide with no polling
    // latency. Emitted once per source; the flag resets in setSource/release.
    override fun onRenderedFirstFrame() {
      if (player !== owner) return
      if (didEmitFirstFrame) {
        return
      }
      didEmitFirstFrame = true
      onFirstFrame(sourceEventPayload(mapOf("playbackId" to currentPlaybackId.orEmpty())))
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (isTv) {
      tvAttached = true
      lifecycleContext = appContext.reactContext as? ReactContext
      hostResumed = lifecycleContext?.lifecycleState == LifecycleState.RESUMED
      lifecycleContext?.addLifecycleEventListener(this)
      updateTvLifecycle()
      scheduleTvFocus()
    }
    startTimeUpdates()
  }

  override fun onDetachedFromWindow() {
    if (isTv) {
      tvAttached = false
      lifecycleContext?.removeLifecycleEventListener(this)
      lifecycleContext = null
      updateTvLifecycle()
    }
    stopTimeUpdates()
    super.onDetachedFromWindow()
  }

  override fun onHostResume() {
    hostResumed = true
    updateTvLifecycle()
  }

  override fun onHostPause() {
    hostResumed = false
    updateTvLifecycle()
  }

  override fun onHostDestroy() {
    hostResumed = false
    release()
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    if (tvInitialized) updateTvLifecycle()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (tvInitialized) updateTvLifecycle()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    // Track-selection popups may take window focus; do not pause their player.
    if (tvInitialized && isTv && !hasWindowFocus) backPressHandler.reset()
  }

  private fun updateTvLifecycle() {
    if (!isTv) return
    tvSuspended = !tvAttached || !hostResumed || !isShown || windowVisibility != View.VISIBLE
    if (tvSuspended) {
      mainHandler.removeCallbacks(requestTvFocus)
      backPressHandler.reset()
      player?.pause()
      detachNowPlaying()
      stopTimeUpdates()
    } else {
      player?.playWhenReady = shouldPlay
      if (nowPlayingEnabled) attachNowPlaying()
      startTimeUpdates()
      scheduleTvFocus()
    }
  }

  private fun scheduleTvFocus() {
    if (!isTv) return
    mainHandler.removeCallbacks(requestTvFocus)
    mainHandler.post(requestTvFocus)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (!isTv) return super.dispatchKeyEvent(event)
    // Leave host navigation alone when this player is not the focused playback view.
    if (tvSuspended || player == null || !hasFocus() || !playerView.useController) return false
    if (event.keyCode == KeyEvent.KEYCODE_BACK) {
      val consumed = when (event.action) {
        KeyEvent.ACTION_DOWN -> backPressHandler.onDown(event.repeatCount, playerView.isControllerFullyVisible)
        KeyEvent.ACTION_UP -> backPressHandler.onUp()
        else -> false
      }
      if (consumed && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        playerView.hideController()
        // Hidden control children must not strand focus outside the player.
        playerView.requestFocus()
      }
      return consumed
    }
    // This is the only native routing path. Falling back to super would dispatch
    // the same event to the PlayerView child twice. Unhandled events bubble to host.
    return playerView.dispatchKeyEvent(event)
  }

  fun setSource(source: MuxVideoSourceRecord?) {
    pendingSource = source
    hasPendingSource = true
  }

  fun applyPendingSource() {
    pendingPlaybackIntent?.let { intent ->
      pendingPlaybackIntent = null
      // Commit the revision before applying intent: synchronous player callbacks
      // acknowledge this atomic prop, while earlier command events keep the old revision.
      val needsAcknowledgment = playbackIntentRevision != intent.revision && shouldPlay == intent.playWhenReady
      playbackIntentRevision = intent.revision
      setPlayWhenReady(intent.playWhenReady)
      // An imperative command may already have applied this value. Acknowledge
      // the new revision once even if setPlayWhenReady has no state change to emit.
      if (needsAcknowledgment) sendStatusChange()
    }
    if (!hasPendingSource) return
    val source = pendingSource
    pendingSource = null
    hasPendingSource = false
    applySource(source)
  }

  fun setPlaybackIntent(intent: MuxPlaybackIntentRecord?) {
    pendingPlaybackIntent = intent
  }

  private fun applySource(source: MuxVideoSourceRecord?) {
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
    currentSourceId = source.sourceId
    didEmitSourceLoad = false
    didEmitFirstFrame = false
    sendStatusChange("loading")

    // A still-warming preload player for this asset must not race the real
    // player for bandwidth; whatever it fetched is already in the shared cache.
    MuxPreloadManager.consume(source.playbackId)

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
    player = nextPlayer
    playerView.player = nextPlayer
    applyPlayerConfiguration()
    val listener = createPlayerListener(nextPlayer)
    playerListener = listener
    nextPlayer.addListener(listener)
    nextPlayer.setMediaItem(source.toMediaItem())
    nextPlayer.playWhenReady = shouldPlay && (!isTv || !tvSuspended)
    nextPlayer.prepare()
    startTimeUpdates()
    scheduleTvFocus()

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
    if (isTv) {
      // useController=false hides UI but does not clear a focused descendant.
      // Exclude the entire native subtree so the JS overlay/host owns D-pad,
      // select and Back; dispatchKeyEvent already declines this mode.
      playerView.descendantFocusability = if (enabled) {
        ViewGroup.FOCUS_AFTER_DESCENDANTS
      } else {
        ViewGroup.FOCUS_BLOCK_DESCENDANTS
      }
      playerView.isFocusableInTouchMode = enabled
      playerView.isFocusable = enabled
      playerView.importantForAccessibility = if (enabled) {
        View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
      } else {
        View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      }
      if (enabled) {
        attachNowPlaying()
        scheduleTvFocus()
      } else {
        mainHandler.removeCallbacks(requestTvFocus)
        backPressHandler.reset()
        playerView.clearFocus()
        clearFocus()
        // A MediaSession can receive transport keys outside view dispatch and
        // duplicate the custom overlay's JS handler. Restore it in native mode.
        detachNowPlaying()
      }
    }
  }

  fun setCaptionStyle(style: MuxCaptionStyleRecord?) {
    val subtitleView = playerView.subtitleView ?: return
    if (style == null) {
      subtitleView.setApplyEmbeddedStyles(true)
      subtitleView.setUserDefaultStyle()
      subtitleView.setUserDefaultTextSize()
      return
    }
    subtitleView.setApplyEmbeddedStyles(false)
    subtitleView.setStyle(
      CaptionStyleCompat(
        parseColor(style.textColor) ?: Color.WHITE,
        parseColor(style.backgroundColor) ?: Color.TRANSPARENT,
        Color.TRANSPARENT,
        CaptionStyleCompat.EDGE_TYPE_NONE,
        Color.WHITE,
        null,
      )
    )
    style.fontScale?.let { scale ->
      subtitleView.setFractionalTextSize(
        SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale.toFloat()
      )
    }
  }

  private fun parseColor(value: String?): Int? {
    if (value.isNullOrBlank()) {
      return null
    }
    return try {
      Color.parseColor(value)
    } catch (error: IllegalArgumentException) {
      null
    }
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

    val selection = findTrack(trackId, C.TRACK_TYPE_TEXT) ?: return
    currentPlayer.trackSelectionParameters = builder
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
      .setOverrideForType(
        TrackSelectionOverride(selection.trackGroup, listOf(selection.trackIndex))
      )
      .build()
    sendStatusChange()
  }

  fun setAudioTrack(trackId: String?) {
    val currentPlayer = player ?: return
    val builder = currentPlayer.trackSelectionParameters.buildUpon()

    if (trackId == null) {
      currentPlayer.trackSelectionParameters = builder
        .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
        .build()
      sendStatusChange()
      return
    }

    val selection = findTrack(trackId, C.TRACK_TYPE_AUDIO) ?: return
    currentPlayer.trackSelectionParameters = builder
      .setOverrideForType(
        TrackSelectionOverride(selection.trackGroup, listOf(selection.trackIndex))
      )
      .build()
    sendStatusChange()
  }

  fun play() {
    shouldPlay = true
    if (!isTv || !tvSuspended) player?.play()
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
      play()
    }
    sendStatusChange()
    sendTimeUpdate()
  }

  fun release() {
    pendingPlaybackIntent = null
    pendingSource = null
    hasPendingSource = false
    releasePlayer()
    sourceFingerprint = null
    currentPlaybackId = null
    currentSourceId = null
    didEmitSourceLoad = false
    didEmitFirstFrame = false
    shouldPlay = false
    sendStatusChange("idle")
  }

  private fun applyPlayerConfiguration() {
    player?.volume = if (muted) 0f else volume
    player?.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    player?.setPlaybackSpeed(playbackRate)
  }

  private fun releasePlayer() {
    stopTimeUpdates()
    mainHandler.removeCallbacks(requestTvFocus)
    backPressHandler.reset()
    detachNowPlaying()
    val oldPlayer = player
    player = null
    playerView.player = null
    playerListener?.let { oldPlayer?.removeListener(it) }
    playerListener = null
    oldPlayer?.release()
  }

  private fun attachNowPlaying() {
    if (!nowPlayingEnabled || (isTv && (tvSuspended || !playerView.useController))) return
    val currentPlayer = player ?: return
    val session = mediaSession ?: MediaSession.Builder(context, currentPlayer)
      .setId("mux-now-playing-${hashCode()}")
      .build()
      .also { mediaSession = it }

    // TV transport integration uses the session; phone notification UI is mobile-only.
    if (isTv) return

    if (notificationManager == null) {
      val manager = PlayerNotificationManager.Builder(
        context,
        NOW_PLAYING_NOTIFICATION_ID,
        NOW_PLAYING_CHANNEL_ID,
      )
        .setChannelNameResourceId(R.string.mux_now_playing_channel_name)
        .build()
      manager.setMediaSessionToken(session.platformToken)
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
    if (!isAttachedToWindow || player == null || (isTv && tvSuspended)) return
    mainHandler.postDelayed(timeUpdateRunnable, timeUpdateEventIntervalMs)
  }

  private fun stopTimeUpdates() {
    mainHandler.removeCallbacks(timeUpdateRunnable)
  }

  private fun sendTimeUpdate() {
    if (currentPlaybackId.isNullOrBlank()) return
    onTimeUpdate(
      sourceEventPayload(mapOf(
        "playbackId" to currentPlaybackId.orEmpty(),
        "currentTime" to currentTimeSeconds(),
        "duration" to durationSeconds(),
        "bufferedPosition" to bufferedPositionSeconds()
      ))
    )
  }

  private fun sendStatusChange(status: String? = null, error: String? = null) {
    if (currentPlaybackId.isNullOrBlank()) return
    val resolvedStatus = status ?: inferStatus()
    val payload = mutableMapOf<String, Any>(
      "playbackId" to currentPlaybackId.orEmpty(),
      "playbackIntentRevision" to playbackIntentRevision,
      "status" to resolvedStatus,
      "currentTime" to currentTimeSeconds(),
      "duration" to durationSeconds(),
      "bufferedPosition" to bufferedPositionSeconds(),
      "muted" to muted,
      "volume" to volume.toDouble(),
      "loop" to loop,
      "playbackRate" to playbackRate.toDouble(),
      "captionTracks" to captionTracksPayload(),
      "selectedCaptionTrackId" to selectedCaptionTrackId().orEmpty(),
      "audioTracks" to audioTracksPayload(),
      "selectedAudioTrackId" to selectedAudioTrackId().orEmpty(),
      // AirPlay is iOS-only; Android has no external-playback equivalent here.
      "externalPlaybackActive" to false,
      "isLive" to (player?.isCurrentMediaItemLive ?: false),
      // media3 normalizes the live/DVR timeline to the current window (0..duration).
      "seekableStart" to 0.0,
      "seekableEnd" to durationSeconds(),
    )

    // Expo can set source before playWhenReady in the same prop update. Initial
    // loading/ready notifications must not overwrite the pending JS play intent.
    if (resolvedStatus != "loading" && resolvedStatus != "ready") {
      payload["playWhenReady"] = shouldPlay
    }

    if (error != null) {
      payload["error"] = error
    }

    onStatusChange(
      sourceEventPayload(payload)
    )
  }

  private fun sourceEventPayload(payload: Map<String, Any>): Map<String, Any> =
    currentSourceId?.let { payload + ("sourceId" to it) } ?: payload

  private fun inferStatus(): String {
    val player = player ?: return "idle"
    if (player.playerError != null) return "error"
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

  private fun findTrack(trackId: String, trackType: Int): TrackSelection? {
    val currentPlayer = player ?: return null

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != trackType) {
        return@forEachIndexed
      }

      for (trackIndex in 0 until group.length) {
        if ("$groupIndex:$trackIndex" == trackId && group.isTrackSupported(trackIndex)) {
          return TrackSelection(trackId, group.mediaTrackGroup, trackIndex)
        }
      }
    }

    return null
  }

  private fun audioTracksPayload(): List<Map<String, Any>> {
    val currentPlayer = player ?: return emptyList()
    val tracks = mutableListOf<Map<String, Any>>()
    var fallbackIndex = 1

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_AUDIO) {
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
          ?: "Audio ${fallbackIndex++}"
        val payload = mutableMapOf<String, Any>(
          "id" to "$groupIndex:$trackIndex",
          "label" to label,
        )

        language?.takeIf { it.isNotBlank() }?.let {
          payload["language"] = it
        }

        tracks.add(payload)
      }
    }

    return tracks
  }

  private fun selectedAudioTrackId(): String? {
    val currentPlayer = player ?: return null

    currentPlayer.currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_AUDIO) {
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
