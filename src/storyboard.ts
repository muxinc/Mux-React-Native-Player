export type StoryboardTile = {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ParsedStoryboard = {
  spriteUrl: string;
  spriteWidth: number;
  spriteHeight: number;
  tiles: StoryboardTile[];
};

const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/;
const XYWH = /#xywh=(\d+),(\d+),(\d+),(\d+)/i;

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(TIMESTAMP);
  if (!match) {
    return null;
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/**
 * Resolve a (possibly relative) cue image reference against the storyboard VTT
 * URL, preserving the VTT's query string (e.g. a signed-playback `token`) when
 * the reference is relative and carries no query of its own.
 */
function resolveSpriteUrl(reference: string, vttUrl: string): string {
  const cleanRef = reference.split('#')[0]?.trim() ?? '';
  if (/^https?:\/\//i.test(cleanRef)) {
    return cleanRef;
  }

  const [vttBaseWithPath, vttQuery] = vttUrl.split('?');
  const base = vttBaseWithPath.slice(0, vttBaseWithPath.lastIndexOf('/') + 1);
  const resolved = `${base}${cleanRef}`;
  if (vttQuery && !resolved.includes('?')) {
    return `${resolved}?${vttQuery}`;
  }
  return resolved;
}

/**
 * Parse a Mux storyboard WebVTT file into sprite tile rectangles keyed by time.
 * Returns null when the input has no usable cues.
 */
export function parseStoryboardVtt(vtt: string, vttUrl: string): ParsedStoryboard | null {
  if (!vtt || !vtt.includes('-->')) {
    return null;
  }

  const lines = vtt.split(/\r?\n/);
  const tiles: StoryboardTile[] = [];
  let spriteUrl = '';
  let spriteWidth = 0;
  let spriteHeight = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('-->')) {
      continue;
    }
    const [startRaw, endRaw] = line.split('-->');
    const start = parseTimestamp(startRaw ?? '');
    const end = parseTimestamp(endRaw ?? '');
    if (start == null || end == null) {
      continue;
    }

    const payload = lines[i + 1] ?? '';
    const rect = payload.match(XYWH);
    if (!rect) {
      continue;
    }
    const x = Number(rect[1]);
    const y = Number(rect[2]);
    const width = Number(rect[3]);
    const height = Number(rect[4]);

    if (!spriteUrl) {
      spriteUrl = resolveSpriteUrl(payload, vttUrl);
    }
    spriteWidth = Math.max(spriteWidth, x + width);
    spriteHeight = Math.max(spriteHeight, y + height);
    tiles.push({ start, end, x, y, width, height });
  }

  if (tiles.length === 0 || !spriteUrl) {
    return null;
  }

  return { spriteUrl, spriteWidth, spriteHeight, tiles };
}

/** Find the storyboard tile covering a given playback time. */
export function tileForTime(
  storyboard: ParsedStoryboard,
  time: number
): StoryboardTile | undefined {
  const { tiles } = storyboard;
  if (tiles.length === 0) {
    return undefined;
  }
  for (const tile of tiles) {
    if (time >= tile.start && time < tile.end) {
      return tile;
    }
  }
  // Clamp to the nearest edge tile when the time is outside the cue range.
  if (time < tiles[0].start) {
    return tiles[0];
  }
  return tiles[tiles.length - 1];
}
