// ===================== Supabase Helper Module =====================
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fuqpgtyuuzegycnazdxv.supabase.co';
// Service role key — chỉ dùng server-side, không bao giờ leak ra client
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_SERVICE_KEY) {
      console.error('[Supabase] Missing SUPABASE_SERVICE_KEY in environment');
      return null;
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log('[Supabase] Client initialized');
  }
  return supabase;
}

// ---- Normalize: map dish_ingredients → ingredients cho frontend ----
function normalizeDish(dish) {
  if (!dish) return dish;
  const d = { ...dish };
  if (d.dish_ingredients && !d.ingredients) {
    d.ingredients = d.dish_ingredients;
  }
  delete d.dish_ingredients;
  return d;
}

function normalizeDishes(dishes) {
  return (dishes || []).map(normalizeDish);
}

// ---- Dishes CRUD ----

async function getAllDishes() {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('dishes')
    .select('*, dish_ingredients(*)')
    .order('name', { ascending: true });
  if (error) {
    console.error('[Supabase] getAllDishes error:', error.message);
    return [];
  }
  return normalizeDishes(data);
}

async function getDishByName(name) {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from('dishes')
    .select('*, dish_ingredients(*)')
    .eq('name', name)
    .single();
  if (error) return null;
  return normalizeDish(data);
}

async function searchDishes(keywords, fullQuery) {
  const client = getClient();
  if (!client || !keywords || keywords.length === 0) return { exactMatch: [], andMatch: [], orMatch: [] };

  const { data, error } = await client
    .from('dishes')
    .select('*, dish_ingredients(*)')
    .order('name')
    .limit(50);

  if (error) {
    console.error('[Supabase] searchDishes error:', error.message);
    return { exactMatch: [], andMatch: [], orMatch: [] };
  }

  let dishes = normalizeDishes(data);

  // Phân loại 3 cấp độ ưu tiên:
  // 1. Exact-match: tên món chứa full cụm từ (VD: "thịt luộc" → "Thịt luộc", "Thịt luộc cuốn bánh tráng")
  // 2. AND-match: tên món chứa tất cả từ (VD: "thịt" + "luộc")
  // 3. OR-match: tên món chứa ít nhất 1 từ
  const exactMatch = dishes.filter(d => {
    if (!d.name) return false;
    return d.name.toLowerCase().includes(fullQuery);
  });

  const seenExact = new Set(exactMatch.map(d => d.name?.toLowerCase()));

  const andMatch = dishes.filter(d => {
    if (!d.name) return false;
    if (seenExact.has(d.name.toLowerCase())) return false;
    const name = d.name.toLowerCase();
    return keywords.every(k => name.includes(k));
  });

  const seenAnd = new Set([...seenExact, ...andMatch.map(d => d.name?.toLowerCase())]);

  const orMatch = dishes.filter(d => {
    if (!d.name) return false;
    if (seenAnd.has(d.name.toLowerCase())) return false;
    const name = d.name.toLowerCase();
    return keywords.some(k => name.includes(k));
  });

  return { exactMatch, andMatch, orMatch };
}

async function getRandomDishes(count = 3) {
  const client = getClient();
  if (!client) return [];

  // Dùng fallback: lấy danh sách dishes + ingredients, shuffle client-side
  const { data: d, error: e } = await client
    .from('dishes')
    .select('*, dish_ingredients(*)');
  if (e) {
    console.error('[Supabase] getRandomDishes error:', e.message);
    return [];
  }
  // Shuffle client-side và lấy count món
  const shuffled = (d || []).sort(() => Math.random() - 0.5).slice(0, count);
  return normalizeDishes(shuffled);
}

async function addDish(dish) {
  const client = getClient();
  if (!client) return null;

  // Check if exists
  const existing = await getDishByName(dish.name);
  if (existing) {
    // Update
    const { error: updateErr } = await client
      .from('dishes')
      .update({
        time: String(dish.time || ''),
        calories: String(dish.calories || ''),
        difficulty: dish.difficulty || '',
        description: dish.description || '',
        instructions: dish.instructions || '',
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
    if (updateErr) {
      console.error('[Supabase] update dish error:', updateErr.message);
      return null;
    }

    // Replace ingredients
    await client.from('dish_ingredients').delete().eq('dish_id', existing.id);
    if (dish.ingredients && Array.isArray(dish.ingredients)) {
      const { error: ingErr } = await client
        .from('dish_ingredients')
        .insert(dish.ingredients.map(ing => ({
          dish_id: existing.id,
          name: ing.name,
          quantity: String(ing.quantity || ''),
          price: ing.price || 0
        })));
      if (ingErr) console.error('[Supabase] update ingredients error:', ingErr.message);
    }
    return { action: 'updated', id: existing.id };
  }

  // Insert new
  const { data: dishData, error: dishErr } = await client
    .from('dishes')
    .insert({
      name: dish.name,
      time: String(dish.time || ''),
      calories: String(dish.calories || ''),
      difficulty: dish.difficulty || '',
      description: dish.description || '',
      instructions: dish.instructions || ''
    })
    .select()
    .single();
  if (dishErr) {
    console.error('[Supabase] insert dish error:', dishErr.message);
    return null;
  }

  const dishId = dishData.id;
  if (dish.ingredients && Array.isArray(dish.ingredients)) {
    const { error: ingErr } = await client
      .from('dish_ingredients')
      .insert(dish.ingredients.map(ing => ({
        dish_id: dishId,
        name: ing.name,
        quantity: String(ing.quantity || ''),
        price: ing.price || 0
      })));
    if (ingErr) console.error('[Supabase] insert ingredients error:', ingErr.message);
  }

  return { action: 'inserted', id: dishId };
}

async function addNewDishes(dishes) {
  const results = [];
  for (const dish of dishes) {
    if (dish.name) {
      const r = await addDish(dish);
      if (r) results.push(r);
    }
  }
  return results;
}

async function deleteDish(name) {
  const client = getClient();
  if (!client) return false;
  const { error } = await client.from('dishes').delete().eq('name', name);
  if (error) {
    console.error('[Supabase] delete dish error:', error.message);
    return false;
  }
  return true;
}

// ---- Gợi ý món theo nguyên liệu ----
const BASIC_SEASONINGS = [
  'muối', 'tiêu', 'đường', 'nước mắm', 'dầu ăn', 'dầu hào', 'hạt nêm',
  'bột ngọt', 'tỏi', 'hành tím', 'hành lá', 'ớt', 'chanh', 'gừng', 'sả',
  'bột canh', 'bột nghệ', 'dầu oliu', 'dầu mè', 'tương ớt', 'tương cà',
  'giấm', 'rượu trắng', 'nước tương', 'xì dầu'
];

function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

async function suggestDishesByIngredients(availableIngredients, limit = 5) {
  if (!availableIngredients || availableIngredients.length === 0) return [];

  const allDishes = await getAllDishes();
  const normalizedAvailable = availableIngredients.map(i => removeAccents(i.toLowerCase().trim()));

  const scored = allDishes.map(dish => {
    const dishIngs = dish.ingredients || [];
    if (dishIngs.length === 0) return null;

    const results = dishIngs.map(ing => {
      const ingName = removeAccents(ing.name.toLowerCase().trim());
      const isAvailable = normalizedAvailable.some(avail =>
        ingName.includes(avail) || avail.includes(ingName)
      );
      const isBasic = BASIC_SEASONINGS.some(b =>
        ingName.includes(removeAccents(b))
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
      dish,
      matchPercent,
      matched: results.filter(r => r.isAvailable),
      missing,
      needsShopping: missing.length > 0
    };
  }).filter(Boolean);

  scored.sort((a, b) => {
    if (b.matchPercent !== a.matchPercent) return b.matchPercent - a.matchPercent;
    return a.missing.length - b.missing.length;
  });

  return scored.filter(s => s.matchPercent > 0).slice(0, limit);
}

// ---- Database health check ----
async function getDishCount() {
  const client = getClient();
  if (!client) return 0;
  const { count, error } = await client
    .from('dishes')
    .select('*', { count: 'exact', head: true });
  if (error) return 0;
  return count || 0;
}

module.exports = {
  getClient,
  getAllDishes,
  getDishByName,
  searchDishes,
  getRandomDishes,
  addDish,
  addNewDishes,
  deleteDish,
  suggestDishesByIngredients,
  removeAccents,
  BASIC_SEASONINGS,
  getDishCount
};
