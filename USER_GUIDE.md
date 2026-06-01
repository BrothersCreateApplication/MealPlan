# 🥘 Vào Bếp — Hướng Dẫn Sử Dụng

> Ứng dụng gợi ý món ăn thông minh, phân tích sức khỏe và lên kế hoạch đi chợ

---

## 📱 Tổng Quan Giao Diện

```
┌──────────────────────────────────────┐
│  🥘  Vào Bếp                         │ ← Thanh header
├──────────────────────────────────────┤
│                                      │
│  🔍  Nhập món muốn nấu...  [📷][Lên] │ ← Thanh tìm kiếm + camera
│                                      │
│  ─── Gợi ý món ăn ───        [↻]    │
│                                      │
│  ┌──────────────────────────┐        │
│  │     🥗                    │        │ ← Card món ăn
│  │                          │        │
│  │  Salad Cá Hồi Áp Chảo   │        │
│  │  ⏱ 20 ph  🔥 450 kcal   │        │
│  │  Mô tả ngắn về món...    │        │
│  │  [📄 Xem Chi tiết]       │        │ ← 2 nút
│  └──────────────────────────┘        │
│                                      │
├──────────────────────────────────────┤
│ [🏠 Trang chủ] [🧊 Tủ lạnh] [🛒 Giỏ] [📊 Lịch sử] │ ← Nav bottom
└──────────────────────────────────────┘
```

### Thanh điều hướng dưới cùng (4 tab):

| Icon | Tab | Chức năng |
|------|-----|-----------|
| 🏠 | **Trang chủ** | Tìm kiếm món, gợi ý ngẫu nhiên |
| 🧊 | **Tủ lạnh** | Nhập nguyên liệu → gợi ý món nấu được |
| 🛒 | **Giỏ đi chợ** | Danh sách mua sắm, tính tiền |
| 📊 | **Lịch sử** | Thống kê thói quen, món yêu thích |

---

## 1️⃣ Trang Chủ — Tìm & Khám Phá Món Ăn

### Gợi ý ngẫu nhiên

```
┌──────────────────────────────────────┐
│  ─── Gợi ý món ăn ───        [↻ Xem thêm] │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │  🥩      │  │  🍗      │         │
│  │ Bò Xào   │  │ Gà Chiên │         │
│  │ 15p 480  │  │ 30p 580  │         │
│  │ [Chi tiết]│  │ [Chi tiết]│         │
│  └──────────┘  └──────────┘         │
│  ┌──────────┐  ┌──────────┐         │
│  │  🥣      │  │  🍲      │         │
│  │ Canh Chua│  │ Kho Tàu  │         │
│  │ 30p 380  │  │ 60p 520  │         │
│  │ [Chi tiết]│  │ [Chi tiết]│         │
│  └──────────┘  └──────────┘         │
└──────────────────────────────────────┘
```

- Khi vào trang: tự động tải **gợi ý món ngẫu nhiên**
- Bấm **[↻ Xem thêm]**: tải thêm món khác (không trùng)

### Tìm kiếm món ăn (AI)

```
┌──────────────────────────────────────┐
│  🔍  Nhập món muốn nấu...           │
│  ──── ví dụ: "kho quẹt", "gà" ────  │
└──────────────────────────────────────┘
```

1. Gõ tên món (VD: **"kho quẹt"**, **"gà chiên"**, **"canh chua"**)
2. Bấm **Enter** hoặc nút **[Lên lịch]**
3. Kết quả hiển thị:
   - ⚡ **Món từ DB**: hiện ngay lập tức
   - 🤖 **Món từ AI**: xuất hiện dần sau vài giây
4. Nếu không tìm thấy: thông báo "Không tìm thấy món" + gợi ý thử từ khóa khác

### Card món ăn

```
┌──────────────────────────────────┐
│         🥗 (emoji gradient)      │
│              ❤️ (yêu thích)       │
├──────────────────────────────────┤
│  Salad Cá Hồi Áp Chảo            │
│  ⏱ 20 ph  🔥 450 kcal  📊 Dễ   │
│  Mô tả ngắn về món ăn...         │
│  [📄 Xem Chi tiết]               │
└──────────────────────────────────┘
```

- **Emoji + gradient**: tự động hiển thị theo loại món (gà→🍗, cá→🐟, canh→🥣...)
- **❤️ Yêu thích**: bấm để lưu vào danh sách yêu thích
- **[📄 Xem Chi tiết]**: mở overlay công thức chi tiết

---

## 2️⃣ Xem Chi Tiết Món Ăn

```
┌──────────────────────────────────────┐
│              🥗                       │ ← Header emoji
│            [X]                        │ ← Đóng
├──────────────────────────────────────┤
│  Salad Cá Hồi Áp Chảo    [Dễ]        │
│  ⏱ 20 ph          🔥 450 kcal       │
│                                      │
│  Mô tả: Món salad tươi mát...        │
│                                      │
│  🛒 Nguyên liệu cần mua              │
│  ┌──────────────────────────┐        │
│  │ 🥩 Cá hồi phi lê   200g  │        │
│  │ 🥬 Xà lách          100g │        │
│  │ 🍅 Cà chua bi       100g │        │
│  │ 🥑 Bơ              1 quả │        │
│  └──────────────────────────┘        │
│                                      │
│  🩺 [Phân tích sức khỏe]          │ ← Nút phân tích sức khỏe
│  Đánh giá tác động lên tim, thận, gan│
│                                      │
│  📖 Cách nấu                          │
│  ┌──────────────────────────┐        │
│  │ ① Sơ chế nguyên liệu...  │        │
│  │ ② Phi thơm hành tỏi...   │        │
│  │ ③ Nấu lửa nhỏ 15 phút...│        │
│  │ ...                     │        │
│  └──────────────────────────┘        │
│                                      │
│  ▶️ Video hướng dẫn                  │
│  ┌──────────────────────────┐        │
│  │    YouTube video embed    │        │
│  └──────────────────────────┘        │
├──────────────────────────────────────┤
│  [🍳 Nấu Ăn]              [Đóng]    │ ← Sticky bottom
└──────────────────────────────────────┘
```

**Các nút chính:**
- **[🍳 Nấu Ăn]**: chuyển nguyên liệu vào Giỏ Đi Chợ + qua tab giỏ hàng
- **[🩺 Phân tích sức khỏe]**: mở cửa sổ phân tích tác động lên tim, thận, gan
- **▶️ Video**: tự động tìm video hướng dẫn từ YouTube

---

## 3️⃣ Phân Tích Sức Khỏe

```
┌──────────────────────────────────────┐
│  🩺 Phân tích sức khỏe              │
│  Salad Cá Hồi Áp Chảo               │
│                              [X]     │
├──────────────────────────────────────┤
│                                      │
│  📊 Chỉ số dinh dưỡng ước tính       │
│  ┌────┬────┬────┬────┬────┐         │
│  │350 │25g │30g │15g │650 │         │
│  │Cal │Pro │Carb│Béo │Na  │         │
│  └────┴────┴────┴────┴────┘         │
│                                      │
│  ┌──────────────────────────┐ 🟢    │
│  │ ❤️ Tim mạch     [Tốt]   │        │
│  │ Tốt cho tim mạch         │        │
│  │ 💡 Lời khuyên dinh dưỡng │        │
│  └──────────────────────────┘        │
│                                      │
│  ┌──────────────────────────┐ 🟡    │
│  🫛 Thận         [Trung bình]│       │
│  │ Cần chú ý lượng đạm      │        │
│  │ 💡 Uống đủ nước...       │        │
│  └──────────────────────────┘        │
│                                      │
│  ┌──────────────────────────┐ 🟢    │
│  🫁 Gan            [Tốt]   │        │
│  │ Ít chất béo không lành   │        │
│  │ 💡 Tăng cường rau xanh   │        │
│  └──────────────────────────┘        │
│                                      │
│  ┌──────────────────────────┐        │
│  │ 📝 Đánh giá tổng quan    │        │
│  │ Món ăn này có giá trị... │        │
│  └──────────────────────────┘        │
├──────────────────────────────────────┤
│  [🍳 Nấu Ăn]              [Đóng]    │ ← Nấu luôn sau khi xem
└──────────────────────────────────────┘
```

### Mức độ đánh giá:

| Màu | Mức | Ý nghĩa |
|-----|-----|---------|
| 🟢 **Xanh** | Tốt (Positive) | Lành mạnh, tốt cho cơ quan này |
| 🟡 **Vàng** | Trung bình (Warning) | Cần chú ý, không nên ăn quá nhiều |
| 🔴 **Đỏ** | Cao (Danger) | Nên hạn chế, có hại nếu ăn thường xuyên |

### 3 cơ quan được phân tích:

| Cơ quan | Phân tích dựa trên | Tác hại nếu cao |
|---------|-------------------|-----------------|
| ❤️ **Tim mạch** | Natri, chất béo bão hòa | Tăng huyết áp, cholesterol |
| 🫛 **Thận** | Protein, natri, kali | Áp lực lên thận, khó đào thải |
| 🫁 **Gan** | Đường, chất béo không lành mạnh | Gan nhiễm mỡ, quá tải |

---

## 4️⃣ Tủ Lạnh — Nấu Theo Nguyên Liệu Có Sẵn

```
┌──────────────────────────────────────┐
│  🧊 Tủ Lạnh Có Gì?                   │
│  Nhập nguyên liệu, tôi gợi ý món!   │
│                                      │
│  💡 Nguyên liệu đang có               │
│  ┌──────────────────────────┐        │
│  │ [Thịt bò ✕] [Trứng ✕]    │        │
│  │ [Cà chua ✕] [Hành tây ✕] │        │
│  └──────────────────────────┘        │
│                                      │
│  [VD: thịt bò, trứng...] [➕Thêm] [📷]│
│                                      │
│  Chọn nhanh:                         │
│  [Thịt bò] [Gà] [Trứng] [Cá]...      │
│                                      │
│  [✨ Gợi ý món ăn]              │
├──────────────────────────────────────┤
│  💡 Gợi ý cho tủ lạnh của bạn        │
│  Tìm thấy 3 món phù hợp              │
│                                      │
│  ┌──────────────────────────┐  80%  │
│  │ Bò Xào Súp Lơ            │  phù  │
│  │ ⏱ 15p 🔥 480 📊 Dễ      │  hợp  │
│  │ ✅ Thịt bò ✅ Tỏi        │       │
│  │ 🛒 Cần mua: Súp lơ (200g)│       │
│  │ [📄 Xem công thức] [🍳]  │       │
│  └──────────────────────────┘       │
│                                      │
│  [↻ Xem thêm gợi ý]                 │
└──────────────────────────────────────┘
```

**Cách dùng:**
1. Nhập nguyên liệu bạn đang có (hoặc chọn nhanh)
2. Bấm **[✨ Gợi ý món ăn]**
3. Hệ thống tìm món phù hợp nhất:
   - 🟢 **Match cao** (≥80%): gần như đủ nguyên liệu
   - 🟡 **Match TB** (50-79%): cần mua thêm vài món
   - ⚪ **Match thấp**: cần nhiều nguyên liệu hơn
4. Mỗi gợi ý hiển thị:
   - **% phù hợp** (vòng tròn)
   - ✅ Nguyên liệu đã có
   - 🛒 Nguyên liệu cần mua thêm
   - Nút **[📄 Xem công thức]** + **[🍳 Nấu]**

---

## 5️⃣ Giỏ Đi Chợ

```
┌──────────────────────────────────────┐
│  🛒 Giỏ Đi Chợ                       │
│                                      │
│  ● Cần mua: 5   ● Đã có: 2          │
│                                      │
│  ┌──────────────────────────┐        │
│  │ ☐ Thịt bò     200g  50k │        │ ← Chưa có
│  │ ☑ Súp lơ      200g  15k │        │ ← Đã có (gạch ngang)
│  │ ☐ Cà rốt      1 củ   5k │        │
│  │ ☐ ...                    │        │
│  └──────────────────────────┘        │
│                                      │
│  ┌ Tổng quan đơn hàng ──────┐        │
│  │ Tiền hàng        70,000đ │        │
│  │ Tiết kiệm       -15,000đ │        │
│  │ Tổng cộng   55,000đ     │        │
│  ├──────────────────────────┤        │
│  │ [✅ Hoàn tất]  [🗑 Huỷ]  │        │
│  └──────────────────────────┘        │
└──────────────────────────────────────┘
```

**Thao tác:**
- **Bấm vào item**: chuyển trạng thái "Cần mua" ↔ "Đã có" (gạch ngang)
- **Bấm giá**: chỉnh sửa giá tiền
- **Nút [✅ Hoàn tất]**: lưu vào lịch sử, thông báo thành công
- **Nút [🗑 Huỷ]**: xoá sạch giỏ hàng

---

## 6️⃣ Lịch Sử & Thói Quen

```
┌──────────────────────────────────────┐
│  📊 Lịch Sử & Thói Quen              │
│  Theo dõi hành trình nấu nướng       │
│                                      │
│  ┌─── AI Insights ──────────────┐    │
│  │ ✨ Phân tích thói quen        │    │
│  │ Dựa trên lịch sử, bạn nên... │    │
│  └──────────────────────────────┘    │
│                                      │
│  ─── Thói quen ăn uống ────────     │
│  ┌──────────────────────────┐        │
│  │  📊 Biểu đồ cột           │        │
│  │  ██                        │        │
│  │  ████                      │        │
│  │  ██████  ██  ████  ███    │        │
│  │  T1   T2   T3   T4   T5   │        │
│  └──────────────────────────┘        │
│                                      │
│  ─── Sản phẩm mua nhiều nhất ────    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ 🥚  │ │ 🥬  │ │ 🍗  │ │ 🍚  │   │
│  │Trứng│ │Cải  │ │Ức gà│ │Gạo  │   │
│  └─────┘ └─────┘ └─────┘ └─────┘   │
│                                      │
│  ─── Lịch sử nấu ăn ──────────      │
│  🔍 Tìm tên món... [📅] [📅] [🔍]   │
│                                      │
│  🍳 Cơm tấm             15/05/2026  │
│  🍜 Phở bò              14/05/2026  │
│  🥗 Salad              13/05/2026  │
│  [↻ Tải thêm lịch sử]               │
│                                      │
│  ─── Món ăn yêu thích ⭐ ────       │
│  ┌──────────┐  ┌──────────┐         │
│  │  🍜      │  │  🥘      │         │
│  │  Phở bò  │  │ Kho tàu  │         │
│  └──────────┘  └──────────┘         │
└──────────────────────────────────────┘
```

**Các chức năng:**
- **AI Insights**: phân tích thói quen ăn uống
- **Biểu đồ cột**: thống kê chi tiêu theo tuần
- **Sản phẩm mua nhiều**: top nguyên liệu hay mua
- **Lịch sử nấu ăn**: filter theo tên + ngày tháng
- **⭐ Yêu thích**: danh sách món đã tim

---

## 7️⃣ Chụp Ảnh Món Ăn / Tủ Lạnh

```
┌──────────────────────────────────────┐
│  📷 Chụp ảnh món ăn                  │
│  ┌──────────────────────────┐  [X]  │
│  │                          │        │
│  │    Camera preview        │        │
│  │                          │        │
│  │       📸 (bấm chụp)      │        │
│  └──────────────────────────┘        │
│  [↻ Chụp lại] [✅ Phân tích]        │
│  [📁 Tải ảnh lên]                    │
└──────────────────────────────────────┘
```

**Cách dùng:**
1. Bấm nút **[📷]** (trên thanh tìm kiếm hoặc trong Tủ Lạnh)
2. Chụp ảnh hoặc tải ảnh từ thư viện
3. AI nhận diện:
   - 📸 **Chụp món ăn**: tự động tìm tên món + công thức
   - 📸 **Chụp tủ lạnh**: nhận diện nguyên liệu, tự động gợi ý

---

## 🌈 Màu Sắc & Trạng Thái

| Màu | Ý nghĩa | Dùng ở đâu |
|-----|---------|-----------|
| 🟢 **Xanh lá** (#006c49) | Chính, thành công | Nút chính, header, match cao |
| 🟠 **Cam** (#9d4300) | Phụ, cảnh báo | Match TB, cảnh báo |
| 🔴 **Đỏ** (#ba1a1a) | Lỗi, nguy hiểm | Health danger, xoá |
| 🟡 **Vàng** | Chú ý | Health warning |
| ⚪ **Xám** | Vô hiệu, phụ | Mô tả, label, disabled |

---

## 📱 Các Luồng Chính (User Flows)

### Luồng 1: Khám phá món mới

```
Bắt đầu → Trang chủ → Xem gợi ý → Bấm Xem Chi tiết
                                    ↓
                            Đọc công thức → Xem video
                                    ↓
                            Bấm Nấu Ăn → Giỏ đi chợ
                                    ↓
                            Hoàn tất → Lịch sử
```

### Luồng 2: Nấu theo nguyên liệu có sẵn

```
Bắt đầu → Tủ Lạnh → Nhập nguyên liệu
                    ↓
            Gợi ý món ăn → Chọn món
                           ↓
                   Xem công thức → Nấu
```

### Luồng 3: Tìm món cụ thể

```
Bắt đầu → Gõ tên món (Enter)
         ↓
  DB hiện ngay → AI tìm thêm
         ↓
  Bấm Xem Chi tiết → Phân tích sức khỏe
                     ↓
             Nấu Ăn → Đi chợ
```

---

## ❓ Câu Hỏi Thường Gặp

**Q: Không tìm thấy món tôi muốn?**
→ Thử từ khóa khác (VD: "gà" thay vì "gà chiên nước mắm") hoặc dùng camera chụp món ăn.

**Q: Kết quả dinh dưỡng có chính xác không?**
→ Các chỉ số là ước tính từ AI dựa trên nguyên liệu, không phải số liệu phòng thí nghiệm.

**Q: Làm sao để xoá món khỏi yêu thích?**
→ Vào tab Lịch sử, kéo xuống "Món ăn yêu thích", bấm lại trái tim.

**Q: Dữ liệu của tôi được lưu ở đâu?**
→ Lịch sử nấu ăn và giỏ hàng được lưu trên máy bạn (localStorage). Dữ liệu món ăn được đồng bộ qua Supabase cloud.

---

*Hướng dẫn sử dụng app **Vào Bếp** — Phiên bản 1.0*
