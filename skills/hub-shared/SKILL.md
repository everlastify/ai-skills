---
name: hub-shared
description: Upload file lên S3 của công ty qua app hub và trả về link public trên CDN. Dùng khi user nói "share file này", "up file lên hub", "gửi link file", "host cái ảnh/pdf này", hoặc cần một URL công khai cho file local.
---

# Hub Shared

## Tổng quan

Skill đẩy **1 file local** lên S3 bằng **presigned URL**, rồi in ra link public qua CloudFront.

Điểm chính: **máy anh không cầm key S3**. Script hỏi hub xin một URL đã ký sẵn, rồi `PUT` file **thẳng lên S3** — file không đi qua server hub, nên không dính giới hạn dung lượng của web server.

Script `scripts/upload.cjs` là Node thuần — **không cần `npm install`**, không dùng thư viện ngoài. File được stream thẳng từ ổ cứng lên S3 nên file lớn không ngốn RAM.

## Chuẩn bị

Cần đúng **1 biến môi trường**:

- `HUB_SKILL_TOKEN` — API key của hub

Script đọc theo thứ tự: biến đã **`export` ở shell thắng trước**, không có thì mới lấy từ `<thư-mục-hiện-tại>/.env`. Thiếu token thì script báo lỗi và dừng.

## Cách dùng

```bash
node <skill-dir>/scripts/upload.cjs <đường-dẫn-file>
```

`<skill-dir>` là thư mục chứa skill này:
- Claude Code: `~/.claude/skills/hub-shared`
- Codex: `~/.codex/skills/hub-shared`
- Trong repo: `skills/hub-shared`

In ra 2 dòng — tên file + dung lượng, rồi link:

```
Uploaded: report.pdf (182044 bytes)
https://files.hbcommerce.co/app-hub/shared/Website/26110208451234567-report.pdf
```

Lỗi thì in thông báo rồi thoát với exit code 1.

## Luồng chạy

Script làm 2 bước, user không cần biết, nhưng để debug thì nắm cho dễ:

1. `POST /api/s3/presign` kèm `{"name": "<tên file>"}` → hub trả `uploadUrl` (URL đã ký), `headers` bắt buộc, và `url` public cuối cùng
2. `PUT` nguyên bytes của file lên `uploadUrl`, gửi đúng mọi header ở bước 1 → S3 trả `200` body rỗng là xong

Hub **không biết** bước 2 có thành công hay không, nên script tự kiểm tra status `200` rồi mới in link.

## Quy trình

1. User nhờ share / up / host một file
2. Kiểm tra file có tồn tại không
3. Chạy `upload.cjs` với đường dẫn file đó
4. Đưa link trong output cho user

## Giới hạn & lưu ý

- **Tối đa 5GB** mỗi file (trần của 1 lần `PUT` lên S3), mỗi lần 1 file. Script tự kiểm tra dung lượng trước khi gửi
- **Link là public** — ai có link cũng mở được. Đừng up file chứa thông tin nhạy cảm
- **Không bao giờ ghi đè** — mỗi lần upload có ID riêng trước tên file, up cùng một file 2 lần ra 2 link khác nhau
- **Tên file trong URL bị làm sạch** — ký tự ngoài `A-Z a-z 0-9 . -` đổi thành `-`, kể cả dấu `_` (vd `Báo cáo v2.pdf` → `<ID>-B-o-c-o-v2.pdf`). Tên gốc vẫn hiện ở dòng `Uploaded:`
- **Content-Type suy từ đuôi file.** Đuôi quen thuộc (`.pdf`, `.png`, `.mp4`…) mở thẳng được trên trình duyệt; đuôi lạ — kể cả `.md` — ra `application/octet-stream`, bấm link là trình duyệt **tải về** chứ không mở
- **URL ký sẵn hết hạn sau 1 giờ.** S3 chỉ kiểm tra lúc bắt đầu request nên file to upload cả tiếng vẫn xong; chỉ khi xin URL rồi để quá lâu mới dính `403 AccessDenied — Request has expired`, chạy lại lệnh là có URL mới
- Lỗi ở bước `PUT` là lỗi của S3 (XML) — script bóc sẵn `<Code>` và `<Message>` ra cho dễ đọc, vd `SignatureDoesNotMatch`

## Tài nguyên

### scripts/upload.cjs
Script Node zero-dependency: kiểm tra file, xin presigned URL từ `POST /api/s3/presign` kèm header `Authorization: Bearer`, rồi stream file lên S3 bằng `PUT` với đúng header server yêu cầu, kiểm tra status 200 và in `url`.
