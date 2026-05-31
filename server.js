const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ---- Database: dÃ¹ng Supabase (khÃ´ng SQLite) ----
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
    name: dish.name || 'MÃ³n Äƒn',
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

// ---- Search dishes: DB trÆ°á»›c, DeepSeek náº¿u mÃ³n má»›i ----
app.post('/api/search-dishes', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ dishes: [] });

  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 0);

  // 1. TÃ¬m trong Supabase trÆ°á»›c
  let dishes = await db.searchDishes(words);

  // 2. Náº¿u khÃ´ng Ä‘á»§ (dÆ°á»›i 3 mÃ³n), gá»i DeepSeek
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
              { role: 'system', content: `Báº¡n lÃ  chuyÃªn gia áº©m thá»±c Viá»‡t Nam. Tráº£ lá»i JSON array. TUYá»†T Äá»I TUÃ‚N THá»¦: Má»—i mÃ³n cÃ³: name, time (sá»‘ phÃºt), calories (sá»‘ kcal), difficulty, description, ingredients (máº£ng {name, quantity}), instructions (cÃ¡c bÆ°á»›c náº¥u cÃ¡ch nhau báº±ng \\n). QUY Táº®C TÃŒM KIáº¾M: NgÆ°á»i dÃ¹ng search tá»« khÃ³a. Æ¯u tiÃªn mÃ³n trÃ¹ng phÆ°Æ¡ng phÃ¡p cháº¿ biáº¿n. LOáº I Bá»Ž mÃ³n dÃ¹ng phÆ°Æ¡ng phÃ¡p khÃ¡c. Tráº£ vá» ÄÃšNG 3-5 mÃ³n.

YÃŠU Cáº¦U QUAN TRá»ŒNG vá» instructions:
- HÆ°á»›ng dáº«n Cá»°C Ká»² CHI TIáº¾T, nhÆ° má»™t Ä‘áº§u báº¿p chá»‰ dáº¡y ngÆ°á»i má»›i náº¥u Äƒn.
- Má»—i bÆ°á»›c pháº£i rÃµ rÃ ng, bao gá»“m: lá»­a to/nhá», thá»i gian chÃ­nh xÃ¡c (phÃºt), cÃ¡ch kiá»ƒm tra Ä‘á»™ chÃ­n, máº¹o nhá».
- instructions gá»“m 6-10 bÆ°á»›c, má»—i bÆ°á»›c má»™t dÃ²ng xuá»‘ng dÃ²ng \\n.
- KÃˆM THEO máº¹o vÃ  lÆ°u Ã½ á»Ÿ cuá»‘i.` },
              { role: 'user', content: `TÃ¬m mÃ³n: ${query}` }
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
            { role: 'system', content: 'Báº¡n lÃ  chuyÃªn gia áº©m thá»±c Viá»‡t Nam. Tráº£ lá»i JSON array. Má»—i mÃ³n cÃ³: name, time (sá»‘ phÃºt), calories (sá»‘ kcal), difficulty, description, ingredients (máº£ng {name, quantity}), instructions. Gá»£i Ã½ 3 mÃ³n Äƒn Viá»‡t Nam ngáº«u nhiÃªn, Ä‘a dáº¡ng.\n\nYÃŠU Cáº¦U QUAN TRá»ŒNG vá» instructions:\n- HÆ°á»›ng dáº«n Cá»°C Ká»² CHI TIáº¾T, nhÆ° Ä‘áº§u báº¿p chá»‰ ngÆ°á»i má»›i náº¥u.\n- Má»—i bÆ°á»›c cÃ³: lá»­a to/nhá», thá»i gian (phÃºt), kiá»ƒm tra Ä‘á»™ chÃ­n, máº¹o nhá».\n- instructions gá»“m 6-10 bÆ°á»›c, cÃ¡ch nhau báº±ng \\n.\n- KÃˆM Máº¸O vÃ  lÆ°u Ã½ á»Ÿ cuá»‘i.' },
            { role: 'user', content: 'Gá»£i Ã½ 3 mÃ³n Äƒn ngáº«u nhiÃªn cho hÃ´m nay' }
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

// ---- YouTube search for cooking videos ----
app.get('/api/youtube-video', async (req, res) => {
  const { dish } = req.query;
  if (!dish) return res.json({ videoId: null });

  try {
    const ytSearch = require('yt-search');
    const query = `cÃ¡ch náº¥u ${dish} cÃ¡ch lÃ m ${dish} hÆ°á»›ng dáº«n náº¥u`;
    const result = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
    const videos = result?.videos || [];
    // Æ¯u tiÃªn video tiáº¿ng Viá»‡t (cÃ³ tá»« "cÃ¡ch náº¥u", "cÃ¡ch lÃ m" trong title)
    const findBest = videos.find(v =>
      /cÃ¡ch (náº¥u|lÃ m)|hÆ°á»›ng dáº«n|cÃ´ng thá»©c|mÃ³n/i.test(v.title)
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

// ===================== Gá»£i Ã½ mÃ³n theo nguyÃªn liá»‡u (Tá»§ Láº¡nh) =====================

app.post('/api/suggest-by-ingredients', async (req, res) => {
  const { ingredients, forceAI } = req.body;
  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.json({ suggestions: [], fromCache: true });
  }

  // 1. TÃ¬m trong DB trÆ°á»›c (trá»« khi forceAI)
  let suggestions = [];
  if (!forceAI) {
    suggestions = await db.suggestDishesByIngredients(ingredients);
  }

  // 2. Náº¿u forceAI hoáº·c khÃ´ng Ä‘á»§ gá»£i Ã½ (dÆ°á»›i 3), gá»i DeepSeek
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
              { role: 'system', content: `Báº¡n lÃ  chuyÃªn gia áº©m thá»±c Viá»‡t Nam. Tráº£ lá»i JSON array.
TUYá»†T Äá»I TUÃ‚N THá»¦ format má»—i mÃ³n:
{ "name": "tÃªn mÃ³n", "time": 30, "calories": 350, "difficulty": "Dá»…", "description": "mÃ´ táº£", "ingredients": [{ "name": "nguyÃªn liá»‡u", "quantity": "sá»‘ lÆ°á»£ng" }], "instructions": "bÆ°á»›c 1\\nbÆ°á»›c 2\\nbÆ°á»›c 3" }

QUY Táº®C:
- NgÆ°á»i dÃ¹ng cÃ³ cÃ¡c nguyÃªn liá»‡u: ${ingsStr}
- Gá»£i Ã½ 3-4 mÃ³n cÃ³ thá»ƒ náº¥u tá»« cÃ¡c nguyÃªn liá»‡u nÃ y, chá»‰ cáº§n mua thÃªm tá»‘i Ä‘a 1-2 gia vá»‹/nguyÃªn liá»‡u phá»¥ thÃ´ng dá»¥ng.
- Æ¯u tiÃªn mÃ³n Viá»‡t Nam phá»• biáº¿n trong mÃ¢m cÆ¡m hÃ ng ngÃ y.
- Má»—i mÃ³n pháº£i ghi Äáº¦Y Äá»¦ nguyÃªn liá»‡u (ká»ƒ cáº£ cÃ¡i Ä‘Ã£ cÃ³ + cÃ¡i cáº§n mua thÃªm).
- time lÃ  sá»‘ phÃºt (number), calories lÃ  sá»‘ kcal (number).
	` },
              { role: 'user', content: `TÃ´i cÃ³ cÃ¡c nguyÃªn liá»‡u: ${ingsStr}. Gá»£i Ã½ tÃ´i náº¥u mÃ³n gÃ¬?` }
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

    // Fallback: náº¿u forceAI mÃ  DeepSeek khÃ´ng tráº£ vá» gÃ¬, láº¥y tá»« DB
    if (forceAI && suggestions.length === 0) {
      suggestions = await db.suggestDishesByIngredients(ingredients);
    }
  }

  res.json({ suggestions: suggestions.slice(0, 5), fromCache: true });
});


// ---- Image analysis API (dÃ¹ng Gemini Flash-Lite) ----
app.post('/api/analyze-image', async (req, res) => {
  const { image, mode } = req.body;
  if (!image) return res.json({ success: false, error: 'Missing image data' });

  const isFridge = mode === 'fridge';
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({
      success: false,
      error: 'Thiáº¿u GEMINI_API_KEY. Xem hÆ°á»›ng dáº«n trong file .env.example',
      needsApiKey: true
    });
  }

  try {
    const prompt = isFridge
      ? 'PhÃ¢n tÃ­ch áº£nh chá»¥p tá»§ láº¡nh nÃ y. Tráº£ vá» JSON há»£p lá»‡ (khÃ´ng markdown, khÃ´ng code block) vá»›i format: { "ingredients": ["tÃªn nguyÃªn liá»‡u 1", "tÃªn nguyÃªn liá»‡u 2", ...] }. Liá»‡t kÃª Táº¤T Cáº¢ nguyÃªn liá»‡u thá»±c pháº©m nhÃ¬n tháº¥y Ä‘Æ°á»£c (thá»‹t, cÃ¡, rau, cá»§, quáº£, trá»©ng, v.v.). Bá» qua gia vá»‹ khÃ´, chai lá», Ä‘á»“ Ä‘Ã³ng há»™p. Má»—i nguyÃªn liá»‡u viáº¿t hoa chá»¯ cÃ¡i Ä‘áº§u. Náº¿u khÃ´ng tháº¥y nguyÃªn liá»‡u nÃ o, tráº£ vá» { "ingredients": [] }'
      : 'PhÃ¢n tÃ­ch áº£nh mÃ³n Äƒn nÃ y. Tráº£ vá» JSON há»£p lá»‡ (khÃ´ng markdown, khÃ´ng code block) vá»›i format: { "name": "TÃªn mÃ³n", "time": "thá»i gian náº¥u (cÃ³ Ä‘Æ¡n vá»‹)", "calories": "lÆ°á»£ng calo (cÃ³ Ä‘Æ¡n vá»‹)", "difficulty": "Dá»…/Trung bÃ¬nh/KhÃ³", "description": "mÃ´ táº£ ngáº¯n", "ingredients": [{"name": "tÃªn nguyÃªn liá»‡u", "quantity": "sá»‘ lÆ°á»£ng", "price": 0}], "instructions": "bÆ°á»›c 1\\nbÆ°á»›c 2\\nbÆ°á»›c 3\\n..." }. Náº¿u khÃ´ng nháº­n diá»‡n Ä‘Æ°á»£c mÃ³n, hÃ£y tráº£ vá» mÃ³n Äƒn báº¥t ká»³ nhÃ¬n tháº¥y trong áº£nh.\n\nYÃŠU Cáº¦U QUAN TRá»ŒNG vá» instructions: hÆ°á»›ng dáº«n CHI TIáº¾T vá»›i 6-10 bÆ°á»›c, má»—i bÆ°á»›c ghi rÃµ lá»­a to/nhá», thá»i gian chÃ­nh xÃ¡c (phÃºt), kiá»ƒm tra Ä‘á»™ chÃ­n, kÃ¨m máº¹o nhá» vÃ  lÆ°u Ã½ á»Ÿ cuá»‘i.'

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
        error: `Lá»—i Gemini API (${response.status}). ${errText.slice(0, 100)}`
      });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON tá»« response
    let parsed = null;
    try {
      // Loáº¡i bá» markdown code block náº¿u cÃ³
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
      return res.json({ success: false, error: 'KhÃ´ng nháº­n diá»‡n Ä‘Æ°á»£c nguyÃªn liá»‡u tá»« áº£nh.' });
    }

    if (parsed && parsed.name) {
      return res.json({ success: true, data: parsed });
    }
    return res.json({ success: false, error: 'KhÃ´ng nháº­n diá»‡n Ä‘Æ°á»£c mÃ³n Äƒn tá»« áº£nh.', raw: content });
  } catch (err) {
    console.error('[Gemini Vision] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

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

  if (lastUserMsg.toLowerCase().includes('thay tháº¿') || lastUserMsg.includes('substitute')) {
    return {
      choices: [{
        message: {
          content: JSON.stringify([
            { original: 'Thá»‹t náº¡m bÃ²', substitute: 'Gáº§u bÃ²', note: 'Gáº§u sáº½ giÃ²n hÆ¡n nhÆ°ng bÃ©o hÆ¡n 15%' },
            { original: 'BÃ¡nh phá»Ÿ tÆ°Æ¡i', substitute: 'BÃ¡nh phá»Ÿ khÃ´', note: 'Dá»… báº£o quáº£n hÆ¡n, cáº§n ngÃ¢m nÆ°á»›c 15p' }
          ])
        }
      }]
    };
  }

  if (lastUserMsg.toLowerCase().includes('phÃ¢n tÃ­ch') || lastUserMsg.includes('thÃ³i quen')) {
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            insight: 'Dá»±a trÃªn thÃ³i quen cá»§a báº¡n, MealPlan Ä‘á» xuáº¥t giáº£m 15% lÆ°á»£ng thá»‹t Ä‘á» vÃ  tÄƒng cÆ°á»ng rau xanh vÃ o tá»‘i Thá»© NÄƒm.',
            trend: '+12%',
            suggestion: 'TÄƒng cÆ°á»ng rau xanh vÃ o bá»¯a tá»‘i'
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
            name: 'Salad CÃ¡ Há»“i Ãp Cháº£o',
            time: '20 ph', calories: '450 kcal', difficulty: 'Dá»…',
            description: 'MÃ³n salad tÆ°Æ¡i mÃ¡t káº¿t há»£p cÃ¡ há»“i Ã¡p cháº£o giÃ²n bÃªn ngoÃ i, má»m bÃªn trong cÃ¹ng rau xÃ  lÃ¡ch vÃ  bÆ¡.',
            ingredients: [
              { name: 'CÃ¡ há»“i phi lÃª', quantity: '200g', price: 0 },
              { name: 'XÃ  lÃ¡ch', quantity: '100g', price: 0 },
              { name: 'CÃ  chua bi', quantity: '100g', price: 0 },
              { name: 'BÆ¡', quantity: '1 quáº£', price: 0 },
              { name: 'Sá»‘t mÃ¨ rang', quantity: '30ml', price: 0 }
            ],
            instructions: '1. CÃ¡ há»“i rá»­a sáº¡ch, tháº¥m khÃ´ báº±ng khÄƒn giáº¥y. Æ¯á»›p Ä‘á»u 2 máº·t vá»›i 1/2 thÃ¬a muá»‘i, 1/2 thÃ¬a tiÃªu, 1 thÃ¬a dáº§u oliu. Äá»ƒ tháº¥m 10 phÃºt.\n2. Báº¯c cháº£o chá»‘ng dÃ­nh lÃªn báº¿p, cho 1 thÃ¬a dáº§u oliu, lá»­a vá»«a-lá»›n. Äá»£i dáº§u nÃ³ng giÃ  (tháº¥y khÃ³i nháº¹).\n3. Cho cÃ¡ há»“i vÃ o Ã¡p cháº£o, máº·t da xuá»‘ng trÆ°á»›c. ChiÃªn 3-4 phÃºt lá»­a vá»«a Ä‘áº¿n khi da vÃ ng giÃ²n.\n4. Láº­t máº·t cÃ¡, chiÃªn thÃªm 2-3 phÃºt (tuá»³ Ä‘á»™ dÃ y). Thá»‹t cÃ¡ chÃ­n tá»›i sáº½ dá»… dÃ ng tÃ¡ch thÃ nh tá»«ng mÃºi.\n5. XÃ  lÃ¡ch rá»­a sáº¡ch, ngÃ¢m nÆ°á»›c muá»‘i 5 phÃºt, Ä‘á»ƒ rÃ¡o. CÃ  chua bi bá»• Ä‘Ã´i. BÆ¡ thÃ¡i lÃ¡t má»ng.\n6. Xáº¿p rau ra Ä‘Ä©a lá»›n, Ä‘áº·t cÃ¡ há»“i lÃªn trÃªn. RÆ°á»›i sá»‘t mÃ¨ rang hoáº·c sá»‘t dáº§u giáº¥m.\nðŸ’¡ Máº¹o: KhÃ´ng chiÃªn cÃ¡ quÃ¡ lÃ¢u - cÃ¡ há»“i sáº½ bá»‹ khÃ´. Thá»‹t cÃ²n hÆ¡i há»“ng á»Ÿ trung tÃ¢m lÃ  ngon nháº¥t. CÃ³ thá»ƒ thay sá»‘t mÃ¨ rang báº±ng sá»‘t chanh dÃ¢y hoáº·c tÆ°Æ¡ng á»›t HÃ n Quá»‘c.'
          },
          {
            name: 'BÃ² XÃ o BÃ´ng Cáº£i Xanh',
            time: '15 ph', calories: '520 kcal', difficulty: 'Dá»…',
            description: 'Thá»‹t bÃ² má»m ngá»t káº¿t há»£p bÃ´ng cáº£i xanh giÃ²n, thÃ­ch há»£p cho bá»¯a tá»‘i nhanh gá»n.',
            ingredients: [
              { name: 'Thá»‹t bÃ² thÄƒn', quantity: '200g', price: 0 },
              { name: 'BÃ´ng cáº£i xanh', quantity: '200g', price: 0 },
              { name: 'á»št chuÃ´ng', quantity: '1 quáº£', price: 0 },
              { name: 'Tá»i', quantity: '3 tÃ©p', price: 0 }
            ],
            instructions: '1. Thá»‹t bÃ² thÃ¡i lÃ¡t má»ng, Æ°á»›p vá»›i dáº§u hÃ o, tiÃªu 5 phÃºt.\n2. BÃ´ng cáº£i tÃ¡ch nhá», luá»™c sÆ¡ 2 phÃºt.\n3. Phi tá»i thÆ¡m, xÃ o bÃ² lá»­a lá»›n 2 phÃºt, cho bÃ´ng cáº£i vÃ o Ä‘áº£o Ä‘á»u.\n4. NÃªm náº¿m gia vá»‹, táº¯t báº¿p, thÃªm á»›t chuÃ´ng thÃ¡i sá»£i.'
          },
          {
            name: 'Canh Chua CÃ¡ LÃ³c',
            time: '30 ph', calories: '380 kcal', difficulty: 'Trung bÃ¬nh',
            description: 'Canh chua ngá»t thanh vá»›i cÃ¡ lÃ³c tÆ°Æ¡i, Ä‘áº­u báº¯p vÃ  giÃ¡ Ä‘á»— â€” mÃ³n Äƒn dÃ¢n dÃ£ khÃ³ cÆ°á»¡ng.',
            ingredients: [
              { name: 'CÃ¡ lÃ³c', quantity: '300g', price: 0 },
              { name: 'Me', quantity: '50g', price: 0 },
              { name: 'Äáº­u báº¯p', quantity: '100g', price: 0 },
              { name: 'GiÃ¡ Ä‘á»—', quantity: '100g', price: 0 }
            ],
            instructions: '1. CÃ¡ lÃ³c lÃ m sáº¡ch, cáº¯t khÃºc, rá»­a vá»›i muá»‘i.\n2. Me ngÃ¢m nÆ°á»›c áº¥m, bá» háº¡t, láº¥y nÆ°á»›c cá»‘t.\n3. Náº¥u nÆ°á»›c sÃ´i, cho cÃ¡ vÃ o, há»›t bá»t.\n4. ThÃªm me, Ä‘áº­u báº¯p, giÃ¡ Ä‘á»—, nÃªm nÆ°á»›c máº¯m, Ä‘Æ°á»ng.\n5. Táº¯t báº¿p, thÃªm rau thÆ¡m.'
          }
        ])
      }
    }]
  };
}

// Export for Vercel
module.exports = app;

