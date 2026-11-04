import { describe, expect, it } from 'vitest';
import { advanceTVPreview, clampTVTime, clearTVBackSubscription, formatTVTime, refreshTVBackSubscription, tvClockLabelWidth, tvClockTextWidth, TV_CLOCK_KERNING_SLACK, tvFocusEntry, tvFocusLinks, tvQualityOptions, tvRemoteAction, TVRemoteInput, tvScanPress, tvScanSteps, tvScrubSpeed, tvSeekStep,
  tvControlsPresentation, tvSettingsSections, tvTimeline, TV_HOLD_REPEAT_MS, TV_PANEL_ENTRY_FOCUS, TV_PANEL_FOCUS, TV_SCRUB_RAMP_MS,
  type TVControlsPanel, type TVFocusLayout, type TVRemoteFocus } from '../src/tv/controls';

describe('TV remote focus order', () => {
  const layout: TVFocusLayout = {
    top: ['robot-summary', 'robot-chapters', 'robot-moments', 'more'],
    timeline: 'seek',
    bar: ['play', 'backward', 'forward', 'tracks', 'settings'],
  };
  /** Follows one arrow from each control, as the remote would. */
  const walk = (start: string, direction: 'up' | 'down' | 'left' | 'right', steps: number, value = layout) => {
    const visited = [start];
    for (let i = 0; i < steps; i++) visited.push(tvFocusLinks(visited[visited.length - 1], value)[direction]!);
    return visited;
  };

  it('moves along each row in screen order and stops at its ends', () => {
    expect(walk('play', 'right', 5)).toEqual(['play', 'backward', 'forward', 'tracks', 'settings', 'settings']);
    expect(walk('settings', 'left', 5)).toEqual(['settings', 'tracks', 'forward', 'backward', 'play', 'play']);
    expect(walk('robot-summary', 'right', 4)).toEqual(['robot-summary', 'robot-chapters', 'robot-moments', 'more', 'more']);
    expect(walk('more', 'left', 4)).toEqual(['more', 'robot-moments', 'robot-chapters', 'robot-summary', 'robot-summary']);
  });

  it('moves one row at a time: buttons, timeline, then the top row', () => {
    for (const id of layout.bar) {
      expect(tvFocusLinks(id, layout).up).toBe('seek');
      expect(tvFocusLinks(id, layout).down).toBe(id);
    }
    expect(walk('settings', 'up', 3)).toEqual(['settings', 'seek', 'robot-summary', 'robot-summary']);
    for (const id of layout.top) expect(tvFocusLinks(id, layout).down).toBe('seek');
    expect(tvFocusLinks('seek', layout)).toMatchObject({ down: 'play', left: 'seek', right: 'seek' });
  });

  it('returns to the control focus came from in the row it re-enters', () => {
    const memory = { top: 'robot-moments', bar: 'settings' };
    expect(tvFocusLinks('seek', layout, memory)).toMatchObject({ up: 'robot-moments', down: 'settings' });
    expect(tvFocusLinks('robot-chapters', layout, memory).down).toBe('seek');
    // A remembered control that has since gone falls back to the row's first.
    expect(tvFocusLinks('seek', { ...layout, top: ['robot-summary', 'more'], bar: ['play'] }, memory))
      .toMatchObject({ up: 'robot-summary', down: 'play' });
    expect(tvFocusEntry(['play', 'settings'], 'settings')).toBe('settings');
    expect(tvFocusEntry([], 'settings')).toBeUndefined();
  });

  it('enters open Robots content between its tab and the playback bar', () => {
    const open = { ...layout, openTab: 'robot-chapters' };
    expect(tvFocusLinks('robot-chapters', open).down).toBe(TV_PANEL_ENTRY_FOCUS);
    // A neighbouring tab becomes the open one as soon as it is focused.
    expect(tvFocusLinks('robot-moments', open).down).toBe(TV_PANEL_ENTRY_FOCUS);
    expect(tvFocusLinks('seek', open, { top: 'robot-summary' }).up).toBe(TV_PANEL_FOCUS);
    // Buttons still reach the timeline first; without a timeline they enter the content.
    expect(tvFocusLinks('play', open).up).toBe('seek');
    expect(tvFocusLinks('play', { ...open, timeline: undefined }).up).toBe(TV_PANEL_FOCUS);
  });

  it('passes over open Robots content with nothing to focus', () => {
    const summary = { ...layout, openTab: 'robot-summary', panelFocusable: false };
    expect(tvFocusLinks('robot-summary', summary).down).toBe('seek');
    expect(tvFocusLinks('seek', summary).up).toBe('robot-summary');
    expect(tvFocusLinks('play', { ...summary, timeline: undefined }).up).toBe('robot-summary');
  });

  it('keeps … beside the tabs of an open workflow', () => {
    const open = { ...layout, openTab: 'robot-moments' };
    expect(walk('robot-summary', 'right', 4, open)).toEqual(['robot-summary', 'robot-chapters', 'robot-moments', 'more', 'more']);
    expect(tvFocusLinks('more', open)).toEqual({ up: 'more', down: TV_PANEL_ENTRY_FOCUS, left: 'robot-moments', right: 'more' });
    // Without … (another panel traps focus), the last tab is the row's end.
    const trapped = { ...open, top: ['robot-summary', 'robot-chapters', 'robot-moments'] };
    expect(tvFocusLinks('robot-moments', trapped).right).toBe('robot-moments');
  });

  it.each<TVControlsPanel>(['summary', 'chapters', 'moments', 'transcript'])(
    'enters %s content with Down from its tab, once per press', panel => {
      expect(tvRemoteAction({ eventType: 'down', eventKeyAction: 1 }, panel, 'tab', 'ios')).toBe('enterPanel');
      expect(tvRemoteAction({ eventType: 'down', eventKeyAction: 0 }, panel, 'tab', 'ios')).toBeNull();
      const input = new TVRemoteInput(() => 0);
      expect(input.action({ eventType: 'down', eventKeyAction: 0 }, panel, 'tab', 'android')).toBe('enterPanel');
      expect(input.action({ eventType: 'down', eventKeyAction: 1 }, panel, 'tab', 'android')).toBeNull();
      // Android hosts that send only key-up still enter once.
      expect(new TVRemoteInput(() => 0).action({ eventType: 'down', eventKeyAction: 1 }, panel, 'tab', 'android')).toBe('enterPanel');
      // Not without an open workflow, and not from other controls.
      expect(tvRemoteAction({ eventType: 'down', eventKeyAction: 1 }, null, 'tab', 'ios')).toBeNull();
      expect(tvRemoteAction({ eventType: 'down', eventKeyAction: 1 }, 'more', 'tab', 'ios')).toBeNull();
    },
  );

  it('leaves the … menu with Left on either platform, once per press', () => {
    expect(tvRemoteAction({ eventType: 'left', eventKeyAction: 1 }, 'more', 'menu', 'ios')).toBe('leaveMenu');
    const input = new TVRemoteInput(() => 0);
    expect(input.action({ eventType: 'left', eventKeyAction: 0 }, 'more', 'menu', 'android')).toBe('leaveMenu');
    expect(input.action({ eventType: 'left', eventKeyAction: 1 }, 'more', 'menu', 'android')).toBeNull();
    // Other arrows, and Left outside the menu, stay with native focus.
    for (const eventType of ['right', 'up', 'down', 'longLeft']) {
      expect(tvRemoteAction({ eventType, eventKeyAction: 1 }, 'more', 'menu', 'ios')).toBeNull();
    }
    expect(tvRemoteAction({ eventType: 'left', eventKeyAction: 1 }, 'settings', 'menu', 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'left', eventKeyAction: 1 }, 'more', null, 'ios')).toBeNull();
  });

  it('skips missing rows without leaving the overlay', () => {
    const live = { top: [], bar: ['play', 'live', 'settings'] };
    expect(tvFocusLinks('play', live)).toEqual({ up: 'play', down: 'play', left: 'play', right: 'live' });
    expect(tvFocusLinks('robot-summary', { ...layout, timeline: undefined }, { bar: 'tracks' }).down).toBe('tracks');
    expect(tvFocusLinks('seek-preview', layout)).toEqual({});
  });
});

describe('TV panel Back priority', () => {
  it('outranks a later host mount listener on open, falls through on close, and cleans the current listener', () => {
    // Both RN Android and tvOS invoke subscribers in reverse registration order.
    const listeners: { owner: 'controls' | 'host'; handler: () => boolean }[] = [];
    let maxControls = 0;
    const subscribe = (handler: () => boolean) => {
      const entry = { owner: 'controls' as const, handler };
      listeners.push(entry);
      maxControls = Math.max(maxControls, listeners.filter(value => value.owner === 'controls').length);
      return { remove: () => {
        const index = listeners.indexOf(entry);
        if (index >= 0) listeners.splice(index, 1);
      } };
    };
    const dispatch = () => {
      for (const entry of [...listeners].reverse()) if (entry.handler()) return;
    };
    const ref: { current: { remove: () => void } | null } = { current: null };
    let panelOpen = false;
    let hostBacks = 0;
    let panelBacks = 0;
    const back = () => {
      if (!panelOpen) return false;
      panelOpen = false;
      panelBacks++;
      return true;
    };

    refreshTVBackSubscription(ref, subscribe, back);
    // A parent's passive effect may register after the child's mount effect.
    listeners.push({ owner: 'host', handler: () => { hostBacks++; return true; } });
    panelOpen = true;
    refreshTVBackSubscription(ref, subscribe, back);
    dispatch();
    expect(panelBacks).toBe(1);
    expect(hostBacks).toBe(0);
    expect(panelOpen).toBe(false);
    dispatch();
    expect(hostBacks).toBe(1);

    panelOpen = true;
    refreshTVBackSubscription(ref, subscribe, back);
    expect(listeners.filter(value => value.owner === 'controls')).toHaveLength(1);
    expect(maxControls).toBe(1);
    clearTVBackSubscription(ref);
    clearTVBackSubscription(ref);
    expect(ref.current).toBeNull();
    expect(listeners.filter(value => value.owner === 'controls')).toHaveLength(0);
    dispatch();
    expect(hostBacks).toBe(2);
    expect(panelBacks).toBe(1);
  });
});

describe('TV explicit Hide/Show source and active scope', () => {
  it('offers chrome initially and only a reveal surface after explicitly hiding', () => {
    expect(tvControlsPresentation(null, 'source-a', true)).toEqual({ showChrome: true, showReveal: false });
    expect(tvControlsPresentation('source-a', 'source-a', true)).toEqual({ showChrome: false, showReveal: true });
    expect(tvControlsPresentation(null, 'source-a', true)).toEqual({ showChrome: true, showReveal: false });
  });

  it('reveals controls for a replacement source and never retains a sourceless hidden surface', () => {
    expect(tvControlsPresentation('source-a', 'source-b', true)).toEqual({ showChrome: true, showReveal: false });
    expect(tvControlsPresentation('source-a', '', true)).toEqual({ showChrome: true, showReveal: false });
  });

  it('exposes neither surface while inactive and preserves explicit hide intent on reactivation', () => {
    expect(tvControlsPresentation(null, 'source-a', false)).toEqual({ showChrome: false, showReveal: false });
    expect(tvControlsPresentation('source-a', 'source-a', false)).toEqual({ showChrome: false, showReveal: false });
    expect(tvControlsPresentation('source-a', 'source-a', true)).toEqual({ showChrome: false, showReveal: true });
  });
});

describe('custom TV remote ownership', () => {
  it('handles Android up-only default taps and down-enabled taps exactly once', () => {
    const input = new TVRemoteInput();
    const send = (eventKeyAction: number) => input.action({ eventType: 'playPause', eventKeyAction }, null, null, 'android');
    expect(send(1)).toBe('toggle');
    expect(send(0)).toBe('toggle');
    expect(send(0)).toBeNull();
    expect(send(1)).toBeNull();
    expect(send(0)).toBe('toggle');
    expect(send(1)).toBeNull();
    input.reset();
    expect(send(1)).toBe('toggle');
  });

  it('accumulates Android seek repeats without applying release a second time', () => {
    let now = 0;
    const input = new TVRemoteInput(() => now);
    const send = (eventType: string, eventKeyAction: number) => input.action({ eventType, eventKeyAction }, 'seek', 'preview', 'android');
    expect(send('right', 1)).toBe('previewForward');
    expect(send('right', 0)).toBe('previewForward');
    now += TV_HOLD_REPEAT_MS;
    expect(send('right', 0)).toBe('previewForward');
    now += TV_HOLD_REPEAT_MS;
    expect(send('longRight', 0)).toBe('previewForward');
    expect(send('longRight', 1)).toBeNull();
    expect(send('right', 1)).toBe('previewForward');
  });

  it('paces held Android arrows and seek keys to the tvOS hold rate', () => {
    let now = 0;
    const input = new TVRemoteInput(() => now);
    // Holds a key for one second: Android repeats it every 50ms after 400ms.
    const holdOneSecond = (eventType: string) => {
      const end = now + 1000;
      const actions = [input.action({ eventType, eventKeyAction: 0 }, null, 'timeline', 'android')];
      for (now += 400; now <= end; now += 50) actions.push(input.action({ eventType, eventKeyAction: 0 }, null, 'timeline', 'android'));
      input.action({ eventType, eventKeyAction: 1 }, null, 'timeline', 'android');
      return actions.filter(Boolean);
    };
    // The first press plus repeats at 400, 550, 700, 850 and 1000ms, not all 13.
    expect(holdOneSecond('right')).toEqual(Array(6).fill('previewForward'));
    expect(holdOneSecond('fastForward')).toEqual(Array(6).fill('forward'));
    // Separate taps are never paced.
    expect([0, 1, 0, 1].map(eventKeyAction => input.action({ eventType: 'left', eventKeyAction }, null, 'timeline', 'android')))
      .toEqual(['previewBackward', null, 'previewBackward', null]);
  });

  it('measures an Android hold from its first key-down and forgets it on release', () => {
    let now = 0;
    const input = new TVRemoteInput(() => now);
    input.action({ eventType: 'right', eventKeyAction: 0 }, null, 'timeline', 'android');
    now = 2500;
    input.action({ eventType: 'right', eventKeyAction: 0 }, 'seek', 'preview', 'android');
    expect(input.heldMs('right')).toBe(2500);
    expect(input.heldMs('left')).toBe(0);
    input.action({ eventType: 'right', eventKeyAction: 1 }, 'seek', 'preview', 'android');
    expect(input.heldMs('right')).toBe(0);
  });

  it.each<TVControlsPanel>(['summary', 'chapters', 'moments', 'transcript'])(
    'leaves vertical navigation between %s and the playback bar to native focus', panel => {
      for (const platform of ['ios', 'android'] as const) {
        const input = new TVRemoteInput();
        for (const focus of ['tab', 'timeline', 'playback', null] as TVRemoteFocus[]) {
          for (const eventType of ['up', 'down']) {
            // The tab row traps Down; the tab enters its content itself.
            if (focus === 'tab' && eventType === 'down') continue;
            for (const eventKeyAction of [0, 1]) {
              expect(input.action({ eventType, eventKeyAction }, panel, focus, platform)).toBeNull();
            }
          }
        }
        // Tab navigation must not fight the native destination or enter content.
        for (const eventType of ['left', 'right', 'select']) {
          expect(input.action({ eventType, eventKeyAction: 1 }, panel, 'tab', platform)).toBeNull();
        }
      }
    },
  );

  it.each<TVControlsPanel>(['summary', 'chapters', 'moments', 'transcript'])(
    'keeps playback transport available wherever focus is while %s is open', panel => {
      for (const platform of ['ios', 'android'] as const) {
        const eventKeyAction = platform === 'ios' ? 1 : 0;
        for (const focus of ['timeline', 'playback', 'tab', null] as TVRemoteFocus[]) {
          expect(['playPause', 'play', 'pause', 'rewind', 'fastForward'].map(eventType =>
            tvRemoteAction({ eventType, eventKeyAction }, panel, focus, platform)))
            .toEqual(['toggle', 'play', 'pause', 'backward', 'forward']);
          // Center activation still belongs only to its focused Pressable.
          expect(tvRemoteAction({ eventType: 'select', eventKeyAction }, panel, focus, platform)).toBeNull();
        }
      }
    },
  );

  it.each<TVControlsPanel>(['summary', 'chapters', 'moments', 'transcript'])(
    'starts a seek preview from the timeline below %s without hijacking other arrows', panel => {
      for (const platform of ['ios', 'android'] as const) {
        const eventKeyAction = platform === 'ios' ? 1 : 0;
        expect(tvRemoteAction({ eventType: 'left', eventKeyAction }, panel, 'timeline', platform)).toBe('previewBackward');
        expect(tvRemoteAction({ eventType: 'right', eventKeyAction }, panel, 'timeline', platform)).toBe('previewForward');
        expect(tvRemoteAction({ eventType: 'longLeft', eventKeyAction: 0 }, panel, 'timeline', platform)).toBe('previewBackward');
        expect(tvRemoteAction({ eventType: 'longRight', eventKeyAction: 0 }, panel, 'timeline', platform)).toBe('previewForward');
        for (const focus of ['tab', 'playback', 'preview', null] as TVRemoteFocus[]) {
          for (const eventType of ['left', 'right']) {
            expect(tvRemoteAction({ eventType, eventKeyAction }, panel, focus, platform)).toBeNull();
          }
        }
      }
    },
  );

  it('handles one down event and ignores the matching up/unspecified actions', () => {
    expect(tvRemoteAction({ eventType: 'playPause', eventKeyAction: 0 }, null, null)).toBe('toggle');
    for (const eventKeyAction of [1, -1, undefined]) {
      expect(tvRemoteAction({ eventType: 'playPause', eventKeyAction }, null, null)).toBeNull();
    }
  });

  it.each(['select', 'longSelect', 'menu', 'back', 'up', 'down', 'left', 'right', 'focus', 'blur'])(
    'leaves %s to Pressable, BackHandler or OS focus navigation', eventType => {
      expect(tvRemoteAction({ eventType, eventKeyAction: 0 }, null, null)).toBeNull();
    },
  );

  it('maps transport keys without giving navigation keys global transport behavior', () => {
    expect(['play', 'pause', 'rewind', 'fastForward'].map(eventType =>
      tvRemoteAction({ eventType, eventKeyAction: 0 }, null, null))).toEqual(['play', 'pause', 'backward', 'forward']);
  });

  it('accepts tvOS ended-only tap events without accepting both Android key edges', () => {
    expect(tvRemoteAction({ eventType: 'playPause', eventKeyAction: 1 }, null, null, 'ios')).toBe('toggle');
    expect(tvRemoteAction({ eventType: 'playPause', eventKeyAction: 0 }, null, null, 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'playPause', eventKeyAction: 1 }, null, null, 'android')).toBeNull();
    expect(tvRemoteAction({ eventType: 'left', eventKeyAction: 1 }, 'seek', 'preview', 'ios')).toBe('previewBackward');
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, 'seek', 'preview', 'ios')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, 'seek', null, 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'select', eventKeyAction: 1 }, null, null, 'ios')).toBeNull();
  });

  it('accepts Apple long-arrow begin once and rejects its end', () => {
    expect(tvRemoteAction({ eventType: 'longRight', eventKeyAction: 0 }, 'seek', 'preview', 'ios')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'longRight', eventKeyAction: 1 }, 'seek', 'preview', 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'longPlayPause', eventKeyAction: 0 }, null, null, 'ios')).toBeNull();
  });

  it.each<TVControlsPanel>(['seek', 'tracks', 'settings', 'more'])(
    'suspends transport for every focus mode while the %s modal is open', panel => {
      for (const platform of ['ios', 'android'] as const) {
        const eventKeyAction = platform === 'ios' ? 1 : 0;
        for (const focus of ['timeline', 'playback', 'tab', 'preview', null] as TVRemoteFocus[]) {
          for (const eventType of ['playPause', 'play', 'pause', 'rewind', 'fastForward']) {
            expect(tvRemoteAction({ eventType, eventKeyAction }, panel, focus, platform)).toBeNull();
          }
        }
      }
    },
  );

  it('adjusts seek only when the preview adjuster owns focus, including long-key repeats', () => {
    for (const eventType of ['right', 'longRight']) {
      expect(tvRemoteAction({ eventType, eventKeyAction: 0 }, 'seek', 'preview')).toBe('previewForward');
      expect(tvRemoteAction({ eventType, eventKeyAction: 0 }, 'seek', null)).toBeNull();
      expect(tvRemoteAction({ eventType, eventKeyAction: 1 }, 'seek', 'preview')).toBeNull();
    }
    for (const eventType of ['left', 'longLeft']) {
      expect(tvRemoteAction({ eventType, eventKeyAction: 0 }, 'seek', 'preview')).toBe('previewBackward');
    }
    expect(tvRemoteAction({ eventType: 'select', eventKeyAction: 0 }, 'seek', 'preview')).toBeNull();
  });

  it('scrubs from the focused timeline, including taps during the hand-off to the preview', () => {
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, null, 'timeline', 'ios')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'left', eventKeyAction: 1 }, null, 'timeline', 'ios')).toBe('previewBackward');
    expect(tvRemoteAction({ eventType: 'longRight', eventKeyAction: 0 }, null, 'timeline', 'ios')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, 'seek', 'timeline', 'ios')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 0 }, null, 'timeline')).toBe('previewForward');
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, null, 'timeline')).toBeNull();
    for (const eventType of ['up', 'down', 'select']) {
      expect(tvRemoteAction({ eventType, eventKeyAction: 1 }, null, 'timeline', 'ios')).toBeNull();
    }
  });

  it('leaves Left/Right to focus navigation away from the timeline and inside other panels', () => {
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, null, null, 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, 'settings', 'timeline', 'ios')).toBeNull();
    expect(tvRemoteAction({ eventType: 'right', eventKeyAction: 1 }, null, 'preview', 'ios')).toBeNull();
  });
});

describe('TV seek bounds and configuration', () => {
  it('uses the moving DVR window for live playback and duration for VOD', () => {
    expect(tvTimeline({ isLive: true, seekableStart: 120, seekableEnd: 180, duration: 999 })).toEqual({ start: 120, end: 180, duration: 60 });
    expect(tvTimeline({ isLive: false, seekableStart: 120, seekableEnd: 180, duration: 999 })).toEqual({ start: 0, end: 999, duration: 999 });
    expect(tvTimeline({ isLive: true, duration: 999 }).duration).toBe(0);
  });

  it('steps on a press, scans on a hold, and changes scan speed on later presses', () => {
    // No scan: a press steps once.
    expect(tvScanPress(null, 1, false)).toEqual({ scan: null, step: true });
    // A hold starts scanning that way at 2x, and a hold the same way keeps its speed.
    const forward = tvScanPress(null, 1, true).scan;
    expect(forward).toEqual({ direction: 1, speed: 2 });
    expect(tvScanPress({ direction: 1, speed: 8 }, 1, true).scan).toEqual({ direction: 1, speed: 8 });
    // Presses the same way speed it up, up to 16x.
    let scan = forward;
    const speeds: number[] = [];
    for (let i = 0; i < 4; i++) {
      scan = tvScanPress(scan, 1, false).scan;
      speeds.push(scan!.speed);
    }
    expect(speeds).toEqual([4, 8, 16, 16]);
    // Presses the other way slow it down, then stop it, leaving later presses to step.
    expect(tvScanPress({ direction: 1, speed: 4 }, -1, false)).toEqual({ scan: { direction: 1, speed: 2 }, step: false });
    expect(tvScanPress({ direction: 1, speed: 2 }, -1, false)).toEqual({ scan: null, step: false });
    // A hold the other way reverses at the slowest speed.
    expect(tvScanPress({ direction: 1, speed: 16 }, -1, true).scan).toEqual({ direction: -1, speed: 2 });
  });

  it('clamps repeated preview changes and revalidates against a changed live window', () => {
    const window = { start: 120, end: 180 };
    let time = 130;
    for (let i = 0; i < 8; i++) time = advanceTVPreview(time, 1, 10, window);
    expect(time).toBe(180);
    for (let i = 0; i < 8; i++) time = advanceTVPreview(time, -1, 10, window);
    expect(time).toBe(120);
    expect(clampTVTime(time, { start: 140, end: 200 })).toBe(140);
  });

  it('speeds up a held scan from 2x to 16x, one level per ramp interval', () => {
    expect([0, 999, 1000, 2000, 3000, 60000].map(ms => tvScrubSpeed(ms))).toEqual([2, 2, 4, 8, 16, 16]);
    expect(tvScrubSpeed(Number.NaN)).toBe(2);
    expect(TV_SCRUB_RAMP_MS).toBe(1000);
    // The slowest scan moves one step per repeat; each speed doubles it.
    expect([2, 4, 8, 16].map(tvScanSteps)).toEqual([1, 2, 4, 8]);
    // Speed multiplies the step after the 120s step cap, and still stops at the ends.
    expect(advanceTVPreview(0, 1, 10, { start: 0, end: 7200 }, 16)).toBe(160);
    expect(advanceTVPreview(700, 1, 10, { start: 0, end: 734 }, 8)).toBe(734);
  });

  it('keeps malformed timing finite and empty timelines unseekable', () => {
    expect(tvTimeline({ isLive: true, seekableStart: 40, seekableEnd: 20, duration: 5 }).duration).toBe(0);
    expect(tvTimeline({ duration: Number.NaN }).duration).toBe(0);
    expect(clampTVTime(Number.POSITIVE_INFINITY, { start: 20, end: 50 })).toBe(20);
    expect(tvSeekStep(Number.NaN)).toBe(10);
    expect(tvSeekStep(-3)).toBe(1);
    expect(tvSeekStep(500)).toBe(120);
    expect(tvSeekStep(15)).toBe(15);
  });

  it('honors settings section flags and source minimum resolution', () => {
    expect(tvSettingsSections(false)).toEqual({ speed: false, quality: false });
    expect(tvSettingsSections(true)).toEqual({ speed: true, quality: true });
    expect(tvSettingsSections({ speed: false })).toEqual({ speed: false, quality: true });
    expect(tvSettingsSections({ quality: false })).toEqual({ speed: true, quality: false });
    expect(tvQualityOptions('1080p')).toEqual(['1080p', '1440p', '2160p']);
    expect(tvQualityOptions()).toEqual(['720p', '1080p', '1440p', '2160p']);
  });

  it('formats readable elapsed times without negative or invalid output', () => {
    expect([0, 65, 3671.8, -1, Number.NaN].map(formatTVTime)).toEqual(['0:00', '1:05', '1:01:11', '0:00', '0:00']);
  });

  it.each([0, 59, 61, 599, 600, 734, 1999, 3599, 3600, 3725, 7384.6])(
    'sizes the clock column for the widest label up to %s seconds', duration => {
      const end = formatTVTime(duration);
      let widest = 0;
      for (let time = 0; time <= Math.floor(duration); time++) {
        widest = Math.max(widest, tvClockTextWidth(`${formatTVTime(time)} / ${end}`));
      }
      expect(tvClockLabelWidth(duration)).toBeCloseTo(widest + TV_CLOCK_KERNING_SLACK, 6);
    });

  it('measures clock labels with DM Sans SemiBold advances', () => {
    // 187.3px at 36px, as the font renders "0:29 / 12:14"; a "0" is twice a "1".
    expect(tvClockTextWidth('0:29 / 12:14') * 36).toBeCloseTo(187.3, 1);
    expect(tvClockTextWidth('0')).toBeCloseTo(2 * tvClockTextWidth('1'), 1);
    expect(tvClockLabelWidth(Number.NaN)).toBeCloseTo(tvClockLabelWidth(0), 6);
  });
});
