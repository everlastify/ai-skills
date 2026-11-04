---
name: product-customize
description: Phân tích xem một sản phẩm cho khách custom những gì — nhập tên gì, giới hạn bao nhiêu ký tự, chọn hình gì, upload mấy ảnh, điều kiện hiện/ẩn ra sao. Dùng khi user đưa product ID hoặc link sản phẩm và hỏi "sản phẩm này custom được gì", "soi option sản phẩm", "phân tích customize", "khách điền những gì".
---

# Product Customize

## Tổng quan

Skill đọc cấu hình customizer của một sản phẩm rồi mô tả lại **khách được custom những gì**.

Dữ liệu lấy từ `GET /api/product/{id}/customize` của app hub, bên dưới là 3 nhà cung cấp customizer: **Customall**, **Teeinblue**, **Customily**. Hub tự tìm store của product rồi hỏi lần lượt 3 provider — mình chỉ cần product ID.

Chỉ đọc được product thuộc **6 store của công ty** (WR US, WR UK, PAW US, PAW UK, PAWPET, FA).

## Chuẩn bị

Cần đúng **1 biến môi trường**:

- `HUB_SKILL_TOKEN` — API key của hub

Đọc theo thứ tự: biến đã **`export` ở shell thắng trước**, không có thì mới lấy từ `<thư-mục-hiện-tại>/.env`.

## Cách dùng

```bash
node <skill-dir>/scripts/customize.cjs <product-id>
```

`<skill-dir>` = **thư mục chứa chính file `SKILL.md` này**.

**Product ID là cách dùng chính.** Script cũng nhận link sản phẩm, lúc đó nó tự lấy ID qua endpoint `.js` của Shopify — chậm hơn một nhịp vì phải gọi thêm 1 request:

```bash
node <skill-dir>/scripts/customize.cjs 10033336877378
node <skill-dir>/scripts/customize.cjs https://pawsionate.com/products/pet-just-kidding-photo-personalized-custom-coffee-mug
```

Mặc định in ra bảng text đã làm sạch, đọc là hiểu ngay:

```
Product : 10033336877378
Store   : pd9bys-q6.myshopify.com
Provider: customily
Tong    : 1 selector, 6 field khach dien

== Cac field khach dien
 1. Choose The Title  [chon 1 trong nhieu]
      bat buoc
      Lua chon: Dad, Mom, Mum
 ...
 6. Type Dogs' Names  [go chu]
      bat buoc · toi da 45 ky tu · vi du "Charlie, Max & Cooper"
      Chi hien khi: Number Of Dogs = 3 Dogs
```

### Tham số

| Tham số | Ý nghĩa |
|---|---|
| `--json` | In JSON đã làm sạch thay vì bảng text — dùng khi cần xử lý tiếp bằng script |
| `--raw` | In nguyên bản API trả về, chưa làm sạch gì |
| `--full -o <file>` | Tải bản đầy đủ (`short=0`) **ghi ra file**. Bắt buộc có `-o`, script từ chối in bản đầy đủ ra màn hình |

## Quy trình

1. User đưa product ID (hoặc link) và hỏi sản phẩm custom được gì
2. Chạy `customize.cjs` với ID đó
3. Đọc output rồi **diễn giải thành câu cho user** — nhóm theo nhân vật / theo bước, nói rõ cái nào bắt buộc, giới hạn ký tự bao nhiêu, điều kiện nào mới hiện
4. Đọc luôn mục **Ghi chú** cuối output: đó là những chỗ script đã phải dọn, có thể là dấu hiệu dữ liệu gốc không chuẩn

## Đọc kết quả

| `kind` | Khách làm gì |
|---|---|
| `go chu` | Gõ chữ — thường kèm giới hạn ký tự và ví dụ |
| `chon 1 trong nhieu` | Chọn một lựa chọn (dropdown / swatch) |
| `chon hinh` | Chọn hình có sẵn (clipart) — màu da, kiểu tóc, trang phục… |
| `upload anh` | Khách tự tải ảnh lên |
| `khong ro` | Loại field API chưa hỗ trợ, có kèm `rawType` để đoán |

Vài khái niệm hay gặp:

- **Selector** — bộ chọn khung lớn, ví dụ *Number Of Kids* có 9 lựa chọn từ 0 đến 8. Customily không có khái niệm này nên chỉ có 1 nhóm field
- **lặp N lần** — field lặp theo số lượng người, ví dụ *Type Kid's Name* lặp 0-8 lần nghĩa là tối đa 8 đứa trẻ
- **Chỉ hiện khi** — field chỉ xuất hiện khi lựa chọn trước đó thoả điều kiện
- **version** — chỉ Customall có, là hash campaign, đổi khi campaign bị sửa

## Độ tin cậy dữ liệu theo provider

Kiểm chứng trên 6 sản phẩm thật (30/10/2026). Chất lượng khác nhau rõ rệt:

**Customily — sạch nhất.** Điều kiện viết bằng tên field và tên lựa chọn thật, đọc hiểu ngay. Tin được gần như hoàn toàn.

**Customall — tạm ổn, nhưng:**
- Hay lặp y hệt một field với 2 điều kiện khác nhau (*Man's Skin Tone* ×2). Script gộp lại
- Điều kiện thường trỏ ID thô kiểu `_v1gx7 = option-1`, không đọc ra nghĩa. Script bỏ, và báo số lượng đã bỏ ở mục Ghi chú
- Ô upload ảnh trả `kind: "unknown"`, `rawType: "Image/images"` — thực chất là upload ảnh, script đã đổi lại

**Teeinblue — bẩn nhất, cẩn thận khi kết luận:**
- Clipart chưa được hỗ trợ → nhiều field ra `unknown` kiểu `clipart-category`. Script đổi thành *chọn hình*, nhưng **không biết có bao nhiêu lựa chọn**. Đừng nói chắc số lượng
- Có sản phẩm trả nhiều selector giống nhau (gặp 1 cái trả 4 bản sao). Script gộp còn 1
- Có field chỉ là đường kẻ `"===================="` — script bỏ
- Điều kiện có thể rỗng kiểu `"Dad's Skin Tone =  |  | "` — script bỏ

**Nguyên tắc:** script chỉ dọn những kiểu bẩn đã biết. Gặp kết quả trông lạ thì chạy lại với `--raw` để xem bản gốc trước khi kết luận.

## Lưu ý

- **Luôn dùng bản rút gọn.** Bản đầy đủ nặng khủng khiếp — một sản phẩm custom cực nhiều (Acrylic Ornament) đo được **1.27MB**, gấp **278 lần** bản rút gọn, đủ để làm vỡ context. Sản phẩm như vậy hiếm, nhưng `--full` vẫn bắt buộc ghi ra file để không bao giờ dính
- **Product US và UK là 2 ID khác nhau.** Truyền ID nào thì đọc customizer của store đó. Có sản phẩm bản UK không có customizer dù bản US có → trả 404
- **Sản phẩm vừa tạo trên Shopify** mà Hasura chưa sync sẽ ra `404 Không tìm thấy product trong store của công ty`
- **Cả 3 provider đều không có dữ liệu** → 404 `PERSONALIZATION_NOT_FOUND`, nghĩa là sản phẩm này không cho custom

## Tài nguyên

### scripts/customize.cjs
Script Node zero-dependency. Nhận ID hoặc URL, gọi API, làm sạch dữ liệu thô (gộp selector trùng, bỏ divider, đổi `unknown` thành loại thật, gộp field lặp, bỏ điều kiện không đọc được) rồi in bảng text. Mọi thao tác dọn dẹp đều được liệt kê ở mục Ghi chú cuối output.
