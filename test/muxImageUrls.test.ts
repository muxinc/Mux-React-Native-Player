import { describe, expect, it } from 'vitest';

import {
  buildMuxStoryboardVttUrl,
  buildMuxThumbnailUrl,
  muxImageHost,
} from '../src/muxImageUrls';

describe('muxImageHost', () => {
  it('defaults to image.mux.com', () => {
    expect(muxImageHost()).toBe('image.mux.com');
  });

  it('derives the image subdomain from a custom domain', () => {
    expect(muxImageHost('media.example.com')).toBe('image.media.example.com');
    expect(muxImageHost('https://media.example.com/')).toBe('image.media.example.com');
  });
});

describe('buildMuxThumbnailUrl', () => {
  it('builds a bare thumbnail URL', () => {
    expect(buildMuxThumbnailUrl({ playbackId: 'abc' })).toBe(
      'https://image.mux.com/abc/thumbnail.jpg'
    );
  });

  it('encodes time, sizing, fit, and token params', () => {
    const url = buildMuxThumbnailUrl(
      { playbackId: 'abc' },
      { time: 12.5, width: 320, fitMode: 'smartcrop', token: 'tok' }
    );
    expect(url).toContain('time=12.5');
    expect(url).toContain('width=320');
    expect(url).toContain('fit_mode=smartcrop');
    expect(url).toContain('token=tok');
  });

  it('uses the custom domain image host', () => {
    expect(buildMuxThumbnailUrl({ playbackId: 'abc', customDomain: 'media.example.com' })).toBe(
      'https://image.media.example.com/abc/thumbnail.jpg'
    );
  });
});

describe('buildMuxStoryboardVttUrl', () => {
  it('builds the storyboard VTT URL', () => {
    expect(buildMuxStoryboardVttUrl({ playbackId: 'abc' })).toBe(
      'https://image.mux.com/abc/storyboard.vtt'
    );
  });

  it('appends a signed token', () => {
    expect(buildMuxStoryboardVttUrl({ playbackId: 'abc' }, 'a b')).toBe(
      'https://image.mux.com/abc/storyboard.vtt?token=a%20b'
    );
  });
});
