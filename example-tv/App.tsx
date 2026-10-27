import * as React from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TVEventControl, TVFocusGuideView, View } from 'react-native';
import { MuxVideoView, useMuxVideoPlayer, type MuxVideoPlayer, type MuxStatusChangeEvent, type MuxTimeUpdateEvent } from '@mux/mux-react-native-player';

import { videos } from './fixtures';

const showQAStatus = __DEV__ && process.env.EXPO_PUBLIC_MUX_TV_QA_STATUS === '1';

function startPlayback(player: MuxVideoPlayer) {
  void player.play().catch(() => {
    // A native view can detach before this async command arrives. The player
    // retains declarative autoplay intent; source failures use onSourceError.
  });
}

function PlayerScreen({ video, onBack }: { video: (typeof videos)[number]; onBack: () => void }) {
  const player = useMuxVideoPlayer(video.source, startPlayback);
  const [failed, setFailed] = React.useState(false);
  const [qaStatus, setQAStatus] = React.useState({ status: 'idle', currentTime: 0, duration: 0 });
  const updateStatus = React.useCallback((event: MuxStatusChangeEvent) => {
    if (showQAStatus) {
      setQAStatus({ status: event.status, currentTime: event.currentTime, duration: event.duration });
    }
  }, []);
  const updateTime = React.useCallback((event: MuxTimeUpdateEvent) => {
    if (showQAStatus) {
      setQAStatus(previous => ({ ...previous, currentTime: event.currentTime, duration: event.duration }));
    }
  }, []);

  React.useLayoutEffect(() => {
    const appleTV = Platform.isTV && Platform.OS === 'ios';
    if (appleTV) TVEventControl.enableTVMenuKey();
    // Native controls get first refusal on Back/Menu (for example, to dismiss
    // a track panel). Only an unconsumed event exits the host playback screen.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => {
      subscription.remove();
      if (appleTV) TVEventControl.disableTVMenuKey();
    };
  }, [onBack]);

  return (
    <View style={styles.playerScreen}>
      <MuxVideoView
        player={player}
        controls={video.controls ?? 'native'}
        robots={video.robots}
        contentFit="contain"
        style={StyleSheet.absoluteFill}
        allowsAirPlay={false}
        allowsPictureInPicture={false}
        onStatusChange={updateStatus}
        onTimeUpdate={updateTime}
        onSourceError={() => setFailed(true)}
        onSourceLoad={() => setFailed(false)}
      />
      {showQAStatus && (
        <View pointerEvents="none" style={styles.qaStatus}>
          <Text style={styles.qaStatusText}>
            {qaStatus.status} · {qaStatus.currentTime.toFixed(1)}s / {qaStatus.duration.toFixed(1)}s
          </Text>
        </View>
      )}
      {failed && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={styles.errorText}>This video could not be played.</Text>
          <Text style={styles.detail}>Press Back or Menu to choose another video.</Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [active, setActive] = React.useState<string | null>(null);
  const [lastSelected, setLastSelected] = React.useState(videos[0].id);
  const [focused, setFocused] = React.useState<string | null>(null);
  const returnToLibrary = React.useCallback(() => setActive(null), []);
  const video = videos.find(item => item.id === active);

  // The selection screen remounts after playback; preferred focus restores the
  // exact source that launched it. Unmounting PlayerScreen releases its player.
  if (video) return <PlayerScreen key={video.id} video={video} onBack={returnToLibrary} />;

  return (
    <View style={styles.library}>
      <Text style={styles.eyebrow}>MUX PLAYER · TV EXAMPLE</Text>
      <Text accessibilityRole="header" style={styles.title}>Choose a video</Text>
      <Text style={styles.subtitle}>Select to play. Back or Menu returns here.</Text>
      {!Platform.isTV && <Text style={styles.detail}>Run this example on an Apple TV or Android TV native build.</Text>}
      <TVFocusGuideView style={styles.choices}>
        <ScrollView contentContainerStyle={styles.choiceContent}>
        {videos.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.detail}`}
            hasTVPreferredFocus={item.id === lastSelected}
            onFocus={() => setFocused(item.id)}
            onBlur={() => setFocused(null)}
            onPress={() => { setLastSelected(item.id); setActive(item.id); }}
            style={[styles.card, focused === item.id && styles.focusedCard]}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.detail}>{item.detail}</Text>
          </Pressable>
        ))}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  library: { flex: 1, backgroundColor: '#101218', paddingHorizontal: 64, paddingVertical: 48, justifyContent: 'center' },
  eyebrow: { color: '#ff85b7', fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#ffffff', fontSize: 42, fontWeight: '700', marginTop: 12 },
  subtitle: { color: '#d2d7e0', fontSize: 22, marginTop: 12, marginBottom: 28 },
  choices: { flex: 1 },
  choiceContent: { gap: 18, padding: 4 },
  card: { borderWidth: 4, borderColor: '#353c4d', borderRadius: 14, padding: 24, backgroundColor: '#1c2330' },
  focusedCard: { borderColor: '#ff85b7', backgroundColor: '#343044' },
  cardTitle: { color: '#ffffff', fontSize: 28, fontWeight: '600' },
  detail: { color: '#d2d7e0', fontSize: 18, marginTop: 8 },
  playerScreen: { flex: 1, backgroundColor: '#000000' },
  qaStatus: { position: 'absolute', top: 0, left: 36, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#101218dd' },
  qaStatusText: { color: '#ffffff', fontSize: 12, fontVariant: ['tabular-nums'] },
  error: { position: 'absolute', left: 48, right: 48, top: 48, padding: 24, backgroundColor: '#281820' },
  errorText: { color: '#ffffff', fontSize: 24, fontWeight: '600' },
});
