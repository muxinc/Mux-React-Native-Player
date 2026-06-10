import * as React from 'react';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabIconProps = {
  color: string;
  focused: boolean;
};

type InstagramTabButtonProps = PressableProps & {
  href?: string;
  icon: 'player' | 'feed';
  isFocused?: boolean;
};

export default function TabsLayout() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.scene} />
      <TabList asChild>
        <SafeAreaView edges={['bottom']} style={styles.tabBar}>
          <TabTrigger name="index" href="/" asChild resetOnFocus>
            <InstagramTabButton
              accessibilityLabel="Player tab"
              icon="player"
            />
          </TabTrigger>
          <TabTrigger name="tiktok" href="/tiktok" asChild resetOnFocus>
            <InstagramTabButton
              accessibilityLabel="Feed tab"
              icon="feed"
            />
          </TabTrigger>
        </SafeAreaView>
      </TabList>
    </Tabs>
  );
}

const InstagramTabButton = React.forwardRef<View, InstagramTabButtonProps>(
  function InstagramTabButton(
    {
      accessibilityState,
      href: _href,
      icon,
      isFocused = false,
      style: _style,
      ...props
    },
    ref
  ) {
    const color = isFocused ? '#f8fbff' : '#7d8793';

    return (
      <Pressable
        {...props}
        ref={ref}
        accessibilityRole="tab"
        accessibilityState={{ ...accessibilityState, selected: isFocused }}
        style={({ pressed }) => [
          styles.tabButton,
          isFocused && styles.tabButtonFocused,
          pressed && styles.tabButtonPressed,
        ]}
      >
        {icon === 'player' ? (
          <PlayerTabIcon color={color} focused={isFocused} />
        ) : (
          <FeedTabIcon color={color} focused={isFocused} />
        )}
      </Pressable>
    );
  }
);

function PlayerTabIcon({ color, focused }: TabIconProps) {
  return (
    <View style={[styles.playerFrame, { borderColor: color }]}>
      <View
        style={[
          styles.playTriangle,
          {
            borderLeftColor: color,
            opacity: focused ? 1 : 0.78,
          },
        ]}
      />
    </View>
  );
}

function FeedTabIcon({ color, focused }: TabIconProps) {
  return (
    <View style={[styles.feedFrame, { borderColor: color }]}>
      <View
        style={[
          styles.feedInnerFrame,
          {
            borderColor: color,
            opacity: focused ? 1 : 0.76,
          },
        ]}
      />
      <View style={[styles.feedDot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#050608',
    flex: 1,
  },
  scene: {
    backgroundColor: '#050608',
    flex: 1,
  },
  tabBar: {
    alignItems: 'center',
    backgroundColor: '#050608',
    borderTopColor: 'rgba(248, 251, 255, 0.16)',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-around',
    minHeight: 62,
    paddingBottom: 6,
    paddingHorizontal: 42,
    paddingTop: 8,
  },
  tabButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    opacity: 0.82,
    width: 64,
  },
  tabButtonFocused: {
    opacity: 1,
  },
  tabButtonPressed: {
    opacity: 0.68,
  },
  playerFrame: {
    alignItems: 'center',
    borderRadius: 5,
    borderWidth: 2,
    height: 23,
    justifyContent: 'center',
    width: 28,
  },
  playTriangle: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    borderTopColor: 'transparent',
    borderTopWidth: 5,
    height: 0,
    marginLeft: 2,
    width: 0,
  },
  feedFrame: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    width: 22,
  },
  feedInnerFrame: {
    borderRadius: 4,
    borderWidth: 1.5,
    height: 18,
    width: 13,
  },
  feedDot: {
    borderRadius: 2,
    height: 3,
    marginTop: 2,
    width: 3,
  },
});
