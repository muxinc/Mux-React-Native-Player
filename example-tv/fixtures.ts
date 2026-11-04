import type { MuxVideoControls, MuxVideoRobotsConfig, MuxVideoSourceObject } from '@mux/mux-react-native-player';
import { connectedRobots } from './robots';
import tearsOfSteel from './fixtures/tears-of-steel-robots.json';

export type TVFixture = { id: string; title: string; detail: string; source: MuxVideoSourceObject; controls?: MuxVideoControls; robots?: MuxVideoRobotsConfig };

// EXPO_PUBLIC values are embedded in the app bundle. Playback/image JWTs are
// scoped client credentials; Mux API tokens and signing private keys NEVER go here.
const envKey = process.env.EXPO_PUBLIC_MUX_ENV_KEY;
const signedPlaybackId = process.env.EXPO_PUBLIC_MUX_SIGNED_PLAYBACK_ID;
const playbackToken = process.env.EXPO_PUBLIC_MUX_PLAYBACK_TOKEN;
const thumbnailToken = process.env.EXPO_PUBLIC_MUX_THUMBNAIL_TOKEN;
const livePlaybackId = process.env.EXPO_PUBLIC_MUX_LIVE_PLAYBACK_ID;
const livePlaybackToken = process.env.EXPO_PUBLIC_MUX_LIVE_PLAYBACK_TOKEN;
const robotsAssetId = process.env.EXPO_PUBLIC_MUX_ROBOTS_ASSET_ID;
const robotsPlaybackId = process.env.EXPO_PUBLIC_MUX_ROBOTS_PLAYBACK_ID;

export const videos: TVFixture[] = [
  // Saved, completed Mux Robots results work on a physical TV without a proxy.
  {
    id: 'tears-of-steel',
    title: 'Tears of Steel · Mux Robots',
    detail: 'Completed Robots results · summary, 8 chapters, 4 moments, English transcript',
    controls: 'custom',
    robots: tearsOfSteel.robots,
    source: {
      playbackId: tearsOfSteel.playbackId,
      assetId: tearsOfSteel.assetId,
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: tearsOfSteel.title, videoId: 'tv-public-vod' },
    },
  },
  // Optional live API comparison, separate from the bundled completed results.
  ...(robotsAssetId && robotsPlaybackId ? [{
    id: 'connected-robots',
    title: 'Connected Robots · Live API',
    detail: 'Your Mux asset · requires a reachable Robots backend',
    controls: 'custom' as const,
    robots: connectedRobots,
    source: {
      playbackId: robotsPlaybackId,
      assetId: robotsAssetId,
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: 'Connected Robots', videoId: 'tv-connected-robots' },
    },
  }] : []),
  {
    id: 'native-controls',
    title: 'Native controls',
    detail: 'Public VOD · platform control comparison',
    controls: 'native',
    source: {
      playbackId: '6m6vzcjYiOhMdGFeChE4bCL02WV01fW1iXR8Kcql9lHnA',
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: 'Tears of Steel', videoId: 'tv-native-vod' },
    },
  },
  {
    id: 'invalid-source',
    title: 'Playback error',
    detail: 'Invalid source · verify error recovery and Back',
    controls: 'custom',
    source: {
      playbackId: 'invalid-tv-example-source',
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: 'Invalid source', videoId: 'tv-invalid-source' },
    },
  },
  ...(signedPlaybackId && playbackToken ? [{
    id: 'signed-vod',
    title: 'Signed VOD',
    detail: 'Local fixture · signed playback and token expiry',
    controls: 'custom' as const,
    source: {
      playbackId: signedPlaybackId,
      playbackToken,
      thumbnailToken,
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: 'Signed VOD', videoId: 'tv-signed-vod' },
    },
  }] : []),
  ...(livePlaybackId ? [{
    id: 'live',
    title: 'Live stream',
    detail: 'Local fixture · live edge and DVR when available',
    controls: 'custom' as const,
    source: {
      playbackId: livePlaybackId,
      playbackToken: livePlaybackToken,
      metadata: { envKey, playerName: 'MuxPlayerTVExample', videoTitle: 'Live stream', videoId: 'tv-live' },
    },
  }] : []),
];
