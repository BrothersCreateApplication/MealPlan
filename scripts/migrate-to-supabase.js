// ===================== Migrate SQLite → Supabase =====================
// Chạy: node scripts/migrate-to-supabase.js
// Cần SUPABASE_SERVICE_KEY trong .env

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sqliteDb = require('../db');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fuqpgtyuuzegycnazdxv.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_KEY in .env');
  console.error('Add: SUPABASE_SERVICE_KEY=your_service_role_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function migrate() {
  console.log('🔄 Starting migration SQLite → Supabase...\n');

  // 1. Lấy dữ liệu từ SQLite
  sqliteDb.initDatabase();
  const dishes = sqliteDb.getAllDishes();
  console.log(`📦 Found ${dishes.length} dishes in SQLite\n`);

  let success = 0;
  let failed = 0;

  for (const dish of dishes) {
    try {
      // Check if already exists
      const { data: existing } = await supabase
        .from('dishes')
        .select('id')
        .eq('name', dish.name)
        .maybeSingle();

      if (existing) {
        console.log(`⏭️  Skipping "${dish.name}" (already exists)`);
        continue;
      }

      // Insert dish
      const { data: dishData, error: dishErr } = await supabase
        .from('dishes')
        .insert({
          name: dish.name,
          time: dish.time || '',
          calories: dish.calories || '',
          difficulty: dish.difficulty || '',
          description: dish.description || '',
          instructions: dish.instructions || ''
        })
        .select()
        .single();

      if (dishErr) {
        console.error(`❌ Failed insert "${dish.name}": ${dishErr.message}`);
        failed++;
        continue;
      }

      // Insert ingredients
      if (dish.ingredients && dish.ingredients.length > 0) {
        const { error: ingErr } = await supabase
          .from('dish_ingredients')
          .insert(dish.ingredients.map(ing => ({
            dish_id: dishData.id,
            name: ing.name,
            quantity: String(ing.quantity || ''),
            price: ing.price || 0
          })));

        if (ingErr) {
          console.error(`⚠️  "${dish.name}": ingredient error ${ingErr.message}`);
        }
      }

      console.log(`✅ Migrated "${dish.name}" (ID: ${dishData.id})`);
      success++;
    } catch (e) {
      console.error(`❌ Error "${dish.name}": ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Result: ${success} success, ${failed} failed`);

  // Verify
  const { count } = await supabase
    .from('dishes')
    .select('*', { count: 'exact', head: true });
  console.log(`📊 Supabase total dishes: ${count}`);

  sqliteDb.closeDatabase();
  console.log('\n✅ Migration complete!');
}

migrate().catch(console.error);
