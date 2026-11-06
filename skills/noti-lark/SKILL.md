---
name: noti-lark
description: Bắn thông báo dạng text lên group Lark qua custom-bot webhook. Dùng khi user nói "noti lark", "báo lên Lark", "bắn tin vào group", "gửi thông báo Lark", hoặc muốn báo kết quả một việc vừa xong vào group.
---

# Noti Lark

## Tổng quan

Skill gửi **một đoạn text** lên group Lark đã gắn custom bot.

Script `scripts/notify.cjs` là Node thuần — **không cần `npm install`**, dùng `fetch` có sẵn của Node 20+.

## Chuẩn bị

Cần đúng **1 biến môi trường**:

- `NOTI_LARK_BOT` — ID của custom bot (phần đuôi URL webhook, dạng UUID)

Script tự ghép thành `https://open.larksuite.com/open-apis/bot/v2/hook/<ID>`. Dán nguyên URL webhook vào biến cũng chạy.

Đọc theo thứ tự: biến đã **`export` ở shell thắng trước**, không có thì mới lấy từ `<thư-mục-hiện-tại>/.env`.

## Cách dùng

```bash
node <skill-dir>/scripts/notify.cjs 'Nội dung thông báo'
node <skill-dir>/scripts/notify.cjs --text 'Nội dung thông báo'
```

`<skill-dir>` = **thư mục chứa chính file `SKILL.md` này**.

Gửi xong in đúng một dòng:

```
Sent to Lark.
```

Lỗi thì in lý do rồi thoát với exit code 1.

Nhiều dòng thì truyền xuống dòng thật. Shell hay nuốt mất xuống dòng thành `\n` chữ, nên script tự đổi `\n` thành xuống dòng thật:

```bash
node <skill-dir>/scripts/notify.cjs 'Deploy xong app-ff\nCommit: a1b2c3d\nKhông có lỗi'
```

## LUÔN dùng nháy đơn

Đây là chỗ hay gãy nhất, và gãy im lặng — không báo lỗi gì cả.

Nháy kép để shell tự xử lý nội dung **trước khi** script nhìn thấy:

| Gõ trong nháy kép | Script nhận được |
|---|---|
| `"Giá: $250"` | `Giá: ` — mất sạch, vì shell hiểu `$250` là tham số vị trí 250 |
| `"Thư mục: $HOME"` | `Thư mục: /Users/jack` |
| `"Kết quả: $(whoami)"` | shell **chạy luôn lệnh đó** rồi mới đưa kết quả vào tin |

Nháy đơn thì shell không đụng gì, nội dung vào nguyên văn:

```bash
node <skill-dir>/scripts/notify.cjs 'Giá: $250 | Thư mục: $HOME | 100% xong'
```

Nội dung bắt đầu bằng `--` cũng phải để trong nháy đơn, nếu không script tưởng là tham số.

## Nội dung có dấu gạch chéo ngược

Script đổi `\n` thành xuống dòng, nên đường dẫn Windows hay regex sẽ bị ăn mất một khúc:

```
Gõ : C:\new\table\report.txt
Nhận: C:
      ew\table\report.txt
```

Thêm `--raw` để tắt phần đổi đó, giữ nguyên mọi dấu `\`:

```bash
node <skill-dir>/scripts/notify.cjs --raw 'Backup: C:\new\table\report.txt'
```

Đánh đổi: bật `--raw` thì `\n` không còn xuống dòng nữa, muốn nhiều dòng phải xuống dòng thật trong chuỗi.

## Quy trình

1. User nói rõ là muốn báo lên Lark
2. Soạn nội dung từ ngữ cảnh đang làm, giữ nguyên tên, link, mã commit, con số quan trọng
3. Chạy `notify.cjs` với nội dung đó
4. Chỉ báo "đã gửi" khi script thoát code 0. Script in lỗi thì nói thẳng là chưa gửi được, kèm lý do

## Lưu ý

- **Chỉ gửi khi user bảo gửi.** Đừng tự ý bắn noti sau khi làm xong việc gì đó, kể cả khi thấy hợp lý
- **Chỉ hỗ trợ text thuần.** Không có card, không ảnh, không file đính kèm, không mention. Đừng bịa ra tham số không tồn tại
- **Đừng in `NOTI_LARK_BOT` ra màn hình**, đừng nhắc lại trong câu trả lời, đừng commit vào repo. Ai cầm ID đó là bắn được vào group
- **Lark trả HTTP 200 kể cả khi từ chối** — lỗi nằm trong JSON ở field `code`. Script đã kiểm tra chỗ này, nên exit code 0 mới thật sự là đã vào group
- Giữ nội dung ngắn gọn, trừ khi user đưa sẵn câu chữ cụ thể
- **Độ dài thoải mái** — đo thực tế 150.000 ký tự vẫn gửi được, nên không cần cắt ngắn vì sợ quá giới hạn
- Emoji, khung kẻ `┌─┬─┐`, tiếng Việt có dấu, JSON, tab đều vào nguyên vẹn

## Tài nguyên

### scripts/notify.cjs
Script Node zero-dependency: đọc `NOTI_LARK_BOT`, ghép URL webhook, `POST` payload `msg_type: text`, timeout 15 giây, kiểm tra cả HTTP status lẫn `code` trong JSON trả về. Cờ `--raw` để giữ nguyên dấu `\`.
