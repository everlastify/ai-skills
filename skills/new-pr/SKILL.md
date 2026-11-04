---
name: new-pr
description: Skill tự review code và tạo Pull Request mới. Dùng khi user gõ "/new-pr <branch>", "tạo PR", "mở PR sang <branch>".
---

# new-pr

Tạo PR từ **nhánh hiện tại** → **`<branch>`** (base), sau khi chạy qua quy trình 4 bước với **2 chốt chặn bắt buộc dừng**.

Skill này **độc lập** — không gọi sang skill khác. Toàn bộ logic review nằm trong file này.

```
/new-pr <branch>
```

---

## BƯỚC 0 — Gom dữ kiện

Chạy script precheck nằm trong thư mục `scripts/` **cùng cấp với chính file `SKILL.md` này** — gọi thư mục đó là `<skill-dir>`:

- **macOS / Linux:** `bash <skill-dir>/scripts/precheck.sh <branch>`
- **Windows:** `powershell -ExecutionPolicy Bypass -File <skill-dir>\scripts\precheck.ps1 <branch>`

`<skill-dir>` = **thư mục chứa chính file `SKILL.md` này**.

Hai script trả **cùng một format output**, nên phần đọc kết quả bên dưới dùng chung.

Script chỉ **đọc và báo cáo**, không sửa gì. Đọc output theo các key:

- `STATUS=ERROR` → dừng, báo `ERROR=` cho user
- `PR_EXISTS=yes` → **DỪNG**, đưa link PR đang có, hỏi user có muốn cập nhật PR đó thay vì tạo mới không
- `BASE_EXISTS_REMOTE=no` → cảnh báo base branch không có trên remote
- `HAS_UPSTREAM=no` hoặc `UNPUSHED_COMMITS>0` → **HỎI user** có `git push` không (gh cần remote branch mới tạo được PR). **Không tự push.**

---

## BƯỚC 1 — CHỐT CHẶN 1: file chưa commit

Nếu `UNCOMMITTED=yes` → **DỪNG NGAY**, không làm gì tiếp.

Trình cho user:
- Danh sách file kèm nhãn (`untracked` / `modified (chưa stage)` / `staged` / `deleted`)
- Hỏi rõ 3 lựa chọn: **commit trước** · **stash** · **kệ, tạo PR với những gì đã push**

**Tuyệt đối không tự commit / stash / add.** Chờ user quyết.

---

## BƯỚC 2 — Review code

Lấy diff theo `DIFF_RANGE` mà script trả về (dùng **3 chấm** — chỉ lấy phần nhánh này thêm vào):

```bash
git diff <DIFF_RANGE>                    # toàn bộ
git diff <DIFF_RANGE> -- <file>          # từng file nếu diff lớn
```

Diff quá lớn → đọc theo file, ưu tiên file có nhiều thay đổi nhất theo `DIFFSTAT`.

### Checklist review — soi theo thứ tự ưu tiên

**🔴 HIGH — bắt buộc dừng:**
- Bug logic: điều kiện sai, off-by-one, so sánh nhầm `=`/`==`, đảo dấu, sai toán tử
- Security: SQL/command injection, hardcode credential/token, log ra secret, thiếu authz check
- Mất dữ liệu: `DELETE`/`UPDATE` thiếu `WHERE`, ghi đè file, migration không reversible
- Breaking change: đổi signature/response shape của API đang có consumer
- `null`/`undefined` không được xử lý ở đường đi chính

**🟡 MEDIUM — dừng để hỏi:**
- Edge case chưa xử lý: mảng rỗng, chia 0, timeout, response lỗi từ API ngoài
- Thiếu error handling — `await` trần không `try/catch`, promise không `.catch()`
- Rò rỉ tài nguyên: connection/file/listener không đóng
- Performance: query trong vòng lặp (N+1), thiếu index, load toàn bộ vào memory
- Race condition, thao tác không idempotent
- Vi phạm rule dự án (xem `CLAUDE.md` của repo): dùng `any` (TS) / `dynamic` (C#), API trả model không tường minh

**🔵 LOW — KHÔNG dừng:**
- Naming, format, comment, code trùng lặp nhẹ, cấu trúc có thể gọn hơn
- → Ghi vào mục **Lưu ý** của PR description, vẫn tạo PR bình thường

---

## BƯỚC 3 — CHỐT CHẶN 2: xác nhận issue

Nếu có bất kỳ mục **HIGH** hoặc **MEDIUM** → **DỪNG**, trình cho user theo dạng danh sách, sắp xếp HIGH trước:

```
🔴 [HIGH] <file>:<line> — <vấn đề>
   Vì sao: <lý do cụ thể, không nói chung chung>
   Đề xuất: <cách sửa>

🟡 [MEDIUM] <file>:<line> — <vấn đề>
   Vì sao: ...
   Đề xuất: ...
```

Rồi hỏi: **sửa trước khi tạo PR**, hay **tạo PR luôn và ghi các vấn đề này vào description**?

**Không tự ý bỏ qua**, kể cả khi thấy nhỏ. Không tự sửa code — đó là request mới, phải trình plan riêng.

Chỉ có **LOW** → không dừng, đi thẳng bước 4.

---

## BƯỚC 4 — Tạo PR

### Title — **tiếng Anh**, Conventional Commits, ngắn gọn

```
<type>(<scope>): <mô tả ngắn>
```
`feat` · `fix` · `refactor` · `perf` · `docs` · `test` · `chore` · `style` · `build` · `ci`

- Dưới ~70 ký tự, không dấu chấm cuối, động từ nguyên thể (`add`, `fix`, `update`)
- Ví dụ: `feat(orders): add retry queue for Shopify tracking sync`

### Description — **tiếng Việt**, keyword kỹ thuật giữ tiếng Anh

Template:

```markdown
## Mục đích
<Giải quyết vấn đề gì / vì sao cần thay đổi này — 1-3 câu>

## Thay đổi chính
- <Thay đổi theo LOGIC, không theo từng dòng code>
- <Ví dụ: "Thêm retry với exponential backoff khi Shopify trả 5xx" — KHÔNG viết "sửa dòng 42 file x.js">

## Ảnh hưởng
- <Module/luồng nào bị tác động, có breaking change không, có cần migrate data không>

## Cách test
- <Các bước hoặc kịch bản để verify>

## Lưu ý
- <Điểm 🔵 phát hiện lúc review, hoặc issue user chấp nhận để lại>
```

Bỏ mục nào không có nội dung, đừng để trống.

### Lệnh tạo

```bash
gh pr create --base <branch> --head <nhánh hiện tại> \
  --title "<title>" --body "<description>"
```

Body dài → ghi ra file tạm rồi dùng `--body-file`.

Xong thì in **link PR** cho user.

---

## Nguyên tắc xuyên suốt

- **Không tự** commit / push / stash / sửa code / merge. Mọi thao tác ghi đều phải hỏi user trước (mục 4 CLAUDE.md).
- Dừng ở chốt nào thì **báo rõ đang dừng ở bước nào và vì sao**.
- Review dựa trên **diff thật đọc được**, không phỏng đoán. Không chắc thì nói không chắc.
- Description tập trung **logic và ý đồ**, không phải bản kê khai thay đổi từng dòng.
