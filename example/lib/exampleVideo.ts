import { Platform } from 'react-native';
import type { MuxVideoSourceObject } from '@mux/mux-react-native-player';

export const robotsApiUrl =
  process.env.EXPO_PUBLIC_ROBOTS_API_URL ??
  (Platform.OS === 'android'
    ? 'http://10.0.2.2:3030/mux/robots'
    : 'http://localhost:3030/mux/robots');

export const exampleVideoSource: MuxVideoSourceObject = {
  playbackId: '6m6vzcjYiOhMdGFeChE4bCL02WV01fW1iXR8Kcql9lHnA',
  assetId: 'g1TbHCW39uACGx00gizzwU00GvYt4vkhNAq1QlF5NeBgU',
  metadata: {
    playerName: 'MuxReactNativePlayerExample',
    videoTitle: 'Tears of Steel',
    customData: {
      customData1: 'example-app',
    },
  },
};

export async function requestRobots<T>(assetId: string, path: string): Promise<T> {
  const response = await fetch(`${robotsApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(getRobotsErrorMessage(body, response.status));
  }

  return body as T;
}

function getRobotsErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }

  return `Robots request failed with ${status}`;
}
