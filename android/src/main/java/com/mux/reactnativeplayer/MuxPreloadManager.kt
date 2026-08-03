package com.mux.reactnativeplayer

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import com.mux.player.MuxPlayer
import com.mux.stats.sdk.core.model.CustomerData
import com.mux.stats.sdk.core.model.CustomerPlayerData

/**
 * Data-only media preloading: a bounded pool of headless, paused players that
 * warm the shared smart cache.
 *
 * Every `MuxPlayer` built with `enableSmartCache(true)` writes through the same
 * on-disk cache (`CacheDatastore` under the app's files directory), so bytes a
 * preload player fetches here are read straight back from disk by the next
 * `MuxVideoView` player for the same asset. That is the whole mechanism: warm
 * the cache up to the requested buffer target, release the player, and the
 * eventual real playback starts from disk instead of the network. No player
 * instance is ever handed across, so nothing about the view's playback path
 * changes.
 *
 * A preload player never renders (no surface is attached) and never plays
 * (`playWhenReady` stays false), so Mux Data records no view for it. Its
 * monitoring data still carries a distinct player name so any telemetry it
 * does produce is filterable.
 *
 * DRM sources are rejected: a license exchange outside an active playback
 * session could consume single-use tokens with no surface to play on.
 */
@OptIn(UnstableApi::class)
object MuxPreloadManager {
  /** Preloads beyond this are evicted oldest-first; keeps memory bounded. */
  private const val MAX_CONCURRENT_PRELOADS = 3

  /** A stalled preload (dead network) must not hold a player forever. */
  private const val PRELOAD_TIMEOUT_MS = 30_000L

  private const val PRELOAD_PLAYER_NAME = "MuxReactNativePlayer Preload"

  private val mainHandler = Handler(Looper.getMainLooper())

  /** Insertion-ordered so eviction is oldest-first. Main-thread only. */
  private val entries = LinkedHashMap<String, Entry>()

  private class Entry(
    val player: MuxPlayer,
    val listener: Player.Listener,
    val timeout: Runnable,
  )

  fun preload(context: Context, source: MuxVideoSourceRecord, bufferAheadSeconds: Double) {
    val playbackId = source.playbackId
    if (playbackId.isBlank() || !source.drmToken.isNullOrBlank()) {
      return
    }
    val applicationContext = context.applicationContext

    runOnMain {
      if (entries.containsKey(playbackId)) {
        return@runOnMain
      }
      while (entries.size >= MAX_CONCURRENT_PRELOADS) {
        val oldest = entries.keys.firstOrNull() ?: break
        removeEntry(oldest)
      }

      val bufferMs = (bufferAheadSeconds.coerceIn(1.0, 30.0) * 1000).toInt()
      // min == max == the preload target: the player loads exactly that much
      // and then reports isLoading=false, which is the release signal below.
      val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(
          bufferMs,
          bufferMs,
          minOf(500, bufferMs),
          minOf(1_500, bufferMs),
        )
        .setPrioritizeTimeOverSizeThresholds(true)
        .build()

      val builder = MuxPlayer.Builder(applicationContext)
        .enableSmartCache(true)
        .applyExoConfig {
          setLoadControl(loadControl)
        }
        .addMonitoringData(preloadCustomerData(source))
      source.metadata?.envKey?.takeIf { it.isNotBlank() }?.let {
        builder.setMuxDataEnv(it)
      }

      val player = builder.build()
      val timeout = Runnable { removeEntry(playbackId) }
      val listener = object : Player.Listener {
        override fun onIsLoadingChanged(isLoading: Boolean) {
          // Loading stops once the load control's buffer target is met. The
          // cache now holds everything a startup needs, so free the player.
          if (!isLoading && player.playbackState == Player.STATE_READY) {
            removeEntry(playbackId)
          }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
          if (playbackState == Player.STATE_ENDED) {
            removeEntry(playbackId)
          }
        }

        override fun onPlayerError(error: PlaybackException) {
          // Best-effort: drop the preload and let playback cold-start later.
          removeEntry(playbackId)
        }
      }

      player.addListener(listener)
      player.volume = 0f
      player.playWhenReady = false
      player.setMediaItem(source.toMediaItem())
      player.prepare()

      entries[playbackId] = Entry(player, listener, timeout)
      mainHandler.postDelayed(timeout, PRELOAD_TIMEOUT_MS)
    }
  }

  /**
   * Called by `MuxVideoView.setSource` when an asset goes live: a still-warming
   * preload player must not race the real player for bandwidth, and whatever it
   * already fetched is in the shared cache regardless.
   */
  fun consume(playbackId: String) {
    runOnMain { removeEntry(playbackId) }
  }

  fun cancel(playbackId: String) {
    runOnMain { removeEntry(playbackId) }
  }

  fun cancelAll() {
    runOnMain {
      for (playbackId in entries.keys.toList()) {
        removeEntry(playbackId)
      }
    }
  }

  private fun removeEntry(playbackId: String) {
    val entry = entries.remove(playbackId) ?: return
    mainHandler.removeCallbacks(entry.timeout)
    entry.player.removeListener(entry.listener)
    entry.player.release()
  }

  private fun preloadCustomerData(source: MuxVideoSourceRecord): CustomerData {
    return source.toCustomerData().apply {
      customerPlayerData = (customerPlayerData ?: CustomerPlayerData()).apply {
        playerName = PRELOAD_PLAYER_NAME
      }
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }
}
