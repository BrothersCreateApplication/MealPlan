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

  // 2. Fallback: random từ DB (các món do AI đề xuất trước đó đã lưu)
  if (dishes.length === 0) {
    try {
      const random = await db.getRandomDishes(10);
      if (random && random.length > 0) dishes = random;
    } catch (e) {}
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

  const apiKey = process.env.DEEPSEEK_API_KEY;
  let suggestions = [];
  let fromCache = true;

  // 1. Luôn gọi AI gợi ý món dựa trên nguyên liệu (DB sạch, AI trả mới)
  if (apiKey) {
    try {
      const ingsStr = ingredients.join(', ');
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
              content: `JSON array. Có nguyên liệu: ${ingsStr}. Gợi ý 4-5 món nấu được từ các nguyên liệu này, có thể thêm 1-2 gia vị.

Mỗi món: name, time (số phút), calories (số kcal), difficulty (Dễ/Trung bình/Khó), description, ingredients[{name,quantity}], instructions (dùng \\n giữa các bước, không xuống dòng thật).`
            },
            { role: 'user', content: `Tôi có: ${ingsStr}. Gợi ý món gì?` }
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
          try {
            let clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
            let parsed;
            try {
              parsed = JSON.parse(clean);
            } catch (e) {
              let fixed = clean.replace(/,\s*([}\]])/g, '$1');
              try {
                parsed = JSON.parse(fixed);
              } catch (e2) {
                const idx = Math.max(fixed.lastIndexOf(']'), fixed.lastIndexOf('}'));
                if (idx > 10) parsed = JSON.parse(fixed.slice(0, idx + 1));
                else throw e;
              }
            }
            const aiDishes = Array.isArray(parsed) ? parsed : [parsed];
            const normalized = aiDishes.map(normalizeDish).filter(d => d && d.name);

            // Lưu vào DB (fire-and-forget)
            db.addNewDishes(normalized).catch(() => {});

            // Parse thành format suggestion
            const baseSeasonings = db.BASIC_SEASONINGS || [];
            const normalizedAvail = ingredients.map(i => db.removeAccents(i.toLowerCase().trim()));

            suggestions = normalized.map(aiDish => {
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

            suggestions.sort((a, b) => b.matchPercent - a.matchPercent);
            fromCache = false;

            console.log(`[FridgeAI] Suggested ${suggestions.length} dishes for: ${ingsStr}`);
          } catch (parseErr) {
            console.error('[FridgeAI] JSON parse error:', parseErr.message);
          }
        }
      }
    } catch (e) {
      console.error('[DeepSeek] Fridge suggestion error:', e.message);
    }
  }

  // 2. Fallback: tìm trong DB (nếu có)
  if (suggestions.length === 0) {
    try {
      suggestions = await db.suggestDishesByIngredients(ingredients);
    } catch (e) {}
  }

  res.json({ suggestions: suggestions.slice(0, 5), fromCache });
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

// ===================== Plating Guide API =====================
app.post('/api/plating-guide', async (req, res) => {
  const { dish } = req.body;
  if (!dish || !dish.name) {
    return res.json({ success: false, error: 'Missing dish data' });
  }

  const name = dish.name || '';
  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients.map(i => i.name) : [];
  const ingsWithQty = Array.isArray(dish.ingredients) ? dish.ingredients.map(i => `${i.quantity || ''} ${i.name}`).join(', ') : ingredients.join(', ');

  const systemPrompt = `Bạn là đầu bếp chuyên nghiệp chuyên về trình bày món ăn (food plating/styling).

Trả về JSON hợp lệ (không markdown, không code block) với format:
{
  "style": "phong cách trình bày (VD: Nhà hàng Hà Nội, Quán Sài Gòn, Fine Dining, Gia đình ấm cúng...)",
  "plateType": "loại đĩa/tô (VD: Tô sứ trắng 20cm, Đĩa tròn sứ 26cm...)",
  "layout": "loại bố cục: bowl | round-plate | layered-glass | square-plate",
  "steps": [
    {
      "step": 1,
      "title": "tên bước ngắn (VD: Lót bánh phở, Xếp thịt hình quạt...)",
      "detail": "mô tả chi tiết 1-2 câu về cách làm bước này",
      "position": "vị trí trên đĩa: bottom | top | left | right | center | all-over | top-right...",
      "coverage": "tỉ lệ diện tích chiếm: số phần trăm (VD: 40)",
      "color": "màu sắc chính của thành phần này (VD: #F5DEB3 cho bánh phở, #FF6B6B cho thịt bò)"
    }
  ],
  "tips": ["mẹo 1", "mẹo 2", "mẹo 3"],
  "commonMistakes": ["lỗi thường gặp 1", "lỗi thường gặp 2"],
  "colorHarmony": "phân tích phối màu trên đĩa (1-2 câu)"
}

QUY TẮC:
- 3-6 bước, mỗi bước RÕ RÀNG về vị trí và tỉ lệ
- layout=bowl nếu món nước (phở, bún, canh), round-plate nếu món cơm/món mặn, layered-glass nếu salad/gỏi
- Mỗi bước phải có position VÀ coverage (tỉ lệ %)
- Tips thiết thực, có thể làm theo ngay
- Chọn phong cách PHÙ HỢP với loại món (món Việt dân dã thì không dùng Fine Dining)`;

  const userPrompt = `Hướng dẫn cách bày trí món "${name}".
Nguyên liệu: ${ingsWithQty || 'không rõ'}.

Hãy hướng dẫn bày trí món này ra đĩa/tô CHUYÊN NGHIỆP và ĐẸP MẮT.`;

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return res.json({
      success: true,
      mock: true,
      plating: getMockPlatingGuide(name, ingredients)
    });
  }

  try {
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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 2000
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (content) {
      let clean = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
      const plating = JSON.parse(clean);

      if (plating.steps && plating.steps.length > 0) {
        return res.json({ success: true, plating });
      }
    }

    throw new Error('Failed to parse plating guide');
  } catch (err) {
    console.error('Plating guide error:', err.message);
    return res.json({
      success: true,
      mock: true,
      plating: getMockPlatingGuide(name, ingredients)
    });
  }
});

// Mock plating guide khi không có API key
function getMockPlatingGuide(dishName, ingredients) {
  const name = dishName.toLowerCase();
  const ings = ingredients.map(i => i.toLowerCase());

  // Xác định loại món để chọn phong cách
  const isSoup = /phở|bún|canh|cháo|hủ tiếu|miến|súp|lẩu/.test(name);
  const isSalad = /salad|gỏi|nộm|trộn/.test(name);
  const isRice = /cơm|xôi/.test(name);
  const isFried = /chiên|rán/.test(name);

  if (isSoup) {
    return {
      style: 'Quán Việt truyền thống',
      plateType: 'Tô sứ trắng 22cm',
      layout: 'bowl',
      steps: [
        { step: 1, title: 'Lót nền', detail: `Trụng ${name.includes('phở') ? 'bánh phở' : name.includes('bún') ? 'bún' : 'thành phần chính'} qua nước sôi 5 giây rồi xếp gọn vào tô, dàn đều đáy.`, position: 'bottom', coverage: 40, color: '#F5DEB3' },
        { step: 2, title: 'Xếp topping', detail: 'Xếp thịt/cá/topping thành hình quạt hoặc lớp chồng nhẹ ở 1/3 diện tích mặt tô. Không dàn trải. Để lộ phần nền bên dưới.', position: 'top', coverage: 30, color: '#FF8C69' },
        { step: 3, title: 'Rải rau thơm & gia vị', detail: 'Hành lá, rau thơm thái nhỏ rắc đều lên mặt. Ớt lát mỏng đặt 2-3 lát lệch tâm làm điểm nhấn.', position: 'all-over', coverage: 15, color: '#228B22' },
        { step: 4, title: 'Chan nước dùng', detail: 'Chan nước dùng nóng từ mép tô, không chan trực tiếp từ trên xuống — giữ topping không bị xô lệch. Nước dùng cao khoảng 3/4 tô.', position: 'all-over', coverage: 100, color: '#8B4513' }
      ],
      tips: ['Trụng bánh phở/bún bằng nước sôi trước khi bày — sợi tơi, không dính', 'Thịt bò thái mỏng 0.3mm, để ngăn đá 30 phút cho dễ thái', 'Nước dùng phải nóng 95°C — thịt tái chín ngay trong tô', 'Luôn để lộ 1 phần thành phần bên dưới — tạo chiều sâu cho tô'],
      commonMistakes: ['Chan nước dùng từ trên xuống làm thịt bị xô lệch', 'Cho quá nhiều topping — nhìn rối mắt', 'Thiếu màu xanh của rau — tô trông "chết"'],
      colorHarmony: 'Nâu nước dùng + trắng bánh + hồng thịt + xanh rau + đỏ ớt = bảng màu cân bằng ấm áp đặc trưng món nước Việt.'
    };
  }

  if (isSalad) {
    return {
      style: 'Fine Dining',
      plateType: 'Bát thủy tinh trong suốt 12cm',
      layout: 'layered-glass',
      steps: [
        { step: 1, title: 'Lót đáy', detail: 'Xà lách bản lớn lót đáy bát, lá hướng ra ngoài để nhìn thấy từ bên hông bát thủy tinh.', position: 'bottom', coverage: 15, color: '#228B22' },
        { step: 2, title: 'Xếp lớp chính giữa', detail: 'Nguyên liệu chính (gà/cá/tôm) xé hoặc thái miếng vừa ăn, xếp gọn ở giữa, cao khoảng 3-4cm.', position: 'center', coverage: 40, color: '#FFF8DC' },
        { step: 3, title: 'Lớp rau củ màu', detail: 'Cà rốt bào sợi + dưa leo thái lát mỏng xếp vòng quanh lớp chính, tạo tương phản màu cam-xanh.', position: 'center', coverage: 25, color: '#FF8C00' },
        { step: 4, title: 'Topping giòn', detail: 'Lạc rang giã dập + hành phi rải 1 lớp mỏng trên cùng, tạo texture giòn.', position: 'top', coverage: 10, color: '#D2691E' },
        { step: 5, title: 'Rưới sốt', detail: 'Sốt rưới zigzag lên mặt, KHÔNG trộn đều. Để khách tự trộn khi ăn — nhìn đẹp hơn.', position: 'all-over', coverage: 10, color: '#FFD700' }
      ],
      tips: ['Dùng bát thủy tinh trong suốt — khách thấy được các lớp màu đẹp mắt', 'Độ cao lý tưởng của salad trong bát: 8-10cm', 'Mỗi lớp nên có màu khác biệt rõ — tránh 2 lớp cùng tông màu liền kề', 'Phục vụ kèm 1 lát chanh vàng + ớt đỏ trên miệng bát'],
      commonMistakes: ['Trộn sốt trước khi phục vụ — rau bị mềm, mất độ giòn', 'Các lớp màu bị trùng — nhìn đơn điệu', 'Không dùng bát trong suốt — mất hiệu ứng layered'],
      colorHarmony: 'Xanh lá + vàng + cam + nâu + trắng kem = tươi mát, kích thích vị giác kiểu Âu.'
    };
  }

  if (isRice) {
    return {
      style: 'Quán cơm Sài Gòn',
      plateType: 'Đĩa tròn sứ trắng 26cm',
      layout: 'round-plate',
      steps: [
        { step: 1, title: 'Ép cơm', detail: 'Cơm nóng ép vào khuôn tròn hoặc bát nhỏ, úp ngược ra đĩa — tạo khối cơm tròn đẹp, cao 3-4cm.', position: 'left', coverage: 40, color: '#FFFEF0' },
        { step: 2, title: 'Xếp món chính', detail: 'Xếp món mặn (sườn/thịt/cá) cạnh cơm, xếp nan quạt hoặc chồng nhẹ 2-3 miếng, không che hết cơm.', position: 'right', coverage: 30, color: '#8B4513' },
        { step: 3, title: 'Thêm đồ chua & rau', detail: 'Đồ chua (cà rốt + củ cải ngâm) để góc đối diện món chính. Rau thơm cắm nhẹ cạnh cơm.', position: 'right', coverage: 20, color: '#FF6347' },
        { step: 4, title: 'Rưới mỡ hành & topping', detail: 'Mỡ hành rưới lên cơm và thịt. Hành phi + tóp mỡ rải đều lên đỉnh cơm — tạo điểm nhấn vàng giòn.', position: 'top', coverage: 10, color: '#FFD700' }
      ],
      tips: ['Cơm phải nóng và dẻo — ép chặt tay để khối cơm không bị rời', 'Sườn xếp chồng 1/3 — không che hết cơm', 'Phải có ít nhất 4 màu: trắng(cơm) + nâu(thịt) + cam/cà rốt + xanh(rau)', 'Dùng đĩa trắng — tạo contrast tối đa với đồ ăn'],
      commonMistakes: ['Cơm rời rạc — do cơm nguội hoặc ép không chặt', 'Sườn che hết cơm — mất bố cục', 'Thiếu màu xanh của rau — đĩa trông "nặng"'],
      colorHarmony: 'Trắng cơm + nâu sườn + cam đồ chua + xanh rau + vàng hành phi = bảng màu ấm, đậm đà kiểu cơm Sài Gòn.'
    };
  }

  // Default: món xào/kho/món mặn
  return {
    style: 'Gia đình ấm cúng',
    plateType: 'Đĩa tròn sứ trắng 24cm',
    layout: 'round-plate',
    steps: [
      { step: 1, title: 'Tạo nền', detail: 'Rau sống hoặc rau luộc trải mỏng lót 1/3 đĩa — tạo nền xanh cho món chính.', position: 'bottom', coverage: 20, color: '#228B22' },
      { step: 2, title: 'Xếp món chính', detail: `Xếp ${dishName} vào trung tâm đĩa, gọn gàng. Dùng khuôn tròn nếu cần — tạo chiều cao 3-5cm.`, position: 'center', coverage: 50, color: '#D2691E' },
      { step: 3, title: 'Trang trí viền', detail: 'Cà chua bi bổ đôi + dưa leo thái lát xếp viền quanh đĩa. Ớt tỉa hoa đặt 1 góc.', position: 'left right', coverage: 20, color: '#FF6347' },
      { step: 4, title: 'Rắc topping & nước sốt', detail: 'Hành lá/rau thơm thái nhỏ rắc đều. Nước sốt chấm xung quanh hoặc chén riêng — không rưới lên món chính.', position: 'all-over', coverage: 10, color: '#FFD700' }
    ],
    tips: ['Luôn dùng đĩa TRẮNG — món ăn là nhân vật chính', 'Chiều cao tạo cảm giác sang trọng — xếp chồng, không dàn phẳng', 'Số lẻ đẹp hơn số chẵn: 3 miếng thịt, 5 cọng rau...'],
    commonMistakes: ['Đĩa quá đầy — phải chừa viền trắng 2-3cm', 'Sauce rưới lên món chính — làm mất hình dáng đẹp', 'Không lau mép đĩa — vết bẩn trên viền trắng rất mất điểm'],
    colorHarmony: 'Tỉ lệ vàng: 60% món chính + 30% rau củ + 10% trang trí. Màu nóng (đỏ/cam/vàng) kích thích ăn ngon.'
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
