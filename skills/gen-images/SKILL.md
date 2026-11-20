---
name: gen-images
description: Generate images with AI - text-to-image and image-to-image (edit/variation) via Gemini (default) or OpenAI. Use when the user asks to "gen ảnh", "tạo ảnh", "vẽ ảnh", "text to image", "image to image", "edit ảnh bằng AI", "làm mockup ảnh", or wants image variations from a reference image.
---

# Gen Images

## Overview

Gen ảnh bằng AI qua 1 script Node zero-dependency (`scripts/gen.mjs`, dùng native `fetch`).
Hỗ trợ 2 chế độ trong cùng 1 CLI:

- **text-to-image**: chỉ truyền `--prompt`
- **image-to-image**: truyền thêm `--image <path>` (lặp lại được nhiều lần) để edit hoặc tạo biến thể từ ảnh gốc

Chạy được trên **macOS, Windows và Linux** — không gọi binary ngoài nào, kể cả khi đọc kích thước ảnh.

## Setup

Cần **Node.js 18+** (script dùng native `fetch`, không cài package nào).

API key đọc từ 2 biến, chỉ cần provider nào thì set key đó:

- `GEMINI_API_SKILL` - cho provider `gemini` ([lấy key](https://aistudio.google.com/apikey))
- `OPENAI_API_SKILL` - cho provider `openai` ([lấy key](https://platform.openai.com/api-keys))

Script tìm theo **3 nấc**, dừng ở nấc đầu tiên có key:

| Thứ tự | Nơi tìm | Dùng khi |
|---|---|---|
| 1 | Biến đã `export` ở shell | Máy cá nhân, set một lần dùng mãi |
| 2 | `.env` ở **thư mục đang đứng** | Mỗi project một key riêng |
| 3 | `.env` trong **thư mục skill** (cạnh `SKILL.md`) | Copy nguyên folder skill đi nơi khác |

Nấc 3 là thứ khiến skill này **mang đi được**: copy cả folder sang máy khác, điền `.env` trong đó, chạy từ bất kỳ đâu cũng được. Trong skill có sẵn **`.env.example`** làm mẫu, copy thành `.env` rồi điền.

```bash
# macOS / Linux — them vao ~/.zshrc hoac ~/.bashrc roi mo lai terminal
export GEMINI_API_SKILL="your-key-here"
```

```powershell
# Windows PowerShell — set vinh vien cho user, mo lai terminal la co
[Environment]::SetEnvironmentVariable("GEMINI_API_SKILL", "your-key-here", "User")
```

```bash
# Hoac dung .env trong thu muc skill
cp <skill-dir>/.env.example <skill-dir>/.env
# roi dien key vao file do
```

⚠️ **Đừng gửi `.env` chứa key thật cho người khác.** Key không giới hạn theo người dùng, ai cầm được cũng gen thoải mái và **chủ key trả tiền**. Đưa `.env.example` để họ tự điền key của họ. Lộ key thì phải rotate ở Google AI Studio hoặc OpenAI, không thu hồi lẻ được.

Thiếu key thì script exit code 1 và in ra đúng 3 đường dẫn có thể đặt, không fail im lặng.

`--json` trả thêm `keyFrom` cho biết key được lấy từ nấc nào, tiện khi debug.

## Usage

```bash
node <skill-dir>/scripts/gen.mjs --prompt "<text>" [options]
```

`<skill-dir>` = **thư mục chứa chính file `SKILL.md` này**.

Options:

| Option | Ý nghĩa |
|---|---|
| `--prompt <text>` | Prompt, bắt buộc trừ khi dùng `--prompt-file` |
| `--prompt-file <path>` | Đọc prompt từ file, dùng cho prompt dài hoặc nhiều dòng |
| `--provider gemini\|openai` | Mặc định `gemini` |
| `--model <id>` | Model id hoặc alias, xem bảng dưới |
| `--aspect <ratio>` | `1:1` (mặc định), `9:16`, `16:9` — áp dụng cho **cả 2 provider** |
| `--resolution <tier>` | `1k`, `2k` (mặc định) cho cả 2 provider, `4k` chỉ Gemini |
| `--size <WxH>` | **Chỉ OpenAI**, đè lên `--aspect`/`--resolution` |
| `--count, -n <N>` | Số ảnh, mặc định `1` |
| `--image, -i <path>` | Ảnh input cho image-to-image, lặp nhiều lần được (png/jpg/webp/gif) |
| `--out, -o <dir>` | Thư mục output, mặc định `./gen-images` |
| `--json` | In JSON summary, dùng khi agent cần parse kết quả |

## Kích thước ảnh

`--aspect` + `--resolution` cho ra kích thước như sau, **giống nhau ở cả 2 provider**:

| Aspect | 1k | 2k (mặc định) | 4k |
|---|---|---|---|
| `1:1` | 1024x1024 | 2048x2048 | 4096x4096 |
| `9:16` | 768x1376 | 1536x2752 | 3072x5504 |
| `16:9` | 1376x768 | 2752x1536 | 5504x3072 |

Bậc **`4k` chỉ Gemini mới có**. OpenAI trần cạnh dài 3840 nên script chặn ngay tại client kèm lý do.

Riêng OpenAI có thể đè bằng `--size WxH` với kích thước bất kỳ, miễn là:

- Hai cạnh đều **chia hết cho 16**
- Cạnh dài **không quá 3840**
- Hoặc truyền `auto` để model tự chọn

Script kiểm tra trước khi gọi API nên sai là báo ngay, không tốn một lượt gọi. Sau khi lưu file, script đọc kích thước thật từ header ảnh và đối chiếu — OpenAI trả sai size là báo lỗi.

Gemini **không nhận `--size`**, truyền vào sẽ bị chặn kèm hướng dẫn dùng `--aspect`.

## Models

`--model` nhận **id đầy đủ hoặc alias**. Không truyền thì dùng mặc định.

**Gemini** — endpoint `generateContent`, dùng chung cho cả t2i và i2i:

| Model | Alias | Ghi chú |
|---|---|---|
| `gemini-3.1-flash-image` | `flash` | **Mặc định**, nhanh và rẻ (Nano Banana 2) |
| `gemini-3.1-flash-lite-image` | `flash-lite` | Rẻ nhất (Nano Banana 2 Lite) |
| `gemini-3-pro-image` | `pro` | Chất lượng cao nhất, chậm và đắt hơn (Nano Banana Pro) |
| `gemini-nano-banana-2.1` | `2.1` | Nano Banana 2.1 |
| `nano-banana-pro-preview` | `pro-preview` | Cùng dòng Pro, tên gọi khác |
| `gemini-2.5-flash-image` | `2.5-flash` | Bản cũ, chỉ dùng khi cần so sánh |

**OpenAI** — chỉ dùng đời 2.x. Trong một đời, **Flare là bản nhanh, Sunburst là bản chất lượng** và giữ bối cảnh tốt hơn khi edit nhiều bước:

| Model | Alias | Ghi chú |
|---|---|---|
| `gpt-image-2.6-flare` | `flare` | **Mặc định**, nhanh nhất |
| `gpt-image-2.6-sunburst` | `sunburst` | Đời mới, ưu tiên chất lượng |
| `gpt-image-2.5-flare` | `2.5-flare` | Đời trước, bản nhanh |
| `gpt-image-2.5-sunburst` | `2.5-sunburst` | Đời trước, bản chất lượng |
| `gpt-image-2` | `2` | Cũ nhất trong đời 2.x |

Các model đời 1 (`gpt-image-1.5`, `gpt-image-1-mini`, `chatgpt-image-latest`) **không được hỗ trợ** — chúng chỉ nhận 3 size cố định, khác luật với đời 2.x.

## Output

- File lưu vào `--out` (mặc định `./gen-images`), tên `<YYYYMMDD-HHmmss>-<slug-prompt>-<index>.<ext>`
- Extension theo mime API trả về — Gemini thường trả **JPEG**, OpenAI trả **PNG**
- Script in đường dẫn tuyệt đối kèm kích thước thật của từng file
- `--json` trả thêm `dimensions[]`, `size`, `model`, `errors[]`

## Workflow cho agent

1. Xác định mode: user có đưa ảnh input không, có thì image-to-image
2. User không nói provider thì dùng `gemini`. Chỉ đổi sang `openai` khi user yêu cầu, hoặc khi Gemini fail vì content policy
3. User không nói số lượng thì `--count 1`
4. Chạy với `--json`, đọc `files[]` và `errors[]`
5. Gửi ảnh cho user (SendUserFile) hoặc nhúng vào report bằng relative path

**Prompt tips:**

- Prompt tả cảnh cụ thể (subject + style + lighting + background) cho kết quả tốt hơn keyword rời rạc
- Image-to-image: nói rõ cái gì ĐỔI và cái gì GIỮ NGUYÊN, ví dụ `"make it wear a red santa hat, keep everything else identical"`
- Cần nhiều ảnh khác nhau rõ rệt thì chạy nhiều lần với prompt khác nhau, thay vì tăng `--count` (count chỉ tạo biến thể cùng prompt)

**Lưu ý per-project:** nếu project có `CLAUDE.md` hoặc `AGENTS.md` quy định chỗ chứa output (thường là `reports/`) thì luôn truyền `--out` theo đúng quy định đó, đừng để mặc định `./gen-images`.

## Behavior

- **Gemini**: 1 API call = 1 ảnh, nên `--count N` chạy N call song song, concurrency tối đa 3 để tránh 429
- **OpenAI**: dùng param `n` tối đa 10 mỗi call, count lớn hơn thì tự chia batch. Image-to-image gọi `/v1/images/edits` (multipart), text-to-image gọi `/v1/images/generations`
- Retry 1 lần khi gặp 429 hoặc 5xx (backoff 5s / 2s)
- Ảnh nào lỗi thì skip và ghi vào `errors[]`, các ảnh còn lại vẫn được lưu. Exit code 1 nếu không lưu được ảnh nào
- Kích thước ảnh đọc trực tiếp từ header PNG / JPEG / WebP bằng JS thuần, không gọi `sips` hay `magick`, nên không lệ thuộc hệ điều hành

## Examples

```bash
# Text-to-image, 4 anh, kho ngang 2k, Gemini mac dinh
node <skill-dir>/scripts/gen.mjs \
  --prompt "cozy coffee shop interior, warm morning light, cinematic" \
  --count 4 --aspect 16:9 --out reports/coffee-mockups

# Image-to-image: doi background cua anh san pham
node <skill-dir>/scripts/gen.mjs \
  --prompt "replace the background with a marble kitchen countertop, keep the mug unchanged" \
  -i sources/mug.png --count 2

# Ghep nhieu anh input (product + model reference)
node <skill-dir>/scripts/gen.mjs \
  --prompt "put the shirt design onto the model, natural fabric folds" \
  -i sources/design.png -i sources/model.jpg

# OpenAI, size tu chon, output JSON
node <skill-dir>/scripts/gen.mjs --provider openai \
  --prompt "minimal flat-design logo of a happy dog, white background" \
  --size 1024x1536 --json

# Gemini pro model, anh doc 1k cho nhe
node <skill-dir>/scripts/gen.mjs --model pro --aspect 9:16 --resolution 1k \
  --prompt "hyper-detailed product shot of a leather wallet on dark wood"

# Gemini 4K, chi Gemini moi co bac nay
node <skill-dir>/scripts/gen.mjs --resolution 4k --aspect 16:9 \
  --prompt "wide landscape of terraced rice fields at sunrise"

# OpenAI ban chat luong thay vi ban nhanh mac dinh
node <skill-dir>/scripts/gen.mjs --provider openai --model sunburst \
  --prompt "studio product shot of a ceramic vase, soft shadows"
```
