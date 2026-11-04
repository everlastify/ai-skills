#!/usr/bin/env node
// Upload 1 file len S3 cua cong ty bang presigned URL cua app hub.
// Hub chi ky URL, file duoc PUT THANG len S3 — khong di qua server hub.
// Zero-dependency, stream tu disk nen file lon khong an het RAM.
//
//   node upload.cjs <file>              tao file moi
//   node upload.cjs <file> <key|link>   ghi de file cu, giu nguyen link

const https = require("https");
const fs = require("fs");
const path = require("path");

// Bien da export o shell thang truoc, khong co thi lay <cwd>/.env
const ENV_PATH = path.join(process.cwd(), ".env");
try {
  process.loadEnvFile(ENV_PATH);
} catch (e) {
  if (e.code !== "ENOENT") {
    console.error(`Cannot load env file "${ENV_PATH}": ${e.message}`);
    process.exit(1);
  }
}

const HOST = "hub.hbcommerce.co";
const PRESIGN_PATH = "/api/s3/presign";
const CDN_PREFIX = "https://files.hbcommerce.co/";
const TOKEN = process.env.HUB_SKILL_TOKEN;
const MAX_BYTES = 5 * 1024 * 1024 * 1024; // tran 1 lan PUT cua S3

if (!TOKEN) {
  console.error(`Missing HUB_SKILL_TOKEN. Export it in your shell, or add it to "${ENV_PATH}".`);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node upload.cjs <file> [key-or-link-to-overwrite]");
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const stats = fs.statSync(filePath);
if (stats.isDirectory()) {
  console.error(`Path is a directory, not a file: ${filePath}`);
  process.exit(1);
}
if (stats.size > MAX_BYTES) {
  const gb = (stats.size / 1024 / 1024 / 1024).toFixed(2);
  console.error(`File is ${gb}GB — a single S3 PUT tops out at 5GB.`);
  process.exit(1);
}

// Tham so 2 (tuy chon): key cua file cu de GHI DE, giu nguyen link.
// Nhan ca key lan nguyen link CDN — copy link ra dan vao la chay.
let overwriteKey = process.argv[3];
if (overwriteKey) {
  if (overwriteKey.startsWith(CDN_PREFIX)) overwriteKey = overwriteKey.slice(CDN_PREFIX.length);
  overwriteKey = overwriteKey.replace(/^\/+/, "");

  // Chan som o client cho do mat mot vong goi API
  if (!overwriteKey.startsWith("shared/")) {
    console.error(`Key must start with "shared/" — got "${overwriteKey}".`);
    console.error("Files uploaded before 2026-11-04 sit under app-hub/shared/ and cannot be overwritten.");
    process.exit(1);
  }
}

// Buoc 1: xin URL ky san. Server dat ten trong URL + doan Content-Type tu duoi file.
// payload: { name } de tao moi, { key } de ghi de file da co.
function presign(payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        hostname: HOST,
        port: 443,
        path: PRESIGN_PATH,
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            reject(
              new Error(
                `Presign failed (HTTP ${res.statusCode}), response is not JSON:\n${raw.slice(0, 500)}`
              )
            );
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && json.uploadUrl) {
            resolve(json);
          } else {
            reject(new Error(`Presign failed (HTTP ${res.statusCode}): ${json.error || raw}`));
          }
        });
      }
    );
    req.on("error", (e) => reject(new Error(`Network error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// Buoc 2: PUT nguyen bytes len S3. Phai gui du header server tra ve, thieu la 403.
function put(uploadUrl, headers, size) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      { method: "PUT", headers: { ...headers, "Content-Length": size } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          // Hub khong biet PUT co thanh cong khong, minh tu check
          if (res.statusCode === 200) resolve();
          else reject(new Error(`S3 rejected the upload (HTTP ${res.statusCode}): ${s3Error(raw)}`));
        });
      }
    );
    req.on("error", (e) => reject(new Error(`Network error: ${e.message}`)));

    const stream = fs.createReadStream(filePath);
    stream.on("error", (e) => {
      req.destroy();
      reject(new Error(`Cannot read file: ${e.message}`));
    });
    stream.pipe(req);
  });
}

// Loi cua S3 la XML — boc <Code>/<Message> cho do roi mat
function s3Error(xml) {
  const code = /<Code>([^<]*)<\/Code>/.exec(xml);
  const message = /<Message>([^<]*)<\/Message>/.exec(xml);
  if (!code && !message) return xml.slice(0, 500) || "(empty response)";
  return [code && code[1], message && message[1]].filter(Boolean).join(" — ");
}

(async () => {
  // Ghi de la thao tac khong undo duoc (bucket tat versioning) -> noi ro truoc khi lam
  if (overwriteKey) console.log(`Overwriting: ${overwriteKey}`);

  let info;
  try {
    info = await presign(overwriteKey ? { key: overwriteKey } : { name: path.basename(filePath) });
    await put(info.uploadUrl, info.headers || {}, stats.size);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log(`Uploaded: ${info.name} (${stats.size} bytes)`);
  console.log(`Key: ${info.key}`);
  console.log(info.url);
})();
