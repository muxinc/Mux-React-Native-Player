import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
import MUXSDKStats
#if os(iOS)
import MuxPlayerSwift
#endif
import UIKit

final class MuxVideoView: ExpoView {
  private let onStatusChange = EventDispatcher()
  private let onPlayingChange = EventDispatcher()
  private let onTimeUpdate = EventDispatcher()
  private let onSourceLoad = EventDispatcher()
  private let onSourceError = EventDispatcher()
  private let onFirstFrame = EventDispatcher()

  private let playerViewController = AVPlayerViewController()
  private let monitorName = "MuxReactNativePlayer-\(UUID().uuidString)"
  private var sourceGeneration = UUID()
  private var sourceError: String?
  private var didReportError = false
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var applicationInactive = false
  private var mediaSelectionObserver: NSObjectProtocol?
  private var sourceFingerprint: String?
  private var pendingSource: MuxVideoSourceRecord?
  private var hasPendingSource = false
  private var pendingPlaybackIntent: MuxPlaybackIntentRecord?
  private var playbackIntentRevision = 0
  private var currentPlaybackId: String?
  private var currentSourceId: String?
  private var didEmitSourceLoad = false
  private var didEmitFirstFrame = false
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
  private var readyForDisplayObservation: NSKeyValueObservation?
  private var captionStyle: MuxCaptionStyleRecord?
  private var nowPlayingEnabled = false
  private var nowPlayingTitle: String?
  private var nowPlayingArtworkURL: URL?
  private var nowPlayingArtwork: MPMediaItemArtwork?
  private var loadedArtworkURL: URL?
  private var remoteCommandsRegistered = false
  /// Set when this view adopted a preloaded item and registered Mux Data
  /// monitoring itself instead of through `prepare(...)`. `releasePlayer`
  /// tears the binding down by this name.
  private var selfMonitoredPlayerName: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    playerViewController.view.frame = bounds
    playerViewController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    playerViewController.showsPlaybackControls = true
    playerViewController.videoGravity = .resizeAspect
    #if os(iOS)
    if #available(iOS 16.0, *) {
      playerViewController.allowsVideoFrameAnalysis = false
    }
    #endif
    #if os(tvOS)
    playerViewController.allowsPictureInPicturePlayback = false
    #endif
    addSubview(playerViewController.view)
    #if os(tvOS)
    lifecycleObservers = [
      NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.applicationInactive = true
        self.playerViewController.player?.pause()
        self.stopTimeUpdates()
        self.sendStatusChange()
      },
      NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.applicationInactive = false
        if self.shouldPlay { self.startPlaybackIfPossible() }
        self.startTimeUpdates()
        self.sendStatusChange()
      },
    ]
    #endif
  }

  deinit {
    releasePlayer()
    for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
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
      detachPlayerController()
      #if os(tvOS)
      playerViewController.player?.pause()
      sendStatusChange()
      #endif
    } else {
      attachPlayerController()
      #if os(tvOS)
      if shouldPlay { startPlaybackIfPossible() }
      #endif
      startTimeUpdates()
    }
  }

  private func attachPlayerController() {
    guard playerViewController.parent == nil else { return }
    var responder: UIResponder? = next
    while let candidate = responder {
      if let parent = candidate as? UIViewController {
        parent.addChild(playerViewController)
        if playerViewController.view.superview !== self { addSubview(playerViewController.view) }
        playerViewController.didMove(toParent: parent)
        #if os(tvOS)
        if playerViewController.showsPlaybackControls { setNeedsFocusUpdate() }
        #endif
        return
      }
      responder = candidate.next
    }
  }

  private func detachPlayerController() {
    guard playerViewController.parent != nil else { return }
    playerViewController.willMove(toParent: nil)
    playerViewController.view.removeFromSuperview()
    playerViewController.removeFromParent()
  }

  override var preferredFocusEnvironments: [UIFocusEnvironment] {
    playerViewController.showsPlaybackControls ? [playerViewController] : super.preferredFocusEnvironments
  }

  func setSource(_ source: MuxVideoSourceRecord?) {
    // Expo prop setters run in dictionary order. Prepare only after the whole
    // batch so playWhenReady and configuration belong to this source.
    pendingSource = source
    hasPendingSource = true
  }

  func setPlaybackIntent(_ intent: MuxPlaybackIntentRecord) {
    pendingPlaybackIntent = intent
  }

  func applyPendingSource() {
    // Commit the revision before applying intent: synchronous command events
    // must identify the JS intent they acknowledge, even without a new source.
    if let intent = pendingPlaybackIntent {
      pendingPlaybackIntent = nil
      if intent.revision >= playbackIntentRevision {
        playbackIntentRevision = intent.revision
        setPlayWhenReady(intent.playWhenReady)
      }
    }
    guard hasPendingSource else { return }
    let source = pendingSource
    pendingSource = nil
    hasPendingSource = false
    applySource(source)
  }

  private func applySource(_ source: MuxVideoSourceRecord?) {
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
    currentSourceId = source.sourceId
    nowPlayingTitle = source.metadata?.videoTitle
    nowPlayingArtworkURL = source.artworkURL()
    nowPlayingArtwork = nil
    loadedArtworkURL = nil
    didEmitSourceLoad = false
    didEmitFirstFrame = false
    didLoadLegibleGroup = false
    didReachEnd = false
    sendStatusChange(status: "loading")
    if nowPlayingEnabled {
      loadArtworkIfNeeded()
    }

    configurePlaybackAudioSession()

    #if os(tvOS)
    do {
      let url = try MuxPlaybackURL.make(
        playbackId: source.playbackId, playbackToken: source.playbackToken,
        drmToken: source.drmToken, customDomain: source.customDomain,
        minResolution: source.minResolution, maxResolution: source.maxResolution,
        renditionOrder: source.renditionOrder,
        assetStartTime: source.clipping?.assetStartTime,
        assetEndTime: source.clipping?.assetEndTime
      )
      playerViewController.player = AVPlayer(playerItem: AVPlayerItem(url: url))
      // Source replacement destroys the old player and its monitor before this
      // new view session starts; metadata.playerName remains a reporting label.
      MUXSDKStats.monitorAVPlayerViewController(
        playerViewController, withPlayerName: monitorName,
        customerData: source.toCustomerData(), automaticErrorTracking: false
      )
      selfMonitoredPlayerName = monitorName
    } catch {
      let failure = error as? MuxPlaybackURL.SourceError ?? .invalidSource
      reportPlaybackError(message: failure.rawValue,
        code: failure == .unsupportedDRM ? "TV_DRM_UNSUPPORTED" : "INVALID_SOURCE")
      return
    }
    #else
    if let warmedItem = MuxPreloadManager.shared.takeItem(
      matchingPlaybackFingerprint: source.playbackFingerprint
    ) {
      // Adopt the preloaded item and the buffer it already accumulated.
      // `prepare(...)` always constructs a fresh AVPlayerItem, which would
      // throw that buffer away, so the player is assembled here and Mux Data
      // monitoring is registered directly. The preload path never accepts DRM
      // sources, so no FairPlay session registration is needed on this branch.
      playerViewController.player = AVPlayer(playerItem: warmedItem)
      let monitoringOptions = source.toMonitoringOptions(playerName: monitorName)
      MUXSDKStats.monitorAVPlayerViewController(
        playerViewController,
        withPlayerName: monitoringOptions.playerName,
        customerData: source.toCustomerData(),
        automaticErrorTracking: monitoringOptions.automaticErrorTracking
      )
      selfMonitoredPlayerName = monitoringOptions.playerName
    } else {
      playerViewController.prepare(
        playbackID: source.playbackId,
        playbackOptions: source.toPlaybackOptions(),
        monitoringOptions: source.toMonitoringOptions(playerName: monitorName)
      )
    }

    #endif

    observePlayer()
    applyPlayerConfiguration()
    startTimeUpdates()
  }

  func setNativeControls(_ enabled: Bool) {
    playerViewController.showsPlaybackControls = enabled
    #if os(tvOS)
    // Hiding AVKit controls alone does not relinquish their focus/press route.
    // Custom controls (or a controls="none" host) own the remote while the
    // native surface continues rendering and keeps its existing Data monitor.
    playerViewController.view.isUserInteractionEnabled = enabled
    playerViewController.view.accessibilityElementsHidden = !enabled
    if !enabled {
      resignPlayerFirstResponder(in: playerViewController.view)
    }
    window?.setNeedsFocusUpdate()
    #endif
  }

  #if os(tvOS)
  private func resignPlayerFirstResponder(in view: UIView) {
    if view.isFirstResponder { view.resignFirstResponder() }
    for child in view.subviews { resignPlayerFirstResponder(in: child) }
  }
  #endif

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
    #if os(iOS)
    playerViewController.allowsPictureInPicturePlayback = enabled
    #else
    playerViewController.allowsPictureInPicturePlayback = false
    #endif
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

  func setAudioTrack(_ trackId: String?) {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .audible)
    else {
      return
    }

    guard let trackId else {
      item.selectMediaOptionAutomatically(in: group)
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
    guard seconds.isFinite, let player = playerViewController.player else { return }
    let range = seekableRange()
    let position = range.end > range.start
      ? min(range.end, max(range.start, seconds)) : max(0, seconds)
    let generation = sourceGeneration
    let target = CMTime(seconds: position, preferredTimescale: 600)
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == generation else { return }
        self.sendStatusChange()
        self.sendTimeUpdate()
      }
    }
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
    // An item's duration stays indefinite until it has loaded, so before then
    // every VOD would look live. Only a ready item can tell.
    guard let item = playerViewController.player?.currentItem, item.status == .readyToPlay else {
      return false
    }
    return item.duration.isIndefinite
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
    pendingSource = nil
    hasPendingSource = false
    releasePlayer()
    sourceFingerprint = nil
    currentPlaybackId = nil
    nowPlayingTitle = nil
    nowPlayingArtworkURL = nil
    nowPlayingArtwork = nil
    loadedArtworkURL = nil
    didEmitSourceLoad = false
    didEmitFirstFrame = false
    didLoadLegibleGroup = false
    didReachEnd = false
    shouldPlay = false
    sendStatusChange(status: "idle")
    currentSourceId = nil
    if nowPlayingEnabled {
      clearNowPlayingInfo()
    }
  }

  private func observePlayer() {
    guard let player = playerViewController.player else {
      return
    }

    let generation = sourceGeneration
    mediaSelectionObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.mediaSelectionDidChangeNotification, object: player.currentItem, queue: .main
    ) { [weak self] _ in
      guard let self, self.sourceGeneration == generation else { return }
      self.sendStatusChange()
    }
    statusObservation = player.observe(\.currentItem?.status, options: [.initial, .new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == generation else { return }
        self.handlePlayerStatusUpdate()
      }
    }

    timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] observedPlayer, _ in
      let observedStatus = observedPlayer.timeControlStatus
      let wasSuspended = self?.playbackSuspended ?? false
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == generation else { return }
        // Native remote transport changes must update intent too. Ignore a
        // queued transition if the player has already moved to another state.
        if !wasSuspended && !self.playbackSuspended && observedPlayer.timeControlStatus == observedStatus && observedPlayer.currentItem?.status == .readyToPlay {
          self.shouldPlay = observedStatus != .paused
        }
        self.sendStatusChange()
      }
    }

    #if os(iOS)
    externalPlaybackObservation = player.observe(\.isExternalPlaybackActive, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == generation else { return }
        self.sendStatusChange()
      }
    }

    #endif

    // The exact first-frame signal: the view controller has a video frame
    // ready for display. `.initial` covers an adopted preloaded item that is
    // already displayable when observation starts. Emitted once per source;
    // the flag resets in setSource/release.
    readyForDisplayObservation = playerViewController.observe(
      \.isReadyForDisplay,
      options: [.initial, .new]
    ) { [weak self] playerViewController, _ in
      guard playerViewController.isReadyForDisplay else {
        return
      }
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == generation, !self.didEmitFirstFrame else {
          return
        }
        self.didEmitFirstFrame = true
        self.onFirstFrame(self.sourceEventPayload(["playbackId": self.currentPlaybackId ?? ""]))
      }
    }

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handlePlaybackEnded(_:)),
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
        onSourceLoad(sourceEventPayload([
          "playbackId": currentPlaybackId ?? "",
          "duration": durationSeconds(),
          "captionTracks": captionTracksPayload(),
          "selectedCaptionTrackId": selectedCaptionTrackId() ?? NSNull(),
          "audioTracks": audioTracksPayload(),
          "selectedAudioTrackId": selectedAudioTrackId() ?? NSNull(),
        ]))
      }
      loadLegibleGroupIfNeeded(for: item)
      applyCaptionStyle()
      if shouldPlay && playerViewController.player?.rate == 0 {
        startPlaybackIfPossible()
      }
      sendStatusChange()
    case .failed:
      reportPlaybackError(message: "Mux playback failed. Check connectivity and playback authorization.",
        code: item.error.map { "\(($0 as NSError).code)" } ?? "PLAYBACK_FAILED")
    default:
      sendStatusChange(status: "loading")
    }
  }

  @objc private func handlePlaybackEnded(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem, item === playerViewController.player?.currentItem else { return }
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
    guard let item = notification.object as? AVPlayerItem, item === playerViewController.player?.currentItem else { return }
    let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
    reportPlaybackError(message: "Mux playback failed. Check connectivity and playback authorization.",
      code: error.map { "\(($0 as NSError).code)" } ?? "PLAYBACK_FAILED")
  }

  private func reportPlaybackError(message: String, code: String) {
    sourceError = message
    guard !didReportError else { return }
    didReportError = true
    #if os(tvOS)
    if let name = selfMonitoredPlayerName {
      MUXSDKStats.dispatchError(code, withMessage: message, forPlayer: name)
    }
    #endif
    onSourceError(sourceEventPayload(["playbackId": currentPlaybackId ?? "", "message": message, "code": code]))
    sendStatusChange(status: "error", error: message)
  }

  private func applyPlayerConfiguration() {
    let player = playerViewController.player
    player?.automaticallyWaitsToMinimizeStalling = true
    player?.currentItem?.preferredForwardBufferDuration = startupBufferDuration
    player?.isMuted = muted
    player?.volume = volume
    #if os(iOS)
    player?.allowsExternalPlayback = true
    player?.usesExternalPlaybackWhileExternalScreenIsActive = true
    #endif
    if shouldPlay {
      startPlaybackIfPossible()
    }
  }

  private var playbackSuspended: Bool {
    #if os(tvOS)
    return applicationInactive || window == nil
    #else
    return false
    #endif
  }

  private func startPlaybackIfPossible() {
    guard !playbackSuspended else { return }
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
    sourceGeneration = UUID()
    sourceError = nil
    didReportError = false
    stopTimeUpdates()
    if let observer = mediaSelectionObserver { NotificationCenter.default.removeObserver(observer) }
    mediaSelectionObserver = nil
    NotificationCenter.default.removeObserver(self)
    statusObservation = nil
    timeControlObservation = nil
    externalPlaybackObservation = nil
    readyForDisplayObservation = nil
    if let selfMonitoredPlayerName {
      MUXSDKStats.destroyPlayer(selfMonitoredPlayerName)
      self.selfMonitoredPlayerName = nil
    }
    #if os(iOS)
    playerViewController.stopMonitoring()
    #endif
    playerViewController.player?.pause()
    playerViewController.player?.replaceCurrentItem(with: nil)
    playerViewController.player = nil
  }

  private func startTimeUpdates() {
    stopTimeUpdates()
    guard window != nil, !playbackSuspended, playerViewController.player != nil else {
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

  /// Identity is copied into each dispatched payload, so events already queued
  /// across the bridge can be rejected after replacing the same playback ID.
  private func sourceEventPayload(_ payload: [String: Any]) -> [String: Any] {
    var event = payload
    event["playbackId"] = currentPlaybackId ?? ""
    if let currentSourceId { event["sourceId"] = currentSourceId }
    return event
  }

  private func sendTimeUpdate() {
    onTimeUpdate(sourceEventPayload([
      "playbackId": currentPlaybackId ?? "",
      "currentTime": currentTimeSeconds(),
      "duration": durationSeconds(),
      "bufferedPosition": bufferedPositionSeconds(),
    ]))
  }

  private func sendStatusChange(status: String? = nil, error: String? = nil) {
    guard currentPlaybackId != nil || status == "idle" else { return }
    let resolvedStatus = status ?? inferStatus()
    var payload: [String: Any] = [
      "status": resolvedStatus,
      "playbackIntentRevision": playbackIntentRevision,
      "playbackId": currentPlaybackId ?? "",
      "currentTime": currentTimeSeconds(),
      "duration": durationSeconds(),
      "bufferedPosition": bufferedPositionSeconds(),
      "muted": muted,
      "volume": Double(volume),
      "loop": loop,
      "playbackRate": Double(playbackRate),
      "captionTracks": captionTracksPayload(),
      "selectedCaptionTrackId": selectedCaptionTrackId() ?? NSNull(),
      "audioTracks": audioTracksPayload(),
      "selectedAudioTrackId": selectedAudioTrackId() ?? NSNull(),
      "externalPlaybackActive": externalPlaybackActive(),
      "isLive": isLiveStream(),
      "seekableStart": seekableRange().start,
      "seekableEnd": seekableRange().end,
    ]

    // Loading may be emitted before Expo applies the playWhenReady prop.
    if resolvedStatus != "loading" && resolvedStatus != "ready" {
      payload["playWhenReady"] = shouldPlay
    }
    if let error = error ?? sourceError {
      payload["error"] = error
    }

    onStatusChange(sourceEventPayload(payload))
    onPlayingChange(sourceEventPayload(["isPlaying": payload["status"] as? String == "playing"]))

    if nowPlayingEnabled {
      updateNowPlayingInfo()
    }
  }

  private func externalPlaybackActive() -> Bool {
    #if os(iOS)
    return playerViewController.player?.isExternalPlaybackActive ?? false
    #else
    return false
    #endif
  }

  private func inferStatus() -> String {
    if sourceError != nil { return "error" }
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
    let requestedGeneration = sourceGeneration
    asset.loadValuesAsynchronously(forKeys: ["availableMediaCharacteristicsWithMediaSelectionOptions"]) { [weak self] in
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == requestedGeneration else {
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

  private func audioTracksPayload() -> [[String: Any]] {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .audible)
    else {
      return []
    }

    return group.options.enumerated().map { index, option in
      var payload: [String: Any] = [
        "id": "\(index)",
        "label": option.displayName,
      ]

      if let language = option.extendedLanguageTag ?? option.locale?.identifier {
        payload["language"] = language
      }

      return payload
    }
  }

  private func selectedAudioTrackId() -> String? {
    guard
      let item = playerViewController.player?.currentItem,
      let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .audible),
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
    #if os(tvOS)
    // AVKit owns system transport commands on TV; avoid duplicate handlers.
    return
    #else
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
    #endif
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
    #if os(iOS)
    do {
      try session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
    } catch {
      try? session.setCategory(.playback, mode: .moviePlayback)
    }
    #else
    try? session.setCategory(.playback, mode: .moviePlayback)
    #endif
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
    let requestedGeneration = sourceGeneration
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard
        let data,
        let image = UIImage(data: data)
      else {
        return
      }
      let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        guard let self, self.sourceGeneration == requestedGeneration else {
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
