const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ---- Database: dùng Supabase (không SQLite) ----
const db = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

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
        const timeout = setTimeout(() => controller.abort(), 20000);
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
    // Chỉ search tiếng Việt, ưu tiên video có "cách nấu" hoặc "cách làm"
    const query = `cách nấu ${dish} cách làm ${dish} hướng dẫn nấu`;
    const result = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
    const videos = result?.videos || [];
    // Ưu tiên video tiếng Việt — title có từ "cách nấu", "cách làm", "hướng dẫn", "công thức"
    const findBest = videos.find(v =>
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

  return {
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
