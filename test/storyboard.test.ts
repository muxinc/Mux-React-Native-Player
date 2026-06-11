import { describe, expect, it } from 'vitest';

import { parseStoryboardVtt, tileForTime } from '../src/storyboard';

const VTT_URL = 'https://image.mux.com/abc/storyboard.vtt';
const SAMPLE = `WEBVTT

00:00:00.000 --> 00:00:05.000
storyboard.jpg#xywh=0,0,320,180

00:00:05.000 --> 00:00:10.000
storyboard.jpg#xywh=320,0,320,180

00:00:10.000 --> 00:00:15.000
storyboard.jpg#xywh=0,180,320,180
`;

describe('parseStoryboardVtt', () => {
  it('returns null for empty or cue-less input', () => {
    expect(parseStoryboardVtt('', VTT_URL)).toBeNull();
    expect(parseStoryboardVtt('WEBVTT\n\n', VTT_URL)).toBeNull();
  });

  it('parses cues into tiles and computes sprite dimensions', () => {
    const result = parseStoryboardVtt(SAMPLE, VTT_URL);
    expect(result).not.toBeNull();
    expect(result!.tiles).toHaveLength(3);
    expect(result!.spriteWidth).toBe(640);
    expect(result!.spriteHeight).toBe(360);
    expect(result!.spriteUrl).toBe('https://image.mux.com/abc/storyboard.jpg');
  });

  it('preserves the VTT query string on a relative sprite reference', () => {
    const result = parseStoryboardVtt(SAMPLE, `${VTT_URL}?token=signed`);
    expect(result!.spriteUrl).toBe('https://image.mux.com/abc/storyboard.jpg?token=signed');
  });

  it('honors absolute sprite references', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:05.000
https://cdn.example.com/sprite.jpg#xywh=0,0,100,100
`;
    const result = parseStoryboardVtt(vtt, VTT_URL);
    expect(result!.spriteUrl).toBe('https://cdn.example.com/sprite.jpg');
  });
});

describe('tileForTime', () => {
  const storyboard = parseStoryboardVtt(SAMPLE, VTT_URL)!;

  it('finds the tile covering a time', () => {
    expect(tileForTime(storyboard, 7)).toMatchObject({ x: 320, y: 0 });
    expect(tileForTime(storyboard, 0)).toMatchObject({ x: 0, y: 0 });
    expect(tileForTime(storyboard, 12)).toMatchObject({ x: 0, y: 180 });
  });

  it('clamps to edge tiles outside the cue range', () => {
    expect(tileForTime(storyboard, -5)).toMatchObject({ x: 0, y: 0 });
    expect(tileForTime(storyboard, 999)).toMatchObject({ x: 0, y: 180 });
  });
});
