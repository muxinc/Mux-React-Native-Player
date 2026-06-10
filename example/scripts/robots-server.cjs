#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const exampleRoot = path.resolve(__dirname, '..');
loadEnv(path.join(exampleRoot, '.env'));

const muxTokenId = process.env.MUX_TOKEN_ID;
const muxTokenSecret = process.env.MUX_TOKEN_SECRET;
const muxApiBaseUrl = process.env.MUX_API_BASE_URL || 'https://api.mux.com';
const host = process.env.MUX_ROBOTS_HOST || '0.0.0.0';
const port = Number(process.env.MUX_ROBOTS_PORT || 3030);
const pollIntervalMs = Number(process.env.MUX_ROBOTS_POLL_INTERVAL_MS || 2000);
const pollTimeoutMs = Number(process.env.MUX_ROBOTS_POLL_TIMEOUT_MS || 120000);

const completedResults = new Map();
const inFlightResults = new Map();

const routes = {
  '/mux/robots/summarize': {
    workflow: 'summarize',
    transform: transformSummary,
  },
  '/mux/robots/chapters': {
    workflow: 'generate-chapters',
    transform: transformChapters,
  },
  '/mux/robots/key-moments': {
    workflow: 'find-key-moments',
    transform: transformKeyMoments,
  },
};

if (!muxTokenId || !muxTokenSecret) {
  console.error('Missing MUX_TOKEN_ID or MUX_TOKEN_SECRET. Add them to example/.env or your shell.');
  process.exit(1);
}

if (!Number.isFinite(port) || port <= 0) {
  console.error(`Invalid MUX_ROBOTS_PORT: ${process.env.MUX_ROBOTS_PORT}`);
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  const route = routes[request.url || ''];
  if (request.method !== 'POST' || !route) {
    sendJson(response, 404, { error: 'Unknown robots endpoint.' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
    if (!assetId) {
      sendJson(response, 400, { error: 'assetId is required.' });
      return;
    }

    const result = await getRobotsResult(route.workflow, assetId, route.transform);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Robots request failed.';
    sendJson(response, 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Mux Robots proxy listening on http://${host}:${port}/mux/robots`);
});

function getRobotsResult(workflow, assetId, transform) {
  const cacheKey = `${workflow}:${assetId}`;
  const cached = completedResults.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = inFlightResults.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = createAndPollJob(workflow, assetId)
    .then(job => {
      const result = transform(job);
      completedResults.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      inFlightResults.delete(cacheKey);
    });

  inFlightResults.set(cacheKey, request);
  return request;
}

async function createAndPollJob(workflow, assetId) {
  const created = await muxFetch(`/robots/v0/jobs/${workflow}`, {
    method: 'POST',
    body: JSON.stringify({
      parameters: {
        asset_id: assetId,
      },
    }),
  });
  const job = getResponseData(created);
  if (!job.id) {
    throw new Error(`Mux Robots did not return a job ID for ${workflow}.`);
  }

  return pollJob(workflow, job);
}

async function pollJob(workflow, initialJob) {
  let job = initialJob;
  const deadline = Date.now() + pollTimeoutMs;

  while (Date.now() < deadline) {
    if (job.status === 'completed') {
      return job;
    }

    if (['cancelled', 'errored', 'failed'].includes(job.status)) {
      throw new Error(`Mux Robots ${workflow} job ${job.id} ended with status ${job.status}.`);
    }

    await delay(pollIntervalMs);
    const result = await muxFetch(`/robots/v0/jobs/${workflow}/${job.id}`, { method: 'GET' });
    job = getResponseData(result);
  }

  throw new Error(`Timed out waiting for Mux Robots ${workflow} job ${job.id}.`);
}

async function muxFetch(urlPath, options) {
  const response = await fetch(`${muxApiBaseUrl}${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${muxTokenId}:${muxTokenSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(getMuxErrorMessage(body, response.status));
  }

  return body;
}

function transformSummary(job) {
  const outputs = getOutputs(job, 'summary');
  return {
    title: stringify(outputs.title),
    description: stringify(outputs.description),
    tags: Array.isArray(outputs.tags) ? outputs.tags.map(tag => String(tag)) : undefined,
  };
}

function transformChapters(job) {
  const outputs = getOutputs(job, 'chapters');
  const chapters = Array.isArray(outputs.chapters) ? outputs.chapters : [];
  return chapters
    .map(chapter => ({
      startTime: toNumber(chapter.start_time ?? chapter.startTime),
      title: stringify(chapter.title),
    }))
    .filter(chapter => Number.isFinite(chapter.startTime) && chapter.title);
}

function transformKeyMoments(job) {
  const outputs = getOutputs(job, 'key moments');
  const moments = Array.isArray(outputs.moments) ? outputs.moments : [];
  return moments
    .map(moment => ({
      startTime: moment.start_ms == null ? toNumber(moment.startTime) : toNumber(moment.start_ms) / 1000,
      endTime: moment.end_ms == null ? toNumber(moment.endTime) : toNumber(moment.end_ms) / 1000,
      title: stringify(moment.title),
      description: stringify(moment.audible_narrative ?? moment.description ?? firstCueText(moment.cues)),
      score: toOptionalNumber(moment.overall_score ?? moment.score),
    }))
    .filter(moment => Number.isFinite(moment.startTime) && Number.isFinite(moment.endTime) && moment.title);
}

function getResponseData(body) {
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    throw new Error('Mux Robots returned an unexpected response.');
  }

  return body.data;
}

function getOutputs(job, label) {
  if (!job.outputs || typeof job.outputs !== 'object') {
    throw new Error(`Mux Robots completed without ${label} outputs.`);
  }

  return job.outputs;
}

function getMuxErrorMessage(body, status) {
  const error = body?.error;
  const message = error?.message || body?.message;
  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(error?.messages) && error.messages.length > 0) {
    return error.messages.map(String).join(' ');
  }

  if (typeof error === 'string') {
    return error;
  }

  return `Mux API request failed with ${status}.`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) {
      process.env[key] = value;
    }
  }
}

function stringify(value) {
  return value == null ? '' : String(value);
}

function toNumber(value) {
  return Number(value);
}

function toOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function firstCueText(cues) {
  if (!Array.isArray(cues)) {
    return '';
  }

  return cues
    .map(cue => stringify(cue.text))
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
