# Feeds & Shorts (`useMuxVideoFeed`)

Vertical short-form feeds (TikTok / Reels style) are where naive React Native video
implementations fall apart: mounting a player per row exhausts native memory, and
without preloading the next video, scrolling stutters. `useMuxVideoFeed` manages a
**sliding window** of players for you — it preloads around the active item and releases
everything else, so memory stays bounded no matter how long the list is.

## Usage

```tsx
import { FlashList } from '@shopify/flash-list';
import { MuxVideoView, useMuxVideoFeed } from '@mux/mux-react-native-player';

function Feed({ videos }) {
  const [activeIndex, setActiveIndex] = React.useState(0);

  const sources = React.useMemo(
    () => videos.map(v => ({ playbackId: v.playbackId, maxResolution: '720p' })),
    [videos]
  );

  const feed = useMuxVideoFeed(sources, activeIndex, {
    preloadAhead: 1,
    preloadBehind: 0,
    autoplay: true,
    loop: true,
  });

  return (
    <FlashList
      data={videos}
      pagingEnabled
      extraData={{ activeIndex, start: feed.window.start, end: feed.window.end }}
      onMomentumScrollEnd={e =>
        setActiveIndex(Math.round(e.nativeEvent.contentOffset.y / itemHeight))
      }
      renderItem={({ item, index }) => {
        const player = feed.getPlayer(index);
        return (
          <View style={{ height: itemHeight }}>
            {player ? (
              <MuxVideoView
                player={player}
                controls={index === activeIndex ? 'custom' : 'none'}
                contentFit="cover"
                allowsFullscreen={false}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
          </View>
        );
      }}
    />
  );
}
```

A complete, working implementation lives in the example app at
[`example/app/tiktok.tsx`](../example/app/tiktok.tsx).

## How it works

- **You own `activeIndex`** — derive it from scroll position / viewability. The hook
  reacts to it.
- **The hook owns the players** — it creates a player for each index in the window
  `[activeIndex - preloadBehind, activeIndex + preloadAhead]`, configures mute/loop, and
  plays the active one. Indices that leave the window are `release()`d. Pass the player
  to `MuxVideoView`; do **not** wrap it in `useMuxVideoPlayer` (that would create a
  second, competing player).
- **`getPlayer(index)`** returns the managed player for an index, or `null` when that
  index is outside the window — render a placeholder (or nothing) for `null`.
- **`window`** is the current `{ start, end }` range; include it in your list's
  `extraData` so rows re-render when the window shifts.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `preloadAhead` | `1` | Items after the active index to preload |
| `preloadBehind` | `1` | Items before the active index to keep alive |
| `muted` | `false` | Mute the active item too. Off-screen items are always muted |
| `autoplay` | `true` | Auto-play the active item |
| `loop` | `true` | Loop every feed item |

Total live players never exceed `preloadBehind + preloadAhead + 1`. For the leanest
memory profile in a downward-scrolling feed, use `preloadBehind: 0, preloadAhead: 1`.

## Tips

- Disable FlashList recycling for video rows (`maxItemsInRecyclePool={0}`,
  `removeClippedSubviews={false}`) so the native surfaces aren't torn down mid-scroll.
- Cap resolution with `maxResolution: '720p'` on feed sources — full-res is wasted on a
  phone-height cell and costs bandwidth.
- Show only the active item's controls (`controls={isActive ? 'custom' : 'none'}`).
