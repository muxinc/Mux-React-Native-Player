import { describe, expect, it, vi } from 'vitest';
import fixture from '../example-tv/fixtures/tears-of-steel-robots.json';
import { normalizeRobotsContent, robotsSeekTarget } from '../src/tv/robotsState';
import type { MuxPlayerStatus } from '../src/types';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
import { videos } from '../example-tv/fixtures';

describe('completed Robots TV fixture', () => {
  it('offers the matching video and saved content first without requiring a proxy', () => {
    const first = videos[0];
    expect(first.source).toMatchObject({ assetId: fixture.assetId, playbackId: fixture.playbackId });
    expect(first.controls).toBe('custom');
    expect(first.robots).toBe(fixture.robots);
    expect(first.robots?.onSummarize).toBeUndefined();
    expect(fixture.provenance.jobs.map(job => job.workflow).sort())
      .toEqual(['find-key-moments', 'generate-chapters', 'summarize']);
  });

  it('provides all four panels with valid seek targets in seconds for this video', () => {
    const status = { status: 'paused', duration: fixture.duration, currentTime: 0, isLive: false } as MuxPlayerStatus;
    const summary = normalizeRobotsContent('summary', fixture.robots.summary);
    expect(summary.title).toBeTruthy();
    expect(summary.description).toBeTruthy();
    for (const [panel, value] of [
      ['chapters', fixture.robots.chapters],
      ['moments', fixture.robots.keyMoments],
      ['transcript', fixture.robots.transcript],
    ] as const) {
      const content = normalizeRobotsContent(panel, value);
      expect(content.rows.length).toBeGreaterThan(0);
      for (const row of content.rows) {
        expect(robotsSeekTarget(row, status)).toBe(row.startTime);
        if (row.endTime !== undefined) expect(row.endTime).toBeLessThanOrEqual(fixture.duration);
      }
    }
  });
});
