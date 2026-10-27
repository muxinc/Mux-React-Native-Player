import Foundation

// Run: swiftc ios/MuxPlaybackURL.swift test/apple/MuxPlaybackURLTests.swift -o /tmp/mux-url-tests && /tmp/mux-url-tests
@main
enum MuxPlaybackURLTests {
  static func main() throws {
    let publicURL = try MuxPlaybackURL.make(playbackId: "public123")
    precondition(publicURL.absoluteString == "https://stream.mux.com/public123.m3u8")

    let combined = try MuxPlaybackURL.make(
      playbackId: "test/id?x#%", customDomain: "video.example.com",
      minResolution: "720p", maxResolution: "2160p", renditionOrder: "desc",
      assetStartTime: 1.25, assetEndTime: 20
    )
    let components = URLComponents(url: combined, resolvingAgainstBaseURL: false)!
    precondition(components.host == "stream.video.example.com")
    precondition(components.percentEncodedPath == "/test%2Fid%3Fx%23%25.m3u8")
    let params = Dictionary(uniqueKeysWithValues: components.queryItems!.map { ($0.name, $0.value!) })
    precondition(params == ["min_resolution": "720p", "max_resolution": "2160p",
      "rendition_order": "desc", "asset_start_time": "1.25", "asset_end_time": "20.0"])

    let token = "header.payload.signature&other=secret#fragment+%"
    let signed = try MuxPlaybackURL.make(playbackId: "signed", playbackToken: token,
      customDomain: "media.example.com", minResolution: "720p", maxResolution: "1080p",
      renditionOrder: "desc", assetStartTime: 3, assetEndTime: 9)
    let signedComponents = URLComponents(url: signed, resolvingAgainstBaseURL: false)!
    precondition(signedComponents.host == "stream.media.example.com")
    precondition(signedComponents.queryItems == [URLQueryItem(name: "token", value: token)])
    precondition(signedComponents.fragment == nil)

    let emptyToken = try MuxPlaybackURL.make(playbackId: "public", playbackToken: "", assetEndTime: 5)
    precondition(URLComponents(url: emptyToken, resolvingAgainstBaseURL: false)!.queryItems ==
      [URLQueryItem(name: "asset_end_time", value: "5.0")])

    for domain in ["https://example.com", "example.com/path", "example.com:443", "user@example.com", ".example.com", "example..com"] {
      expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "id", customDomain: domain) }
    }
    expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "") }
    expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "id", assetStartTime: .nan) }
    expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "id", assetEndTime: .infinity) }
    expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "id", assetStartTime: -1) }
    expect(.invalidSource) { try MuxPlaybackURL.make(playbackId: "id", assetStartTime: 10, assetEndTime: 5) }
    expect(.unsupportedDRM) { try MuxPlaybackURL.make(playbackId: "id", drmToken: "secret") }
    print("MuxPlaybackURL: all public, signed, encoding, clipping, domain and DRM checks passed")
  }

  static func expect(_ expected: MuxPlaybackURL.SourceError, _ build: () throws -> URL) {
    do {
      _ = try build()
      preconditionFailure("Expected source rejection")
    } catch {
      precondition(error as? MuxPlaybackURL.SourceError == expected)
      precondition(!String(describing: error).contains("secret"))
    }
  }
}
