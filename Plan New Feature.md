# AI Cooking App Architecture

## Core Concept

### Detail Page
- overview / khám phá món ăn
- hiển thị thông tin tổng quan
- giúp user quyết định có nấu hay không

### Cooking Mode
- execution mode
- follow từng bước khi đang nấu thật
- tối ưu cho mobile + ít thao tác

---

# User Flow

```text
Detail Page
    ↓
[🛒 Đi chợ] hoặc [🍳 Nấu ăn]

Nếu Đi chợ:
    ↓
Tab 🛒 Đi chợ
    ↓
✅ Hoàn thành mua
    ↓
Tab 🍳 Nấu ăn → Sẵn sàng nấu
    ↓
Bắt đầu nấu
    ↓
Cooking Mode
    ↓
✅ Hoàn thành món ăn
    ↓
Section ✅ Đã nấu

Nếu đã có nguyên liệu:
    ↓
🍳 Nấu ăn
    ↓
Cooking Mode
    ↓
✅ Đã nấu
```

---

# Bottom Tabs

```text
🏠 Home
🔍 Search
🛒 Đi chợ
🍳 Nấu ăn
👤 Profile
```

---

# Tab 🛒 Đi chợ

## Mục đích
Chứa các recipe chưa mua đủ nguyên liệu.

## Card Example

```text
🛒 Gà kho sả ớt
- thịt gà
- sả
- tỏi
```

Button:

```text
✅ Hoàn thành mua
```

Sau khi complete:
- move sang tab 🍳 Nấu ăn
- section “Sẵn sàng nấu”

---

# Tab 🍳 Nấu ăn

## Section 1 — Sẵn sàng nấu

Hiển thị:
- đã đủ nguyên liệu
- chưa bắt đầu cooking session

Ví dụ:

```text
🍗 Gà kho sả ớt
✅ Đủ nguyên liệu
⏱ 35 phút
🔥 520 kcal

[ Bắt đầu nấu ]
```

---

## Section 2 — Đã nấu

History tracking:

```text
✅ Gà kho sả ớt
Hôm nay • 520 kcal

✅ Bò xào hành
Hôm qua • 430 kcal
```

---

# Detail Page

## Mục tiêu
- overview ngắn gọn
- clean UI
- không quá dài
- không hiển thị từng step nhỏ

## Hiển thị

```text
- ảnh món
- calories
- macros
- nguyên liệu đầy đủ
- summary steps
- nút Đi chợ
- nút Nấu ăn
```

---

# Summary Steps

Ví dụ:

```text
1. Ướp gà
2. Phi sả tỏi
3. Kho gà
4. Hoàn thành
```

Không show:
- substep
- step chi tiết
- execution details

---

# Cooking Mode

## Mục tiêu
Guided execution.

Không phải article page.

---

# Cooking Mode Layout

## Top Bar

```text
← Gà kho sả ớt
35 phút • 520 kcal
```

---

## Progress

```text
██████░░░░ 60%
Bước 3 / 5
```

---

## Current Step Card

```text
🍗 Kho gà

Cho thịt gà vào chảo.

Đảo đều khoảng 2 phút
để thịt săn lại.
```

---

## Dùng ở bước này

```text
✓ 500g thịt gà
✓ 1 muỗng nước màu
✓ 1/2 chén nước
```

Chỉ hiển thị ingredients liên quan current step.

---

## Tip Section

```text
💡 Không đảo liên tục để thịt mềm hơn.
```

---

## Timer

```text
⏱ 15:00
[Bắt đầu]
```

---

## Bottom Actions

```text
⬅ Quay lại      Tiếp theo ➜
```

---

## Bottom Utilities

```text
📋 Nguyên liệu
📖 Tất cả bước
🔊 Đọc lại
```

---

# Ingredient UX

## Current Step Ingredients

Trong main screen chỉ hiển thị:

```text
ingredients liên quan current step
```

Ví dụ:

```text
Dùng ở bước này:
- dầu ăn
- tỏi
- sả
```

---

## Full Ingredient Panel

Khi bấm:

```text
📋 Nguyên liệu
```

Mở bottom sheet:

```text
✓ Đã dùng
🔥 Đang dùng
○ Sắp dùng
```

Ví dụ:

```text
✓ Thịt gà
🔥 Sả
🔥 Tỏi
○ Ớt
○ Hành lá
```

---

# All Steps UX

Khi bấm:

```text
📖 Tất cả bước
```

Hiển thị:

```text
✓ B1. Ướp gà
✓ B2. Phi sả tỏi
🔥 B3. Kho gà
○ B4. Hoàn thành
```

---

# Text To Speech

## Version đầu
Không cần:
- realtime AI voice
- Whisper
- GPT realtime
- ElevenLabs

Chỉ cần:

```text
text-to-speech
```

Flow:

```text
User bấm Next
→ chuyển step
→ app đọc step hiện tại
```

## Tech Suggestion

Flutter:

```yaml
flutter_tts
```

Native:
- Android TextToSpeech
- iOS AVSpeechSynthesizer

---

# Architecture Quan Trọng

## KHÔNG parse realtime khi user bấm Nấu ăn

Sai:

```text
User bấm Nấu ăn
→ AI parse lại recipe
```

Rủi ro:
- lệch steps
- reorder
- hallucination
- inconsistent UX

---

# Cách đúng

## Parse MỘT LẦN khi import recipe

Pipeline:

```text
Raw Recipe
    ↓
AI preprocess ONCE
    ↓
summary_steps
Detailed_steps
ingredients_per_step
timers
tips
    ↓
Save DB
```

---

# Database Structure

## Recipe

```json
{
  "title": "Gà kho sả ớt",
  "ingredients": [],
  "summary_steps": [],
  "detailed_steps": []
}
```

---

# Detailed Steps

```json
[
  {
    "step": 1,
    "title": "Ướp gà",
    "instruction": [
      "Cho thịt gà vào tô",
      "Thêm nước mắm",
      "Trộn đều",
      "Ướp 15 phút"
    ],
    "ingredients": [
      "thịt gà",
      "nước mắm"
    ],
    "timer_seconds": 900,
    "tip": "Ướp lâu hơn sẽ đậm vị hơn"
  }
]
```

---

# Cooking Session

```json
{
  "recipe_id": 12,
  "current_step": 3,
  "completed_steps": [1,2],
  "status": "cooking"
}
```

---

# Cooking Mode Logic

## Next button

```text
current_step += 1
```

Sau đó:
- render step mới
- đọc TTS
- update progress
- update ingredient state

---

# UX Principles

## Detail Page

```text
information-heavy
```

---

## Cooking Page

```text
action-heavy
```

---

# Cooking Mode Requirements

✅ ít scroll  
✅ focus current step  
✅ one-hand usage  
✅ minimal UI  
✅ step-by-step  
✅ easy to follow  
✅ progress tracking  
✅ ingredient contextual  
✅ timer support  
✅ state-driven UI

---

# Không nên

❌ article dài  
❌ render full recipe liên tục  
❌ AI realtime phức tạp  
❌ parse realtime  
❌ full voice assistant ở phase đầu

---

# Nên

✅ guided cooking  
✅ deterministic steps  
✅ TTS đơn giản  
✅ cooking session state  
✅ current_step focus  
✅ bottom sheet ingredients  
✅ progress UI  
✅ next/back navigation

---

# Core Mindset

```text
Detail Page = planning mode
Cooking Mode = execution mode
```

Cooking Mode nên giống:

```text
navigation app
```

Không phải:

```text
recipe article
```
 