#!/usr/bin/env node
// gen-images: text-to-image & image-to-image through OneRouter (POST /v1/images).
// Zero dependencies - uses native fetch (Node 18+).
// Cross-platform: no external binaries, runs on macOS, Windows and Linux.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://model.hbcommerce.co';

const DEFAULT_MODEL = {
  gemini: 'gemini-3.1-flash-image',
  openai: 'gpt-image-2.6-flare',
};
const MODEL_ALIAS = {
  gemini: {
    flash: 'gemini-3.1-flash-image',
    'flash-lite': 'gemini-3.1-flash-lite-image',
    pro: 'gemini-3-pro-image',
    '2.1': 'gemini-nano-banana-2.1',
    '2.5-flash': 'gemini-2.5-flash-image',
  },
  openai: {
    flare: 'gpt-image-2.6-flare',
    sunburst: 'gpt-image-2.6-sunburst',
    '2.5-flare': 'gpt-image-2.5-flare',
    '2.5-sunburst': 'gpt-image-2.5-sunburst',
    '2': 'gpt-image-2',
  },
};

const ASPECTS = ['1:1', '9:16', '16:9'];
const RESOLUTIONS = ['1k', '2k', '4k'];
// OpenAI doi 2.x tran canh dai 3840 nen khong voi toi bac 4k
const GEMINI_ONLY_RESOLUTIONS = ['4k'];

// Chi dung cho OpenAI: OneRouter can `size` tuong minh, con Gemini nhan
// `aspect_ratio` + `resolution` nen khong phai quy ra pixel.
const OUTPUT_SIZE = {
  '1:1': { '1k': [1024, 1024], '2k': [2048, 2048], '4k': [4096, 4096] },
  '9:16': { '1k': [768, 1376], '2k': [1536, 2752], '4k': [3072, 5504] },
  '16:9': { '1k': [1376, 768], '2k': [2752, 1536], '4k': [5504, 3072] },
};
// Rang buoc that cua OpenAI, lay tu thong bao loi cua API chu khong phai enum co dinh
const OPENAI_SIZE_STEP = 16;
const OPENAI_MAX_EDGE = 3840;

// Gioi han cua OneRouter (muc 8 trong docs)
const MAX_N_PER_REQUEST = 4;
const MAX_REF_IMAGES = 14;
const MAX_REF_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const REQUEST_CONCURRENCY = 3;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
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
// gen.mjs nam trong scripts/, nen thu muc skill (cho co SKILL.md) la cap tren
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

function parseArgs(argv) {
  const opts = {
    images: [],
    count: 1,
    aspect: '1:1',
    resolution: '2k',
    out: './gen-images',
    json: false,
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
      case '--provider': opts.provider = next().toLowerCase(); break;
      case '--model': opts.model = next(); break;
      case '--count': case '-n': opts.count = Number(next()); break;
      case '--image': case '-i': opts.images.push(next()); break;
      case '--out': case '-o': opts.out = next(); break;
      case '--aspect': opts.aspect = next(); break;
      case '--resolution': opts.resolution = next().toLowerCase(); break;
      case '--size': opts.size = next(); break;
      case '--json': opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: fail(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const USAGE = `Usage:
  node gen.mjs --prompt "<text>" [options]

Options:
  --prompt <text>        Prompt (required unless --prompt-file)
  --prompt-file <path>   Read prompt from a file
  --provider <name>      gemini (default) | openai
                         Inferred from --model when the id is known
  --model <id>           Model id or alias. Defaults:
                           gemini=${DEFAULT_MODEL.gemini}
                           openai=${DEFAULT_MODEL.openai}
                         Gemini aliases: ${Object.keys(MODEL_ALIAS.gemini).join(', ')}
                         OpenAI aliases: ${Object.keys(MODEL_ALIAS.openai).join(', ')}
  --aspect <ratio>       1:1 (default) | 9:16 | 16:9
  --resolution <tier>    1k | 2k (default) | 4k (Gemini only)
  --size <WxH>           OpenAI only, overrides --aspect/--resolution.
                         Both edges divisible by ${OPENAI_SIZE_STEP},
                         longest edge <= ${OPENAI_MAX_EDGE}, or "auto"
  --count, -n <N>        Number of images (default 1), sent ${MAX_N_PER_REQUEST} per request
  --image, -i <path>     Input image for image-to-image (repeatable, max ${MAX_REF_IMAGES})
  --out, -o <dir>        Output directory (default ./gen-images)
  --json                 Print a JSON summary instead of human text

Env: ONEROUTER_KEY (required), ONEROUTER_URL (default ${DEFAULT_BASE_URL})`;

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function mimeOf(path) {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) fail(`Unsupported input image type: ${basename(path)} (png/jpg/webp/gif only)`);
  return mime;
}

// Mot endpoint chung cho 2 provider nen --model lac provider la hong ngay.
// Suy nguoc tu id de khoi phai nho go kem --provider.
function providerOf(modelId) {
  if (/^(gpt-image|chatgpt-image)/.test(modelId)) return 'openai';
  if (/^(gemini|nano-banana)/.test(modelId)) return 'gemini';
  return null;
}

// Doc kich thuoc tu header, khong goi binary ngoai -> chay duoc ca Windows.
// Chi can 3 dinh dang API nay tra ve: PNG, JPEG, WebP.
function readDimensions(buf) {
  // PNG: IHDR nam ngay sau 8 byte signature, width/height la uint32 BE
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: duyet marker toi SOF0..SOF15 (bo qua SOF4/SOF8/SOF12 la bang Huffman)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }

  // WebP: RIFF....WEBP roi toi chunk VP8 / VP8L / VP8X
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
  }

  return { width: null, height: null };
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

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (e) {
        results[i] = { ok: false, error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// --- OneRouter: 1 endpoint cho ca 2 provider, toi da 4 anh moi request ---
async function genImages({ baseUrl, apiKey, model, prompt, count, references, provider, aspect, resolution, size }) {
  const base = { model, prompt };
  if (references.length) base.reference_images = references;
  if (provider === 'openai') {
    if (size && size !== 'auto') base.size = size;
    else base.aspect_ratio = aspect;
  } else {
    base.aspect_ratio = aspect;
    base.resolution = resolution.toUpperCase();
  }

  const batches = [];
  for (let left = count; left > 0; left -= MAX_N_PER_REQUEST) {
    batches.push(Math.min(left, MAX_N_PER_REQUEST));
  }

  const url = `${baseUrl}/v1/images`;
  const results = await runPool(
    batches.map((n, i) => async () => {
      const label = `request ${i + 1}/${batches.length}`;
      const data = await callApi(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...base, n }),
      }, label);
      const items = (data.images ?? []).filter((im) => im.url);
      if (!items.length) throw new Error(`${label}: no image in response`);
      return {
        cost: data.cost_usd ?? 0,
        buffers: await Promise.all(items.map(async (im) => ({
          mime: im.mime_type ?? 'image/png',
          buf: await download(im.url, label),
        }))),
      };
    }),
    REQUEST_CONCURRENCY,
  );

  const out = { images: [], errors: [], cost: 0 };
  for (const r of results) {
    if (!r.ok) { out.errors.push(r.error); continue; }
    out.images.push(...r.value.buffers);
    out.cost += r.value.cost;
  }
  return out;
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

  if (opts.provider && !['gemini', 'openai'].includes(opts.provider)) {
    fail(`--provider must be gemini or openai`);
  }
  // --model thang hon --provider: id noi ro no thuoc nha nao
  const aliasHit = opts.model
    ? (MODEL_ALIAS.gemini[opts.model] ?? MODEL_ALIAS.openai[opts.model])
    : null;
  const modelId = aliasHit ?? opts.model ?? null;
  const provider = (modelId && providerOf(modelId)) ?? opts.provider ?? 'gemini';
  const model = modelId ?? DEFAULT_MODEL[provider];

  if (!Number.isInteger(opts.count) || opts.count < 1) fail(`--count must be a positive integer`);
  if (!ASPECTS.includes(opts.aspect)) fail(`--aspect must be one of: ${ASPECTS.join(', ')}`);
  if (!RESOLUTIONS.includes(opts.resolution)) {
    fail(`--resolution must be one of: ${RESOLUTIONS.join(', ')}`);
  }
  if (provider === 'openai' && GEMINI_ONLY_RESOLUTIONS.includes(opts.resolution)) {
    fail(`--resolution ${opts.resolution} is Gemini-only (OpenAI tops out at ${OPENAI_MAX_EDGE}px per edge).`);
  }
  if (opts.size && provider !== 'openai') {
    fail(`--size is OpenAI-only. For Gemini use --aspect and --resolution.`);
  }
  if (opts.size && opts.size !== 'auto') {
    const m = /^(\d+)x(\d+)$/.exec(opts.size);
    if (!m) fail(`--size must look like 1024x1536, or "auto"`);
    const [w, h] = [Number(m[1]), Number(m[2])];
    if (w % OPENAI_SIZE_STEP || h % OPENAI_SIZE_STEP) {
      fail(`--size: both edges must be divisible by ${OPENAI_SIZE_STEP} (got ${w}x${h})`);
    }
    if (Math.max(w, h) > OPENAI_MAX_EDGE) {
      fail(`--size: longest edge must be <= ${OPENAI_MAX_EDGE} (got ${w}x${h})`);
    }
  }
  if (opts.images.length > MAX_REF_IMAGES) {
    fail(`--image: at most ${MAX_REF_IMAGES} input images (got ${opts.images.length})`);
  }

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

  // --size chi de de tay cho OpenAI, khong co thi suy tu aspect + resolution
  const [aspectWidth, aspectHeight] = OUTPUT_SIZE[opts.aspect][opts.resolution];
  const size = provider === 'openai'
    ? (opts.size ?? `${aspectWidth}x${aspectHeight}`)
    : null;
  const [targetWidth, targetHeight] = size && size !== 'auto'
    ? size.split('x').map(Number)
    : [null, null];

  const result = await genImages({
    baseUrl,
    apiKey,
    model,
    prompt,
    count: opts.count,
    references,
    provider,
    aspect: opts.aspect,
    resolution: opts.resolution,
    size,
  });

  const outDir = resolve(opts.out);
  const base = `${stamp()}-${slugify(prompt)}`;
  const files = [];
  const dimensions = [];
  const warnings = [];

  // Chi tao thu muc khi that su co anh, tranh de lai thu muc rong khi gen loi
  if (result.images.length) await mkdir(outDir, { recursive: true });

  for (const [i, img] of result.images.entries()) {
    const path = join(outDir, `${base}-${i + 1}${EXT_BY_MIME[img.mime] ?? '.png'}`);
    await writeFile(path, img.buf);
    files.push(path);

    const actual = readDimensions(img.buf);
    dimensions.push({ file: path, ...actual });
    if (targetWidth && actual.width
      && (actual.width !== targetWidth || actual.height !== targetHeight)) {
      warnings.push(
        `${basename(path)}: asked for ${targetWidth}x${targetHeight}, got ${actual.width}x${actual.height}`,
      );
    }
  }

  const summary = {
    provider,
    model,
    keyFrom: found.from,
    baseUrl,
    aspect: opts.aspect,
    resolution: opts.resolution,
    size,
    mode: references.length ? 'image-to-image' : 'text-to-image',
    requested: opts.count,
    costUsd: Number(result.cost.toFixed(6)),
    files,
    dimensions,
    warnings,
    errors: result.errors,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${summary.mode} | ${provider}/${model} | ${files.length}/${opts.count} image(s) | $${summary.costUsd}`);
    for (const d of dimensions) console.log(`${d.file} (${d.width}x${d.height})`);
    for (const w of warnings) console.error(`WARN: ${w}`);
    for (const e of result.errors) console.error(`FAILED: ${e}`);
  }

  if (!files.length) process.exit(1);
}

main().catch((e) => fail(e.stack ?? e.message));
