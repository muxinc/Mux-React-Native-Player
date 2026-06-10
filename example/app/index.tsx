import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MuxVideoView,
  useMuxVideoPlayer,
  type MuxPlaybackStatus,
} from '@mux/mux-react-native-player';

import { exampleVideoSource, requestRobots } from '../lib/exampleVideo';

export default function PlayerScreen() {
  const [status, setStatus] = useState<MuxPlaybackStatus>('idle');
  const [time, setTime] = useState(0);
  const player = useMuxVideoPlayer(exampleVideoSource);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>mux react native player</Text>
      </View>

      <MuxVideoView
        player={player}
        controls="custom"
        contentFit="contain"
        robots={{
          onSummarize: ({ assetId }) => requestRobots(assetId, '/summarize'),
          onGenerateChapters: ({ assetId }) => requestRobots(assetId, '/chapters'),
          onFindKeyMoments: ({ assetId }) => requestRobots(assetId, '/key-moments'),
        }}
        style={styles.video}
        onStatusChange={event => setStatus(event.status)}
        onTimeUpdate={event => setTime(event.currentTime)}
      />
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>Status: {status}</Text>
        <Text style={styles.statusText}>{Math.floor(time)}s</Text>
      </View>
      <Text style={styles.videoTitle}>Tears of Steel</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#101820',
    padding: 20,
  },
  header: {
    marginBottom: 24,
    marginTop: 24,
  },
  eyebrow: {
    color: '#39d98a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  video: {
    aspectRatio: 16 / 9,
    backgroundColor: 'black',
    borderRadius: 18,
    overflow: 'hidden',
    width: '100%',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  statusText: {
    color: '#c9d6df',
    fontSize: 14,
  },
  videoTitle: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
});
