import * as React from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  InteractionManager,
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
  useMuxVideoPlayer,
} from '@mux/mux-react-native-player';

import {
  feedVideos,
  getFeedVideoSource,
  type FeedVideo,
} from '../lib/feedVideos';
import { requestRobots } from '../lib/exampleVideo';

// Keep the native-player window small; native buffering handles smooth starts.
const PRELOAD_AHEAD = 1;
const PRELOAD_BEHIND = 0;
const IMMEDIATE_PRELOAD_AHEAD = 1;
const STAGGERED_PRELOAD_DELAY_MS = 200;
const START_UNMUTE_DELAY_MS = 150;
const FEED_MAX_RESOLUTION = '720p' as const;

type ScrollDirection = 'up' | 'down';

export default function TikTokScreen() {
  const { width } = useWindowDimensions();
  const [feedHeight, setFeedHeight] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [scrollDirection, setScrollDirection] =
    React.useState<ScrollDirection>('down');
  const isMomentumScrollingRef = React.useRef(false);
  const itemHeight = Math.max(1, feedHeight);
  const hasMeasuredFeed = feedHeight > 0;

  const clampFeedIndex = React.useCallback((index: number) => {
    return Math.max(0, Math.min(feedVideos.length - 1, index));
  }, []);

  const commitActiveIndex = React.useCallback(
    (nextIndex: number) => {
      const clampedIndex = clampFeedIndex(nextIndex);
      setActiveIndex(currentIndex => {
        if (clampedIndex === currentIndex) {
          return currentIndex;
        }
        setScrollDirection(clampedIndex > currentIndex ? 'down' : 'up');
        return clampedIndex;
      });
    },
    [clampFeedIndex]
  );

  const commitActiveIndexFromOffset = React.useCallback(
    (offsetY: number) => {
      if (feedHeight <= 0) {
        return;
      }
      commitActiveIndex(Math.round(offsetY / feedHeight));
    },
    [commitActiveIndex, feedHeight]
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

  const shouldPreloadIndex = React.useCallback(
    (index: number) => {
      if (index === activeIndex) {
        return true;
      }

      if (scrollDirection === 'down') {
        return (
          index >= activeIndex - PRELOAD_BEHIND &&
          index <= activeIndex + PRELOAD_AHEAD
        );
      }

      return (
        index >= activeIndex - PRELOAD_AHEAD &&
        index <= activeIndex + PRELOAD_BEHIND
      );
    },
    [activeIndex, scrollDirection]
  );

  const renderItem = React.useCallback(
    ({ item, index, target }: ListRenderItemInfo<FeedVideo>) => {
      if (target !== 'Cell') {
        return <View style={[styles.item, { height: itemHeight, width }]} />;
      }

      const isActive = index === activeIndex;
      const offsetFromActive = index - activeIndex;

      return (
        <FeedVideoItem
          active={isActive}
          height={itemHeight}
          preloadDelay={getPreloadDelay(offsetFromActive)}
          shouldPreload={shouldPreloadIndex(index)}
          showControls={isActive}
          video={item}
          width={width}
        />
      );
    },
    [
      activeIndex,
      itemHeight,
      shouldPreloadIndex,
      width,
    ]
  );

  const listExtraData = React.useMemo(
    () => ({
      activeIndex,
      itemHeight,
      scrollDirection,
      width,
    }),
    [activeIndex, itemHeight, scrollDirection, width]
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
          overrideProps={flashListOverrideProps}
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
  preloadDelay: number;
  shouldPreload: boolean;
  showControls: boolean;
  video: FeedVideo;
  width: number;
};

const FeedVideoItem = React.memo(function FeedVideoItem({
  active,
  height,
  preloadDelay,
  shouldPreload,
  showControls,
  video,
  width,
}: FeedVideoItemProps) {
  const unmuteTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const [isPreloadArmed, setIsPreloadArmed] = React.useState(
    shouldPreload && preloadDelay === 0
  );
  const [isReady, setIsReady] = React.useState(false);
  const shouldUsePlayer = shouldPreload && isPreloadArmed;
  const source = React.useMemo(() => {
    if (!shouldUsePlayer) {
      return undefined;
    }

    return {
      ...getFeedVideoSource(video),
      maxResolution: FEED_MAX_RESOLUTION,
    };
  }, [shouldUsePlayer, video]);
  const player = useMuxVideoPlayer(source);

  const clearUnmuteTimeout = React.useCallback(() => {
    if (unmuteTimeoutRef.current != null) {
      clearTimeout(unmuteTimeoutRef.current);
      unmuteTimeoutRef.current = undefined;
    }
  }, []);

  React.useEffect(() => {
    setIsReady(false);
    clearUnmuteTimeout();
  }, [clearUnmuteTimeout, video.id]);

  React.useEffect(() => clearUnmuteTimeout, [clearUnmuteTimeout]);

  React.useEffect(() => {
    if (!shouldPreload) {
      setIsPreloadArmed(false);
      return;
    }

    if (preloadDelay === 0) {
      setIsPreloadArmed(true);
      return;
    }

    setIsPreloadArmed(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const interaction = InteractionManager.runAfterInteractions(() => {
      timeout = setTimeout(() => {
        setIsPreloadArmed(true);
      }, preloadDelay);
    });

    return () => {
      interaction.cancel();
      if (timeout != null) {
        clearTimeout(timeout);
      }
    };
  }, [preloadDelay, shouldPreload, video.id]);

  React.useEffect(() => {
    runFeedPlayerCommand(player.setLoop(true));
  }, [player]);

  React.useEffect(() => {
    clearUnmuteTimeout();

    if (!shouldUsePlayer) {
      setIsReady(false);
      runFeedPlayerCommand(player.setMuted(true));
      runFeedPlayerCommand(player.pause());
      runFeedPlayerCommand(player.release());
      return;
    }

    if (active) {
      // Set playWhenReady even before source load. Once the item is ready,
      // unmute after a short delay so the first decoded video frames are shown.
      runFeedPlayerCommand(player.setMuted(true));
      runFeedPlayerCommand(player.play());

      if (isReady) {
        unmuteTimeoutRef.current = setTimeout(() => {
          unmuteTimeoutRef.current = undefined;
          runFeedPlayerCommand(player.setMuted(false));
        }, START_UNMUTE_DELAY_MS);
      }

      return clearUnmuteTimeout;
    }

    runFeedPlayerCommand(player.setMuted(true));
    runFeedPlayerCommand(player.pause());
  }, [active, clearUnmuteTimeout, isReady, player, shouldUsePlayer, video.id]);

  return (
    <View style={[styles.item, { height, width }]}>
      {shouldUsePlayer ? (
        <MuxVideoView
          allowsFullscreen={false}
          controls={showControls ? 'custom' : 'none'}
          contentFit="cover"
          nativeControls={false}
          onSourceError={event => {
            if (
              event.playbackId == null ||
              event.playbackId === video.playbackId
            ) {
              setIsReady(false);
            }
          }}
          onSourceLoad={event => {
            if (event.playbackId === video.playbackId) {
              setIsReady(true);
            }
          }}
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
    previous.preloadDelay === next.preloadDelay &&
    previous.shouldPreload === next.shouldPreload &&
    previous.showControls === next.showControls &&
    previous.video.id === next.video.id &&
    previous.width === next.width
  );
}

function getPreloadDelay(offsetFromActive: number): number {
  const distance = Math.abs(offsetFromActive);
  if (distance <= IMMEDIATE_PRELOAD_AHEAD) {
    return 0;
  }

  return (distance - IMMEDIATE_PRELOAD_AHEAD) * STAGGERED_PRELOAD_DELAY_MS;
}

function runFeedPlayerCommand(command: Promise<void>): void {
  command.catch(() => {
    // FlashList can unmount a native row while Expo view commands are settling.
  });
}

const maintainVisibleContentPosition = {
  disabled: true,
};

const flashListOverrideProps = {
  initialDrawBatchSize: PRELOAD_AHEAD + PRELOAD_BEHIND + 1,
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
