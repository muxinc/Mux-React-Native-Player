import { NativeTabs } from 'expo-router/unstable-native-tabs';

const tabContentStyle = { backgroundColor: '#050608' } as const;

export default function TabsLayout() {
  return (
    <NativeTabs
      backgroundColor="#050608"
      blurEffect="dark"
      disableTransparentOnScrollEdge
      iconColor={{ default: '#7d8793', selected: '#f8fbff' }}
      labelStyle={{
        default: { color: '#7d8793' },
        selected: { color: '#f8fbff', fontWeight: '700' },
      }}
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger
        contentStyle={tabContentStyle}
        disableAutomaticContentInsets
        name="index"
      >
        <NativeTabs.Trigger.Icon
          md="play_circle"
          sf={{ default: 'play.rectangle', selected: 'play.rectangle.fill' }}
        />
        <NativeTabs.Trigger.Label>Player</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        contentStyle={tabContentStyle}
        disableAutomaticContentInsets
        name="tiktok"
      >
        <NativeTabs.Trigger.Icon
          md="video_library"
          sf={{ default: 'rectangle.stack', selected: 'rectangle.stack.fill' }}
        />
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
