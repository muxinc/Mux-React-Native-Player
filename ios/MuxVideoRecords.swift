import ExpoModulesCore
import Foundation
import MuxCore
import MuxPlayerSwift

struct MuxVideoClippingRecord: Record {
  @Field var assetStartTime: Double?
  @Field var assetEndTime: Double?
}

struct MuxCaptionStyleRecord: Record {
  @Field var textColor: String?
  @Field var backgroundColor: String?
  @Field var fontScale: Double?
}

struct MuxVideoMetadataRecord: Record {
  @Field var envKey: String?
  @Field var playerName: String?
  @Field var playerVersion: String?
  @Field var videoTitle: String?
  @Field var videoId: String?
  @Field var videoSeries: String?
  @Field var viewerUserId: String?
  @Field var customData: [String: String]?
}

struct MuxVideoSourceRecord: Record {
  @Field var playbackId: String = ""
  @Field var playbackToken: String?
  @Field var drmToken: String?
  @Field var thumbnailToken: String?
  @Field var storyboardToken: String?
  @Field var customDomain: String?
  @Field var minResolution: String?
  @Field var maxResolution: String?
  @Field var renditionOrder: String = "default"
  @Field var clipping: MuxVideoClippingRecord?
  @Field var metadata: MuxVideoMetadataRecord?

  var fingerprint: String {
    var values: [String] = []
    values.append(playbackId)
    values.append(playbackToken ?? "")
    values.append(drmToken ?? "")
    values.append(thumbnailToken ?? "")
    values.append(storyboardToken ?? "")
    values.append(customDomain ?? "")
    values.append(minResolution ?? "")
    values.append(maxResolution ?? "")
    values.append(renditionOrder)
    values.append(clipping?.assetStartTime.map { String($0) } ?? "")
    values.append(clipping?.assetEndTime.map { String($0) } ?? "")
    values.append(metadata?.envKey ?? "")
    values.append(metadata?.playerName ?? "")
    values.append(metadata?.playerVersion ?? "")
    values.append(metadata?.videoTitle ?? "")
    values.append(metadata?.videoId ?? "")
    values.append(metadata?.videoSeries ?? "")
    values.append(metadata?.viewerUserId ?? "")
    let customDataFingerprint = metadata?.customData?
      .sorted { $0.key < $1.key }
      .map { "\($0.key):\($0.value)" }
      .joined(separator: ",") ?? ""
    values.append(customDataFingerprint)

    return values.joined(separator: "|")
  }

  /// Build the Mux thumbnail URL used as lock-screen / Now Playing artwork.
  func artworkURL() -> URL? {
    guard !playbackId.isEmpty else {
      return nil
    }
    let host: String
    if let domain = blankToNil(customDomain) {
      host = "image.\(domain)"
    } else {
      host = "image.mux.com"
    }
    var components = URLComponents()
    components.scheme = "https"
    components.host = host
    components.path = "/\(playbackId)/thumbnail.jpg"
    if let token = blankToNil(thumbnailToken) {
      components.queryItems = [URLQueryItem(name: "token", value: token)]
    }
    return components.url
  }

  func toPlaybackOptions() -> PlaybackOptions {
    if let playbackToken, let drmToken {
      return PlaybackOptions(
        playbackToken: playbackToken,
        drmToken: drmToken,
        customDomain: blankToNil(customDomain)
      )
    }

    if let customDomain = blankToNil(customDomain), let playbackToken {
      return PlaybackOptions(customDomain: customDomain, playbackToken: playbackToken)
    }

    if let playbackToken {
      return PlaybackOptions(playbackToken: playbackToken)
    }

    if let customDomain = blankToNil(customDomain) {
      return PlaybackOptions(
        customDomain: customDomain,
        maximumResolutionTier: maxResolution.toMaxResolutionTier(),
        minimumResolutionTier: minResolution.toMinResolutionTier(),
        renditionOrder: renditionOrder.toRenditionOrder()
      )
    }

    if let clipping = clipping?.toInstantClipping() {
      return PlaybackOptions(
        maximumResolutionTier: maxResolution.toMaxResolutionTier(),
        minimumResolutionTier: minResolution.toMinResolutionTier(),
        renditionOrder: renditionOrder.toRenditionOrder(),
        clipping: clipping
      )
    }

    return PlaybackOptions(
      maximumResolutionTier: maxResolution.toMaxResolutionTier(),
      minimumResolutionTier: minResolution.toMinResolutionTier(),
      renditionOrder: renditionOrder.toRenditionOrder()
    )
  }

  func toMonitoringOptions() -> MonitoringOptions {
    let customerData = toCustomerData()
    let playerName = blankToNil(metadata?.playerName) ?? "MuxReactNativePlayer"
    return MonitoringOptions(
      customerData: customerData,
      playerName: playerName,
      automaticErrorTracking: true
    )
  }

  func toCustomerData() -> MUXSDKCustomerData {
    let customerData = MUXSDKCustomerData()

    let customerPlayerData = MUXSDKCustomerPlayerData()
    customerPlayerData.environmentKey = blankToNil(metadata?.envKey)
    customerPlayerData.playerName = blankToNil(metadata?.playerName) ?? "MuxReactNativePlayer"
    customerPlayerData.playerVersion = blankToNil(metadata?.playerVersion)
    customerPlayerData.viewerUserId = blankToNil(metadata?.viewerUserId)
    customerData.customerPlayerData = customerPlayerData

    let customerVideoData = MUXSDKCustomerVideoData()
    customerVideoData.videoTitle = blankToNil(metadata?.videoTitle)
    customerVideoData.videoId = blankToNil(metadata?.videoId)
    customerVideoData.videoSeries = blankToNil(metadata?.videoSeries)
    customerData.customerVideoData = customerVideoData

    let customData = MUXSDKCustomData()
    customData.customData1 = metadata?.customData?["customData1"]
    customData.customData2 = metadata?.customData?["customData2"]
    customData.customData3 = metadata?.customData?["customData3"]
    customData.customData4 = metadata?.customData?["customData4"]
    customData.customData5 = metadata?.customData?["customData5"]
    customData.customData6 = metadata?.customData?["customData6"]
    customData.customData7 = metadata?.customData?["customData7"]
    customData.customData8 = metadata?.customData?["customData8"]
    customData.customData9 = metadata?.customData?["customData9"]
    customData.customData10 = metadata?.customData?["customData10"]
    customerData.customData = customData

    return customerData
  }
}

private func blankToNil(_ value: String?) -> String? {
  guard let value, !value.isEmpty else {
    return nil
  }
  return value
}

private extension MuxVideoClippingRecord {
  func toInstantClipping() -> InstantClipping? {
    switch (assetStartTime, assetEndTime) {
    case let (start?, end?):
      return InstantClipping(assetStartTimeInSeconds: start, assetEndTimeInSeconds: end)
    case let (start?, nil):
      return InstantClipping(assetStartTimeInSeconds: start)
    case let (nil, end?):
      return InstantClipping(assetEndTimeInSeconds: end)
    default:
      return nil
    }
  }
}

private extension Optional where Wrapped == String {
  func toMaxResolutionTier() -> MaxResolutionTier {
    switch self {
    case "720p":
      return .upTo720p
    case "1080p":
      return .upTo1080p
    case "1440p":
      return .upTo1440p
    case "2160p":
      return .upTo2160p
    default:
      return .default
    }
  }

  func toMinResolutionTier() -> MinResolutionTier {
    switch self {
    case "480p":
      return .atLeast480p
    case "540p":
      return .atLeast540p
    case "720p":
      return .atLeast720p
    case "1080p":
      return .atLeast1080p
    case "1440p":
      return .atLeast1440p
    case "2160p":
      return .atLeast2160p
    default:
      return .default
    }
  }
}

private extension String {
  func toRenditionOrder() -> RenditionOrder {
    switch self {
    case "desc":
      return .descending
    default:
      return .default
    }
  }
}
