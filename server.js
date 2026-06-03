const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ---- Database: dùng Supabase (không SQLite) ----
const db = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- In-memory cache cho dishes ----
let dishesCache = { data: null, time: 0 };
const CACHE_TTL = 60000; // 60 giây cache

async function getCachedDishes() {
  const now = Date.now();
  if (dishesCache.data && (now - dishesCache.time) < CACHE_TTL) {
    return dishesCache.data;
  }
  dishesCache.data = await db.getAllDishes();
  dishesCache.time = now;
  return dishesCache.data;
}

// ---- Helper: parse JSON safely ----
function tryParseJSON(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

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

  // 1. Lấy món chứa chính xác cụm từ từ DB (MIỄN PHÍ)
  const { exactMatch } = await db.searchDishes(q);
  let aiDishes = [];

  // 2. Chỉ gọi AI nếu DB chưa đủ 6 món
  if (exactMatch.length < 6) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: `JSON array. Mỗi món: name, time(số phút), calories(số kcal), difficulty, description, ingredients[{name,quantity}], instructions(\\n cách bước). Tìm món liên quan đến "${query}". Ưu tiên món có tên hoặc mô tả liên quan — linh hoạt, không cứng nhắc tên phải chứa chính xác. VD: tìm "kho quẹt" → trả "Kho Quẹt", "Rau Luộc Kho Quẹt", "Cơm Trắng Kho Quẹt". Tìm "rau" → trả các món rau. Trả 3-6 món (không ép nhiều nếu không đủ). Instructions: ngắn gọn, đủ bước.` },
              { role: 'user', content: `Tìm món: ${query}` }
            ],
            temperature: 0.7,
            max_tokens: 3000
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            const aiRaw = Array.isArray(parsed) ? parsed : [parsed];
            aiDishes = aiRaw.map(normalizeDish);

            // Lưu vào DB cho lần sau
            const saveResults = await db.addNewDishes(aiDishes);
            const inserted = saveResults.filter(r => r && r.action === 'inserted');
            if (inserted.length > 0) {
              console.log(`[DeepSeek] Saved ${inserted.length} new dishes to Supabase from search: "${query}"`);
            }
          }
        }
      } catch (e) {
        console.error('DeepSeek search error:', e.message);
      }
    }
  }

  // 3. Gộp DB + AI, loại trùng tên
  const seen = new Set();
  const merged = [];

  function addIfNew(dish) {
    if (!dish || !dish.name) return;
    const key = dish.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(dish);
  }

  // DB exact lên trước
  for (const d of exactMatch) addIfNew(d);
  // AI bổ sung sau
  for (const d of aiDishes) addIfNew(d);

  res.json({ dishes: merged.slice(0, 10), fromCache: exactMatch.length > 0 });
});

// ---- Search dishes STREAMING: SSE, DB trước, DeepSeek stream sau ----
app.get('/api/search-dishes-stream', async (req, res) => {
  const query = req.query.query;
  if (!query) return res.json({ dishes: [] });

  const q = query.trim().toLowerCase();

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 1. DB results immediately
  const { exactMatch } = await db.searchDishes(q);
  let seenNames = new Set(exactMatch.map(d => d.name.toLowerCase()));

  res.write(`data: ${JSON.stringify({ type: 'db', dishes: exactMatch })}\n\n`);

  // 2. Kiểm tra nếu đã đủ món thì không cần AI
  if (exactMatch.length >= 6) {
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  // 3. Báo hiệu AI bắt đầu
  res.write(`data: ${JSON.stringify({ type: 'ai_start' })}\n\n`);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const aiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: `JSON array. Mỗi món: name, time(số phút), calories(số kcal), difficulty, description, ingredients[{name,quantity}], instructions(\\n cách bước). Tìm món liên quan đến "${query}". Ưu tiên món có tên hoặc mô tả liên quan — linh hoạt, không cứng nhắc tên phải chứa chính xác. VD: tìm "kho quẹt" → trả "Kho Quẹt", "Rau Luộc Kho Quẹt", "Cơm Trắng Kho Quẹt". Tìm "rau" → trả các món rau. Trả 3-6 món (không ép nhiều nếu không đủ). Instructions: ngắn gọn, đủ bước.` },
          { role: 'user', content: `Tìm món: ${query}` }
        ],
        temperature: 0.7,
        max_tokens: 3000,
        stream: true
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => '');
      console.error(`[DeepSeek] Stream HTTP ${aiResponse.status}: ${errText.slice(0, 200)}`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // Stream DeepSeek response
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let accumulated = '';
    let allAiDishes = [];

    async function processChunk() {
      // Process SSE lines from DeepSeek
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.delta?.content || '';
            if (content) {
              accumulated += content;
            }
          } catch (e) {
            // Not a valid JSON line — skip
          }
        }
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      await processChunk();
    }

    // Xử lý buffer còn lại
    if (sseBuffer.trim()) {
      await processChunk();
    }

    // Parse complete accumulated JSON and send dishes
    try {
      // Strip markdown code blocks if present
      let clean = accumulated.trim();
      const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        clean = jsonMatch[1].trim();
      }

      const arr = JSON.parse(clean);
      if (Array.isArray(arr)) {
        for (const d of arr) {
          const normalized = normalizeDish(d);
          if (!normalized || !normalized.name) continue;
          const key = normalized.name.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            allAiDishes.push(normalized);
            res.write(`data: ${JSON.stringify({ type: 'ai', dish: normalized })}\n\n`);
          }
        }
        console.log(`[DeepSeek] Parsed ${arr.length} dishes from stream, sent ${allAiDishes.length} new`);
      }
    } catch (e) {
      console.error('[DeepSeek] Failed to parse accumulated JSON:', e.message);
      console.error('[DeepSeek] Accumulated text (first 500):', accumulated.slice(0, 500));
      // Log the raw accumulated without JSON parse
      console.error('[DeepSeek] Raw accumulated:', accumulated);
    }

    // Lưu AI dishes vào DB (fire-and-forget)
    if (allAiDishes.length > 0) {
      db.addNewDishes(allAiDishes).then(saveResults => {
        const inserted = saveResults.filter(r => r && r.action === 'inserted');
        if (inserted.length > 0) {
          console.log(`[DeepSeek] Saved ${inserted.length} new dishes to Supabase from stream: "${query}"`);
        }
      }).catch(e => console.error('[DeepSeek] Save stream dishes error:', e.message));
    }

    console.log(`[DeepSeek] Streamed ${allAiDishes.length} AI dishes for: "${query}"`);
  } catch (e) {
    console.error('DeepSeek stream error:', e.message);
  }

  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
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
            { role: 'system', content: 'JSON array. Mỗi món: name, time(số phút), calories(số kcal), difficulty, description, ingredients[{name, quantity}], instructions(\\n cách bước). Gợi ý 3 món Việt ngẫu nhiên. Instructions: 6-10 bước, lửa to/nhỏ, thời gian, mẹo.' },
            { role: 'user', content: 'Gợi ý 3 món ăn ngẫu nhiên cho hôm nay' }
          ],
          temperature: 0.8,
          max_tokens: 1500
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

// ---- YouTube search for cooking videos ----
app.get('/api/youtube-video', async (req, res) => {
  const { dish } = req.query;
  if (!dish) return res.json({ videoId: null });

  try {
    const ytSearch = require('yt-search');
    // Trích xuất từ khoá chính từ tên món (bỏ từ phụ)
    const dishLower = dish.toLowerCase();
    const stopWords = ['cách', 'làm', 'nấu', 'món', 'với', 'và', 'của', 'có', 'thịt', 'bằng'];
    const tokens = dishLower.split(' ').filter(t => t.length > 1 && !stopWords.includes(t));
    const coreTokens = tokens.slice(0, 3); // lấy tối đa 3 từ khoá chính

    // 1. Thử search chính xác tên món trước
    const exactQuery = `cách nấu ${dish} hướng dẫn`;
    let result = await ytSearch({ query: exactQuery, pageStart: 1, pageEnd: 1 });
    let videos = result?.videos || [];

    // 2. Nếu không đủ kết quả, search rộng hơn với từ khoá chính
    if (videos.length < 3 && coreTokens.length > 0) {
      const broadQuery = `cách nấu ${coreTokens.join(' ')}`;
      result = await ytSearch({ query: broadQuery, pageStart: 1, pageEnd: 1 });
      videos = [...videos, ...(result?.videos || [])];
    }

    // 3. Lọc video có title chứa ít nhất 1 từ khoá chính (không dấu)
    const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const filtered = videos.filter(v => {
      const title = normalize(v.title);
      const dishNorm = normalize(dishLower);
      // Ưu tiên title chứa chính xác tên món
      if (title.includes(dishNorm)) return true;
      // Hoặc chứa ít nhất 2 từ khoá chính
      const matchCount = coreTokens.filter(t => title.includes(t)).length;
      return matchCount >= Math.min(2, coreTokens.length);
    });

    // Ưu tiên video có từ "cách nấu", "cách làm", "hướng dẫn", "công thức"
    const findBest = filtered.find(v =>
      /cách (nấu|làm)|hướng dẫn|công thức/i.test(v.title)
    ) || filtered[0] || videos.find(v =>
      /cách (nấu|làm)|hướng dẫn|công thức|món/i.test(v.title)
    ) || videos[0];

    res.json({ videoId: findBest?.videoId || null, title: findBest?.title || '' });
  } catch (err) {
    console.error('[YouTube] Search error:', err.message);
    res.json({ videoId: null });
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

// ===================== Weather API (Open-Meteo, free, no key needed) =====================
app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.json({ success: false, error: 'Missing lat/lon' });
  }
  try {
    // Reverse geocode: lat/lon → city name (BigDataCloud, free, no key needed)
    let cityName = '';
    try {
      const bdcRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=vi`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (bdcRes.ok) {
        const bdcData = await bdcRes.json();
        const locality = bdcData.locality || '';
        // Tìm quận/huyện trong mảng informative
        let district = '';
        const informative = bdcData.localityInfo?.informative || [];
        for (const a of informative) {
          if (/^Quận\s/i.test(a.name) || /^Huyện\s/i.test(a.name)) {
            district = a.name;
            break;
          }
        }
        // Cũng check administrative nếu có
        const adminLevels = bdcData.localityInfo?.administrative || [];
        for (const a of adminLevels) {
          if (/^Quận\s/i.test(a.name) || /^Huyện\s/i.test(a.name)) {
            district = district || a.name;
          }
        }
        cityName = district || locality || bdcData.city || '';
        cityName = cityName.replace(/^(Quận|Huyện|Phường|Xã|Thị trấn|Thành phố|TP\.)\s+/i, '');
      }
    } catch (geoErr) {
      console.warn('[Weather] Geocode error:', geoErr.message);
    }
    // Fallback: nếu không lấy được từ BigDataCloud, thử từ tọa độ
    if (!cityName) {
      try {
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=vi`,
          { headers: { 'User-Agent': 'VaobepApp/1.0' }, signal: AbortSignal.timeout(3000) }
        );
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          const addr = nomData.address || {};
          cityName = addr.suburb || addr.quarter || addr.district || addr.town || addr.city || '';
          cityName = cityName.replace(/^(Phường|Xã|Thị trấn|Quận|Huyện|Thành phố|TP\.)\s+/i, '');
        }
      } catch (nomErr) {}
    }

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,precipitation&timezone=auto`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();
    const current = data.current || {};
    const code = current.weather_code ?? 0;

    // Map WMO weather codes to conditions
    let condition = 'unknown', icon = 'help';
    if (code === 0) { condition = 'clear'; icon = 'sunny'; }
    else if (code <= 3) { condition = 'cloudy'; icon = 'cloud'; }
    else if (code <= 48) { condition = 'foggy'; icon = 'foggy'; }
    else if (code <= 57) { condition = 'drizzly'; icon = 'rainy_light'; }
    else if (code <= 67) { condition = 'rainy'; icon = 'rainy'; }
    else if (code <= 77) { condition = 'snowy'; icon = 'snowy'; }
    else if (code <= 82) { condition = 'rainy'; icon = 'rainy'; }
    else if (code <= 86) { condition = 'snowy'; icon = 'snowy'; }
    else if (code <= 99) { condition = 'stormy'; icon = 'thunderstorm'; }

    const temp = current.temperature_2m ?? 25;
    // Determine hot/cold
    let tempLabel = 'moderate';
    if (temp >= 33) tempLabel = 'hot';
    else if (temp <= 18) tempLabel = 'cold';

    res.json({
      success: true,
      cityName,
      weather: {
        condition,
        icon,
        temp: Math.round(temp),
        apparentTemp: Math.round(current.apparent_temperature ?? temp),
        humidity: current.relative_humidity_2m,
        precipitation: current.precipitation ?? 0,
        tempLabel,
        code
      }
    });
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ===================== Dish Management API =====================

// ---- Gợi ý món theo buổi (AI chính, cache phụ) ----
const MEAL_PERIODS = { breakfast: 'sáng', lunch: 'trưa', dinner: 'tối', night: 'khuya' };

app.get('/api/dishes/meal/:period', async (req, res) => {
  const period = req.params.period;
  const mealName = MEAL_PERIODS[period];
  if (!mealName) return res.json({ dishes: [] });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  let dishes = [];

  // 1. Luôn gọi AI để có gợi ý tươi mới mỗi lần
  if (apiKey) {
    console.log(`[Meal] Calling DeepSeek for period=${period}, mealName=${mealName}`);
    try {
      // Random seed để AI không trả cùng kết quả
      const seed = Date.now() % 1000;
      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `Bạn là đầu bếp Việt Nam. Gợi ý món cho bữa ${mealName}.

Trả về JSON array. Mỗi món: name, time (số phút), calories (số kcal), difficulty, description, ingredients[{name,quantity}], instructions (dùng \\n giữa các bước, không xuống dòng thật).

QUY TẮC:
- Chỉ món phổ biến người Việt ăn bữa ${mealName}
- ${period === 'breakfast' ? 'Sáng: bánh mì, phở, bún, cháo, xôi, bánh cuốn, hủ tiếu, cơm tấm...' : period === 'lunch' ? 'Trưa: cơm + món mặn + canh, cơm tấm, bún thịt nướng, cơm chiên...' : period === 'dinner' ? 'Tối: canh, xào, kho, lẩu, nướng, hấp, cá, tôm, thịt...' : 'Khuya: đồ nhẹ như cháo, súp, salad, bánh...'}
- Trả 4 món, đa dạng, KHÔNG trùng lần trước (seed ${seed})`
            },
            { role: 'user', content: `Gợi ý 4 món ${mealName} Việt Nam cho ngày thứ ${dayOfYear}.` }
          ],
          temperature: 0.9,
          max_tokens: 3500
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          // DeepSeek hay trả JSON lỗi cú pháp → try/catch + clean
          try {
            let clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
            // Thử parse nguyên bản trước
            let parsed;
            try {
              parsed = JSON.parse(clean);
            } catch (e) {
              console.error(`[DeepSeek] Raw content (first 200):`, clean.slice(0, 200));
              console.error(`[DeepSeek] Raw content (last 200):`, clean.slice(-200));
              // Sửa JSON lỗi thường gặp: trailing comma, thiếu dấu đóng
              let fixed = clean
                .replace(/,\s*([}\]])/g, '$1'); // xoá trailing comma
              // Thử cắt bỏ phần lỗi cuối — giữ từ đầu đến ] cuối cùng
              try {
                parsed = JSON.parse(fixed);
              } catch (e2) {
                const idx = fixed.lastIndexOf(']');
                const idx2 = fixed.lastIndexOf('}');
                const cut = Math.max(idx, idx2);
                if (cut > 10) {
                  parsed = JSON.parse(fixed.slice(0, cut + 1));
                } else {
                  throw e;
                }
              }
            }
            const aiDishes = Array.isArray(parsed) ? parsed : [parsed];
            const normalized = aiDishes.map(normalizeDish).filter(d => d && d.name);

            // Lưu vào DB cho lần sau (fire-and-forget)
            db.addNewDishes(normalized).catch(() => {});

            console.log(`[Meal] AI returned ${normalized.length} dishes for ${period}: ${normalized.map(d => d.name).join(', ')}`);
            dishes = normalized;
          } catch (parseErr) {
            console.error(`[DeepSeek] JSON parse error for ${period}:`, parseErr.message);
            // Không set dishes → fallback
          }
        }
      }
    } catch (e) {
      console.error('[DeepSeek] Meal suggestion error:', e.message);
    }
  } else {
    console.log('[Meal] No DEEPSEEK_API_KEY, skipping AI');
  }

  // 2. Fallback: dishes phù hợp theo buổi (nếu AI fail)
  if (dishes.length === 0) {
    dishes = getMealFallbackDishes(period);
  }

  res.json({ dishes: dishes.slice(0, 10) });
});

app.get('/api/dishes', async (req, res) => {
  const dishes = await getCachedDishes();
  res.json({ dishes });
});

// Load 1 món + ingredients (gọi khi click Xem/Nấu)
app.get('/api/dishes/:name', async (req, res) => {
  let name = req.params.name;
  try { name = decodeURIComponent(name); } catch (e) { /* keep */ }
  const dish = await db.getDishByName(name);
  if (!dish) return res.status(404).json({ error: 'Not found' });
  res.json({ dish });
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
              { role: 'system', content: `JSON array. Mỗi món: name, time(số phút), calories(số kcal), difficulty, description, ingredients[{name,quantity}], instructions(\\n cách bước). Có nguyên liệu: ${ingsStr}. Gợi ý 3-4 món nấu được, chỉ thêm 1-2 gia vị. Ghi ĐẦY ĐỦ nguyên liệu. time, calories là number.` },
              { role: 'user', content: `Tôi có các nguyên liệu: ${ingsStr}. Gợi ý tôi nấu món gì?` }
            ],
            temperature: 0.7,
            max_tokens: 1500
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


// ---- Image analysis API (dùng Gemini Flash-Lite) ----
app.post('/api/analyze-image', async (req, res) => {
  const { image, mode } = req.body;
  if (!image) return res.json({ success: false, error: 'Missing image data' });

  const isFridge = mode === 'fridge';
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({
      success: false,
      error: 'Thiếu GEMINI_API_KEY. Xem hướng dẫn trong file .env.example',
      needsApiKey: true
    });
  }

  try {
    const prompt = isFridge
      ? 'Phân tích ảnh chụp tủ lạnh này. Trả về JSON hợp lệ (không markdown, không code block) với format: { "ingredients": ["tên nguyên liệu 1", "tên nguyên liệu 2", ...] }. Liệt kê TẤT CẢ nguyên liệu thực phẩm nhìn thấy được (thịt, cá, rau, củ, quả, trứng, v.v.). Bỏ qua gia vị khô, chai lọ, đồ đóng hộp. Mỗi nguyên liệu viết hoa chữ cái đầu. Nếu không thấy nguyên liệu nào, trả về { "ingredients": [] }'
      : 'Phân tích ảnh món ăn này. Trả về JSON hợp lệ (không markdown, không code block) với format: { "name": "Tên món", "time": "thời gian nấu (có đơn vị)", "calories": "lượng calo (có đơn vị)", "difficulty": "Dễ/Trung bình/Khó", "description": "mô tả ngắn", "ingredients": [{"name": "tên nguyên liệu", "quantity": "số lượng", "price": 0}], "instructions": "bước 1\\nbước 2\\nbước 3\\n..." }. Nếu không nhận diện được món, hãy trả về món ăn bất kỳ nhìn thấy trong ảnh.\n\nYÊU CẦU QUAN TRỌNG về instructions: hướng dẫn CHI TIẾT với 6-10 bước, mỗi bước ghi rõ lửa to/nhỏ, thời gian chính xác (phút), kiểm tra độ chín, kèm mẹo nhỏ và lưu ý ở cuối.';

    // Extract base64 data (remove data:image/...;base64, prefix)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4000
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Gemini Vision] HTTP ${response.status}: ${errText.slice(0, 200)}`);

      return res.json({
        success: false,
        error: `Lỗi Gemini API (${response.status}). ${errText.slice(0, 100)}`
      });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON từ response
    let parsed = null;
    try {
      // Loại bỏ markdown code block nếu có
      const clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
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
    return res.json({ success: false, error: 'Không nhận diện được món ăn từ ảnh.', raw: content });
  } catch (err) {
    console.error('[Gemini Vision] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ===================== Recommend By Body API (BMI/BMR + AI) =====================
app.post('/api/recommend-by-body', async (req, res) => {
  const { gender, age, weight, height, goal, bmi, bmr, tdee, calTarget, loadMore, skipCount } = req.body;
  if (!age || !weight || !height) {
    return res.json({ success: false, error: 'Missing body metrics' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (apiKey) {
    // Dùng AI đề xuất
    const systemPrompt = `Bạn là chuyên gia dinh dưỡng và đầu bếp. Dựa trên chỉ số cơ thể người dùng, hãy đề xuất các món ăn phù hợp.

Trả về JSON hợp lệ (không markdown, không code block) với format:
{
  "dishes": [
    {
      "name": "tên món",
      "time": "thời gian nấu (VD: 15 ph, 30 ph)",
      "calories": "số kcal (VD: 350 kcal)",
      "difficulty": "Dễ | Trung bình | Khó",
      "description": "mô tả ngắn (1 câu)",
      "ingredients": [
        { "name": "nguyên liệu", "quantity": "định lượng", "price": 0 }
      ],
      "instructions": "các bước nấu, mỗi bước 1 dòng, có số thứ tự"
    }
  ],
  "summary": "lời khuyên dinh dưỡng ngắn (1-2 câu)"
}

QUY TẮC:
- Mỗi món phải có đủ ingredients và instructions
- Đảm bảo tổng calories mỗi món phù hợp với calTarget cho 1 bữa (calTarget/3)
- Nếu mục tiêu giảm cân: ưu tiên món ít dầu mỡ, nhiều rau, protein nạc
- Nếu mục tiêu tăng cơ: ưu tiên món giàu protein, carb vừa phải
- Nếu mục tiêu tăng cân: ưu tiên món giàu calo, carb và chất béo lành mạnh
- Nếu giữ dáng: cân bằng dinh dưỡng
- Đề xuất 4-6 món đa dạng, không trùng lặp tên`;

    let userPrompt;
    if (loadMore) {
      userPrompt = `Người dùng: ${gender === 'male' ? 'Nam' : 'Nữ'}, ${age} tuổi, ${weight}kg, ${height}cm.
BMI: ${bmi}, BMR: ${bmr} kcal/ngày, TDEE: ${tdee} kcal/ngày.
Mục tiêu: ${goal === 'lose' ? 'Giảm cân' : goal === 'gain_muscle' || goal === 'gain' ? 'Tăng cơ' : goal === 'gain_weight' ? 'Tăng cân' : 'Giữ dáng'}.
Mỗi bữa nên nạp khoảng ${Math.round(calTarget / 3)} kcal.

Hãy đề xuất THÊM 3 món ăn Việt Nam KHÁC phù hợp với thể trạng và mục tiêu này. Không trùng với ${skipCount || 0} món đã đề xuất trước đó.`;
    } else {
      userPrompt = `Người dùng: ${gender === 'male' ? 'Nam' : 'Nữ'}, ${age} tuổi, ${weight}kg, ${height}cm.
BMI: ${bmi} (${bmi >= 25 ? 'thừa cân' : bmi >= 23 ? 'nguy cơ thừa cân' : bmi >= 18.5 ? 'bình thường' : 'gầy'})
BMR: ${bmr} kcal/ngày, TDEE: ${tdee} kcal/ngày.
Mục tiêu: ${goal === 'lose' ? 'Giảm cân' : goal === 'gain_muscle' || goal === 'gain' ? 'Tăng cơ' : goal === 'gain_weight' ? 'Tăng cân' : 'Giữ dáng'}.
Mỗi bữa nên nạp khoảng ${Math.round(calTarget / 3)} kcal.

Hãy đề xuất 5 món ăn Việt Nam phù hợp với thể trạng và mục tiêu này.`;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4,
          max_tokens: 4000
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;

      if (content) {
        let clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
        const result = JSON.parse(clean);
        if (result.dishes && result.dishes.length > 0) {
          // Thêm matchPercent dựa trên độ phù hợp calo
          const dishesWithScore = result.dishes.map(d => {
            const cal = parseInt((d.calories || '').replace(/[^0-9]/g, '')) || 0;
            const perMeal = Math.round(calTarget / 3);
            const diff = Math.abs(cal - perMeal);
            let matchPercent;
            if (diff < 50) matchPercent = 95;
            else if (diff < 100) matchPercent = 85;
            else if (diff < 200) matchPercent = 75;
            else matchPercent = 60;
            return { dish: d, matchPercent };
          });
          return res.json({ success: true, dishes: dishesWithScore, summary: result.summary || '' });
        }
      }
      throw new Error('Failed to parse AI response');
    } catch (err) {
      console.error('Body recommend AI error:', err.message);
      // Fallback xuống mock
    }
  }

  // ---- Mock fallback: lấy dishes từ DB và sắp xếp ----
  try {
    // Timeout 3s cho Supabase
    const dishes = await Promise.race([
      getCachedDishes(),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    let scored = [];

    if (dishes && dishes.length > 0) {
      const perMealTarget = Math.round(calTarget / 3);
      scored = dishes.map(d => {
        const cal = parseInt((d.calories || '').replace(/[^0-9]/g, '')) || 300;
        const diff = Math.abs(cal - perMealTarget);
        let matchPercent;
        if (diff < 50) matchPercent = 95;
        else if (diff < 100) matchPercent = 85;
        else if (diff < 200) matchPercent = 75;
        else if (diff < 300) matchPercent = 60;
        else matchPercent = 45;

        // Penalty cho món chiên nếu giảm cân, bonus cho protein nếu tăng cơ
        let penalty = 0;
        if (goal === 'lose') {
          const ingNames = (d.ingredients || []).map(i => (i.name || '').toLowerCase());
          if (ingNames.some(n => /chiên|rán|dầu|mỡ/.test(n))) penalty = 15;
        } else if (goal === 'gain_muscle' || goal === 'gain') {
          const ingNames = (d.ingredients || []).map(i => (i.name || '').toLowerCase());
          if (ingNames.some(n => /thịt|bò|gà|cá|tôm|trứng|đậu/.test(n))) matchPercent += 5;
        }

        return { dish: d, matchPercent: Math.min(99, matchPercent - penalty) };
      });

      // Sort by matchPercent descending, lấy top — có offset nếu loadMore
      scored.sort((a, b) => b.matchPercent - a.matchPercent);
      const offset = loadMore ? (skipCount || 0) : 0;
      const top = scored.slice(offset, offset + 5);

      // Nếu quá ít hoặc loadMore hết món, dùng sample
      if (top.length < 3) {
        if (loadMore) {
          // Không còn món từ DB, dùng sample mới
          const samples = getSampleBodyDishes(calTarget, goal).slice(0, 3);
          return res.json({ success: true, dishes: samples });
        }
        const samples = getSampleBodyDishes(calTarget, goal);
        return res.json({ success: true, dishes: samples });
      }

      return res.json({ success: true, dishes: top });
    } else {
      // Không có DB dishes — dùng sample
      const samples = getSampleBodyDishes(calTarget, goal);
      return res.json({ success: true, dishes: samples });
    }
  } catch (err) {
    console.error('Body recommend fallback error:', err);
    return res.json({ success: false, error: err.message });
  }
});

// ---- SSE stream: gợi ý món theo thể trạng ----
app.get('/api/recommend-by-body-stream', async (req, res) => {
  const { gender, age, weight, height, goal, bmi, bmr, tdee, calTarget } = req.query;

  if (!age || !weight || !height) {
    return res.json({ success: false, error: 'Missing body metrics' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const apiKey = process.env.DEEPSEEK_API_KEY;
  let aiSucceeded = false;

  // Helper to send SSE dish
  function sendDish(dish, matchPercent) {
    res.write(`data: ${JSON.stringify({ type: 'dish', dish, matchPercent })}\n\n`);
  }

  function sendDone() {
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  }

  if (apiKey) {
    // Map goal names (client may send gain_muscle or gain)
    const goalNormalized = goal === 'gain_muscle' || goal === 'gain' ? 'gain_muscle' : goal;
    const goalDisplay = goalNormalized === 'lose' ? 'Giảm cân' :
      goalNormalized === 'gain_muscle' ? 'Tăng cơ' :
      goalNormalized === 'gain_weight' ? 'Tăng cân' : 'Giữ dáng';

    const systemPrompt = `Bạn là chuyên gia dinh dưỡng và đầu bếp. Dựa trên chỉ số cơ thể người dùng, hãy đề xuất các món ăn phù hợp.

Trả về JSON hợp lệ (không markdown, không code block) với format MẢNG:
[
  {
    "name": "tên món",
    "time": "thời gian nấu (VD: 15 ph, 30 ph)",
    "calories": "số kcal (VD: 350 kcal)",
    "difficulty": "Dễ | Trung bình | Khó",
    "description": "mô tả ngắn (1 câu)",
    "ingredients": [
      { "name": "nguyên liệu", "quantity": "định lượng", "price": 0 }
    ],
    "instructions": "các bước nấu, mỗi bước 1 dòng, có số thứ tự"
  }
]

QUY TẮC:
- Mỗi món phải có đủ ingredients và instructions
- Đảm bảo calories mỗi món phù hợp với calTarget cho 1 bữa
- Giảm cân: ưu tiên món ít dầu mỡ, nhiều rau, protein nạc
- Tăng cơ: ưu tiên món giàu protein, carb vừa phải
- Tăng cân: ưu tiên món giàu calo, carb và chất béo lành mạnh
- Giữ dáng: cân bằng dinh dưỡng
- Đề xuất 4-6 món đa dạng`;

    const userPrompt = `Người dùng: ${gender === 'male' ? 'Nam' : 'Nữ'}, ${age} tuổi, ${weight}kg, ${height}cm.
BMI: ${bmi}, BMR: ${bmr} kcal/ngày, TDEE: ${tdee} kcal/ngày.
Mục tiêu: ${goalDisplay}.
Mỗi bữa nên nạp khoảng ${Math.round(parseInt(calTarget) / 3)} kcal.

Hãy đề xuất 5 món ăn Việt Nam phù hợp với thể trạng và mục tiêu này. Trả về MẢNG JSON.`;

    try {
      const controller = new AbortController();
      // Timeout 7s — Vercel Hobby chỉ có 10s, để dư 3s cho fallback
      const timeout = setTimeout(() => controller.abort(), 7000);
      const aiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4,
          max_tokens: 4000,
          stream: true
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!aiResponse.ok) throw new Error(`DeepSeek API error: ${aiResponse.status}`);

      // Stream DeepSeek response, accumulate, then parse and send each dish
      const reader = aiResponse.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed?.choices?.[0]?.delta?.content || '';
              accumulated += content;
            } catch (e) { /* skip */ }
          }
        }
      }
      if (sseBuffer.trim()) {
        const line = sseBuffer;
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const content = parsed?.choices?.[0]?.delta?.content || '';
              accumulated += content;
            } catch (e) { /* skip */ }
          }
        }
      }

      // Parse accumulated JSON array
      try {
        let clean = accumulated.trim();
        const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) clean = jsonMatch[1].trim();
        const arr = JSON.parse(clean);

        if (Array.isArray(arr)) {
          const perMeal = Math.round(parseInt(calTarget) / 3) || 500;
          for (const d of arr) {
            if (!d.name) continue;
            const cal = parseInt((d.calories || '').replace(/[^0-9]/g, '')) || 0;
            const diff = Math.abs(cal - perMeal);
            let mp = diff < 50 ? 95 : diff < 100 ? 85 : diff < 200 ? 75 : 60;
            sendDish(d, mp);
          }
        }
        aiSucceeded = true;
      } catch (e) {
        console.error('Body stream parse error:', e.message);
      }
    } catch (err) {
      console.error('Body stream AI error:', err.message);
    }
  }

  // ---- Fallback: DB + sample (chạy khi không có API key, hoặc AI thất bại) ----
  if (!aiSucceeded) {
    let scored = [];

    try {
      // Timeout 3s cho Supabase — trên Vercel Hobby function timeout 10s
      const dishes = await Promise.race([
        getCachedDishes(),
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
      ]);

      if (dishes && dishes.length > 0) {
        const perMealTarget = Math.round(parseInt(calTarget) / 3) || 500;
        const goalNorm = goal === 'gain_muscle' || goal === 'gain' ? 'gain_muscle' : goal;

        scored = dishes.map(d => {
          const cal = parseInt((d.calories || '').replace(/[^0-9]/g, '')) || 300;
          const diff = Math.abs(cal - perMealTarget);
          let matchPercent = diff < 50 ? 95 : diff < 100 ? 85 : diff < 200 ? 75 : diff < 300 ? 60 : 45;

          let penalty = 0;
          if (goalNorm === 'lose') {
            const names = (d.ingredients || []).map(i => (i.name || '').toLowerCase());
            if (names.some(n => /chiên|rán|dầu|mỡ/.test(n))) penalty = 15;
          }
          return { dish: d, matchPercent: Math.min(99, matchPercent - penalty) };
        });
        scored.sort((a, b) => b.matchPercent - a.matchPercent);
      }
    } catch (err) {
      console.error('Body stream DB fetch error:', err.message);
    }

    // Nếu DB trống hoặc timeout → dùng sample
    if (scored.length < 3) {
      scored = getSampleBodyDishes(calTarget, goal);
    }

    for (const item of scored.slice(0, 8)) {
      sendDish(item.dish, item.matchPercent);
    }
  }

  sendDone();
});

// ===================== Health Analysis API =====================
app.post('/api/health-analysis', async (req, res) => {
  const { dish } = req.body;
  if (!dish || !dish.name) {
    return res.json({ success: false, error: 'Missing dish data' });
  }

  // Extract nutrients from dish
  const name = dish.name || '';
  const calories = dish.calories || '';
  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients.map(i => i.name) : [];

  // Xây prompt phân tích sức khỏe
  const systemPrompt = `Bạn là chuyên gia dinh dưỡng. Phân tích tác động của món ăn lên sức khỏe.
Trả về JSON hợp lệ (không markdown, không code block) với format:
{
  "rating": 4.5,
  "nutrients": {
    "calories": "số kcal (chỉ lấy số, VD: 350)",
    "protein": "ước tính protein (g)",
    "carbs": "ước tính carbs (g)",
    "fats": "ước tính chất béo (g)",
    "sodium": "ước tính natri (mg)"
  },
  "heart": {
    "level": "positive" | "warning" | "danger",
    "title": "tiêu đề ngắn",
    "summary": "phân tích chi tiết về tác động lên tim mạch (dựa trên natri, chất béo bão hòa)",
    "advice": "lời khuyên"
  },
  "kidneys": {
    "level": "positive" | "warning" | "danger",
    "title": "tiêu đề ngắn",
    "summary": "phân tích chi tiết về tác động lên thận (dựa trên protein, natri, kali)",
    "advice": "lời khuyên"
  },
  "liver": {
    "level": "positive" | "warning" | "danger",
    "title": "tiêu đề ngắn",
    "summary": "phân tích chi tiết về tác động lên gan (dựa trên đường, chất béo không lành mạnh)",
    "advice": "lời khuyên"
  },
  "overall": "đánh giá tổng quan về mức độ lành mạnh của món ăn này (2-3 câu)"
}

QUY TẮC ĐÁNH GIÁ rating (thang 1.0 - 5.0, 1 decimal):
- 4.5-5.0: rất lành mạnh, tốt cho tất cả các cơ quan
- 3.5-4.4: lành mạnh, chỉ cần chú ý một ít
- 2.5-3.4: trung bình, cần điều chỉnh
- 1.5-2.4: kém lành mạnh, nên hạn chế
- 1.0-1.4: không tốt cho sức khỏe, chỉ nên ăn ít

QUY TẮC ĐÁNH GIÁ:
- "danger": thành phần có hại ở mức cao (natri >800mg, chất béo bão hòa >15g, protein >40g món, đường >20g)
- "warning": ở mức trung bình cần chú ý
- "positive": lành mạnh, tốt cho cơ quan đó`;

  const userPrompt = `Phân tích món ăn: "${name}" - ${calories}.
Các nguyên liệu chính: ${ingredients.join(', ') || 'không rõ'}.
Hãy phân tích tác động lên tim, thận, gan dựa trên các nguyên liệu này. Ước tính các chỉ số dinh dưỡng một cách hợp lý.`;

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    // Mock response khi không có API key
    return res.json({
      success: true,
      mock: true,
      analysis: getMockHealthAnalysis(name, ingredients)
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (content) {
      // Parse JSON từ response
      let clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
      const analysis = JSON.parse(clean);

      // Validate structure
      if (analysis.heart && analysis.kidneys && analysis.liver) {
        return res.json({ success: true, analysis });
      }
    }

    throw new Error('Failed to parse analysis');
  } catch (err) {
    console.error('Health analysis error:', err.message);
    // Fallback to mock
    return res.json({
      success: true,
      mock: true,
      analysis: getMockHealthAnalysis(name, ingredients)
    });
  }
});

// Mock health analysis khi không có DeepSeek
function getMockHealthAnalysis(name, ingredients) {
  const ings = ingredients.map(i => i.toLowerCase());
  const hasFried = ings.some(i => /chiên|rán|dầu|mỡ/.test(i));
  const hasRedMeat = ings.some(i => /thịt bò|thịt heo|thịt lợn|ba chỉ|xá xíu/.test(i));
  const hasHighSalt = ings.some(i => /mắm|muối|tương|xì dầu|hạt nêm/.test(i));
  const hasSugar = ings.some(i => /đường|ngọt|syrup|mật ong/.test(i));
  const hasProcessed = ings.some(i => /chả|lạp xưởng|xúc xích|jambon/.test(i));
  const isGreen = ings.some(i => /rau|xà lách|cải|bông cải|giá|đậu|nấm/.test(i));

  const heartScore = (hasFried || hasRedMeat ? -2 : 0) + (hasHighSalt ? -2 : 0) + (isGreen ? 2 : 0) + (hasProcessed ? -2 : 0);
  const kidneyScore = (hasHighSalt ? -3 : 0) + (hasRedMeat ? -1 : 0) + (isGreen ? 1 : 0);
  const liverScore = (hasFried || hasProcessed ? -2 : 0) + (hasSugar ? -2 : 0) + (isGreen ? 2 : 0);

  function getLevel(score) {
    if (score >= 2) return 'positive';
    if (score >= -1) return 'warning';
    return 'danger';
  }

  // Tính rating (1-5) dựa trên các score
  const totalScore = heartScore + kidneyScore + liverScore;
  let rating = 3.0; // default
  if (totalScore >= 5) rating = 4.5;
  else if (totalScore >= 3) rating = 4.0;
  else if (totalScore >= 0) rating = 3.5;
  else if (totalScore >= -3) rating = 2.5;
  else if (totalScore >= -6) rating = 2.0;
  else rating = 1.5;

  return {
    rating: rating,
    nutrients: {
      calories: '350',
      protein: '25g',
      carbs: '30g',
      fats: '15g',
      sodium: '650mg'
    },
    heart: {
      level: getLevel(heartScore),
      title: heartScore >= 0 ? 'Tốt cho tim mạch' : 'Cần chú ý',
      summary: heartScore >= 2
        ? 'Món ăn này ít chất béo bão hòa và natri, tốt cho sức khỏe tim mạch.'
        : heartScore >= -1
        ? 'Món ăn có lượng natri và chất béo ở mức trung bình. Không quá lo ngại nếu ăn với lượng vừa phải.'
        : 'Món ăn chứa nhiều chất béo bão hòa và/hoặc natri, có thể gây áp lực lên tim mạch và tăng cholesterol xấu.',
      advice: heartScore >= 0
        ? 'Kết hợp với rau xanh và ngũ cốc nguyên hạt để tăng thêm chất xơ cho tim.'
        : 'Nên giảm lượng muối khi nấu. Dùng dầu thực vật thay mỡ động vật. Kết hợp nhiều rau xanh hơn.'
    },
    kidneys: {
      level: getLevel(kidneyScore),
      title: kidneyScore >= 0 ? 'Thân thiện với thận' : 'Cần lưu ý',
      summary: kidneyScore >= 0
        ? 'Món ăn có lượng protein và natri phù hợp, không gây áp lực lên thận.'
        : 'Món ăn chứa lượng đạm và muối nhất định. Người có vấn đề về thận nên ăn lượng vừa phải.',
      advice: 'Uống đủ nước (1.5-2 lít/ngày) để hỗ trợ thận đào thải chất dư thừa. Hạn chế thêm muối.'
    },
    liver: {
      level: getLevel(liverScore),
      title: liverScore >= 0 ? 'Tốt cho gan' : 'Cần chú ý',
      summary: liverScore >= 0
        ? 'Món ăn ít đường và chất béo không lành mạnh, không gây áp lực lên gan.'
        : 'Món ăn chứa chất béo hoặc đường ở mức cần theo dõi, có thể ảnh hưởng đến gan nếu ăn thường xuyên.',
      advice: 'Hạn chế đồ chiên rán và đường tinh luyện. Tăng cường rau xanh và thực phẩm giàu chất xơ.'
    },
    overall: 'Món ăn này có giá trị dinh dưỡng trung bình. Nên ăn kèm với rau xanh và điều chỉnh lượng muối/dầu khi chế biến để tốt cho sức khỏe tổng thể.'
  };
}

// ---- Serve SPA ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vào Bếp server running at http://localhost:${PORT}`);
});

// Export for Vercel
module.exports = app;

// ---- Fallback dishes cho meal period (khi AI fail) ----
function getMealFallbackDishes(period) {
  const all = {
    breakfast: [
      { name: 'Phở Bò', time: '25 ph', calories: '420 kcal', difficulty: 'Trung bình', description: 'Phở bò tái nạm thơm ngon, nước dùng đậm đà — món sáng quốc dân.', ingredients: [{name:'Bánh phở',quantity:'200g'},{name:'Thịt bò',quantity:'150g'},{name:'Hành lá',quantity:'5 cây'}], instructions: '1. Hầm xương bò lấy nước dùng.\n2. Trụng bánh phở.\n3. Thái thịt bò, xếp lên tô.\n4. Chan nước dùng nóng, rắc hành ngò.' },
      { name: 'Bánh Mì Ốp La', time: '10 ph', calories: '380 kcal', difficulty: 'Dễ', description: 'Bánh mì giòn với trứng ốp la, pate và rau thơm.', ingredients: [{name:'Bánh mì',quantity:'1 ổ'},{name:'Trứng gà',quantity:'2 quả'},{name:'Pate',quantity:'1 thìa'}], instructions: '1. Bánh mì nướng giòn.\n2. Chiên trứng ốp la lửa vừa.\n3. Phết pate, xếp trứng, rau, chan xì dầu.\n4. Kẹp lại và thưởng thức.' },
      { name: 'Bún Bò Huế', time: '30 ph', calories: '450 kcal', difficulty: 'Trung bình', description: 'Bún bò Huế cay nồng, đậm đà xứ Huế.', ingredients: [{name:'Bún',quantity:'200g'},{name:'Thịt bò',quantity:'150g'},{name:'Sả',quantity:'5 cây'}], instructions: '1. Nấu nước dùng với sả, ruốc.\n2. Trụng bún.\n3. Thịt bò thái mỏng.\n4. Chan nước dùng, thêm ớt, rau sống.' },
      { name: 'Cơm Tấm Sườn', time: '30 ph', calories: '500 kcal', difficulty: 'Trung bình', description: 'Cơm tấm sườn nướng thơm lừng, ăn kèm bì chả.', ingredients: [{name:'Cơm tấm',quantity:'1 dĩa'},{name:'Sườn',quantity:'200g'},{name:'Bì',quantity:'50g'}], instructions: '1. Sườn ướp gia vị nướng chín.\n2. Xé bì heo.\n3. Dọn cơm tấm với sườn, bì, chả, mỡ hành.\n4. Chan nước mắm chua ngọt.' },
      { name: 'Cháo Thịt Băm', time: '25 ph', calories: '320 kcal', difficulty: 'Dễ', description: 'Cháo nóng hổi với thịt băm và hành lá.', ingredients: [{name:'Gạo',quantity:'100g'},{name:'Thịt heo băm',quantity:'100g'},{name:'Hành lá',quantity:'3 cây'}], instructions: '1. Nấu gạo thành cháo.\n2. Xào thịt băm với hành.\n3. Cho thịt vào cháo, nêm nếm.\n4. Múc ra tô, rắc hành và tiêu.' },
      { name: 'Hủ Tiếu Nam Vang', time: '20 ph', calories: '400 kcal', difficulty: 'Trung bình', description: 'Hủ tiếu Nam Vang tôm thịt nước dùng ngọt thanh.', ingredients: [{name:'Hủ tiếu',quantity:'200g'},{name:'Tôm',quantity:'100g'},{name:'Thịt heo',quantity:'100g'}], instructions: '1. Nấu nước dùng tôm thịt.\n2. Trụng hủ tiếu.\n3. Xếp tôm, thịt, giá lên tô.\n4. Chan nước dùng, thêm hành phi.' },
      { name: 'Bánh Cuốn', time: '30 ph', calories: '350 kcal', difficulty: 'Khó', description: 'Bánh cuốn mỏng tang nhân tôm thịt, chấm nước mắm chua ngọt.', ingredients: [{name:'Bột gạo',quantity:'200g'},{name:'Thịt băm',quantity:'100g'},{name:'Mộc nhĩ',quantity:'30g'}], instructions: '1. Pha bột, tráng bánh.\n2. Xào nhân thịt mộc nhĩ.\n3. Trải bánh, cho nhân, cuốn lại.\n4. Rắc hành phi, chấm nước mắm.' },
      { name: 'Xôi Xéo', time: '35 ph', calories: '420 kcal', difficulty: 'Dễ', description: 'Xôi gấc vàng ươm với mỡ hành và hành phi.', ingredients: [{name:'Gạo nếp',quantity:'300g'},{name:'Gấc',quantity:'1 miếng'},{name:'Hành phi',quantity:'2 thìa'}], instructions: '1. Đồ nếp với gấc cho vàng.\n2. Rưới mỡ hành lên xôi.\n3. Rắc hành phi và muối mè.' },
      { name: 'Bún Chả', time: '25 ph', calories: '450 kcal', difficulty: 'Trung bình', description: 'Bún chả Hà Nội với chả thơm, nước mắm chua ngọt.', ingredients: [{name:'Bún',quantity:'200g'},{name:'Thịt ba chỉ',quantity:'150g'},{name:'Rau sống',quantity:'1 dĩa'}], instructions: '1. Thịt thái lát ướp gia vị.\n2. Nướng thịt trên than hoa.\n3. Pha nước mắm chua ngọt.\n4. Dọn bún, chả, rau và nước mắm.' },
      { name: 'Bánh Ướt Thịt Nướng', time: '25 ph', calories: '400 kcal', difficulty: 'Trung bình', description: 'Bánh ướt mềm cuốn thịt nướng và rau sống.', ingredients: [{name:'Bánh ướt',quantity:'200g'},{name:'Thịt heo',quantity:'150g'},{name:'Rau sống',quantity:'100g'}], instructions: '1. Thịt ướp gia vị nướng chín.\n2. Trải bánh ướt, xếp thịt và rau.\n3. Cuốn chặt, chấm nước mắm chua ngọt.' },
    ],
    lunch: [
      { name: 'Cơm Tấm Sườn Nướng', time: '30 ph', calories: '550 kcal', difficulty: 'Trung bình', description: 'Cơm tấm sườn nướng thơm lừng, ăn kèm bì chả.', ingredients: [{name:'Cơm tấm',quantity:'1 dĩa'},{name:'Sườn',quantity:'200g'},{name:'Bì',quantity:'50g'}], instructions: '1. Sườn ướp nướng.\n2. Xé bì.\n3. Dọn cơm + sườn + bì + mỡ hành.' },
      { name: 'Bún Thịt Nướng', time: '15 ph', calories: '480 kcal', difficulty: 'Dễ', description: 'Bún thịt nướng với nem chua, chấm nước mắm chua ngọt.', ingredients: [{name:'Bún',quantity:'200g'},{name:'Thịt heo',quantity:'150g'},{name:'Nem chua',quantity:'2 cái'}], instructions: '1. Thịt ướp nướng chín.\n2. Bún trụng, xếp rau thơm.\n3. Thêm thịt nướng, nem, đậu phộng.\n4. Chan nước mắm chua ngọt.' },
      { name: 'Cơm Chiên Dương Châu', time: '15 ph', calories: '520 kcal', difficulty: 'Dễ', description: 'Cơm chiên tôm thịt trứng — nhanh gọn cho bữa trưa.', ingredients: [{name:'Cơm nguội',quantity:'300g'},{name:'Tôm',quantity:'100g'},{name:'Trứng',quantity:'2 quả'}], instructions: '1. Phi tỏi thơm.\n2. Xào tôm, cho cơm vào chiên.\n3. Đập trứng, đảo đều.\n4. Nêm nếm, rắc hành lá.' },
      { name: 'Bò Xào Súp Lơ', time: '15 ph', calories: '480 kcal', difficulty: 'Dễ', description: 'Thịt bò mềm kết hợp súp lơ xanh giòn ngọt.', ingredients: [{name:'Thịt bò',quantity:'200g'},{name:'Súp lơ',quantity:'200g'},{name:'Tỏi',quantity:'3 tép'}], instructions: '1. Bò ướp, xào lửa lớn.\n2. Luộc sơ súp lơ.\n3. Phi tỏi, cho bò và súp lơ vào đảo đều.' },
      { name: 'Canh Chua Cá Lóc', time: '30 ph', calories: '380 kcal', difficulty: 'Trung bình', description: 'Canh chua thanh ngọt với cá lóc tươi, đậu bắp.', ingredients: [{name:'Cá lóc',quantity:'300g'},{name:'Me',quantity:'50g'},{name:'Đậu bắp',quantity:'100g'}], instructions: '1. Cá lóc làm sạch.\n2. Nấu nước me.\n3. Cho cá vào nấu chín, thêm đậu bắp, giá.' },
      { name: 'Thịt Kho Trứng', time: '45 ph', calories: '520 kcal', difficulty: 'Trung bình', description: 'Thịt ba chỉ kho trứng đậm đà, hao cơm.', ingredients: [{name:'Thịt ba chỉ',quantity:'300g'},{name:'Trứng',quantity:'4 quả'},{name:'Nước dừa',quantity:'200ml'}], instructions: '1. Thịt cắt miếng, ướp gia vị.\n2. Kho thịt với nước dừa lửa nhỏ.\n3. Luộc trứng, bỏ vỏ, cho vào kho cùng.' },
    ],
    dinner: [
      { name: 'Cá Kho Tộ', time: '40 ph', calories: '450 kcal', difficulty: 'Trung bình', description: 'Cá kho tộ thơm lừng, đậm đà — món tối truyền thống.', ingredients: [{name:'Cá basa',quantity:'300g'},{name:'Nước mắm',quantity:'3 thìa'},{name:'Tiêu',quantity:'1 thìa'}], instructions: '1. Cá rửa sạch, ướp gia vị.\n2. Xếp cá vào nồi đất, kho lửa liu riu.\n3. Kho đến khi nước sền sệt, thêm tiêu.' },
      { name: 'Lẩu Thái Hải Sản', time: '45 ph', calories: '550 kcal', difficulty: 'Khó', description: 'Lẩu Thái chua cay hải sản tươi ngon.', ingredients: [{name:'Tôm',quantity:'200g'},{name:'Mực',quantity:'200g'},{name:'Sả',quantity:'5 cây'}], instructions: '1. Nấu nước lẩu với sả, ớt, me.\n2. Nhúng hải sản, rau.\n3. Thưởng thức với bún.' },
      { name: 'Sườn Nướng BBQ', time: '45 ph', calories: '580 kcal', difficulty: 'Trung bình', description: 'Sườn non nướng BBQ thơm lừng cả nhà.', ingredients: [{name:'Sườn non',quantity:'500g'},{name:'Sốt BBQ',quantity:'100ml'}], instructions: '1. Sườn ướp sốt BBQ 30 phút.\n2. Nướng lò 180°C 20 phút.\n3. Phết sốt, nướng thêm 10 phút.' },
      { name: 'Bò Lúc Lắc', time: '20 ph', calories: '500 kcal', difficulty: 'Trung bình', description: 'Bò lúc lắc hạt tiêu xanh ăn kèm salad.', ingredients: [{name:'Thịt bò',quantity:'300g'},{name:'Salad',quantity:'100g'},{name:'Hạt tiêu',quantity:'1 thìa'}], instructions: '1. Bò cắt hạt lựu, ướp tiêu.\n2. Xào lửa lớn đến khi chín tới.\n3. Dọn với salad.' },
      { name: 'Gà Nướng Mật Ong', time: '10 ph', calories: '480 kcal', difficulty: 'Trung bình', description: 'Cánh gà nướng mật ong thơm ngọt.', ingredients: [{name:'Cánh gà',quantity:'500g'},{name:'Mật ong',quantity:'3 thìa'}], instructions: '1. Gà ướp mật ong + gia vị.\n2. Nướng lò 15 phút.\n3. Phết mật ong, nướng thêm 5 phút.' },
      { name: 'Tôm Rim Mặn Ngọt', time: '15 ph', calories: '380 kcal', difficulty: 'Dễ', description: 'Tôm rim mặn ngọt ăn cơm nóng.', ingredients: [{name:'Tôm',quantity:'300g'},{name:'Đường',quantity:'1 thìa'},{name:'Nước mắm',quantity:'2 thìa'}], instructions: '1. Tôm làm sạch.\n2. Phi thơm hành, cho tôm vào.\n3. Thêm nước mắm + đường, rim lửa nhỏ.' },
    ],
    night: [
      { name: 'Cháo Gà Xé', time: '20 ph', calories: '280 kcal', difficulty: 'Dễ', description: 'Cháo gà xé nhẹ nhàng cho bữa khuya.', ingredients: [{name:'Gạo',quantity:'100g'},{name:'Gà luộc',quantity:'100g'},{name:'Gừng',quantity:'1 nhánh'}], instructions: '1. Nấu gạo thành cháo.\n2. Xé gà luộc.\n3. Cho gà vào cháo, thêm gừng.\n4. Nêm nếm, rắc hành.' },
      { name: 'Bánh Mì Trứng', time: '10 ph', calories: '320 kcal', difficulty: 'Dễ', description: 'Bánh mì trứng nhanh gọn lúc đói khuya.', ingredients: [{name:'Bánh mì',quantity:'1 ổ'},{name:'Trứng',quantity:'2 quả'},{name:'Tương ớt',quantity:'1 thìa'}], instructions: '1. Bánh mì nướng giòn.\n2. Trứng chiên theo ý thích.\n3. Xếp trứng vào bánh mì, thêm tương ớt.' },
      { name: 'Salad Rau Củ', time: '10 ph', calories: '180 kcal', difficulty: 'Dễ', description: 'Salad rau củ thanh mát, ít calo cho bữa khuya.', ingredients: [{name:'Xà lách',quantity:'200g'},{name:'Cà rốt',quantity:'1 củ'},{name:'Dầu giấm',quantity:'30ml'}], instructions: '1. Rau củ rửa sạch.\n2. Thái sợi hoặc cắt nhỏ.\n3. Trộn đều với dầu giấm.' },
      { name: 'Súp Bí Đỏ', time: '15 ph', calories: '200 kcal', difficulty: 'Dễ', description: 'Súp bí đỏ ấm bụng — ngon và bổ.', ingredients: [{name:'Bí đỏ',quantity:'200g'},{name:'Sữa tươi',quantity:'100ml'}], instructions: '1. Bí đỏ gọt vỏ, hấp chín.\n2. Xay nhuyễn với sữa.\n3. Nấu sôi nhẹ, nêm chút muối.' },
      { name: 'Bánh Flan', time: '5 ph', calories: '220 kcal', difficulty: 'Dễ', description: 'Bánh flan mát lạnh, caramen thơm ngọt.', ingredients: [{name:'Bánh flan',quantity:'2 cái'},{name:'Cà phê',quantity:'1 ly'}], instructions: '1. Bánh flan mua sẵn.\n2. Ăn kèm cà phê hoặc đá bào.' },
    ]
  };

  const list = all[period] || all.lunch;
  // Trộn ngẫu nhiên để mỗi lần hiển thị thứ tự khác nhau
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 8);
}

// ---- Sample dishes cho body recommend fallback ----
function getSampleBodyDishes(calTarget, goal) {
  const perMeal = Math.round(parseInt(calTarget || 1800) / 3);
  const goalNorm = `${goal || 'maintain'}`;
  const isLose = goalNorm === 'lose';
  const isGain = goalNorm === 'gain_muscle' || goalNorm === 'gain';
  const isGainWeight = goalNorm === 'gain_weight';

  // Dishes với calories khác nhau
  const all = [
    {
      dish: { name: 'Salad Gà Luộc', time: '15 ph', calories: '280 kcal', difficulty: 'Dễ', description: 'Salad gà luộc xé sợi trộn rau củ thanh mát.', ingredients: [{name:'Ức gà',quantity:'150g'},{name:'Xà lách',quantity:'100g'},{name:'Cà rốt',quantity:'1 củ'}], instructions: '1. Ức gà luộc chín, xé sợi.\n2. Rau củ thái sợi.\n3. Trộn đều với dầu giấm.' },
      matchPercent: 65
    },
    {
      dish: { name: 'Cá Hấp Xì Dầu', time: '20 ph', calories: '320 kcal', difficulty: 'Dễ', description: 'Cá hấp nhẹ với xì dầu, gừng và hành lá.', ingredients: [{name:'Cá chép',quantity:'1 con'},{name:'Xì dầu',quantity:'3 thìa'},{name:'Gừng',quantity:'1 nhánh'}], instructions: '1. Cá làm sạch, khứa vài đường.\n2. Xếp gừng lên cá.\n3. Hấp cách thủy 15 phút.' },
      matchPercent: 70
    },
    {
      dish: { name: 'Canh Chua Cá Lóc', time: '30 ph', calories: '380 kcal', difficulty: 'Trung bình', description: 'Canh chua ngọt thanh với cá lóc tươi.', ingredients: [{name:'Cá lóc',quantity:'300g'},{name:'Me',quantity:'50g'},{name:'Đậu bắp',quantity:'100g'}], instructions: '1. Cá lóc làm sạch, cắt khúc.\n2. Me ngâm nước ấm, bỏ hạt.\n3. Nấu sôi, cho cá vào, thêm me và rau.' },
      matchPercent: 75
    },
    {
      dish: { name: 'Bò Xào Súp Lơ', time: '15 ph', calories: '480 kcal', difficulty: 'Dễ', description: 'Thịt bò xào nhanh với súp lơ xanh.', ingredients: [{name:'Thịt bò thăn',quantity:'200g'},{name:'Súp lơ xanh',quantity:'200g'},{name:'Tỏi',quantity:'3 tép'}], instructions: '1. Thịt bò thái lát, ướp gia vị.\n2. Súp lơ luộc sơ.\n3. Phi tỏi, xào bò lửa lớn 2 phút.' },
      matchPercent: 80
    },
    {
      dish: { name: 'Ức Gà Áp Chảo', time: '20 ph', calories: '350 kcal', difficulty: 'Dễ', description: 'Ức gà áp chảo thơm ngon, ít dầu mỡ.', ingredients: [{name:'Ức gà',quantity:'200g'},{name:'Dầu olive',quantity:'1 thìa'},{name:'Hạt nêm',quantity:'1 thìa'}], instructions: '1. Ức gà ướp gia vị 10 phút.\n2. Áp chảo lửa vừa 5 phút mỗi mặt.\n3. Ăn kèm rau luộc.' },
      matchPercent: 90
    },
    {
      dish: { name: 'Cơm Tấm Sườn Nướng', time: '40 ph', calories: '650 kcal', difficulty: 'Trung bình', description: 'Cơm tấm với sườn nướng thơm lừng.', ingredients: [{name:'Sườn cốt lết',quantity:'300g'},{name:'Cơm tấm',quantity:'200g'},{name:'Mỡ hành',quantity:'1 thìa'}], instructions: '1. Sườn ướp gia vị 30 phút.\n2. Nướng sườn trên bếp than hoặc lò.\n3. Dọn với cơm tấm, mỡ hành và đồ chua.' },
      matchPercent: 85
    },
    {
      dish: { name: 'Khoai Tây Chiên', time: '15 ph', calories: '520 kcal', difficulty: 'Dễ', description: 'Khoai tây chiên giòn rụm.', ingredients: [{name:'Khoai tây',quantity:'3 củ'},{name:'Dầu ăn',quantity:'200ml'}], instructions: '1. Khoai gọt vỏ, thái sợi.\n2. Ngâm nước muối, để ráo.\n3. Chiên ngập dầu lửa lớn 5 phút.' },
      matchPercent: 55
    },
  ];

  // Sắp xếp theo độ phù hợp calo
  all.sort((a, b) => {
    const diffA = Math.abs(parseInt(a.dish.calories) - perMeal);
    const diffB = Math.abs(parseInt(b.dish.calories) - perMeal);
    return diffA - diffB;
  });

  // Ưu tiên theo mục tiêu
  if (isLose) {
    all.sort((a, b) => {
      const calA = parseInt(a.dish.calories);
      const calB = parseInt(b.dish.calories);
      if (calA <= perMeal && calB > perMeal) return -1;
      if (calA > perMeal && calB <= perMeal) return 1;
      return Math.abs(calA - perMeal) - Math.abs(calB - perMeal);
    });
  } else if (isGainWeight) {
    all.sort((a, b) => {
      const calA = parseInt(a.dish.calories);
      const calB = parseInt(b.dish.calories);
      if (calA >= perMeal && calB < perMeal) return -1;
      if (calA < perMeal && calB >= perMeal) return 1;
      return Math.abs(calA - perMeal) - Math.abs(calB - perMeal);
    });
  }

  // Tính lại matchPercent
  return all.map(item => {
    const cal = parseInt(item.dish.calories) || 300;
    const diff = Math.abs(cal - perMeal);
    item.matchPercent = diff < 50 ? 95 : diff < 100 ? 85 : diff < 200 ? 75 : diff < 300 ? 60 : 45;
    return item;
  }).slice(0, 8);
}

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
            insight: 'Dựa trên thói quen của bạn, Vào Bếp đề xuất giảm 15% lượng thịt đỏ và tăng cường rau xanh vào tối Thứ Năm.',
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
            instructions: '1. Cá hồi rửa sạch, thấm khô bằng khăn giấy. Ướp đều 2 mặt với 1/2 thìa muối, 1/2 thìa tiêu, 1 thìa dầu oliu. Để thấm 10 phút.\n2. Bắc chảo chống dính lên bếp, cho 1 thìa dầu oliu, lửa vừa-lớn. Đợi dầu nóng già (thấy khói nhẹ).\n3. Cho cá hồi vào áp chảo, mặt da xuống trước. Chiên 3-4 phút lửa vừa đến khi da vàng giòn.\n4. Lật mặt cá, chiên thêm 2-3 phút (tuỳ độ dày). Thịt cá chín tới sẽ dễ dàng tách thành từng múi.\n5. Xà lách rửa sạch, ngâm nước muối 5 phút, để ráo. Cà chua bi bổ đôi. Bơ thái lát mỏng.\n6. Xếp rau ra đĩa lớn, đặt cá hồi lên trên. Rưới sốt mè rang hoặc sốt dầu giấm.\n💡 Mẹo: Không chiên cá quá lâu - cá hồi sẽ bị khô. Thịt còn hơi hồng ở trung tâm là ngon nhất. Có thể thay sốt mè rang bằng sốt chanh dây hoặc tương ớt Hàn Quốc.'
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
