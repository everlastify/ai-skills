#!/usr/bin/env node
// gen-images: text-to-image & image-to-image via Gemini (default) or OpenAI.
// Zero dependencies - uses native fetch / FormData / Blob (Node 18+).
// Cross-platform: no external binaries, runs on macOS, Windows and Linux.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

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
    'pro-preview': 'nano-banana-pro-preview',
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

// Dung chung cho ca 2 provider: do thuc te cho thay OpenAI nhan het cac size nay.
const OUTPUT_SIZE = {
  '1:1': { '1k': [1024, 1024], '2k': [2048, 2048], '4k': [4096, 4096] },
  '9:16': { '1k': [768, 1376], '2k': [1536, 2752], '4k': [3072, 5504] },
  '16:9': { '1k': [1376, 768], '2k': [2752, 1536], '4k': [5504, 3072] },
};
// Rang buoc that cua OpenAI, lay tu thong bao loi cua API chu khong phai enum co dinh
const OPENAI_SIZE_STEP = 16;
const OPENAI_MAX_EDGE = 3840;

const OPENAI_MAX_N = 10;
const GEMINI_CONCURRENCY = 3;
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

function parseArgs(argv) {
  const opts = {
    images: [],
    count: 1,
    provider: 'gemini',
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
  --count, -n <N>        Number of images (default 1)
  --image, -i <path>     Input image for image-to-image (repeatable)
  --out, -o <dir>        Output directory (default ./gen-images)
  --json                 Print a JSON summary instead of human text

Env: GEMINI_API_SKILL (gemini), OPENAI_API_SKILL (openai)`;

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

// Doc kich thuoc tu header, khong goi binary ngoai -> chay duoc ca Windows.
// Chi can 3 dinh dang script nay sinh ra: PNG, JPEG, WebP.
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
    throw new Error(`${label}: HTTP ${res.status} - ${body.slice(0, 500)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// --- Gemini: one image per call, so run `count` calls in a small pool. ---
async function genGemini({ prompt, model, count, images, aspect, resolution, apiKey }) {
  const parts = [{ text: prompt }];
  for (const path of images) {
    parts.push({
      inline_data: { mime_type: mimeOf(path), data: (await readFile(path)).toString('base64') },
    });
  }
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: aspect,
        imageSize: resolution.toUpperCase(),
      },
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  };

  const results = await runPool(
    Array.from({ length: count }, (_, i) => async () => {
      const data = await callApi(url, init, `gemini call ${i + 1}`);
      const inline = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.inlineData ?? p.inline_data)
        .filter(Boolean);
      if (!inline.length) {
        const reason = data.candidates?.[0]?.finishReason ?? 'no image in response';
        throw new Error(`gemini call ${i + 1}: ${reason}`);
      }
      return inline.map((p) => ({ b64: p.data, mime: p.mimeType ?? p.mime_type ?? 'image/png' }));
    }),
    GEMINI_CONCURRENCY,
  );

  const out = { images: [], errors: [] };
  for (const r of results) {
    if (r.ok) out.images.push(...r.value);
    else out.errors.push(r.error);
  }
  return out;
}

// --- OpenAI: /generations for text-to-image, /edits for image-to-image. ---
async function genOpenai({ prompt, model, count, images, size, apiKey }) {
  const out = { images: [], errors: [] };
  const batches = [];
  for (let left = count; left > 0; left -= OPENAI_MAX_N) batches.push(Math.min(left, OPENAI_MAX_N));

  const files = await Promise.all(
    images.map(async (path) => ({ path, buf: await readFile(path), mime: mimeOf(path) })),
  );

  for (const [idx, n] of batches.entries()) {
    const label = `openai batch ${idx + 1}`;
    try {
      let init;
      let url;
      if (files.length) {
        url = 'https://api.openai.com/v1/images/edits';
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('n', String(n));
        if (size) form.append('size', size);
        for (const f of files) {
          form.append('image[]', new Blob([f.buf], { type: f.mime }), basename(f.path));
        }
        init = { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form };
      } else {
        url = 'https://api.openai.com/v1/images/generations';
        init = {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, n, ...(size ? { size } : {}) }),
        };
      }
      const data = await callApi(url, init, label);
      const items = (data.data ?? []).filter((d) => d.b64_json);
      if (!items.length) throw new Error(`${label}: no image in response`);
      out.images.push(...items.map((d) => ({ b64: d.b64_json, mime: 'image/png' })));
    } catch (e) {
      out.errors.push(e.message);
    }
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

  if (!['gemini', 'openai'].includes(opts.provider)) fail(`--provider must be gemini or openai`);
  if (!Number.isInteger(opts.count) || opts.count < 1) fail(`--count must be a positive integer`);
  if (!ASPECTS.includes(opts.aspect)) fail(`--aspect must be one of: ${ASPECTS.join(', ')}`);
  if (!RESOLUTIONS.includes(opts.resolution)) {
    fail(`--resolution must be one of: ${RESOLUTIONS.join(', ')}`);
  }
  if (opts.provider === 'openai' && GEMINI_ONLY_RESOLUTIONS.includes(opts.resolution)) {
    fail(`--resolution ${opts.resolution} is Gemini-only (OpenAI tops out at ${OPENAI_MAX_EDGE}px per edge).`);
  }
  if (opts.size && opts.provider !== 'openai') {
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

  const envVar = opts.provider === 'gemini' ? 'GEMINI_API_SKILL' : 'OPENAI_API_SKILL';
  const apiKey = process.env[envVar];
  if (!apiKey) fail(`Missing env ${envVar}. Add it to ~/.zshrc and reload the shell.`);

  const model = MODEL_ALIAS[opts.provider][opts.model] ?? opts.model ?? DEFAULT_MODEL[opts.provider];

  const images = opts.images.map((p) => resolve(p));
  for (const p of images) {
    try {
      await readFile(p);
    } catch {
      fail(`Input image not found: ${p}`);
    }
  }

  // --size chi de de tay cho OpenAI, khong co thi suy tu aspect + resolution
  const [aspectWidth, aspectHeight] = OUTPUT_SIZE[opts.aspect][opts.resolution];
  const size = opts.provider === 'openai'
    ? (opts.size ?? `${aspectWidth}x${aspectHeight}`)
    : null;
  const [targetWidth, targetHeight] = size && size !== 'auto'
    ? size.split('x').map(Number)
    : (size === 'auto' ? [null, null] : [aspectWidth, aspectHeight]);

  const args = {
    prompt,
    model,
    count: opts.count,
    images,
    apiKey,
    aspect: opts.aspect,
    resolution: opts.resolution,
    size,
  };
  const result = opts.provider === 'gemini' ? await genGemini(args) : await genOpenai(args);

  const outDir = resolve(opts.out);
  await mkdir(outDir, { recursive: true });
  const base = `${stamp()}-${slugify(prompt)}`;
  const files = [];
  const dimensions = [];

  for (const [i, img] of result.images.entries()) {
    const path = `${outDir}/${base}-${i + 1}${EXT_BY_MIME[img.mime] ?? '.png'}`;
    const buf = Buffer.from(img.b64, 'base64');
    await writeFile(path, buf);
    files.push(path);

    const actual = readDimensions(buf);
    dimensions.push({ file: path, ...actual });
    if (opts.provider === 'openai' && targetWidth && actual.width
      && (actual.width !== targetWidth || actual.height !== targetHeight)) {
      throw new Error(
        `OpenAI size mismatch for ${path}: expected ${targetWidth}x${targetHeight}, got ${actual.width}x${actual.height}`,
      );
    }
  }

  const summary = {
    provider: opts.provider,
    model,
    aspect: opts.aspect,
    resolution: opts.resolution,
    size,
    mode: images.length ? 'image-to-image' : 'text-to-image',
    requested: opts.count,
    files,
    dimensions,
    errors: result.errors,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${summary.mode} | ${opts.provider}/${model} | ${files.length}/${opts.count} image(s)`);
    for (const d of dimensions) console.log(`${d.file} (${d.width}x${d.height})`);
    for (const e of result.errors) console.error(`FAILED: ${e}`);
  }

  if (!files.length) process.exit(1);
}

main().catch((e) => fail(e.stack ?? e.message));
