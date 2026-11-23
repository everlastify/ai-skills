---
name: gen-videos
description: Generate videos from a text prompt or from an input image using the Gemini Omni video models through the company OneRouter gateway. Use this skill when the user asks to create, generate, render, or animate a video, turn an image into a video, "gen video", "tạo video", "làm video từ ảnh", or mentions AI video generation.
---

# Gen Videos

## Overview

Gen video bằng AI qua 1 script Node zero-dependency (`scripts/gen-video.mjs`, dùng native `fetch`). Hai chế độ trong cùng 1 CLI:

- **text-to-video**: chỉ truyền `--prompt`
- **image-to-video**: truyền thêm `--image <path>` để dùng ảnh làm khung hình đầu hoặc làm tham chiếu nhân vật

Request đi qua **OneRouter** (`https://model.hbcommerce.co`) — gateway nội bộ của công ty, dùng chung một key với skill `gen-images`.

Chạy được trên **macOS, Windows và Linux** — **không cần `npm install`**, không có `node_modules`.

> **Veo đã ngừng hoạt động.** Google đóng Veo và OpenAI đóng Sora trong năm 2026. Skill này giờ dùng dòng `gemini-omni-*`. Lệnh cũ `generate-video.js` đã bị xoá.

## Setup

Cần **Node.js 18+**.

| Biến | Bắt buộc | Mặc định |
|---|---|---|
| `ONEROUTER_KEY` | ✅ | — (xin admin, dạng `or-` + 40 ký tự) |
| `ONEROUTER_URL` | — | `https://model.hbcommerce.co` |

Script tìm theo **3 nấc**, dừng ở nấc đầu tiên có key:

| Thứ tự | Nơi tìm | Dùng khi |
|---|---|---|
| 1 | Biến đã `export` ở shell | Máy cá nhân, set một lần dùng mãi |
| 2 | `.env` ở **thư mục đang đứng** | Mỗi project một key riêng |
| 3 | `.env` trong **thư mục skill** (cạnh `SKILL.md`) | Copy nguyên folder skill đi nơi khác |

```bash
# macOS / Linux — them vao ~/.zshrc hoac ~/.bashrc roi mo lai terminal
export ONEROUTER_KEY="or-..."
```

```powershell
# Windows PowerShell — set vinh vien cho user, mo lai terminal la co
[Environment]::SetEnvironmentVariable("ONEROUTER_KEY", "or-...", "User")
```

```bash
# Hoac dung .env trong thu muc skill
cp <skill-dir>/.env.example <skill-dir>/.env
```

⚠️ **Đừng gửi `.env` chứa key thật cho người khác.** Video đắt hơn ảnh nhiều lần, ai cầm key cũng gen được và **chủ key chịu budget**.

## Usage

```bash
node <skill-dir>/scripts/gen-video.mjs --prompt "<text>" [options]
```

`<skill-dir>` = **thư mục chứa chính file `SKILL.md` này**.

| Option | Ý nghĩa |
|---|---|
| `--prompt <text>` | Tả **cảnh** và **chuyển động**, bắt buộc trừ khi dùng `--prompt-file` |
| `--prompt-file <path>` | Đọc prompt từ file |
| `--model <id>` | `gemini-omni-1.2-flash` (mặc định, alias `1.2`) hoặc `gemini-omni-1.1-flash` (alias `1.1`) |
| `--seconds, -s <N>` | 3-15 giây, mặc định `8` |
| `--aspect <ratio>` | `16:9` (mặc định) hoặc `9:16` |
| `--resolution <tier>` | `360p`, `720p` (mặc định), `1080p`, `4k` |
| `--image, -i <path>` | Ảnh tham chiếu, tối đa 6 (png/jpg/webp) |
| `--out, -o <path>` | Thư mục output (mặc định `./gen-videos`), hoặc đường dẫn kết thúc bằng `.mp4` |
| `--json` | In JSON summary thay vì dòng tiến trình |

## Behavior

- Gen video là **bất đồng bộ**: script tạo job, poll `GET /v1/jobs/{id}` mỗi 5 giây, xong thì tải MP4 về
- Thực tế mất khoảng **30 giây đến 3 phút**. Job quá 30 phút thì server tự fail, script bỏ cuộc ở phút 35 và in luôn lệnh `curl` để xem lại job
- Budget được **giữ trước** theo số giây × đơn giá. Không đủ budget là job bị từ chối ngay, không tốn gì
- Job fail thì phần giữ trước được hoàn lại (trừ khi provider đã tính tiền)
- Ảnh input gửi kèm dưới dạng data URL, mỗi ảnh tối đa 20MB, tổng body 60MB — script chặn trước khi gửi
- Retry 1 lần khi gặp 429 hoặc 5xx. Lỗi `budget_exceeded` (402) thì **không** retry
- Tên file mặc định: `<YYYYMMDD-HHmmss>-<slug-prompt>.mp4`

⚠️ **Link CDN của OneRouter là public** — ai có link cũng mở được. Script tải video về máy ngay, nhưng bản trên CDN vẫn còn đó. Đừng gen video chứa thông tin phải giữ kín.

## Workflow cho agent

1. Có ảnh input thì dùng image-to-video, nói rõ trong prompt ảnh đó đóng vai gì
2. User không nói độ dài thì để mặc định 8 giây, không nói chất lượng thì để `720p`
3. Chạy với `--json`, đọc `file` và `costUsd`
4. Báo cho user đường dẫn MP4 đã lưu, hoặc gửi file qua SendUserFile
5. Thất bại vì safety filter (`upstream_error`) thì sửa prompt rồi thử lại, đừng retry y nguyên

**Prompt tips:**

- Tả **chuyển động** chứ không chỉ tả cảnh tĩnh: camera đi hướng nào, chủ thể làm gì, tốc độ ra sao
- Thử nghiệm thì để `--seconds 3 --resolution 360p` cho rẻ, ưng rồi mới gen bản `1080p`
- Image-to-video: nói rõ ảnh là khung hình đầu hay chỉ là tham chiếu ngoại hình

**Lưu ý per-project:** nếu project có `CLAUDE.md` hoặc `AGENTS.md` quy định chỗ chứa output thì truyền `--out` theo đúng quy định đó.

## Examples

```bash
# Text-to-video, mac dinh 8 giay 16:9 720p
node <skill-dir>/scripts/gen-video.mjs \
  --prompt "a paper boat drifting on a calm lake at sunrise, slow camera push in"

# Ban nhap cho re: 3 giay, 360p
node <skill-dir>/scripts/gen-video.mjs --seconds 3 --resolution 360p \
  --prompt "neon sign flickering on a rainy street, slight camera shake"

# Video doc cho TikTok / Reels, luu dung ten file
node <skill-dir>/scripts/gen-video.mjs --aspect 9:16 --resolution 1080p --seconds 10 \
  --prompt "close-up of coffee being poured into a glass, steam rising, slow motion" \
  --out reports/coffee-pour.mp4

# Image-to-video: lam anh san pham chuyen dong
node <skill-dir>/scripts/gen-video.mjs -i sources/mug.png \
  --prompt "the mug slowly rotates on a wooden table, warm morning light" --json
```
