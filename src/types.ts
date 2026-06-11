import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type MuxMaxResolution = '720p' | '1080p' | '1440p' | '2160p';
export type MuxMinResolution = '480p' | '540p' | '720p' | '1080p' | '1440p' | '2160p';
export type MuxRenditionOrder = 'default' | 'desc';
export type MuxContentFit = 'contain' | 'cover' | 'fill';
export type MuxVideoControls = 'native' | 'custom' | 'none';

/**
 * Poster image shown before the first frame renders.
 * - `undefined` / `true`: auto-generate from the Mux thumbnail endpoint
 * - `false`: no poster
 * - `string` / `{ uri }`: a custom poster image
 */
export type MuxPosterSource = boolean | string | { uri: string };

export type MuxCustomData = Partial<Record<
  | 'customData1'
  | 'customData2'
  | 'customData3'
  | 'customData4'
  | 'customData5'
  | 'customData6'
  | 'customData7'
  | 'customData8'
  | 'customData9'
  | 'customData10',
  string
>> & Record<string, string | undefined>;

export type MuxVideoMetadata = {
  envKey?: string;
  playerName?: string;
  playerVersion?: string;
  videoTitle?: string;
  videoId?: string;
  videoSeries?: string;
  viewerUserId?: string;
  customData?: MuxCustomData;
};

export type MuxVideoClipping = {
  assetStartTime?: number;
  assetEndTime?: number;
};

export type MuxVideoSourceObject = {
  playbackId: string;
  assetId?: string;
  playbackToken?: string;
  drmToken?: string;
  thumbnailToken?: string;
  storyboardToken?: string;
  customDomain?: string;
  minResolution?: MuxMinResolution;
  maxResolution?: MuxMaxResolution;
  renditionOrder?: MuxRenditionOrder;
  clipping?: MuxVideoClipping;
  metadata?: MuxVideoMetadata;
};

export type MuxVideoSource = string | MuxVideoSourceObject;

export type NormalizedMuxVideoSource = MuxVideoSourceObject & {
  playbackId: string;
  renditionOrder: MuxRenditionOrder;
};

export type MuxPlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type MuxPlayerStatus = {
  status: MuxPlaybackStatus;
  currentTime: number;
  duration: number;
  bufferedPosition: number;
  muted: boolean;
  volume: number;
  loop: boolean;
  playbackRate: number;
  captionTracks?: MuxVideoCaptionTrack[];
  selectedCaptionTrackId?: string | null;
  error?: string;
};

export type MuxStatusChangeEvent = MuxPlayerStatus;

export type MuxPlayingChangeEvent = {
  isPlaying: boolean;
};

export type MuxTimeUpdateEvent = {
  currentTime: number;
  duration: number;
  bufferedPosition: number;
};

export type MuxVideoRobotsContext = {
  assetId: string;
  duration: number;
  currentTime: number;
};

export type MuxVideoSummary = {
  title: string;
  description: string;
  tags?: string[];
};

export type MuxVideoChapter = {
  startTime: number;
  title: string;
};

export type MuxVideoKeyMoment = {
  startTime: number;
  endTime: number;
  title: string;
  description?: string;
  score?: number;
};

export type MuxVideoRobotsConfig = {
  enabled?: boolean;
  assetId?: string;
  summary?: MuxVideoSummary;
  chapters?: MuxVideoChapter[];
  keyMoments?: MuxVideoKeyMoment[];
  onSummarize?: (context: MuxVideoRobotsContext) => Promise<MuxVideoSummary>;
  onGenerateChapters?: (
    context: MuxVideoRobotsContext
  ) => Promise<MuxVideoChapter[]>;
  onFindKeyMoments?: (
    context: MuxVideoRobotsContext
  ) => Promise<MuxVideoKeyMoment[]>;
};

export type MuxSourceLoadEvent = {
  playbackId: string;
  duration: number;
  captionTracks?: MuxVideoCaptionTrack[];
  selectedCaptionTrackId?: string | null;
};

export type MuxSourceErrorEvent = {
  playbackId?: string;
  message: string;
  code?: string;
};

export type MuxNativeViewRef = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  replay: () => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setLoop: (loop: boolean) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setCaptionTrack: (trackId: string | null) => Promise<void>;
  release: () => Promise<void>;
};

export type MuxVideoCaptionTrack = {
  id: string;
  label: string;
  language?: string;
  kind?: 'subtitles' | 'captions' | 'forced' | string;
};

export type MuxVideoControlsTheme = {
  accentColor?: string;
  backgroundColor?: string;
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
  buttonSize?: number;
  playButtonSize?: number;
  fullscreenButtonSize?: number;
  progressTrackColor?: string;
  bufferedTrackColor?: string;
  trackColor?: string;
  trackHeight?: number;
  textColor?: string;
  seekSeconds?: number;
};

export type MuxVideoViewProps = ViewProps & {
  player: import('./MuxVideoPlayer').MuxVideoPlayer;
  controls?: MuxVideoControls;
  controlsTheme?: MuxVideoControlsTheme;
  robots?: MuxVideoRobotsConfig;
  nativeControls?: boolean;
  contentFit?: MuxContentFit;
  poster?: MuxPosterSource;
  posterTime?: number;
  thumbnailPreviews?: boolean;
  allowsFullscreen?: boolean;
  allowsPictureInPicture?: boolean;
  timeUpdateEventInterval?: number;
  startupBufferDuration?: number;
  onStatusChange?: (event: MuxStatusChangeEvent) => void;
  onPlayingChange?: (event: MuxPlayingChangeEvent) => void;
  onTimeUpdate?: (event: MuxTimeUpdateEvent) => void;
  onSourceLoad?: (event: MuxSourceLoadEvent) => void;
  onSourceError?: (event: MuxSourceErrorEvent) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
};

export type NativeMuxVideoViewProps = Omit<
  MuxVideoViewProps,
  | 'player'
  | 'controls'
  | 'controlsTheme'
  | 'robots'
  | 'onStatusChange'
  | 'onPlayingChange'
  | 'onTimeUpdate'
  | 'onSourceLoad'
  | 'onSourceError'
  | 'onFullscreenChange'
> & {
  source?: NormalizedMuxVideoSource;
  playWhenReady: boolean;
  muted: boolean;
  volume: number;
  loop: boolean;
  playbackRate: number;
  onStatusChange?: (event: NativeSyntheticEvent<MuxStatusChangeEvent>) => void;
  onPlayingChange?: (event: NativeSyntheticEvent<MuxPlayingChangeEvent>) => void;
  onTimeUpdate?: (event: NativeSyntheticEvent<MuxTimeUpdateEvent>) => void;
  onSourceLoad?: (event: NativeSyntheticEvent<MuxSourceLoadEvent>) => void;
  onSourceError?: (event: NativeSyntheticEvent<MuxSourceErrorEvent>) => void;
};
