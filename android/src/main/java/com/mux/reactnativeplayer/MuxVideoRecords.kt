package com.mux.reactnativeplayer

import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.mux.player.media.MediaItems
import com.mux.player.media.PlaybackResolution
import com.mux.player.media.RenditionOrder
import com.mux.stats.sdk.core.model.CustomData
import com.mux.stats.sdk.core.model.CustomerData
import com.mux.stats.sdk.core.model.CustomerPlayerData
import com.mux.stats.sdk.core.model.CustomerVideoData
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class MuxVideoClippingRecord : Record {
  @Field
  var assetStartTime: Double? = null

  @Field
  var assetEndTime: Double? = null
}

class MuxVideoMetadataRecord : Record {
  @Field
  var envKey: String? = null

  @Field
  var playerName: String? = null

  @Field
  var playerVersion: String? = null

  @Field
  var videoTitle: String? = null

  @Field
  var videoId: String? = null

  @Field
  var videoSeries: String? = null

  @Field
  var viewerUserId: String? = null

  @Field
  var customData: Map<String, String>? = null
}

class MuxVideoSourceRecord : Record {
  @Field
  var playbackId: String = ""

  @Field
  var playbackToken: String? = null

  @Field
  var drmToken: String? = null

  @Field
  var customDomain: String? = null

  @Field
  var minResolution: String? = null

  @Field
  var maxResolution: String? = null

  @Field
  var renditionOrder: String = "default"

  @Field
  var clipping: MuxVideoClippingRecord? = null

  @Field
  var metadata: MuxVideoMetadataRecord? = null

  val fingerprint: String
    get() = listOf(
      playbackId,
      playbackToken.orEmpty(),
      drmToken.orEmpty(),
      customDomain.orEmpty(),
      minResolution.orEmpty(),
      maxResolution.orEmpty(),
      renditionOrder,
      clipping?.assetStartTime?.toString().orEmpty(),
      clipping?.assetEndTime?.toString().orEmpty(),
      metadata?.envKey.orEmpty(),
      metadata?.playerName.orEmpty(),
      metadata?.playerVersion.orEmpty(),
      metadata?.videoTitle.orEmpty(),
      metadata?.videoId.orEmpty(),
      metadata?.videoSeries.orEmpty(),
      metadata?.viewerUserId.orEmpty(),
      metadata?.customData?.toSortedMap()?.entries?.joinToString { "${it.key}:${it.value}" }.orEmpty(),
    ).joinToString("|")

  fun toMediaItem(): MediaItem {
    val builder = MediaItems.builderFromMuxPlaybackId(
      playbackId = playbackId,
      maxResolution = maxResolution.toPlaybackResolution(),
      minResolution = minResolution.toPlaybackResolution(),
      renditionOrder = renditionOrder.toRenditionOrder(),
      assetStartTime = clipping?.assetStartTime,
      assetEndTime = clipping?.assetEndTime,
      domain = customDomain,
      playbackToken = playbackToken,
      drmToken = drmToken,
    )

    metadata?.videoTitle?.let { title ->
      builder.setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(title)
          .build()
      )
    }

    return builder.build()
  }

  fun toCustomerData(): CustomerData {
    val metadata = metadata
    return CustomerData().apply {
      customerPlayerData = CustomerPlayerData().apply {
        environmentKey = metadata?.envKey
        playerName = metadata?.playerName ?: "MuxReactNativePlayer"
        playerVersion = metadata?.playerVersion
        viewerUserId = metadata?.viewerUserId
      }
      customerVideoData = CustomerVideoData().apply {
        videoTitle = metadata?.videoTitle
        videoId = metadata?.videoId
        videoSeries = metadata?.videoSeries
      }
      customData = CustomData().apply {
        applyCustomData(metadata?.customData)
      }
    }
  }
}

private fun String?.toPlaybackResolution(): PlaybackResolution? {
  return when (this) {
    "480p" -> PlaybackResolution.LD_480
    "540p" -> PlaybackResolution.LD_540
    "720p" -> PlaybackResolution.HD_720
    "1080p" -> PlaybackResolution.FHD_1080
    "1440p" -> PlaybackResolution.QHD_1440
    "2160p" -> PlaybackResolution.FOUR_K_2160
    else -> null
  }
}

private fun String?.toRenditionOrder(): RenditionOrder? {
  return when (this) {
    "desc" -> RenditionOrder.Descending
    "default" -> RenditionOrder.Default
    else -> null
  }
}

private fun CustomData.applyCustomData(values: Map<String, String>?) {
  customData1 = values?.get("customData1")
  customData2 = values?.get("customData2")
  customData3 = values?.get("customData3")
  customData4 = values?.get("customData4")
  customData5 = values?.get("customData5")
  customData6 = values?.get("customData6")
  customData7 = values?.get("customData7")
  customData8 = values?.get("customData8")
  customData9 = values?.get("customData9")
  customData10 = values?.get("customData10")
}
