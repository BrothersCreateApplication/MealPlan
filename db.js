// ===================== Database Module (SQLite) =====================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'mealplan.db');

let db;

// ---- Bỏ dấu tiếng Việt ----
function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // xoá dấu
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// ---- Seed dishes ----
const SEED_DISHES = [
  { name: 'Thịt Ba Chỉ Luộc', time: '25 ph', calories: '350 kcal', difficulty: 'Dễ', description: 'Thịt ba chỉ luộc chín tới, thái lát mỏng, chấm nước mắm tỏi ớt.', ingredients: [{ name: 'Thịt ba chỉ', quantity: '300g', price: 0 }, { name: 'Muối', quantity: '1 thìa', price: 0 }, { name: 'Sả', quantity: '2 cây', price: 0 }], instructions: '1. Thịt ba chỉ rửa sạch, cạo lông.\n2. Luộc thịt với nước lạnh, thêm sả và muối.\n3. Luộc lửa vừa 20 phút, tắt bếp ngâm 5 phút.\n4. Vớt ra thái lát mỏng.' },
  { name: 'Thịt Luộc Cuốn Bánh Tráng', time: '30 ph', calories: '420 kcal', difficulty: 'Trung bình', description: 'Thịt luộc thái mỏng cuốn bánh tráng với rau sống, chấm nước mắm chua ngọt.', ingredients: [{ name: 'Thịt ba chỉ', quantity: '300g', price: 0 }, { name: 'Bánh tráng', quantity: '10 cái', price: 0 }, { name: 'Rau sống', quantity: '200g', price: 0 }], instructions: '1. Thịt ba chỉ luộc chín, thái lát mỏng.\n2. Bánh tráng nhúng nước, trải ra.\n3. Xếp rau và thịt lên bánh tráng, cuốn chặt.\n4. Pha nước mắm chua ngọt chấm kèm.' },
  { name: 'Salad Thịt Luộc Rau Củ', time: '15 ph', calories: '280 kcal', difficulty: 'Dễ', description: 'Salad thịt luộc thái sợi trộn rau củ.', ingredients: [{ name: 'Thịt ba chỉ luộc', quantity: '200g', price: 0 }, { name: 'Xà lách', quantity: '100g', price: 0 }, { name: 'Cà rốt', quantity: '1 củ', price: 0 }], instructions: '1. Thịt luộc thái sợi.\n2. Rau củ rửa sạch, thái sợi.\n3. Trộn đều với sốt dầu giấm.' },
  { name: 'Gà Chiên Giòn', time: '30 ph', calories: '580 kcal', difficulty: 'Trung bình', description: 'Gà chiên giòn rụm, thích hợp bữa tối cuối tuần.', ingredients: [{ name: 'Đùi gà', quantity: '4 cái', price: 0 }, { name: 'Bột chiên giòn', quantity: '200g', price: 0 }], instructions: '1. Gà ướp gia vị.\n2. Lăn qua bột chiên.\n3. Chiên ngập dầu 12 phút.' },
  { name: 'Cá Hấp Xì Dầu', time: '20 ph', calories: '320 kcal', difficulty: 'Dễ', description: 'Cá hấp xì dầu, gừng và hành lá.', ingredients: [{ name: 'Cá chép', quantity: '1 con', price: 0 }, { name: 'Xì dầu', quantity: '3 thìa', price: 0 }, { name: 'Gừng', quantity: '1 nhánh', price: 0 }], instructions: '1. Cá làm sạch.\n2. Xếp gừng, hành lên cá.\n3. Hấp cách thủy 15 phút.' },
  { name: 'Bò Xào Súp Lơ', time: '15 ph', calories: '480 kcal', difficulty: 'Dễ', description: 'Thịt bò xào nhanh với súp lơ xanh.', ingredients: [{ name: 'Thịt bò thăn', quantity: '200g', price: 0 }, { name: 'Súp lơ xanh', quantity: '200g', price: 0 }, { name: 'Tỏi', quantity: '3 tép', price: 0 }], instructions: '1. Thịt bò thái lát ướp.\n2. Phi tỏi, xào bò 2 phút.\n3. Cho súp lơ vào đảo đều.' },
  { name: 'Thịt Kho Tàu', time: '60 ph', calories: '520 kcal', difficulty: 'Trung bình', description: 'Thịt kho nước dừa và trứng cút.', ingredients: [{ name: 'Thịt ba chỉ', quantity: '300g', price: 0 }, { name: 'Trứng cút', quantity: '10 quả', price: 0 }, { name: 'Nước dừa', quantity: '200ml', price: 0 }], instructions: '1. Thịt thái miếng ướp.\n2. Phi hành, xào thịt săn.\n3. Đổ nước dừa, kho lửa nhỏ 45 phút.' },
  { name: 'Canh Chua Cá Lóc', time: '30 ph', calories: '380 kcal', difficulty: 'Trung bình', description: 'Canh chua ngọt thanh với cá lóc tươi.', ingredients: [{ name: 'Cá lóc', quantity: '300g', price: 0 }, { name: 'Me', quantity: '50g', price: 0 }, { name: 'Đậu bắp', quantity: '100g', price: 0 }, { name: 'Giá đỗ', quantity: '100g', price: 0 }], instructions: '1. Cá lóc làm sạch.\n2. Me ngâm nước ấm.\n3. Nấu sôi, cho cá vào.\n4. Thêm me, đậu bắp.' }
];

function initDatabase() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Custom function để search không phân biệt dấu tiếng Việt
  db.function('remove_accents', (text) => removeAccents(text));

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS dishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      time TEXT DEFAULT '',
      calories TEXT DEFAULT '',
      difficulty TEXT DEFAULT '',
      description TEXT DEFAULT '',
      instructions TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dish_ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity TEXT DEFAULT '',
      price REAL DEFAULT 0,
      FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
    );
  `);

  // Check if we have data; if not, seed from JSON or built-in
  const count = db.prepare('SELECT COUNT(*) as c FROM dishes').get();
  if (count.c === 0) {
    // Try to migrate from dishes.json first
    const jsonPath = path.join(__dirname, 'dishes.json');
    let migrated = false;
    if (fs.existsSync(jsonPath)) {
      try {
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (Array.isArray(jsonData) && jsonData.length > 0) {
          const insertDish = db.prepare('INSERT OR IGNORE INTO dishes (name, time, calories, difficulty, description, instructions) VALUES (?, ?, ?, ?, ?, ?)');
          const insertIng = db.prepare('INSERT INTO dish_ingredients (dish_id, name, quantity, price) VALUES (?, ?, ?, ?)');
          const tx = db.transaction(() => {
            for (const dish of jsonData) {
              const time = dish.time ? String(dish.time) : '';
              const calories = dish.calories ? String(dish.calories) : '';
              const result = insertDish.run(dish.name, time, calories, dish.difficulty || '', dish.description || '', dish.instructions || '');
              const dishId = result.lastInsertRowid;
              if (dish.ingredients && Array.isArray(dish.ingredients)) {
                for (const ing of dish.ingredients) {
                  insertIng.run(dishId, ing.name, String(ing.quantity || ''), ing.price || 0);
                }
              }
            }
          });
          tx();
          migrated = true;
          console.log(`[DB] Migrated ${jsonData.length} dishes from dishes.json`);
        }
      } catch (e) {
        console.warn('[DB] Failed to migrate dishes.json:', e.message);
      }
    }

    if (!migrated) {
      // Seed with built-in dishes
      seedDishes(SEED_DISHES);
    }
  }

  console.log('[DB] Database initialized at', DB_PATH);
  const totalDishes = db.prepare('SELECT COUNT(*) as c FROM dishes').get();
  console.log(`[DB] Total dishes in DB: ${totalDishes.c}`);
  return db;
}

function seedDishes(dishes) {
  const insertDish = db.prepare('INSERT OR IGNORE INTO dishes (name, time, calories, difficulty, description, instructions) VALUES (?, ?, ?, ?, ?, ?)');
  const insertIng = db.prepare('INSERT INTO dish_ingredients (dish_id, name, quantity, price) VALUES (?, ?, ?, ?)');

  const tx = db.transaction(() => {
    for (const dish of dishes) {
      const result = insertDish.run(dish.name, dish.time || '', dish.calories || '', dish.difficulty || '', dish.description || '', dish.instructions || '');
      const dishId = result.lastInsertRowid;
      if (dish.ingredients && Array.isArray(dish.ingredients)) {
        for (const ing of dish.ingredients) {
          insertIng.run(dishId, ing.name, String(ing.quantity || ''), ing.price || 0);
        }
      }
    }
  });
  tx();
}

// ---- Query: Get all dishes with ingredients ----
function getAllDishes() {
  const dishes = db.prepare('SELECT * FROM dishes ORDER BY name ASC').all();
  return dishes.map(d => enrichDish(d));
}

// ---- Query: Get dish by name ----
function getDishByName(name) {
  const dish = db.prepare('SELECT * FROM dishes WHERE name = ?').get(name);
  return dish ? enrichDish(dish) : null;
}

// ---- Query: Search dishes by keywords ----
function searchDishes(keywords) {
  if (!keywords || keywords.length === 0) return getAllDishes();

  // Bỏ dấu keywords để search không phân biệt dấu
  const conditions = keywords.map(() => "remove_accents(name) LIKE ?");
  const params = keywords.map(k => `%${removeAccents(k)}%`);
  const sql = `SELECT * FROM dishes WHERE ${conditions.join(' AND ')} ORDER BY name ASC LIMIT 20`;

  const dishes = db.prepare(sql).all(...params);
  return dishes.map(d => enrichDish(d));
}

// ---- Query: Get random dishes ----
function getRandomDishes(count = 3) {
  const dishes = db.prepare('SELECT * FROM dishes ORDER BY RANDOM() LIMIT ?').all(count);
  return dishes.map(d => enrichDish(d));
}

// ---- Insert dish with ingredients ----
function addDish(dish) {
  const insertDish = db.prepare('INSERT OR IGNORE INTO dishes (name, time, calories, difficulty, description, instructions) VALUES (?, ?, ?, ?, ?, ?)');
  const insertIng = db.prepare('INSERT INTO dish_ingredients (dish_id, name, quantity, price) VALUES (?, ?, ?, ?)');
  const updateDish = db.prepare('UPDATE dishes SET time=?, calories=?, difficulty=?, description=?, instructions=?, updated_at=CURRENT_TIMESTAMP WHERE name=?');

  const tx = db.transaction(() => {
    // Check if exists
    const existing = db.prepare('SELECT id FROM dishes WHERE name = ?').get(dish.name);
    if (existing) {
      // Update existing dish
      updateDish.run(dish.time || '', dish.calories || '', dish.difficulty || '', dish.description || '', dish.instructions || '', dish.name);
      // Replace ingredients: delete old, insert new
      db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ?').run(existing.id);
      if (dish.ingredients && Array.isArray(dish.ingredients)) {
        for (const ing of dish.ingredients) {
          insertIng.run(existing.id, ing.name, String(ing.quantity || ''), ing.price || 0);
        }
      }
      return { action: 'updated', id: existing.id };
    } else {
      const result = insertDish.run(dish.name, dish.time || '', dish.calories || '', dish.difficulty || '', dish.description || '', dish.instructions || '');
      const dishId = result.lastInsertRowid;
      if (dish.ingredients && Array.isArray(dish.ingredients)) {
        for (const ing of dish.ingredients) {
          insertIng.run(dishId, ing.name, String(ing.quantity || ''), ing.price || 0);
        }
      }
      return { action: 'inserted', id: dishId };
    }
  });

  return tx();
}

// ---- Insert multiple dishes (from DeepSeek results) ----
function addNewDishes(dishes) {
  const results = [];
  for (const dish of dishes) {
    if (dish.name) {
      results.push(addDish(dish));
    }
  }
  return results;
}

// ---- Delete dish ----
function deleteDish(name) {
  const dish = db.prepare('SELECT id FROM dishes WHERE name = ?').get(name);
  if (!dish) return false;
  db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ?').run(dish.id);
  db.prepare('DELETE FROM dishes WHERE id = ?').run(dish.id);
  return true;
}

// ---- Helper: enrich dish row with ingredients array ----
function enrichDish(dish) {
  const ingredients = db.prepare('SELECT name, quantity, price FROM dish_ingredients WHERE dish_id = ?').all(dish.id);
  return {
    ...dish,
    ingredients
  };
}

// ---- Close database ----
function closeDatabase() {
  if (db) {
    db.close();
    console.log('[DB] Database closed');
  }
}

// ---- Common basic seasonings (coi như luôn có) ----
const BASIC_SEASONINGS = [
  'muối', 'tiêu', 'đường', 'nước mắm', 'dầu ăn', 'dầu hào', 'hạt nêm',
  'bột ngọt', 'tỏi', 'hành tím', 'hành lá', 'ớt', 'chanh', 'gừng', 'sả',
  'bột canh', 'bột nghệ', 'dầu oliu', 'dầu mè', 'tương ớt', 'tương cà',
  'giấm', 'rượu trắng', 'nước tương', 'xì dầu'
];

// ---- Tìm món phù hợp với nguyên liệu có sẵn ----
// availableIngredients: mảng string tên nguyên liệu user có
// Trả về: mảng { dish, matchPercent, matched, missing, needsShopping }
function suggestDishesByIngredients(availableIngredients, limit = 5) {
  if (!availableIngredients || availableIngredients.length === 0) return [];

  const normalizedAvailable = availableIngredients.map(i => removeAccents(i.toLowerCase().trim()));
  const allDishes = getAllDishes();

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

  // Sort: matchPercent descending, then fewer missing items first
  scored.sort((a, b) => {
    if (b.matchPercent !== a.matchPercent) return b.matchPercent - a.matchPercent;
    return a.missing.length - b.missing.length;
  });

  // Chỉ giữ món có matchPercent > 0 (có ít nhất 1 nguyên liệu chính match)
  return scored.filter(s => s.matchPercent > 0).slice(0, limit);
}

module.exports = {
  initDatabase,
  getAllDishes,
  getDishByName,
  searchDishes,
  getRandomDishes,
  addDish,
  addNewDishes,
  deleteDish,
  closeDatabase,
  suggestDishesByIngredients,
  removeAccents,
  BASIC_SEASONINGS,
  SEED_DISHES
};
