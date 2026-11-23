#!/usr/bin/env node
// gen-videos: text-to-video & image-to-video through OneRouter (POST /v1/videos).
// Zero dependencies - uses native fetch (Node 18+).
// Cross-platform: no external binaries, runs on macOS, Windows and Linux.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://model.hbcommerce.co';
const DEFAULT_MODEL = 'gemini-omni-1.2-flash';
const MODEL_ALIAS = {
  '1.2': 'gemini-omni-1.2-flash',
  '1.1': 'gemini-omni-1.1-flash',
};

const ASPECTS = ['16:9', '9:16'];
const RESOLUTIONS = ['360p', '720p', '1080p', '4k'];
const MIN_SECONDS = 3;
const MAX_SECONDS = 15;

// Gioi han cua OneRouter (muc 8 trong docs)
const MAX_REF_IMAGES = 6;
const MAX_REF_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 60 * 1024 * 1024;

// Job qua 30 phut la server tu fail, doi them chut cho chac
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 35 * 60 * 1000;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// --- Tim key: shell > .env o thu muc dang dung > .env canh skill ---
// Parser toi gian co y: chi KEY=value, du dung va giu duoc Node 18+
// (process.loadEnvFile can Node 20.12+, se pha loi hua Node 18 trong README).
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// gen-video.mjs nam trong scripts/, nen thu muc skill (cho co SKILL.md) la cap tren
const SKILL_DIR = dirname(SCRIPT_DIR);

function readVar(name) {
  if (process.env[name]) return { value: process.env[name], from: 'shell' };
  const places = [
    [process.cwd(), '.env o thu muc dang dung'],
    [SKILL_DIR, '.env trong thu muc skill'],
    [SCRIPT_DIR, '.env trong scripts/'],
  ];
  for (const [dir, label] of places) {
    let text;
    try {
      text = readFileSync(join(dir, '.env'), 'utf8');
    } catch (e) {
      continue;
    }
    const val = parseEnv(text)[name];
    if (val) return { value: val, from: label };
  }
  return null;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    images: [],
    seconds: 8,
    aspect: '16:9',
    resolution: '720p',
    out: './gen-videos',
    json: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--prompt': opts.prompt = next(); break;
      case '--prompt-file': opts.promptFile = next(); break;
      case '--model': opts.model = next(); break;
      case '--seconds': case '-s': opts.seconds = Number(next()); break;
      case '--aspect': opts.aspect = next(); break;
      case '--resolution': opts.resolution = next().toLowerCase(); break;
      case '--image': case '-i': opts.images.push(next()); break;
      case '--out': case '-o': opts.out = next(); break;
      case '--json': opts.json = true; opts.quiet = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: fail(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

const USAGE = `Usage:
  node gen-video.mjs --prompt "<text>" [options]

Options:
  --prompt <text>        Prompt describing the scene AND the motion
  --prompt-file <path>   Read the prompt from a file
  --model <id>           Model id or alias (default ${DEFAULT_MODEL})
                         Aliases: ${Object.keys(MODEL_ALIAS).join(', ')}
  --seconds, -s <N>      ${MIN_SECONDS}-${MAX_SECONDS} seconds (default 8)
  --aspect <ratio>       ${ASPECTS.join(' | ')} (default 16:9)
  --resolution <tier>    ${RESOLUTIONS.join(' | ')} (default 720p)
  --image, -i <path>     Starting frame / subject reference (repeatable, max ${MAX_REF_IMAGES})
                         Say in the prompt how each image should be used
  --out, -o <path>       Output directory, or a path ending in .mp4
                         (default ./gen-videos)
  --json                 Print a JSON summary instead of progress lines

Env: ONEROUTER_KEY (required), ONEROUTER_URL (default ${DEFAULT_BASE_URL})`;

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function mimeOf(path) {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) fail(`Unsupported input image type: ${basename(path)} (png/jpg/webp only)`);
  return mime;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OneRouter tra loi theo dang { error: { message, code } }, provider thi giu
// nguyen dang cua ho -> boc duoc cai nao thi boc, khong thi in raw.
function describeError(status, body) {
  try {
    const j = JSON.parse(body);
    const e = j.error ?? j;
    if (e?.message) return `${e.code ? `${e.code}: ` : ''}${e.message}`;
  } catch (err) {
    // khong phai JSON, roi xuong duoi in raw
  }
  return `HTTP ${status} - ${body.slice(0, 500)}`;
}

// Retries once on 429 / 5xx. Returns parsed JSON or throws with the API message.
async function callApi(url, init, label) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw new Error(`${label}: network error - ${e.message}`);
    }
    if (res.ok) return res.json();
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) {
      await sleep(res.status === 429 ? 5000 : 2000);
      continue;
    }
    throw new Error(`${label}: ${describeError(res.status, body)}`);
  }
}

async function download(url, label) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw new Error(`${label}: cannot download ${url} - ${e.message}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  let prompt = opts.prompt;
  if (opts.promptFile) prompt = (await readFile(opts.promptFile, 'utf8')).trim();
  if (!prompt) fail(`--prompt (or --prompt-file) is required.\n\n${USAGE}`);

  if (!Number.isInteger(opts.seconds) || opts.seconds < MIN_SECONDS || opts.seconds > MAX_SECONDS) {
    fail(`--seconds must be a whole number between ${MIN_SECONDS} and ${MAX_SECONDS}`);
  }
  if (!ASPECTS.includes(opts.aspect)) fail(`--aspect must be one of: ${ASPECTS.join(', ')}`);
  if (!RESOLUTIONS.includes(opts.resolution)) {
    fail(`--resolution must be one of: ${RESOLUTIONS.join(', ')}`);
  }
  if (opts.images.length > MAX_REF_IMAGES) {
    fail(`--image: at most ${MAX_REF_IMAGES} input images (got ${opts.images.length})`);
  }

  const model = MODEL_ALIAS[opts.model] ?? opts.model ?? DEFAULT_MODEL;

  const found = readVar('ONEROUTER_KEY');
  if (!found) {
    fail(
      `Missing ONEROUTER_KEY. Set it one of these ways:\n`
      + `  1. export ONEROUTER_KEY=... in your shell\n`
      + `  2. put ONEROUTER_KEY=... in ${join(process.cwd(), '.env')}\n`
      + `  3. put ONEROUTER_KEY=... in ${join(SKILL_DIR, '.env')}  (travels with the skill folder)`,
    );
  }
  const apiKey = found.value;
  const baseUrl = (readVar('ONEROUTER_URL')?.value ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };

  // Anh input gui len duoi dang data URL, OneRouter khong doc duoc duong dan local
  const references = [];
  let refBytes = 0;
  for (const p of opts.images.map((x) => resolve(x))) {
    let buf;
    try {
      buf = await readFile(p);
    } catch {
      fail(`Input image not found: ${p}`);
    }
    if (buf.length > MAX_REF_BYTES) {
      fail(`Input image too large: ${basename(p)} is ${(buf.length / 1048576).toFixed(1)}MB, limit is 20MB`);
    }
    const b64 = buf.toString('base64');
    refBytes += b64.length;
    references.push(`data:${mimeOf(p)};base64,${b64}`);
  }
  if (refBytes > MAX_BODY_BYTES) {
    fail(`Input images total ${(refBytes / 1048576).toFixed(1)}MB once encoded, over the 60MB body limit.`);
  }

  const log = (msg) => { if (!opts.quiet) console.log(msg); };

  const body = {
    model,
    prompt,
    seconds: opts.seconds,
    aspect_ratio: opts.aspect,
    resolution: opts.resolution,
    ...(references.length ? { reference_images: references } : {}),
  };

  log(`${references.length ? 'image-to-video' : 'text-to-video'} | ${model} | ${opts.seconds}s ${opts.aspect} ${opts.resolution}`);

  let job = await callApi(`${baseUrl}/v1/videos`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, 'create job');

  log(`job ${job.id} queued, reserved $${job.reserved_usd ?? '?'} - polling every ${POLL_INTERVAL_MS / 1000}s`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() > deadline) {
      fail(`job ${job.id} still ${job.status} after ${POLL_TIMEOUT_MS / 60000} minutes, giving up.\n`
        + `The job may still finish - check it with: curl -H "Authorization: Bearer $ONEROUTER_KEY" ${baseUrl}/v1/jobs/${job.id}`);
    }
    await sleep(POLL_INTERVAL_MS);
    const previous = job.status;
    job = await callApi(`${baseUrl}/v1/jobs/${job.id}`, { headers }, `poll job ${job.id}`);
    if (job.status !== previous) log(`  ...${job.status}`);
  }

  if (job.status !== 'succeeded') {
    const why = job.error?.message ?? job.error ?? 'no reason given';
    fail(`job ${job.id} ${job.status}: ${typeof why === 'string' ? why : JSON.stringify(why)}`);
  }

  const url = job.videos?.[0]?.url;
  if (!url) fail(`job ${job.id} succeeded but returned no video url`);

  const outArg = resolve(opts.out);
  const isFile = extname(outArg).toLowerCase() === '.mp4';
  const outPath = isFile ? outArg : join(outArg, `${stamp()}-${slugify(prompt)}.mp4`);

  const buf = await download(url, `job ${job.id}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);

  const summary = {
    model,
    keyFrom: found.from,
    baseUrl,
    jobId: job.id,
    mode: references.length ? 'image-to-video' : 'text-to-video',
    seconds: opts.seconds,
    aspect: opts.aspect,
    resolution: opts.resolution,
    costUsd: job.cost_usd ?? null,
    bytes: buf.length,
    file: outPath,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${outPath} (${(buf.length / 1048576).toFixed(1)}MB, $${summary.costUsd})`);
  }
}

main().catch((e) => fail(e.stack ?? e.message));
