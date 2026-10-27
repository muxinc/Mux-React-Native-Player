import Foundation

/// Kept independent of AVFoundation so URL policy can be tested on the host.
enum MuxPlaybackURL {
  enum SourceError: String, Error {
    case invalidSource = "Invalid Mux playback source."
    case unsupportedDRM = "DRM playback is not supported on tvOS in this release."
  }

  static func make(
    playbackId: String, playbackToken: String? = nil, drmToken: String? = nil,
    customDomain: String? = nil, minResolution: String? = nil,
    maxResolution: String? = nil, renditionOrder: String = "default",
    assetStartTime: Double? = nil, assetEndTime: Double? = nil
  ) throws -> URL {
    if let drmToken, !drmToken.isEmpty { throw SourceError.unsupportedDRM }
    guard !playbackId.isEmpty else { throw SourceError.invalidSource }
    let domain = customDomain.flatMap { $0.isEmpty ? nil : $0 } ?? "mux.com"
    // A root hostname, never a URL, port, path, or credentials.
    guard domain.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ label in
      !label.isEmpty && label.first != "-" && label.last != "-" &&
        label.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-").contains($0) }
    }) else { throw SourceError.invalidSource }
    var components = URLComponents()
    components.scheme = "https"
    components.host = "stream.\(domain)"
    let segmentCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    guard let encodedID = playbackId.addingPercentEncoding(withAllowedCharacters: segmentCharacters) else {
      throw SourceError.invalidSource
    }
    components.percentEncodedPath = "/\(encodedID).m3u8"
    var query: [URLQueryItem] = []
    if let token = playbackToken, !token.isEmpty {
      // Mux signed parameters belong in JWT claims, as in Mux Player Swift.
      query.append(URLQueryItem(name: "token", value: token))
    } else {
      let resolutions = ["480p", "540p", "720p", "1080p", "1440p", "2160p"]
      for (name, value) in [("min_resolution", minResolution), ("max_resolution", maxResolution)] {
        if let value, value != "default" {
          guard resolutions.contains(value) else { throw SourceError.invalidSource }
          query.append(URLQueryItem(name: name, value: value))
        }
      }
      if renditionOrder == "desc" { query.append(URLQueryItem(name: "rendition_order", value: "desc")) }
      for (name, value) in [("asset_start_time", assetStartTime), ("asset_end_time", assetEndTime)] {
        if let value {
          guard value.isFinite && value >= 0 else { throw SourceError.invalidSource }
          query.append(URLQueryItem(name: name, value: String(value)))
        }
      }
      if let start = assetStartTime, let end = assetEndTime, start >= end { throw SourceError.invalidSource }
    }
    if !query.isEmpty { components.queryItems = query }
    guard let url = components.url else { throw SourceError.invalidSource }
    return url
  }
}
