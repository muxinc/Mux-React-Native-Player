import { Platform } from 'react-native';
import type { MuxVideoRobotsConfig } from '@mux/mux-react-native-player';

const robotsApiUrl = process.env.EXPO_PUBLIC_ROBOTS_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3030/mux/robots' : 'http://localhost:3030/mux/robots');

async function requestRobots<T>(assetId: string, path: string): Promise<T> {
  const response = await fetch(`${robotsApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!response.ok) throw new Error('Robots content could not be loaded.');
  return response.json() as Promise<T>;
}

/** Real requests stay behind the host proxy; API credentials never enter the app. */
export const connectedRobots: MuxVideoRobotsConfig = {
  onSummarize: ({ assetId }) => requestRobots(assetId, '/summarize'),
  onGenerateChapters: ({ assetId }) => requestRobots(assetId, '/chapters'),
  onFindKeyMoments: ({ assetId }) => requestRobots(assetId, '/key-moments'),
  onTranscribe: ({ assetId }) => requestRobots(assetId, '/transcript'),
};
