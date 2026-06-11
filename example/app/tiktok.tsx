import * as React from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { ListRenderItemInfo } from '@shopify/flash-list';
import {
  MuxVideoView,
  useMuxVideoFeed,
  type MuxVideoPlayer,
  type MuxVideoSource,
} from '@mux/mux-react-native-player';

import {
  feedVideos,
  getFeedVideoSource,
  type FeedVideo,
} from '../lib/feedVideos';
import { requestRobots } from '../lib/exampleVideo';

// Keep the live native-player window small; useMuxVideoFeed releases the rest.
const PRELOAD_AHEAD = 1;
const PRELOAD_BEHIND = 0;
const FEED_MAX_RESOLUTION = '720p' as const;

export default function TikTokScreen() {
  const { width } = useWindowDimensions();
  const [feedHeight, setFeedHeight] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const isMomentumScrollingRef = React.useRef(false);
  const itemHeight = Math.max(1, feedHeight);
  const hasMeasuredFeed = feedHeight > 0;

  const feedSources = React.useMemo<MuxVideoSource[]>(
    () =>
      feedVideos.map(video => ({
        ...getFeedVideoSource(video),
        maxResolution: FEED_MAX_RESOLUTION,
      })),
    []
  );

  // Centralized windowed player lifecycle: preload around the active item,
  // release everything else, autoplay + loop the active video.
  const feed = useMuxVideoFeed(feedSources, activeIndex, {
    preloadAhead: PRELOAD_AHEAD,
    preloadBehind: PRELOAD_BEHIND,
    autoplay: true,
    loop: true,
  });

  const commitActiveIndexFromOffset = React.useCallback(
    (offsetY: number) => {
      if (feedHeight <= 0) {
        return;
      }
      const nextIndex = Math.max(
        0,
        Math.min(feedVideos.length - 1, Math.round(offsetY / feedHeight))
      );
      setActiveIndex(current => (current === nextIndex ? current : nextIndex));
    },
    [feedHeight]
  );

  const onMomentumScrollBegin = React.useCallback(() => {
    isMomentumScrollingRef.current = true;
  }, []);

  const onMomentumScrollEnd = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      isMomentumScrollingRef.current = false;
      commitActiveIndexFromOffset(event.nativeEvent.contentOffset.y);
    },
    [commitActiveIndexFromOffset]
  );

  const onScrollEndDrag = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      setTimeout(() => {
        if (!isMomentumScrollingRef.current) {
          commitActiveIndexFromOffset(offsetY);
        }
      }, 50);
    },
    [commitActiveIndexFromOffset]
  );

  const renderItem = React.useCallback(
    ({ item, index, target }: ListRenderItemInfo<FeedVideo>) => {
      if (target !== 'Cell') {
        return <View style={[styles.item, { height: itemHeight, width }]} />;
      }

      const isActive = index === activeIndex;
      return (
        <FeedVideoItem
          active={isActive}
          height={itemHeight}
          player={feed.getPlayer(index)}
          showControls={isActive}
          video={item}
          width={width}
        />
      );
    },
    [activeIndex, feed, itemHeight, width]
  );

  const listExtraData = React.useMemo(
    () => ({
      activeIndex,
      itemHeight,
      width,
      windowStart: feed.window.start,
      windowEnd: feed.window.end,
    }),
    [activeIndex, feed.window.end, feed.window.start, itemHeight, width]
  );

  return (
    <View
      style={styles.root}
      onLayout={event => {
        const nextHeight = event.nativeEvent.layout.height;
        setFeedHeight(currentHeight =>
          currentHeight === nextHeight ? currentHeight : nextHeight
        );
      }}
    >
      <StatusBar style="light" />
      {hasMeasuredFeed ? (
        <FlashList
          bounces={false}
          data={feedVideos}
          decelerationRate="fast"
          disableIntervalMomentum
          drawDistance={itemHeight * 2}
          extraData={listExtraData}
          keyExtractor={item => item.id}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          maxItemsInRecyclePool={0}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollEndDrag={onScrollEndDrag}
          pagingEnabled
          removeClippedSubviews={false}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={itemHeight}
          style={styles.feed}
        />
      ) : null}
    </View>
  );
}

type FeedVideoItemProps = {
  active: boolean;
  height: number;
  player: MuxVideoPlayer | null;
  showControls: boolean;
  video: FeedVideo;
  width: number;
};

const FeedVideoItem = React.memo(function FeedVideoItem({
  height,
  player,
  showControls,
  video,
  width,
}: FeedVideoItemProps) {
  return (
    <View style={[styles.item, { height, width }]}>
      {player ? (
        <MuxVideoView
          allowsFullscreen={false}
          controls={showControls ? 'custom' : 'none'}
          contentFit="cover"
          nativeControls={false}
          player={player}
          robots={
            showControls
              ? {
                  assetId: video.assetId,
                  onSummarize: ({ assetId }) =>
                    requestRobots(assetId, '/summarize'),
                  onGenerateChapters: ({ assetId }) =>
                    requestRobots(assetId, '/chapters'),
                  onFindKeyMoments: ({ assetId }) =>
                    requestRobots(assetId, '/key-moments'),
                }
              : undefined
          }
          startupBufferDuration={2.5}
          style={StyleSheet.absoluteFill}
          timeUpdateEventInterval={showControls ? 1 : 5}
        />
      ) : null}
    </View>
  );
}, areFeedVideoItemPropsEqual);

function areFeedVideoItemPropsEqual(
  previous: FeedVideoItemProps,
  next: FeedVideoItemProps
): boolean {
  return (
    previous.active === next.active &&
    previous.height === next.height &&
    previous.player === next.player &&
    previous.showControls === next.showControls &&
    previous.video.id === next.video.id &&
    previous.width === next.width
  );
}

const maintainVisibleContentPosition = {
  disabled: true,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'black',
  },
  feed: {
    backgroundColor: 'black',
    flex: 1,
  },
  item: {
    backgroundColor: 'black',
    overflow: 'hidden',
  },
});
