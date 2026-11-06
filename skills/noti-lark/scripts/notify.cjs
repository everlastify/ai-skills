#!/usr/bin/env node
// Ban 1 thong bao text len group Lark qua custom-bot webhook.
// Chi can NOTI_LARK_BOT (ID cua bot), script tu ghep thanh URL day du.
// Zero-dependency, chay bang fetch co san cua Node 20+.
//
//   node notify.cjs 'Noi dung'
//   node notify.cjs --text 'Noi dung'
//   node notify.cjs --raw 'C:\new\table'   giu nguyen dau \, khong doi thanh xuong dong

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

const HOOK_BASE = "https://open.larksuite.com/open-apis/bot/v2/hook/";
const TIMEOUT_MS = 15000;

const BOT = process.env.NOTI_LARK_BOT;
if (!BOT) {
  console.error(`Missing NOTI_LARK_BOT. Export it in your shell, or add it to "${ENV_PATH}".`);
  process.exit(1);
}

// Bien chua ID la chinh, nhung dan nguyen URL vao cung chay
const webhookUrl = /^https?:\/\//.test(BOT) ? BOT : HOOK_BASE + BOT;

const args = process.argv.slice(2);
let text = null;
let raw = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--raw") {
    raw = true;
  } else if (args[i] === "--text") {
    i += 1;
    if (i >= args.length) {
      console.error("--text needs a value.");
      process.exit(1);
    }
    text = args[i];
  } else if (text === null) {
    text = args[i];
  } else {
    console.error(`Unexpected argument: ${args[i]}`);
    process.exit(1);
  }
}

if (!text || !text.trim()) {
  console.error("Usage: node notify.cjs 'message' [--raw]");
  process.exit(1);
}

// Goi qua shell hay bi escape thanh \n chu, doi lai thanh xuong dong that.
// --raw de giu nguyen dau \ cho duong dan Windows, regex...
const message = raw ? text : text.replace(/\\n/g, "\n");

(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  let body;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ msg_type: "text", content: { text: message } }),
      signal: controller.signal,
    });
    body = await res.text();
  } catch (e) {
    const why = e.name === "AbortError" ? `no answer after ${TIMEOUT_MS / 1000}s` : e.message;
    console.error(`Cannot reach Lark: ${why}`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error(`Lark returned HTTP ${res.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  // Lark van tra 200 khi tu choi, loi nam trong JSON -> phai doc code
  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    console.error(`Lark returned a non-JSON response: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const code = json.code ?? json.StatusCode;
  if (code !== 0) {
    console.error(`Lark rejected the message (${code}): ${json.msg ?? json.StatusMessage ?? body}`);
    process.exit(1);
  }

  console.log("Sent to Lark.");
})();
