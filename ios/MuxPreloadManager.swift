import AVFoundation
import Foundation
import MuxPlayerSwift

/// Data-only media preloading: a bounded pool of paused, muted players warming
/// detached `AVPlayerItem`s.
///
/// A plain `AVPlayer` has no cross-item media cache, so unlike Android the
/// warmed bytes live inside the buffered `AVPlayerItem` itself. The pool
/// therefore hands the item across: when a `MuxVideoView` receives a source
/// whose playback-affecting fields match a pooled entry, it adopts the warmed
/// item — and the buffer it accumulated — instead of building a cold one.
///
/// DRM sources are rejected before an item is created: a FairPlay license
/// exchange outside an active playback session could consume single-use
/// tokens with no surface to play on.
///
/// Main-thread only, matching the view lifecycle that consumes it.
final class MuxPreloadManager {
  static let shared = MuxPreloadManager()

  private struct Entry {
    let playbackId: String
    let playbackFingerprint: String
    let player: AVPlayer
    let item: AVPlayerItem
  }

  /// Preloads beyond this are evicted oldest-first; keeps memory bounded.
  private let maxConcurrentPreloads = 3

  /// Insertion-ordered so eviction is oldest-first.
  private var entries: [Entry] = []

  func preload(source: MuxVideoSourceRecord, bufferAheadSeconds: Double) {
    let playbackId = source.playbackId
    guard !playbackId.isEmpty else {
      return
    }
    if let drmToken = source.drmToken, !drmToken.isEmpty {
      return
    }
    guard !entries.contains(where: { $0.playbackId == playbackId }) else {
      return
    }

    while entries.count >= maxConcurrentPreloads {
      discard(entries.removeFirst())
    }

    let item = AVPlayerItem(
      playbackID: playbackId,
      playbackOptions: source.toPlaybackOptions()
    )
    item.preferredForwardBufferDuration = min(30, max(1, bufferAheadSeconds))

    // A paused AVPlayer still buffers its current item toward
    // preferredForwardBufferDuration; playback never starts here.
    let player = AVPlayer(playerItem: item)
    player.isMuted = true
    player.automaticallyWaitsToMinimizeStalling = true

    entries.append(
      Entry(
        playbackId: playbackId,
        playbackFingerprint: source.playbackFingerprint,
        player: player,
        item: item
      )
    )
  }

  /// Pops the warmed item for a source whose playback-affecting fields match.
  /// Metadata-only differences (Mux Data fields) do not prevent adoption, which
  /// is why this matches on ``MuxVideoSourceRecord/playbackFingerprint`` rather
  /// than the full source fingerprint.
  func takeItem(matchingPlaybackFingerprint fingerprint: String) -> AVPlayerItem? {
    guard let index = entries.firstIndex(where: { $0.playbackFingerprint == fingerprint }) else {
      return nil
    }
    let entry = entries.remove(at: index)
    entry.player.replaceCurrentItem(with: nil)
    return entry.item
  }

  func cancel(playbackId: String) {
    while let index = entries.firstIndex(where: { $0.playbackId == playbackId }) {
      discard(entries.remove(at: index))
    }
  }

  func cancelAll() {
    while !entries.isEmpty {
      discard(entries.removeFirst())
    }
  }

  private func discard(_ entry: Entry) {
    entry.player.replaceCurrentItem(with: nil)
  }
}
