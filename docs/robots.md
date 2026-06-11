# Mux Robots

[Mux Robots](https://www.mux.com) can generate an AI summary, chapters, and key moments for a video. With `controls="custom"`, the player renders Robots buttons that trigger these on demand — chapters become timeline markers, key moments become highlighted ranges, and selecting either seeks to its start.

Robots is **opt-in**: without the `robots` prop you get a standard video player and nothing on this page applies.

## Security model — bring your own backend

Generating Robots data calls the Mux API, which requires your `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET`. **Never embed these in your app.** Instead, run a small authenticated endpoint on your backend that holds the secret, and pass callbacks that call it:

```
app (this package) → robots callbacks → your backend → Mux API (with your token)
```

```tsx
<MuxVideoView
  player={player}
  controls="custom"
  robots={{
    onSummarize: ({ assetId }) => postJson('/api/mux/robots/summarize', { assetId }),
    onGenerateChapters: ({ assetId }) => postJson('/api/mux/robots/chapters', { assetId }),
    onFindKeyMoments: ({ assetId }) => postJson('/api/mux/robots/key-moments', { assetId }),
  }}
/>
```

A reference backend implementation lives in this repo at [`example/scripts/robots-server.cjs`](../example/scripts/robots-server.cjs) — port it to your own stack (Next.js API route, Lambda, etc.).

Each callback receives `{ assetId, duration, currentTime }` and must resolve to the corresponding shape:

```ts
type MuxVideoSummary = { title: string; description: string; tags?: string[] };
type MuxVideoChapter = { startTime: number; title: string };
type MuxVideoKeyMoment = {
  startTime: number;
  endTime: number;
  title: string;
  description?: string;
  score?: number;
};
```

## Requirements for the buttons to appear

A Robots button renders only when its action is possible:

- the `robots` prop is set (and `enabled` is not `false`), **and**
- an `assetId` is available — set it on `robots.assetId` or on the video source (`source.assetId`), **and**
- the matching callback (`onSummarize`, `onGenerateChapters`, `onFindKeyMoments`) or pre-computed data exists.

No callback for an action → no button for it. This lets you enable just chapters, for example.

## Pre-computed data (no backend at all)

If you generate Robots data ahead of time (at upload, in a CMS), pass it directly and skip the callbacks entirely:

```tsx
<MuxVideoView
  player={player}
  controls="custom"
  robots={{
    summary: { title: 'Tears of Steel', description: '…' },
    chapters: [
      { startTime: 0, title: 'Opening' },
      { startTime: 120, title: 'The heist' },
    ],
    keyMoments: [{ startTime: 45, endTime: 60, title: 'Reveal' }],
  }}
/>
```

Callbacks and pre-computed data can be mixed; freshly generated results take precedence over the pre-computed values.

## Config reference

```ts
type MuxVideoRobotsConfig = {
  enabled?: boolean;     // default true when the prop is present
  assetId?: string;      // falls back to source.assetId
  summary?: MuxVideoSummary;
  chapters?: MuxVideoChapter[];
  keyMoments?: MuxVideoKeyMoment[];
  onSummarize?: (ctx: MuxVideoRobotsContext) => Promise<MuxVideoSummary>;
  onGenerateChapters?: (ctx: MuxVideoRobotsContext) => Promise<MuxVideoChapter[]>;
  onFindKeyMoments?: (ctx: MuxVideoRobotsContext) => Promise<MuxVideoKeyMoment[]>;
};

type MuxVideoRobotsContext = { assetId: string; duration: number; currentTime: number };
```
