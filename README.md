# AI Skills

Bộ sưu tập **Skills** dùng chung cho các AI coding agent (Claude Code, Codex CLI...).
Mỗi skill là một thư mục chứa file `SKILL.md` mô tả cách agent thực hiện một tác vụ cụ thể — agent chỉ nạp skill khi thực sự cần, nên cài nhiều cũng không nặng context.

Repo mở để ai cũng tải về dùng được. Cứ lấy nguyên bộ hoặc nhặt riêng skill mình cần.

## Danh sách Skills

### `git-commit-message`
> Generate standardized commit messages or PR title using Conventional Commits

Phân tích code changes (diff, files, summary), xác định intent chính, rồi sinh ra commit message chuẩn **Conventional Commits** (`<type>(scope): <description>`).
Ràng buộc: description tối đa 50 ký tự, thì hiện tại, lowercase, không dấu chấm cuối. Output đúng 1 message, không giải thích.

### `new-pr`
> Skill tự review code và tạo Pull Request mới

Gõ `/new-pr <branch>` để tạo PR từ nhánh hiện tại sang branch đích, nhưng phải qua **2 chốt chặn bắt buộc dừng**:

- **Chốt 1** — còn file chưa commit thì dừng, liệt kê ra và hỏi user (commit / stash / kệ), tuyệt đối không tự xử lý
- **Chốt 2** — tự review diff theo checklist 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW; dính HIGH hoặc MEDIUM là dừng để user quyết sửa trước hay ghi vào PR description

PR title theo Conventional Commits (tiếng Anh), description theo template tiếng Việt (Mục đích · Thay đổi chính · Ảnh hưởng · Cách test · Lưu ý).
Không tự commit / push / stash / sửa code — mọi thao tác ghi đều hỏi trước.

**Yêu cầu:** cài sẵn [`gh` CLI](https://cli.github.com/) và đã chạy `gh auth login`.
Skill kèm script precheck cho cả 2 hệ: `precheck.sh` (macOS/Linux) và `precheck.ps1` (Windows PowerShell) — chạy được native, không cần WSL hay Git Bash.

### `pull-request-review`
> Review Pull Request đã mở trên GitHub, feedback có severity

Đọc PR qua `gh` CLI (metadata + diff + comment cũ) rồi trả review theo 7 mục: tóm tắt chức năng cho người không đọc code · overview · file thay đổi · code quality · issues phân **High/Medium/Low** · test case đề xuất · nợ kỹ thuật.

Phần đáng giá nhất là bộ **hiệu chỉnh severity** — chống thói quen thổi phồng mức độ: bắt buộc trace tới nơi giá trị được tiêu thụ trước khi gán Medium+, không bump severity chỉ vì endpoint "nhạy cảm", phân biệt lệch status code với bypass thật. Kèm **pre-merge gate** ép kiểm đủ file thay đổi và verify import mới có tồn tại trên branch không.

Tự theo dõi **tech debt** theo từng repo (chỉ lưu Medium trở lên), đánh dấu `done` khi PR sau fix được issue cũ.

**Yêu cầu:** [`gh` CLI](https://cli.github.com/) đã `gh auth login`. Không tự post comment lên GitHub — in ra cho bạn duyệt trước, chỉ post khi bạn yêu cầu.
Tech debt lưu ngoài thư mục skill (`~/.claude/pr-review-tech-debt/`, đổi được qua env `PR_REVIEW_DEBT_DIR`) để không lẫn vào repo.

> Khác với `new-pr`: skill đó review **trước khi tạo** PR mới; skill này review PR **đã có** trên GitHub.

### `gen-html`
> Tạo report hoặc tài liệu bằng HTML theo template UI có sẵn

Dựng file report / tài liệu HTML **self-contained — 1 file duy nhất**, CSS + JS inline, không CDN, không framework. Mở bằng browser là chạy, gửi qua chat hay up static host đều được.

Template lo sẵn: sidebar có scroll-spy, progress bar theo scroll, hero + stat, card / callout / timeline / metric, copy-to-clipboard kèm toast, responsive 3 breakpoint, `@media print` để in ra PDF, skip-link + `aria-label` cho accessibility.
Phong cách **báo in trên giấy** (vintage editorial): nền giấy ngà có texture hạt, chữ serif Georgia, nhãn nhỏ sans, viền kẻ đôi. Tài liệu ngắn dưới 3 section thì tự bỏ sidebar.

**Yêu cầu:** không cần gì cả — thuần HTML/CSS/JS.

### `gen-images`
> Gen ảnh bằng AI — text-to-image và image-to-image qua Gemini hoặc OpenAI

Một script Node **zero-dependency** (dùng native `fetch`, không cài package nào) chạy được cả 2 chế độ:

- **text-to-image** — chỉ cần `--prompt`
- **image-to-image** — thêm `--image <path>` (lặp nhiều lần được) để edit ảnh hoặc ghép nhiều ảnh nguồn

Chỉnh được số lượng ảnh, tỉ lệ khung (`--aspect` cho Gemini / `--size` cho OpenAI), model, thư mục output. Có `--json` để agent parse kết quả. Tự retry khi dính 429/5xx, ảnh nào lỗi thì skip chứ không đánh rơi cả batch.

**Yêu cầu:** Node.js 18+ và API key đặt trong biến môi trường `GEMINI_API_SKILL` hoặc `OPENAI_API_SKILL` (hướng dẫn set cho macOS/Linux và Windows nằm trong `SKILL.md`).

### `gen-videos`
> Gen video bằng AI — text-to-video và image-to-video qua Google Veo

Tạo video từ mô tả bằng chữ, hoặc **làm ảnh tĩnh chuyển động** (đưa thêm đường dẫn ảnh vào là thành image-to-video).

Video render lâu, nên script submit job xong sẽ **tự poll mỗi 10s** cho tới khi xong rồi tải file MP4 về — không phải ngồi canh.
Chỉnh được model (`VEO_MODEL`) và tỉ lệ khung (`VEO_ASPECT_RATIO`: `16:9` hoặc `9:16`). Mặc định `veo-3.0-generate-001` có kèm audio; key/region nào chưa hỗ trợ Veo 3 thì hạ xuống `veo-2.0-generate-001` (không audio).

**Yêu cầu:** Node.js 18+, API key ở biến `GEMINI_API_SKILL` (dùng chung với `gen-images`), và phải chạy `npm install` trong thư mục `scripts/` của skill.
⚠️ Veo **chỉ chạy trên tài khoản Google AI Studio đã bật billing** — free tier không có video.

### `hub-shared`
> Upload file qua app hub và trả về link public trên CDN

Đẩy **1 file local** lên S3 bằng **presigned URL** của app hub, rồi in ra link public qua CloudFront — tiện để share file, host asset, hoặc gửi link cho người khác.

Máy chạy skill **không cầm key S3**: script gửi API key để xin một URL đã ký sẵn (`POST /api/s3/presign`), rồi `PUT` file thẳng lên S3 — file không đi qua server hub.

Script Node **zero-dependency** — không thư viện ngoài, không `npm install`, file được stream thẳng từ ổ cứng nên file lớn không ngốn RAM.
Token đọc từ biến đã `export` ở shell trước, không có thì mới lấy từ `.env` ở thư mục hiện tại.

Giới hạn **5GB** mỗi file (trần của 1 lần `PUT` lên S3, script kiểm tra trước khi gửi). Link là public, và mặc định mỗi lần upload ra một link riêng — muốn **cập nhật nội dung mà giữ nguyên link** thì truyền thêm key của file cũ.

**Yêu cầu:** Node.js 20+ (dùng `process.loadEnvFile`) và biến `HUB_SKILL_TOKEN`.

### `product-customize`
> Phân tích xem một sản phẩm cho khách custom những gì

Đưa vào **product ID** (hoặc link sản phẩm) → trả về khách được điền gì: nhập tên gì, giới hạn bao nhiêu ký tự, chọn hình gì, upload mấy ảnh, field nào chỉ hiện khi chọn cái khác.

Dữ liệu đọc qua app hub, bên dưới là 3 nhà cung cấp customizer (**Customall** · **Teeinblue** · **Customily**). Mỗi bên trả một kiểu bẩn khác nhau — selector trùng lặp, field chỉ là đường kẻ, loại field không nhận dạng được, điều kiện trỏ ID thô. Script **làm sạch hết** rồi in bảng text đọc là hiểu, kèm mục ghi chú liệt kê đúng những gì đã dọn.

Script Node **zero-dependency**. Có `--json` để lấy dữ liệu đã làm sạch, `--raw` để soi bản gốc khi nghi ngờ.

**Yêu cầu:** Node.js 20+ và biến `HUB_SKILL_TOKEN`. Chỉ đọc được sản phẩm thuộc store của công ty.

### `noti-lark`
> Bắn thông báo text lên group Lark

Gửi một đoạn text vào group Lark đã gắn custom bot — tiện để báo deploy xong, job chạy lỗi, hay kết quả một việc vừa làm.

Chỉ cần **ID của bot**, script tự ghép thành URL webhook. Dán nguyên URL vào biến cũng chạy.

Script Node **zero-dependency**, dùng `fetch` có sẵn. Lark trả HTTP 200 kể cả khi từ chối, lỗi nằm trong JSON — script kiểm tra cả hai nên exit code 0 mới thật sự là tin đã vào group.

**Yêu cầu:** Node.js 20+ và biến `NOTI_LARK_BOT`.

## Cấu trúc

```
skills/
└── <ten-skill>/
    ├── SKILL.md          # frontmatter (name, description) + hướng dẫn chi tiết
    └── scripts/          # (tuỳ chọn) script hỗ trợ — bash / powershell / node / python
```

Skill nào cần script thì đặt luôn trong thư mục skill đó. Nếu skill có chạy script shell, nên kèm cả bản `.sh` lẫn `.ps1` để user Windows dùng được — xem `new-pr` làm mẫu.

## Cài đặt

### Bước 1 — Tải code về

Chọn 1 trong 3 cách:

**Cách 1 — Tải lẻ đúng skill mình cần (nhẹ nhất)**

Mỗi skill có file `.zip` riêng, giải nén ra là được thư mục đúng tên skill, bỏ thẳng vào thư mục ở Bước 2.

| Skill | Tải về |
|---|---|
| `git-commit-message` | [git-commit-message.zip](https://github.com/everlastify/ai-skills/releases/latest/download/git-commit-message.zip) |
| `new-pr` | [new-pr.zip](https://github.com/everlastify/ai-skills/releases/latest/download/new-pr.zip) |
| `pull-request-review` | [pull-request-review.zip](https://github.com/everlastify/ai-skills/releases/latest/download/pull-request-review.zip) |
| `gen-html` | [gen-html.zip](https://github.com/everlastify/ai-skills/releases/latest/download/gen-html.zip) |
| `gen-images` | [gen-images.zip](https://github.com/everlastify/ai-skills/releases/latest/download/gen-images.zip) |
| `gen-videos` | [gen-videos.zip](https://github.com/everlastify/ai-skills/releases/latest/download/gen-videos.zip) |
| `hub-shared` | [hub-shared.zip](https://github.com/everlastify/ai-skills/releases/latest/download/hub-shared.zip) |
| `product-customize` | [product-customize.zip](https://github.com/everlastify/ai-skills/releases/latest/download/product-customize.zip) |
| `noti-lark` | [noti-lark.zip](https://github.com/everlastify/ai-skills/releases/latest/download/noti-lark.zip) |

Xem tất cả ở trang [Releases](https://github.com/everlastify/ai-skills/releases/latest). Zip được build lại tự động mỗi khi skill thay đổi, nên link luôn trỏ bản mới nhất.

**Cách 2 — Tải cả bộ, không cần biết lệnh**

Mở https://github.com/everlastify/ai-skills → bấm nút xanh **Code** → **Download ZIP** → giải nén file vừa tải.

**Cách 3 — Clone (nếu máy đã có git)**

```bash
git clone https://github.com/everlastify/ai-skills.git
```

Với cách 2 và 3, bên trong sẽ có thư mục `skills/` — mỗi thư mục con là một skill.

### Bước 2 — Mở thư mục skill của agent

Đây là nơi agent tìm skill. Cài vào đây thì dùng được ở **mọi project**.

**Đường dẫn theo từng agent / hệ điều hành:**

| Agent | macOS / Linux | Windows |
|---|---|---|
| Claude Code | `~/.claude/skills` | `%USERPROFILE%\.claude\skills` |
| Codex CLI | `~/.codex/skills` | `%USERPROFILE%\.codex\skills` |

**Mở thư mục đó bằng giao diện, khỏi gõ lệnh:**

- **macOS:** mở **Finder** → bấm `Cmd + Shift + G` → dán đường dẫn ở bảng trên (ví dụ `~/.claude/skills`) → Enter.
  *Thư mục bắt đầu bằng dấu chấm bị ẩn mặc định — muốn nhìn thấy thì bấm `Cmd + Shift + .`*
- **Windows:** mở **File Explorer** → dán đường dẫn vào thanh địa chỉ trên cùng (ví dụ `%USERPROFILE%\.claude\skills`) → Enter.

Nếu chưa có thư mục `skills` thì tự tạo một thư mục mới, đặt đúng tên `skills`.

### Bước 3 — Copy skill vào

Copy **nguyên thư mục skill** từ `skills/` trong repo vừa tải, paste vào thư mục vừa mở ở Bước 2.

> ⚠️ Copy cả folder (ví dụ nguyên folder `git-commit-message`), **không** chỉ copy riêng file `SKILL.md` bên trong.

Kết quả đúng sẽ trông như này:

```
~/.claude/skills/
└── git-commit-message/
    └── SKILL.md
```

Muốn cài hết thì copy tất cả thư mục con trong `skills/`. Muốn cài lẻ thì chỉ copy folder mình cần.

### Bước 4 — Khởi động lại agent

Tắt Claude Code / Codex rồi mở lại. Skill chỉ được nạp lúc khởi động, session đang mở sẽ không thấy skill mới.

---

### Dành cho bạn nào rành terminal (hoặc nhờ AI tự cài)

Copy nguyên block dưới đây chạy thẳng, hoặc dán cho AI agent bảo nó cài giúp:

**macOS / Linux**

```bash
# Claude Code
mkdir -p ~/.claude/skills && cp -r skills/* ~/.claude/skills/

# Codex CLI
mkdir -p ~/.codex/skills && cp -r skills/* ~/.codex/skills/
```

**Windows (PowerShell)**

```powershell
# Claude Code
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills"
Copy-Item -Recurse -Force .\skills\* "$env:USERPROFILE\.claude\skills\"

# Codex CLI
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force .\skills\* "$env:USERPROFILE\.codex\skills\"
```

Cài lẻ 1 skill: đổi `skills/*` thành `skills/git-commit-message`.

### Lưu ý

- Chỉ muốn dùng skill trong 1 project cụ thể (không phải toàn máy): đặt vào `.claude/skills/` hoặc `.codex/skills/` ngay trong thư mục project đó.
- Skill nào cần thư viện (Node / Python) thì vào thư mục skill đó tự cài: `npm install` hoặc `pip install -r requirements.txt`. Repo cố tình **không** kèm sẵn `node_modules/`, `.venv/` để giữ cho nhẹ.

## Cách thêm skill mới

1. Tạo thư mục `skills/<ten-skill>/`
2. Viết `SKILL.md` với frontmatter:
   ```yaml
   ---
   name: ten-skill
   description: Mô tả ngắn gọn — dùng để agent quyết định khi nào gọi skill này
   ---
   ```
3. Bổ sung skill đó vào mục **Danh sách Skills** ở trên
4. Commit theo chuẩn Conventional Commits (dùng chính skill `git-commit-message` 🙂)
