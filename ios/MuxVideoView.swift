import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
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
  private var externalPlaybackObservation: NSKeyValueObservation?
  private var captionStyle: MuxCaptionStyleRecord?
  private var nowPlayingEnabled = false
  private var nowPlayingTitle: String?
  private var nowPlayingArtworkURL: URL?
  private var nowPlayingArtwork: MPMediaItemArtwork?
  private var loadedArtworkURL: URL?
  private var remoteCommandsRegistered = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    playerViewController.view.frame = bounds
    playerViewController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    playerViewController.showsPlaybackControls = true
    playerViewController.videoGravity = .resizeAspect
    if #available(iOS 16.0, *) {
      playerViewController.allowsVideoFrameAnalysis = false
    }
    addSubview(playerViewController.view)
  }

  deinit {
    releasePlayer()
    stopTimeUpdates()
    if nowPlayingEnabled {
      unregisterRemoteCommands()
      clearNowPlayingInfo()
    }
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
    nowPlayingTitle = source.metadata?.videoTitle
    nowPlayingArtworkURL = source.artworkURL()
    nowPlayingArtwork = nil
    loadedArtworkURL = nil
    didEmitSourceLoad = false
    didLoadLegibleGroup = false
    didReachEnd = false
    sendStatusChange(status: "loading")
    if nowPlayingEnabled {
      loadArtworkIfNeeded()
    }

    configurePlaybackAudioSession()

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

  func seekToLive() {
    let range = seekableRange()
    guard range.end > 0 else {
      return
    }
    didReachEnd = false
    let target = CMTime(seconds: range.end, preferredTimescale: 600)
    playerViewController.player?.seek(to: target, toleranceBefore: .positiveInfinity, toleranceAfter: .zero)
    shouldPlay = true
    startPlaybackIfPossible()
    sendStatusChange()
    sendTimeUpdate()
  }

  private func isLiveStream() -> Bool {
    guard let duration = playerViewController.player?.currentItem?.duration else {
      return false
    }
    return duration.isIndefinite
  }

  private func seekableRange() -> (start: Double, end: Double) {
    guard
      let last = playerViewController.player?.currentItem?.seekableTimeRanges.last?.timeRangeValue
    else {
      return (0, 0)
    }
    let start = CMTimeGetSeconds(last.start)
    let end = CMTimeGetSeconds(CMTimeAdd(last.start, last.duration))
    return (start.isFinite ? max(0, start) : 0, end.isFinite ? max(0, end) : 0)
  }

  func release() {
    releasePlayer()
    sourceFingerprint = nil
    currentPlaybackId = nil
    nowPlayingTitle = nil
    nowPlayingArtworkURL = nil
    nowPlayingArtwork = nil
    loadedArtworkURL = nil
    didEmitSourceLoad = false
    didLoadLegibleGroup = false
    didReachEnd = false
    shouldPlay = false
    sendStatusChange(status: "idle")
    if nowPlayingEnabled {
      clearNowPlayingInfo()
    }
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

    externalPlaybackObservation = player.observe(\.isExternalPlaybackActive, options: [.new]) { [weak self] _, _ in
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
      applyCaptionStyle()
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
    player?.allowsExternalPlayback = true
    player?.usesExternalPlaybackWhileExternalScreenIsActive = true
    if shouldPlay {
      startPlaybackIfPossible()
    }
  }

  private func startPlaybackIfPossible() {
    guard let player = playerViewController.player else {
      return
    }

    try? AVAudioSession.sharedInstance().setActive(true)
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
    externalPlaybackObservation = nil
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
      "externalPlaybackActive": playerViewController.player?.isExternalPlaybackActive ?? false,
      "isLive": isLiveStream(),
      "seekableStart": seekableRange().start,
      "seekableEnd": seekableRange().end,
    ]

    if let error {
      payload["error"] = error
    }

    onStatusChange(payload)
    onPlayingChange(["isPlaying": payload["status"] as? String == "playing"])

    if nowPlayingEnabled {
      updateNowPlayingInfo()
    }
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

  func setCaptionStyle(_ style: MuxCaptionStyleRecord?) {
    captionStyle = style
    applyCaptionStyle()
  }

  private func applyCaptionStyle() {
    guard let item = playerViewController.player?.currentItem else {
      return
    }
    guard let style = captionStyle else {
      item.textStyleRules = nil
      return
    }
    var attributes: [String: Any] = [:]
    if let scale = style.fontScale, scale > 0 {
      attributes[kCMTextMarkupAttribute_RelativeFontSize as String] = scale * 100
    }
    if let argb = style.textColor.flatMap(MuxVideoView.hexToARGB) {
      attributes[kCMTextMarkupAttribute_ForegroundColorARGB as String] = argb
    }
    if let argb = style.backgroundColor.flatMap(MuxVideoView.hexToARGB) {
      attributes[kCMTextMarkupAttribute_BackgroundColorARGB as String] = argb
    }
    if attributes.isEmpty {
      item.textStyleRules = nil
      return
    }
    if let rule = AVTextStyleRule(textMarkupAttributes: attributes) {
      item.textStyleRules = [rule]
    }
  }

  private static func hexToARGB(_ hex: String) -> [CGFloat]? {
    var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") {
      value.removeFirst()
    }
    guard let parsed = UInt64(value, radix: 16) else {
      return nil
    }
    switch value.count {
    case 6:
      return [
        1,
        CGFloat((parsed >> 16) & 0xff) / 255,
        CGFloat((parsed >> 8) & 0xff) / 255,
        CGFloat(parsed & 0xff) / 255,
      ]
    case 8:
      return [
        CGFloat((parsed >> 24) & 0xff) / 255,
        CGFloat((parsed >> 16) & 0xff) / 255,
        CGFloat((parsed >> 8) & 0xff) / 255,
        CGFloat(parsed & 0xff) / 255,
      ]
    default:
      return nil
    }
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

  // MARK: - Now Playing / lock-screen controls

  func setEnableNowPlaying(_ enabled: Bool) {
    guard enabled != nowPlayingEnabled else {
      return
    }
    nowPlayingEnabled = enabled

    if enabled {
      configureAudioSession()
      registerRemoteCommands()
      loadArtworkIfNeeded()
      updateNowPlayingInfo()
    } else {
      unregisterRemoteCommands()
      clearNowPlayingInfo()
    }
  }

  private func configureAudioSession() {
    configurePlaybackAudioSession()
    try? AVAudioSession.sharedInstance().setActive(true)
  }

  /// Without the .longFormVideo route-sharing policy (or with the default
  /// .soloAmbient category), picking an AirPlay device routes audio only and
  /// AVPlayer never engages external video playback.
  private func configurePlaybackAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
    } catch {
      try? session.setCategory(.playback, mode: .moviePlayback)
    }
  }

  private func registerRemoteCommands() {
    guard !remoteCommandsRegistered else {
      return
    }
    remoteCommandsRegistered = true
    let center = MPRemoteCommandCenter.shared()

    center.playCommand.addTarget { [weak self] _ in
      self?.play()
      return .success
    }
    center.pauseCommand.addTarget { [weak self] _ in
      self?.pause()
      return .success
    }
    center.togglePlayPauseCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      if self.playerViewController.player?.rate ?? 0 > 0 {
        self.pause()
      } else {
        self.play()
      }
      return .success
    }
    center.skipForwardCommand.preferredIntervals = [10]
    center.skipForwardCommand.addTarget { [weak self] event in
      guard let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
      self?.seekBy(event.interval)
      return .success
    }
    center.skipBackwardCommand.preferredIntervals = [10]
    center.skipBackwardCommand.addTarget { [weak self] event in
      guard let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
      self?.seekBy(-event.interval)
      return .success
    }
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      self?.seekTo(event.positionTime)
      return .success
    }
  }

  private func unregisterRemoteCommands() {
    guard remoteCommandsRegistered else {
      return
    }
    remoteCommandsRegistered = false
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.removeTarget(nil)
    center.pauseCommand.removeTarget(nil)
    center.togglePlayPauseCommand.removeTarget(nil)
    center.skipForwardCommand.removeTarget(nil)
    center.skipBackwardCommand.removeTarget(nil)
    center.changePlaybackPositionCommand.removeTarget(nil)
  }

  private func updateNowPlayingInfo() {
    guard nowPlayingEnabled, currentPlaybackId != nil else {
      return
    }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: nowPlayingTitle ?? "",
      MPMediaItemPropertyPlaybackDuration: durationSeconds(),
      MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTimeSeconds(),
      MPNowPlayingInfoPropertyPlaybackRate: Double(playerViewController.player?.rate ?? 0),
    ]
    if let artwork = nowPlayingArtwork {
      info[MPMediaItemPropertyArtwork] = artwork
    }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func clearNowPlayingInfo() {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
  }

  private func loadArtworkIfNeeded() {
    guard let url = nowPlayingArtworkURL, url != loadedArtworkURL else {
      return
    }
    loadedArtworkURL = url
    let requestedFingerprint = sourceFingerprint
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard
        let data,
        let image = UIImage(data: data)
      else {
        return
      }
      let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        guard let self, self.sourceFingerprint == requestedFingerprint else {
          return
        }
        self.nowPlayingArtwork = artwork
        if self.nowPlayingEnabled {
          self.updateNowPlayingInfo()
        }
      }
    }.resume()
  }
}
