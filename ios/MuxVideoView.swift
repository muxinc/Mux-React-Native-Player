import AVFoundation
import AVKit
import ExpoModulesCore
import MuxPlayerSwift
import UIKit

final class MuxVideoView: ExpoView {
  private let onStatusChange = EventDispatcher()
  private let onPlayingChange = EventDispatcher()
  private let onTimeUpdate = EventDispatcher()
  private let onSourceLoad = EventDispatcher()
  private let onSourceError = EventDispatcher()

  private let playerViewController = AVPlayerViewController()
  private var sourceFingerprint: String?
  private var currentPlaybackId: String?
  private var didEmitSourceLoad = false
  private var didLoadLegibleGroup = false
  private var didReachEnd = false
  private var muted = false
  private var volume: Float = 1
  private var loop = false
  private var playbackRate: Float = 1
  private var shouldPlay = false
  private var timeUpdateInterval: TimeInterval = 0.5
  private var startupBufferDuration: TimeInterval = 0
  private var timeUpdateTimer: Timer?
  private var statusObservation: NSKeyValueObservation?
  private var timeControlObservation: NSKeyValueObservation?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    playerViewController.view.frame = bounds
    playerViewController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    playerViewController.showsPlaybackControls = true
    playerViewController.videoGravity = .resizeAspect
    addSubview(playerViewController.view)
  }

  deinit {
    releasePlayer()
    stopTimeUpdates()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()

    if window == nil {
      stopTimeUpdates()
    } else {
      startTimeUpdates()
    }
  }

  func setSource(_ source: MuxVideoSourceRecord?) {
    guard let source else {
      release()
      return
    }

    guard source.fingerprint != sourceFingerprint else {
      return
    }

    releasePlayer()
    sourceFingerprint = source.fingerprint
    currentPlaybackId = source.playbackId
    didEmitSourceLoad = false
    didLoadLegibleGroup = false
    didReachEnd = false
    sendStatusChange(status: "loading")

    playerViewController.prepare(
      playbackID: source.playbackId,
      playbackOptions: source.toPlaybackOptions(),
      monitoringOptions: source.toMonitoringOptions()
    )

    observePlayer()
    applyPlayerConfiguration()
    startTimeUpdates()

    if shouldPlay {
      playerViewController.player?.play()
    }
  }

  func setNativeControls(_ enabled: Bool) {
    playerViewController.showsPlaybackControls = enabled
  }

  func setContentFit(_ contentFit: String) {
    switch contentFit {
    case "cover":
      playerViewController.videoGravity = .resizeAspectFill
    case "fill":
      playerViewController.videoGravity = .resize
    default:
      playerViewController.videoGravity = .resizeAspect
    }
  }

  func setAllowsPictureInPicture(_ enabled: Bool) {
    playerViewController.allowsPictureInPicturePlayback = enabled
  }

  func setTimeUpdateEventInterval(_ interval: Double) {
    timeUpdateInterval = max(0.1, interval)
    stopTimeUpdates()
    startTimeUpdates()
  }

  func setStartupBufferDuration(_ duration: Double) {
    startupBufferDuration = max(0, duration)
    playerViewController.player?.currentItem?.preferredForwardBufferDuration = startupBufferDuration
  }

  func setPlayWhenReady(_ playWhenReady: Bool) {
    if shouldPlay == playWhenReady {
      return
    }

    if playWhenReady {
      play()
    } else {
      pause()
    }
  }

  func setMuted(_ muted: Bool) {
    self.muted = muted
    playerViewController.player?.isMuted = muted
    sendStatusChange()
  }

  func setVolume(_ volume: Double) {
    self.volume = Float(min(1, max(0, volume)))
    playerViewController.player?.volume = self.volume
    sendStatusChange()
  }

  func setLoop(_ loop: Bool) {
    self.loop = loop
    sendStatusChange()
  }

  func setPlaybackRate(_ rate: Double) {
    playbackRate = Float(min(4, max(0.25, rate)))
    if playerViewController.player?.rate ?? 0 > 0 {
      playerViewController.player?.rate = playbackRate
    }
    sendStatusChange()
  }

  func setCaptionTrack(_ trackId: String?) {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible)
    else {
      return
    }

    guard let trackId else {
      item.select(nil, in: group)
      sendStatusChange()
      return
    }

    guard
      let index = Int(trackId),
      group.options.indices.contains(index)
    else {
      return
    }

    item.select(group.options[index], in: group)
    sendStatusChange()
  }

  func play() {
    shouldPlay = true
    didReachEnd = false
    startPlaybackIfPossible()
    sendStatusChange()
  }

  func pause() {
    shouldPlay = false
    playerViewController.player?.pause()
    sendStatusChange()
  }

  func replay() {
    shouldPlay = true
    didReachEnd = false
    seekTo(0)
    play()
  }

  func seekBy(_ seconds: Double) {
    seekTo(currentTimeSeconds() + seconds)
  }

  func seekTo(_ seconds: Double) {
    didReachEnd = false
    let target = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
    playerViewController.player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
    sendStatusChange()
    sendTimeUpdate()
  }

  func release() {
    releasePlayer()
    sourceFingerprint = nil
    currentPlaybackId = nil
    didEmitSourceLoad = false
    didLoadLegibleGroup = false
    didReachEnd = false
    shouldPlay = false
    sendStatusChange(status: "idle")
  }

  private func observePlayer() {
    guard let player = playerViewController.player else {
      return
    }

    statusObservation = player.observe(\.currentItem?.status, options: [.initial, .new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        self?.handlePlayerStatusUpdate()
      }
    }

    timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        self?.sendStatusChange()
      }
    }

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handlePlaybackEnded),
      name: .AVPlayerItemDidPlayToEndTime,
      object: player.currentItem
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handlePlaybackFailed(_:)),
      name: .AVPlayerItemFailedToPlayToEndTime,
      object: player.currentItem
    )
  }

  private func handlePlayerStatusUpdate() {
    guard let item = playerViewController.player?.currentItem else {
      return
    }

    switch item.status {
    case .readyToPlay:
      if !didEmitSourceLoad {
        didEmitSourceLoad = true
        onSourceLoad([
          "playbackId": currentPlaybackId ?? "",
          "duration": durationSeconds(),
          "captionTracks": captionTracksPayload(),
          "selectedCaptionTrackId": selectedCaptionTrackId() ?? NSNull(),
        ])
      }
      loadLegibleGroupIfNeeded(for: item)
      if shouldPlay && playerViewController.player?.rate == 0 {
        startPlaybackIfPossible()
      }
      sendStatusChange()
    case .failed:
      let message = item.error?.localizedDescription ?? "Mux playback failed."
      onSourceError([
        "playbackId": currentPlaybackId ?? "",
        "message": message,
        "code": item.error.map { "\(($0 as NSError).code)" } ?? "",
      ])
      sendStatusChange(status: "error", error: message)
    default:
      sendStatusChange(status: "loading")
    }
  }

  @objc private func handlePlaybackEnded() {
    if loop {
      seekTo(0)
      play()
      return
    }

    didReachEnd = true
    shouldPlay = false
    sendStatusChange(status: "ended")
  }

  @objc private func handlePlaybackFailed(_ notification: Notification) {
    let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
    let message = error?.localizedDescription ?? "Mux playback failed."
    onSourceError([
      "playbackId": currentPlaybackId ?? "",
      "message": message,
      "code": error.map { "\(($0 as NSError).code)" } ?? "",
    ])
    sendStatusChange(status: "error", error: message)
  }

  private func applyPlayerConfiguration() {
    let player = playerViewController.player
    player?.automaticallyWaitsToMinimizeStalling = true
    player?.currentItem?.preferredForwardBufferDuration = startupBufferDuration
    player?.isMuted = muted
    player?.volume = volume
    if shouldPlay {
      startPlaybackIfPossible()
    }
  }

  private func startPlaybackIfPossible() {
    guard let player = playerViewController.player else {
      return
    }

    player.automaticallyWaitsToMinimizeStalling = true
    player.currentItem?.preferredForwardBufferDuration = startupBufferDuration
    player.play()

    if playbackRate != 1, player.currentItem?.status == .readyToPlay {
      player.rate = playbackRate
    }
  }

  private func releasePlayer() {
    NotificationCenter.default.removeObserver(self)
    statusObservation = nil
    timeControlObservation = nil
    playerViewController.stopMonitoring()
    playerViewController.player?.pause()
    playerViewController.player = nil
  }

  private func startTimeUpdates() {
    stopTimeUpdates()
    guard window != nil else {
      return
    }
    timeUpdateTimer = Timer.scheduledTimer(withTimeInterval: timeUpdateInterval, repeats: true) { [weak self] _ in
      self?.sendTimeUpdate()
    }
  }

  private func stopTimeUpdates() {
    timeUpdateTimer?.invalidate()
    timeUpdateTimer = nil
  }

  private func sendTimeUpdate() {
    onTimeUpdate([
      "currentTime": currentTimeSeconds(),
      "duration": durationSeconds(),
      "bufferedPosition": bufferedPositionSeconds(),
    ])
  }

  private func sendStatusChange(status: String? = nil, error: String? = nil) {
    var payload: [String: Any] = [
      "status": status ?? inferStatus(),
      "currentTime": currentTimeSeconds(),
      "duration": durationSeconds(),
      "bufferedPosition": bufferedPositionSeconds(),
      "muted": muted,
      "volume": Double(volume),
      "loop": loop,
      "playbackRate": Double(playbackRate),
      "captionTracks": captionTracksPayload(),
      "selectedCaptionTrackId": selectedCaptionTrackId() ?? NSNull(),
    ]

    if let error {
      payload["error"] = error
    }

    onStatusChange(payload)
    onPlayingChange(["isPlaying": payload["status"] as? String == "playing"])
  }

  private func inferStatus() -> String {
    guard let player = playerViewController.player else {
      return currentPlaybackId == nil ? "idle" : "loading"
    }

    if didReachEnd {
      return "ended"
    }

    if player.currentItem?.status == .failed {
      return "error"
    }

    if player.currentItem?.status != .readyToPlay {
      return "loading"
    }

    if player.timeControlStatus == .waitingToPlayAtSpecifiedRate {
      return "buffering"
    }

    return player.rate > 0 ? "playing" : "paused"
  }

  private func currentTimeSeconds() -> Double {
    guard let seconds = playerViewController.player?.currentTime().seconds, seconds.isFinite else {
      return 0
    }
    return max(0, seconds)
  }

  private func durationSeconds() -> Double {
    guard let duration = playerViewController.player?.currentItem?.duration.seconds, duration.isFinite else {
      return 0
    }
    return max(0, duration)
  }

  private func bufferedPositionSeconds() -> Double {
    guard let range = playerViewController.player?.currentItem?.loadedTimeRanges.first?.timeRangeValue else {
      return 0
    }
    let end = CMTimeGetSeconds(CMTimeAdd(range.start, range.duration))
    return end.isFinite ? max(0, end) : 0
  }

  private func loadLegibleGroupIfNeeded(for item: AVPlayerItem) {
    guard !didLoadLegibleGroup else {
      return
    }
    didLoadLegibleGroup = true
    let asset = item.asset
    let requestedFingerprint = sourceFingerprint
    asset.loadValuesAsynchronously(forKeys: ["availableMediaCharacteristicsWithMediaSelectionOptions"]) { [weak self] in
      DispatchQueue.main.async {
        guard let self, self.sourceFingerprint == requestedFingerprint else {
          return
        }
        self.sendStatusChange()
      }
    }
  }

  private func captionTracksPayload() -> [[String: Any]] {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible)
    else {
      return []
    }

    return group.options.enumerated().map { index, option in
      var payload: [String: Any] = [
        "id": "\(index)",
        "label": option.displayName,
        "kind": captionTrackKind(option),
      ]

      if let language = option.extendedLanguageTag ?? option.locale?.identifier {
        payload["language"] = language
      }

      return payload
    }
  }

  private func selectedCaptionTrackId() -> String? {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible),
      let selected = item.currentMediaSelection.selectedMediaOption(in: group),
      let index = group.options.firstIndex(where: { $0 === selected })
    else {
      return nil
    }

    return "\(index)"
  }

  private func captionTrackKind(_ option: AVMediaSelectionOption) -> String {
    if option.hasMediaCharacteristic(.containsOnlyForcedSubtitles) {
      return "forced"
    }

    if option.hasMediaCharacteristic(.transcribesSpokenDialogForAccessibility) {
      return "captions"
    }

    return "subtitles"
  }
}
