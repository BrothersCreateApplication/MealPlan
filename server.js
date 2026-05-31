const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ---- Database: dùng Supabase (không SQLite) ----
const db = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helper ----
function normalizeDish(dish) {
  return {
    name: dish.name || 'Món ăn',
    time: dish.time ? String(dish.time).includes('ph') ? String(dish.time) : String(dish.time) + ' ph' : '',
    calories: dish.calories ? String(dish.calories).includes('kcal') ? String(dish.calories) : String(dish.calories) + ' kcal' : '',
    difficulty: dish.difficulty || '',
    description: dish.description || '',
    ingredients: Array.isArray(dish.ingredients) ? dish.ingredients.map(i => ({
      name: i.name || '',
      quantity: String(i.quantity || ''),
      price: i.price || 0
    })) : [],
    instructions: dish.instructions || ''
  };
}

// ---- Search dishes: DB trước, DeepSeek nếu món mới ----
app.post('/api/search-dishes', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ dishes: [] });

  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 0);

  // 1. Tìm trong Supabase trước
  let dishes = await db.searchDishes(words);

  // 2. Nếu không đủ (dưới 3 món), gọi DeepSeek
  if (dishes.length < 3) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: 'Bạn là chuyên gia ẩm thực Việt Nam. Trả lời JSON array. TUYỆT ĐỐI TUÂN THỦ: Mỗi món có: name, time (số phút), calories (số kcal), difficulty, description, ingredients (mảng {name, quantity}), instructions (các bước nấu cách nhau bằng \\n). QUY TẮC TÌM KIẾM: Người dùng search từ khóa. Ưu tiên món trùng phương pháp chế biến. LOẠI BỎ món dùng phương pháp khác. Trả về ĐÚNG 3-5 món.' },
              { role: 'user', content: `Tìm món: ${query}` }
            ],
            temperature: 0.7,
            max_tokens: 4000
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            const aiDishes = Array.isArray(parsed) ? parsed : [parsed];

            const normalized = aiDishes.map(normalizeDish);
            const saveResults = await db.addNewDishes(normalized);
            const inserted = saveResults.filter(r => r && r.action === 'inserted');
            if (inserted.length > 0) {
              console.log(`[DeepSeek] Saved ${inserted.length} new dishes to Supabase from search: "${query}"`);
            }

            dishes = await db.searchDishes(words);
            if (dishes.length < 3) {
              dishes = normalized;
            }
          }
        }
      } catch (e) {
        console.error('DeepSeek search error:', e.message);
      }
    }
  }

  // 3. Fallback
  if (dishes.length < 3) {
    dishes = await db.searchDishes(words);
    if (dishes.length < 3) {
      const all = await db.getAllDishes();
      dishes = all.filter(d => {
        if (!d.name) return false;
        const text = d.name.toLowerCase();
        return words.every(w => text.includes(w));
      });
    }
  }

  res.json({ dishes: dishes.slice(0, 5), fromCache: dishes.length > 0 });
});

// ---- Random dishes ----
app.post('/api/random-dishes', async (req, res) => {
  let dishes = await db.getRandomDishes(3);

  if (dishes.length >= 3) {
    return res.json({ dishes: dishes.slice(0, 3), fromCache: true });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'Bạn là chuyên gia ẩm thực Việt Nam. Trả lời JSON array. Mỗi món có: name, time (số phút), calories (số kcal), difficulty, description, ingredients (mảng {name, quantity}), instructions. Gợi ý 3 món ăn Việt Nam ngẫu nhiên, đa dạng.' },
            { role: 'user', content: 'Gợi ý 3 món ăn ngẫu nhiên cho hôm nay' }
          ],
          temperature: 0.8,
          max_tokens: 4000
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const aiDishes = Array.isArray(parsed) ? parsed : [parsed];

          const normalized = aiDishes.map(normalizeDish);
          const saveResults = await db.addNewDishes(normalized);
          const inserted = saveResults.filter(r => r && r.action === 'inserted');
          if (inserted.length > 0) {
            console.log(`[DeepSeek] Saved ${inserted.length} new dishes to Supabase from random`);
          }

          dishes = await db.getRandomDishes(3);
          if (dishes.length >= 3) {
            return res.json({ dishes: dishes.slice(0, 3), fromCache: true });
          }
          return res.json({ dishes: normalized.slice(0, 3), fromCache: false });
        }
      }
    } catch (e) {
      console.error('DeepSeek random error:', e.message);
    }
  }

  if (dishes.length === 0) {
    const all = await db.getAllDishes();
    dishes = all.slice(0, 3);
  }

  res.json({ dishes: dishes.slice(0, 3), fromCache: true });
});

// ---- DeepSeek API proxy ----
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return res.status(200).json({
      success: false,
      error: 'API key not configured',
      mock: true,
      data: getMockResponse(req.body.messages)
    });
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: req.body.messages || [],
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    res.json({ success: true, mock: false, data });
  } catch (err) {
    console.error('DeepSeek API error:', err.message);
    res.json({
      success: true,
      error: err.message,
      mock: true,
      data: getMockResponse(req.body.messages)
    });
  }
});

// ---- Unsplash image proxy ----
app.get('/api/dish-image', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.json({ url: null });

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!unsplashKey) return res.json({ url: null });

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent('vietnamese food ' + name)}&per_page=1&orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${unsplashKey}` } }
    );
    if (!response.ok) throw new Error(`Unsplash error: ${response.status}`);
    const data = await response.json();
    const url = data.results?.[0]?.urls?.regular || null;
    res.json({ url });
  } catch (err) {
    console.error('Unsplash error:', err.message);
    res.json({ url: null });
  }
});

// ===================== Dish Management API =====================

app.get('/api/dishes', async (req, res) => {
  const dishes = await db.getAllDishes();
  res.json({ dishes });
});

app.post('/api/dishes', async (req, res) => {
  const dish = req.body;
  if (!dish || !dish.name) {
    return res.status(400).json({ error: 'Missing dish name' });
  }
  const normalized = normalizeDish(dish);
  const result = await db.addDish(normalized);
  const saved = await db.getDishByName(dish.name);
  res.json({ success: true, action: result?.action || 'inserted', dish: saved });
});

app.delete('/api/dishes/:name', async (req, res) => {
  let name = req.params.name;
  try { name = decodeURIComponent(name); } catch (e) { /* keep */ }
  const deleted = await db.deleteDish(name);
  res.json({ success: deleted });
});

app.get('/api/dish-names', async (req, res) => {
  const all = await db.getAllDishes();
  const names = all.map(d => d.name);
  res.json({ names });
});

// ===================== Gợi ý món theo nguyên liệu (Tủ Lạnh) =====================

app.post('/api/suggest-by-ingredients', async (req, res) => {
  const { ingredients, forceAI } = req.body;
  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.json({ suggestions: [], fromCache: true });
  }

  // 1. Tìm trong DB trước (trừ khi forceAI)
  let suggestions = [];
  if (!forceAI) {
    suggestions = await db.suggestDishesByIngredients(ingredients);
  }

  // 2. Nếu forceAI hoặc không đủ gợi ý (dưới 3), gọi DeepSeek
  if (forceAI || suggestions.length < 3) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      try {
        const ingsStr = ingredients.join(', ');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: `Bạn là chuyên gia ẩm thực Việt Nam. Trả lời JSON array.
TUYỆT ĐỐI TUÂN THỦ format mỗi món:
{ "name": "tên món", "time": 30, "calories": 350, "difficulty": "Dễ", "description": "mô tả", "ingredients": [{ "name": "nguyên liệu", "quantity": "số lượng" }], "instructions": "bước 1\\nbước 2\\nbước 3" }

QUY TẮC:
- Người dùng có các nguyên liệu: ${ingsStr}
- Gợi ý 3-4 món có thể nấu từ các nguyên liệu này, chỉ cần mua thêm tối đa 1-2 gia vị/nguyên liệu phụ thông dụng.
- Ưu tiên món Việt Nam phổ biến trong mâm cơm hàng ngày.
- Mỗi món phải ghi ĐẦY ĐỦ nguyên liệu (kể cả cái đã có + cái cần mua thêm).
- time là số phút (number), calories là số kcal (number).` },
              { role: 'user', content: `Tôi có các nguyên liệu: ${ingsStr}. Gợi ý tôi nấu món gì?` }
            ],
            temperature: 0.7,
            max_tokens: 4000
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            const aiDishes = Array.isArray(parsed) ? parsed : [parsed];

            const normalized = aiDishes.map(normalizeDish);
            const saveResults = await db.addNewDishes(normalized);
            const inserted = saveResults.filter(r => r && r.action === 'inserted');
            if (inserted.length > 0) {
              console.log(`[DeepSeek] Saved ${inserted.length} new dishes from ingredient suggestion`);
            }

            const dbSuggestions = await db.suggestDishesByIngredients(ingredients);
            if (dbSuggestions.length >= 3) {
              return res.json({ suggestions: dbSuggestions, fromCache: true });
            }

            // Parse AI dishes to suggestion format
            const baseSeasonings = db.BASIC_SEASONINGS || [];
            const normalizedAvail = ingredients.map(i => db.removeAccents(i.toLowerCase().trim()));

            const aiSuggestions = normalized.map(aiDish => {
              const dishIngs = aiDish.ingredients || [];
              const results = dishIngs.map(ing => {
                const ingName = db.removeAccents(ing.name.toLowerCase().trim());
                const isAvailable = normalizedAvail.some(a =>
                  ingName.includes(a) || a.includes(ingName)
                );
                const isBasic = baseSeasonings.some(b =>
                  ingName.includes(db.removeAccents(b))
                );
                return { name: ing.name, quantity: ing.quantity, isAvailable, isBasic };
              });

              const matchedNonBasic = results.filter(r => r.isAvailable && !r.isBasic).length;
              const nonBasicTotal = results.filter(r => !r.isBasic).length;
              const missing = results.filter(r => !r.isAvailable && !r.isBasic);
              const matchPercent = nonBasicTotal > 0
                ? Math.round((matchedNonBasic / nonBasicTotal) * 100)
                : 100;

              return {
                dish: aiDish,
                matchPercent,
                matched: results.filter(r => r.isAvailable),
                missing,
                needsShopping: missing.length > 0
              };
            });

            aiSuggestions.sort((a, b) => b.matchPercent - a.matchPercent);
            return res.json({ suggestions: [...suggestions, ...aiSuggestions].slice(0, 5), fromCache: false });
          }
        }
      } catch (e) {
        console.error('DeepSeek suggestion error:', e.message);
      }
    }

    // Fallback: nếu forceAI mà DeepSeek không trả về gì, lấy từ DB
    if (forceAI && suggestions.length === 0) {
      suggestions = await db.suggestDishesByIngredients(ingredients);
    }
  }

  res.json({ suggestions: suggestions.slice(0, 5), fromCache: true });
});

// ---- Image analysis API (dùng Google Gemini Flash — free, hỗ trợ vision) ----
// DeepSeek không hỗ trợ vision/image_url, nên dùng Gemini làm vision backend
app.post('/api/analyze-image', async (req, res) => {
  const { image, mode } = req.body;
  if (!image) return res.json({ success: false, error: 'Missing image data' });

  const isFridge = mode === 'fridge';
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    // Fallback: nếu không có Gemini key, trả về hướng dẫn
    return res.json({
      success: false,
      error: 'Thiếu GEMINI_API_KEY. Lấy key free tại https://aistudio.google.com/apikei (không cần credit card)',
      needsApiKey: true
    });
  }

  try {
    const prompt = isFridge
      ? 'Phân tích ảnh chụp tủ lạnh này. Trả về JSON hợp lệ (không markdown, không code block) với format: { "ingredients": ["tên nguyên liệu 1", "tên nguyên liệu 2", ...] }. Liệt kê TẤT CẢ nguyên liệu thực phẩm nhìn thấy được (thịt, cá, rau, củ, quả, trứng, v.v.). Bỏ qua gia vị khô, chai lọ, đồ đóng hộp. Mỗi nguyên liệu viết hoa chữ cái đầu. Nếu không thấy nguyên liệu nào, trả về { "ingredients": [] }'
      : 'Phân tích ảnh món ăn này. Trả về JSON hợp lệ (không markdown, không code block) với format: { "name": "Tên món", "time": "thời gian nấu", "calories": "lượng calo", "difficulty": "Dễ/Trung bình/Khó", "description": "mô tả ngắn", "ingredients": [{ "name": "tên", "quantity": "số lượng", "price": 0 }], "instructions": "các bước nấu cách nhau bởi \\n" }. Nếu không nhận diện được món, hãy trả về món phổ biến nhất mà bạn nhìn thấy.';

    // Google Gemini API: base64 image trong nội dung gửi đi
    // Strip data:image/...;base64, prefix để lấy raw base64
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Gemini] HTTP ${response.status}: ${errText.slice(0, 200)}`);
      return res.json({
        success: false,
        error: `Gemini API lỗi (HTTP ${response.status}). Vui lòng kiểm tra GEMINI_API_KEY.`,
        fallback: true
      });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON từ response
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[1]); } catch (e2) {}
      }
    }

    if (isFridge) {
      if (parsed && Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0) {
        return res.json({ success: true, ingredients: parsed.ingredients });
      }
      return res.json({ success: false, error: 'Không nhận diện được nguyên liệu từ ảnh.' });
    }

    if (parsed && parsed.name) {
      return res.json({ success: true, data: parsed });
    }
    return res.json({ success: false, error: 'Không nhận diện được món ăn từ ảnh.' });
  } catch (err) {
    console.error('[Gemini] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ---- Serve SPA ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MealPlan server running at http://localhost:${PORT}`);
});

// ---- Mock responses ----
function getMockResponse(messages) {
  const lastUserMsg = messages?.filter(m => m.role === 'user').pop()?.content || '';

  if (lastUserMsg.toLowerCase().includes('thay thế') || lastUserMsg.includes('substitute')) {
    return {
      choices: [{
        message: {
          content: JSON.stringify([
            { original: 'Thịt nạm bò', substitute: 'Gầu bò', note: 'Gầu sẽ giòn hơn nhưng béo hơn 15%' },
            { original: 'Bánh phở tươi', substitute: 'Bánh phở khô', note: 'Dễ bảo quản hơn, cần ngâm nước 15p' }
          ])
        }
      }]
    };
  }

  if (lastUserMsg.toLowerCase().includes('phân tích') || lastUserMsg.includes('thói quen')) {
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            insight: 'Dựa trên thói quen của bạn, MealPlan đề xuất giảm 15% lượng thịt đỏ và tăng cường rau xanh vào tối Thứ Năm.',
            trend: '+12%',
            suggestion: 'Tăng cường rau xanh vào bữa tối'
          })
        }
      }]
    };
  }

  return {
    choices: [{
      message: {
        content: JSON.stringify([
          {
            name: 'Salad Cá Hồi Áp Chảo',
            time: '20 ph', calories: '450 kcal', difficulty: 'Dễ',
            description: 'Món salad tươi mát kết hợp cá hồi áp chảo giòn bên ngoài, mềm bên trong cùng rau xà lách và bơ.',
            ingredients: [
              { name: 'Cá hồi phi lê', quantity: '200g', price: 0 },
              { name: 'Xà lách', quantity: '100g', price: 0 },
              { name: 'Cà chua bi', quantity: '100g', price: 0 },
              { name: 'Bơ', quantity: '1 quả', price: 0 },
              { name: 'Sốt mè rang', quantity: '30ml', price: 0 }
            ],
            instructions: '1. Cá hồi rửa sạch, thấm khô, ướp muối tiêu 10 phút.\n2. Áp chảo cá hồi với dầu oliu mỗi mặt 3-4 phút lửa vừa.\n3. Xà lách rửa sạch, cà chua bổ đôi, bơ thái lát.\n4. Xếp rau ra đĩa, đặt cá hồi lên trên, rưới sốt mè rang.'
          },
          {
            name: 'Bò Xào Bông Cải Xanh',
            time: '15 ph', calories: '520 kcal', difficulty: 'Dễ',
            description: 'Thịt bò mềm ngọt kết hợp bông cải xanh giòn, thích hợp cho bữa tối nhanh gọn.',
            ingredients: [
              { name: 'Thịt bò thăn', quantity: '200g', price: 0 },
              { name: 'Bông cải xanh', quantity: '200g', price: 0 },
              { name: 'Ớt chuông', quantity: '1 quả', price: 0 },
              { name: 'Tỏi', quantity: '3 tép', price: 0 }
            ],
            instructions: '1. Thịt bò thái lát mỏng, ướp với dầu hào, tiêu 5 phút.\n2. Bông cải tách nhỏ, luộc sơ 2 phút.\n3. Phi tỏi thơm, xào bò lửa lớn 2 phút, cho bông cải vào đảo đều.\n4. Nêm nếm gia vị, tắt bếp, thêm ớt chuông thái sợi.'
          },
          {
            name: 'Canh Chua Cá Lóc',
            time: '30 ph', calories: '380 kcal', difficulty: 'Trung bình',
            description: 'Canh chua ngọt thanh với cá lóc tươi, đậu bắp và giá đỗ — món ăn dân dã khó cưỡng.',
            ingredients: [
              { name: 'Cá lóc', quantity: '300g', price: 0 },
              { name: 'Me', quantity: '50g', price: 0 },
              { name: 'Đậu bắp', quantity: '100g', price: 0 },
              { name: 'Giá đỗ', quantity: '100g', price: 0 }
            ],
            instructions: '1. Cá lóc làm sạch, cắt khúc, rửa với muối.\n2. Me ngâm nước ấm, bỏ hạt, lấy nước cốt.\n3. Nấu nước sôi, cho cá vào, hớt bọt.\n4. Thêm me, đậu bắp, giá đỗ, nêm nước mắm, đường.\n5. Tắt bếp, thêm rau thơm.'
          }
        ])
      }
    }]
  };
}

// Export for Vercel
module.exports = app;
