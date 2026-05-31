// ===================== Trang Chủ Module =====================

(function() {
  let currentDishes = []; // cache for detail button by index
  let isSearchMode = false;
  let lastSearchQuery = '';
  let isLoadingMore = false;

  // ---- Dish image helpers ----
  // Sắp xếp keyword dài nhất trước để ưu tiên khớp chính xác hơn
  const dishVisuals = (() => {
    const map = {
      'salad': { gradient: 'bg-gradient-to-br from-lime-400/30 to-green-300/30', emoji: '🥗' },
      'phở': { gradient: 'bg-gradient-to-br from-amber-500/30 to-orange-400/30', emoji: '🍜' },
      'bánh': { gradient: 'bg-gradient-to-br from-purple-400/30 to-fuchsia-300/30', emoji: '🥟' },
      'trứng': { gradient: 'bg-gradient-to-br from-yellow-300/30 to-amber-200/30', emoji: '🥚' },
      'cơm': { gradient: 'bg-gradient-to-br from-orange-400/30 to-yellow-300/30', emoji: '🍚' },
      'canh': { gradient: 'bg-gradient-to-br from-teal-400/30 to-cyan-300/30', emoji: '🥣' },
      'nướng': { gradient: 'bg-gradient-to-br from-red-500/30 to-orange-400/30', emoji: '🔥' },
      'chiên': { gradient: 'bg-gradient-to-br from-amber-400/30 to-yellow-300/30', emoji: '🍳' },
      'xào': { gradient: 'bg-gradient-to-br from-orange-400/30 to-yellow-300/30', emoji: '🥘' },
      'kho': { gradient: 'bg-gradient-to-br from-amber-500/30 to-orange-400/30', emoji: '🍲' },
      'luộc': { gradient: 'bg-gradient-to-br from-teal-400/30 to-cyan-300/30', emoji: '🥟' },
      'rau': { gradient: 'bg-gradient-to-br from-green-400/30 to-emerald-300/30', emoji: '🥬' },
      'tôm': { gradient: 'bg-gradient-to-br from-pink-400/30 to-orange-300/30', emoji: '🦐' },
      'cá': { gradient: 'bg-gradient-to-br from-blue-400/30 to-teal-300/30', emoji: '🐟' },
      'gà': { gradient: 'bg-gradient-to-br from-amber-400/30 to-yellow-300/30', emoji: '🍗' },
      'bò': { gradient: 'bg-gradient-to-br from-red-500/30 to-orange-400/30', emoji: '🥩' },
      'heo': { gradient: 'bg-gradient-to-br from-rose-400/30 to-pink-300/30', emoji: '🐷' },
      'lợn': { gradient: 'bg-gradient-to-br from-rose-400/30 to-pink-300/30', emoji: '🐷' },
      'chả': { gradient: 'bg-gradient-to-br from-red-400/30 to-amber-300/30', emoji: '🥓' },
      'mì': { gradient: 'bg-gradient-to-br from-yellow-500/30 to-orange-400/30', emoji: '🍝' },
    };
    // Sắp xếp key dài nhất lên đầu để ưu tiên khớp chính xác
    return Object.fromEntries(
      Object.entries(map).sort(([a], [b]) => b.length - a.length)
    );
  })();
  const defaultVisual = { gradient: 'bg-gradient-to-br from-primary/10 to-primary-container/20', emoji: '🍽️' };

  function getDishVisual(name) {
    const lower = name.toLowerCase();
    for (const [key, visual] of Object.entries(dishVisuals)) {
      if (lower.includes(key)) return visual;
    }
    return defaultVisual;
  }

  async function loadDishImage(dishName, containerClass = 'dish-image') {
    try {
      const res = await fetch(`/api/dish-image?name=${encodeURIComponent(dishName)}`);
      const data = await res.json();
      if (data.url) {
        // Tìm container bằng cách duyệt — không dùng CSS.escape
        const all = document.querySelectorAll(`.${containerClass}`);
        let container = null;
        for (const el of all) {
          if (el.getAttribute('data-dish-name') === dishName) {
            container = el;
            break;
          }
        }
        if (container) {
          const img = new Image();
          img.onload = () => {
            container.style.backgroundImage = `url(${data.url})`;
            container.style.backgroundSize = 'cover';
            container.style.backgroundPosition = 'center';
            container.innerHTML = ''; // remove emoji
          };
          img.onerror = () => { /* keep fallback */ };
          img.src = data.url;
        }
      }
    } catch (e) { /* keep fallback */ }
  }

  // ---- Gọi API để lấy gợi ý món ăn kèm công thức (cache trước, API sau) ----
  async function loadRandomDishes() {
    const grid = document.getElementById('dish-grid');
    if (!grid) return;
    isSearchMode = false;
    lastSearchQuery = '';

    grid.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-on-surface-variant font-body-md">Đang tìm gợi ý món ngon cho bạn...</p>
      </div>`;

    let dishes = [];
    try {
      const res = await fetch('/api/random-dishes', { method: 'POST' });
      const data = await res.json();
      if (data.dishes) dishes = data.dishes;
    } catch (e) {
      console.warn('Failed to load random dishes:', e);
    }

    if (dishes.length === 0) {
      dishes = getSampleDishes();
    }

    renderDishes(dishes);
  }

  // ---- Load thêm món ----
  async function loadMoreDishes() {
    if (isLoadingMore) return;
    isLoadingMore = true;

    const btn = document.getElementById('btn-load-more');
    if (btn) {
      btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Đang tải...';
      btn.disabled = true;
    }

    let newDishes = [];
    try {
      if (isSearchMode && lastSearchQuery) {
        // Gọi lại API search với cùng query
        const res = await fetch('/api/search-dishes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: lastSearchQuery })
        });
        const data = await res.json();
        if (data.dishes) newDishes = data.dishes;
      } else {
        const res = await fetch('/api/random-dishes', { method: 'POST' });
        const data = await res.json();
        if (data.dishes) newDishes = data.dishes;
      }
    } catch (e) {
      console.warn('Load more error:', e);
      newDishes = getSampleDishes();
    }

    if (newDishes.length === 0) {
      newDishes = getSampleDishes();
    }

    // Lọc trùng với món đã có
    const existingNames = new Set(currentDishes.map(d => d.name));
    const uniqueNew = newDishes.filter(d => !existingNames.has(d.name));

    if (uniqueNew.length === 0) {
      MealPlan.showToast('Đã hiển thị tất cả món!', 'info');
      if (btn) {
        btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">refresh</span> Xem thêm';
        btn.disabled = false;
      }
      isLoadingMore = false;
      return;
    }

    // Append vào grid
    appendDishes(uniqueNew);
    currentDishes = [...currentDishes, ...uniqueNew];

    if (btn) {
      btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">refresh</span> Xem thêm';
      btn.disabled = false;
    }
    isLoadingMore = false;
  }

  // ---- Append dish cards (cho Xem thêm) ----
  function appendDishes(dishes) {
    const grid = document.getElementById('dish-grid');
    if (!grid) return;

    const startIdx = currentDishes.length;
    const html = dishes.map((dish, i) => {
      const idx = startIdx + i;
      const { gradient, emoji } = getDishVisual(dish.name);
      return `
      <div class="dish-card bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all group overflow-hidden border border-surface-container-high">
        <div class="relative h-48 overflow-hidden">
          <div class="dish-image w-full h-full flex items-center justify-center ${gradient}" data-dish-name="${dish.name}">
            <span class="text-6xl">${emoji}</span>
          </div>
          <div class="absolute top-3 right-3">
            <button class="fav-btn bg-white/80 backdrop-blur-md p-1.5 rounded-full shadow-sm" data-dish="${dish.name}">
              <span class="material-symbols-outlined text-secondary ${MealPlan.isFavorite(dish.name) ? '' : 'opacity-40'}" style="font-variation-settings: 'FILL' ${MealPlan.isFavorite(dish.name) ? '1' : '0'};">favorite</span>
            </button>
          </div>
        </div>
        <div class="p-4">
          <h4 class="font-title-md text-on-surface mb-2">${dish.name}</h4>
          <div class="flex items-center gap-gutter-md mb-3">
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">schedule</span>
              ${dish.time || '--'}
            </div>
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">local_fire_department</span>
              ${dish.calories || '--'}
            </div>
            ${dish.difficulty ? `
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">signal_cellular_alt</span>
              ${dish.difficulty}
            </div>` : ''}
          </div>
          ${dish.description ? `<p class="text-body-md text-on-surface-variant mb-3 line-clamp-2">${dish.description}</p>` : ''}
          <button class="detail-btn w-full flex items-center justify-center gap-2 bg-surface-container-high text-primary font-label-md px-4 py-2.5 rounded-lg hover:bg-primary-container/30 active:scale-[0.98] transition-all" data-idx="${idx}" data-dish-name="${dish.name}">
            <span class="material-symbols-outlined text-[18px]">article</span>
            Xem Chi tiết
          </button>
        </div>
      </div>`;
    }).join('');

    grid.insertAdjacentHTML('beforeend', html);

    // Load ảnh cho món mới
    dishes.forEach(dish => { loadDishImage(dish.name); });

    // Attach events cho các nút mới — dùng MealPlan.toggleFavorite() để lưu đúng
    document.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const dishName = this.dataset.dish;
        const icon = this.querySelector('.material-symbols-outlined');
        const dish = currentDishes.find(d => d && d.name === dishName);
        const added = MealPlan.toggleFavorite(dish || { name: dishName });
        MealPlan.saveState();
        if (added) {
          icon.style.setProperty('font-variation-settings', "'FILL' 1");
          icon.classList.remove('opacity-40');
        } else {
          icon.style.setProperty('font-variation-settings', "'FILL' 0");
          icon.classList.add('opacity-40');
        }
      });
    });

    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        let dish = currentDishes[idx];
        if (!dish) {
          const name = this.dataset.dishName;
          dish = currentDishes.find(d => d && d.name === name);
        }
        if (dish) showRecipeDetail(dish);
        else MealPlan.showToast('Không thể hiển thị chi tiết món ăn!', 'error');
      });
    });
  }

  // ---- Sample fallback ----
  function getSampleDishes() {
    return [
      {
        name: 'Thịt Ba Chỉ Luộc',
        time: '25 ph',
        calories: '350 kcal',
        difficulty: 'Dễ',
        description: 'Thịt ba chỉ luộc chín tới, thái lát mỏng, chấm nước mắm tỏi ớt.',
        ingredients: [
          { name: 'Thịt ba chỉ', quantity: '300g', price: 0 },
          { name: 'Muối', quantity: '1 thìa', price: 0 },
          { name: 'Sả', quantity: '2 cây', price: 0 }
        ],
        instructions: '1. Thịt ba chỉ rửa sạch.\n2. Luộc thịt với nước lạnh, thêm sả và muối.\n3. Luộc lửa vừa 20 phút, tắt bếp ngâm 5 phút.\n4. Vớt ra thái lát mỏng.'
      },
      {
        name: 'Thịt Luộc Cuốn Bánh Tráng',
        time: '30 ph',
        calories: '420 kcal',
        difficulty: 'Trung bình',
        description: 'Thịt luộc thái mỏng cuốn bánh tráng với rau sống, chấm nước mắm chua ngọt.',
        ingredients: [
          { name: 'Thịt ba chỉ', quantity: '300g', price: 0 },
          { name: 'Bánh tráng', quantity: '10 cái', price: 0 },
          { name: 'Rau sống', quantity: '200g', price: 0 }
        ],
        instructions: '1. Thịt ba chỉ luộc chín, thái lát mỏng.\n2. Bánh tráng nhúng nước, trải ra.\n3. Xếp rau và thịt lên bánh tráng, cuốn chặt.\n4. Pha nước mắm chua ngọt chấm kèm.'
      },
      {
        name: 'Thịt Chân Giò Luộc',
        time: '40 ph',
        calories: '400 kcal',
        difficulty: 'Trung bình',
        description: 'Chân giò luộc thơm ngon, thái miếng vừa ăn, chấm mắm tôm hoặc nước mắm gừng.',
        ingredients: [
          { name: 'Chân giò', quantity: '1 cái', price: 0 },
          { name: 'Gừng', quantity: '1 nhánh', price: 0 },
          { name: 'Rượu trắng', quantity: '1 thìa', price: 0 }
        ],
        instructions: '1. Chân giò cạo sạch, rửa với muối.\n2. Luộc chân giò với gừng đập dập và rượu.\n3. Luộc lửa nhỏ 35 phút.\n4. Vớt ra để nguội, thái miếng vừa ăn.'
      },
      {
        name: 'Salad Thịt Luộc',
        time: '15 ph',
        calories: '280 kcal',
        difficulty: 'Dễ',
        description: 'Salad thịt luộc thái sợi trộn rau củ — món ăn kèm nhẹ nhàng, thanh mát.',
        ingredients: [
          { name: 'Thịt ba chỉ luộc', quantity: '200g', price: 0 },
          { name: 'Xà lách', quantity: '100g', price: 0 },
          { name: 'Cà rốt', quantity: '1 củ', price: 0 }
        ],
        instructions: '1. Thịt luộc thái sợi.\n2. Rau củ rửa sạch, thái sợi.\n3. Trộn đều với sốt dầu giấm.\n4. Bày ra đĩa.'
      },
      {
        name: 'Gà Chiên Giòn',
        time: '30 ph',
        calories: '580 kcal',
        difficulty: 'Trung bình',
        description: 'Gà chiên giòn rụm bên ngoài, mềm bên trong, thích hợp cho bữa tối cuối tuần.',
        ingredients: [
          { name: 'Đùi gà', quantity: '4 cái', price: 0 },
          { name: 'Bột chiên giòn', quantity: '200g', price: 0 }
        ],
        instructions: '1. Gà ướp gia vị 15 phút.\n2. Lăn qua bột chiên giòn.\n3. Chiên ngập dầu lửa vừa 12 phút.\n4. Vớt ra để ráo dầu.'
      },
      {
        name: 'Cá Hấp Xì Dầu',
        time: '20 ph',
        calories: '320 kcal',
        difficulty: 'Dễ',
        description: 'Cá hấp nhẹ nhàng với xì dầu, gừng và hành lá — món ăn thanh đạm.',
        ingredients: [
          { name: 'Cá chép', quantity: '1 con', price: 0 },
          { name: 'Xì dầu', quantity: '3 thìa', price: 0 },
          { name: 'Gừng', quantity: '1 nhánh', price: 0 }
        ],
        instructions: '1. Cá làm sạch, khứa vài đường.\n2. Xếp gừng, hành lên cá.\n3. Hấp cách thủy 15 phút.\n4. Rưới xì dầu nóng lên cá.'
      },
      {
        name: 'Bò Xào Súp Lơ',
        time: '15 ph',
        calories: '480 kcal',
        difficulty: 'Dễ',
        description: 'Thịt bò xào nhanh với súp lơ xanh, giòn ngọt.',
        ingredients: [
          { name: 'Thịt bò thăn', quantity: '200g', price: 0 },
          { name: 'Súp lơ xanh', quantity: '200g', price: 0 },
          { name: 'Tỏi', quantity: '3 tép', price: 0 }
        ],
        instructions: '1. Thịt bò thái lát mỏng, ướp gia vị.\n2. Súp lơ luộc sơ.\n3. Phi tỏi, xào bò lửa lớn 2 phút.\n4. Cho súp lơ vào đảo đều.'
      },
      {
        name: 'Salad Gà Luộc Rau Củ',
        time: '15 ph',
        calories: '280 kcal',
        difficulty: 'Dễ',
        description: 'Salad gà luộc xé sợi trộn rau củ — món ăn kèm nhẹ nhàng.',
        ingredients: [
          { name: 'Gà luộc', quantity: '200g', price: 0 },
          { name: 'Xà lách', quantity: '100g', price: 0 },
          { name: 'Cà rốt', quantity: '1 củ', price: 0 }
        ],
        instructions: '1. Gà luộc xé sợi.\n2. Rau củ rửa sạch, thái sợi.\n3. Trộn đều với sốt dầu giấm.\n4. Bày ra đĩa.'
      },
      {
        name: 'Thịt Kho Tàu',
        time: '60 ph',
        calories: '520 kcal',
        difficulty: 'Trung bình',
        description: 'Thịt ba chỉ kho với nước dừa và trứng cút — món ăn đậm đà.',
        ingredients: [
          { name: 'Thịt ba chỉ', quantity: '300g', price: 0 },
          { name: 'Trứng cút', quantity: '10 quả', price: 0 },
          { name: 'Nước dừa', quantity: '200ml', price: 0 }
        ],
        instructions: '1. Thịt thái miếng, ướp gia vị 15 phút.\n2. Phi thơm hành, cho thịt vào xào săn.\n3. Đổ nước dừa, kho lửa nhỏ 45 phút.\n4. Thêm trứng cút, kho thêm 15 phút.'
      },
      {
        name: 'Canh Chua Cá Lóc',
        time: '30 ph',
        calories: '380 kcal',
        difficulty: 'Trung bình',
        description: 'Canh chua ngọt thanh với cá lóc tươi, đậu bắp và giá đỗ.',
        ingredients: [
          { name: 'Cá lóc', quantity: '300g', price: 0 },
          { name: 'Me', quantity: '50g', price: 0 },
          { name: 'Đậu bắp', quantity: '100g', price: 0 },
          { name: 'Giá đỗ', quantity: '100g', price: 0 }
        ],
        instructions: '1. Cá lóc làm sạch, cắt khúc.\n2. Me ngâm nước ấm, bỏ hạt.\n3. Nấu nước sôi, cho cá vào, hớt bọt.\n4. Thêm me, đậu bắp, giá đỗ, nêm gia vị.'
      }
    ];
  }

  // ---- Render dish cards (grid view) ----
  function renderDishes(dishes) {
    const grid = document.getElementById('dish-grid');
    if (!grid) return;

    if (!dishes || dishes.length === 0) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
          <span class="material-symbols-outlined text-5xl text-outline mb-4">restaurant</span>
          <p class="text-on-surface-variant font-body-md">Không tìm thấy món ăn nào!</p>
        </div>`;
      return;
    }

    grid.innerHTML = dishes.map((dish, idx) => {
      const { gradient, emoji } = getDishVisual(dish.name);
      return `
      <div class="dish-card bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all group overflow-hidden border border-surface-container-high">
        <div class="relative h-48 overflow-hidden">
          <div class="dish-image w-full h-full flex items-center justify-center ${gradient}" data-dish-name="${dish.name}">
            <span class="text-6xl">${emoji}</span>
          </div>
          <div class="absolute top-3 right-3">
            <button class="fav-btn bg-white/80 backdrop-blur-md p-1.5 rounded-full shadow-sm" data-dish="${dish.name}">
              <span class="material-symbols-outlined text-secondary ${MealPlan.isFavorite(dish.name) ? '' : 'opacity-40'}" style="font-variation-settings: 'FILL' ${MealPlan.isFavorite(dish.name) ? '1' : '0'};">favorite</span>
            </button>
          </div>
        </div>
        <div class="p-4">
          <h4 class="font-title-md text-on-surface mb-2">${dish.name}</h4>
          <div class="flex items-center gap-gutter-md mb-3">
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">schedule</span>
              ${dish.time || '--'}
            </div>
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">local_fire_department</span>
              ${dish.calories || '--'}
            </div>
            ${dish.difficulty ? `
            <div class="flex items-center gap-1 text-on-surface-variant font-label-md">
              <span class="material-symbols-outlined text-[18px]">signal_cellular_alt</span>
              ${dish.difficulty}
            </div>` : ''}
          </div>
          ${dish.description ? `<p class="text-body-md text-on-surface-variant mb-3 line-clamp-2">${dish.description}</p>` : ''}
          <button class="detail-btn w-full flex items-center justify-center gap-2 bg-surface-container-high text-primary font-label-md px-4 py-2.5 rounded-lg hover:bg-primary-container/30 active:scale-[0.98] transition-all" data-idx="${idx}" data-dish-name="${dish.name}">
            <span class="material-symbols-outlined text-[18px]">article</span>
            Xem Chi tiết
          </button>
        </div>
      </div>`;
    }).join('');

    // Cache dishes for detail button lookup
    currentDishes = dishes;
    console.log('[MealPlan] Dishes cached:', dishes.length, dishes.map(d => d.name));

    // Attach events
    attachDishEvents();

    // Async load Unsplash images for each card
    dishes.forEach(dish => {
      loadDishImage(dish.name);
    });
  }

  // ---- Dish card events ----
  function attachDishEvents() {
    // Favorite toggle
    document.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const dishName = this.dataset.dish;
        const icon = this.querySelector('.material-symbols-outlined');
        // Find dish info from currentDishes cache
        const dish = currentDishes.find(d => d && d.name === dishName);
        const added = MealPlan.toggleFavorite(dish || { name: dishName });
        MealPlan.saveState();
        if (added) {
          icon.style.setProperty('font-variation-settings', "'FILL' 1");
          icon.classList.remove('opacity-40');
        } else {
          icon.style.setProperty('font-variation-settings', "'FILL' 0");
          icon.classList.add('opacity-40');
        }
      });
    });

    // Detail button → show overlay
    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        let dish = currentDishes[idx];

        // Fallback: try to find by name
        if (!dish) {
          const name = this.dataset.dishName;
          dish = currentDishes.find(d => d && d.name === name);
        }

        if (dish) {
          showRecipeDetail(dish);
        } else {
          MealPlan.showToast('Không thể hiển thị chi tiết món ăn!', 'error');
        }
      });
    });
  }

  // ---- Recipe Detail Overlay ----
  function showRecipeDetail(dish) {
    const existing = document.querySelector('.recipe-overlay');
    if (existing) existing.remove();

    const { gradient, emoji } = getDishVisual(dish.name);

    // Format instructions as numbered steps
    const steps = (dish.instructions || '')
      .split('\n')
      .filter(s => s.trim())
      .map((s, i) => {
        const clean = s.replace(/^\d+[\.\s)]+\s*/, '');
        return `<li class="flex gap-3">
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-on-primary text-xs font-bold flex-shrink-0 mt-0.5">${i + 1}</div>
          <div class="flex-1 pt-0.5">
            <span class="font-label-md text-on-surface">${clean}</span>
          </div>
        </li>`;
      }).join('<li class="my-2 border-t border-outline-variant/20"></li>');

    const overlay = document.createElement('div');
    overlay.className = 'recipe-overlay fixed inset-0 z-[200] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full h-full md:h-auto md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
        <!-- Header image -->
        <div class="relative h-36 md:h-48 flex items-center justify-center overflow-hidden flex-shrink-0 ${gradient} recipe-header-img" data-dish-name="${dish.name}">
          <span class="text-6xl md:text-7xl recipe-header-emoji">${emoji}</span>
          <button class="absolute top-4 right-4 bg-black/30 backdrop-blur-md text-white p-2 rounded-full hover:bg-black/50 transition-all" id="recipe-close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto md:overflow-y-visible">
          <div class="p-5 md:p-6">
            <!-- Title & badges -->
            <div class="flex items-center gap-2 mb-1">
              <h2 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">${dish.name}</h2>
              ${dish.difficulty ? `<span class="bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-full text-xs font-semibold">${dish.difficulty}</span>` : ''}
            </div>
            <div class="flex items-center gap-gutter-md mb-4">
              <span class="flex items-center gap-1 text-on-surface-variant font-label-md">
                <span class="material-symbols-outlined text-[18px]">schedule</span> ${dish.time || '--'}
              </span>
              <span class="flex items-center gap-1 text-on-surface-variant font-label-md">
                <span class="material-symbols-outlined text-[18px]">local_fire_department</span> ${dish.calories || '--'}
              </span>
            </div>

            ${dish.description ? `<p class="text-body-md text-on-surface-variant mb-5">${dish.description}</p>` : ''}

            <!-- Ingredients -->
            <div class="mb-5">
              <h3 class="font-title-md flex items-center gap-2 text-primary mb-3">
                <span class="material-symbols-outlined">shopping_basket</span>
                Nguyên liệu cần mua
              </h3>
              <div class="bg-surface-container-low rounded-xl divide-y divide-outline-variant/20 overflow-hidden">
                ${(dish.ingredients || []).map(ing => `
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <div class="flex items-center gap-3">
                      <span class="material-symbols-outlined text-outline text-[18px]">${getIngredientIcon(ing.name)}</span>
                      <span class="font-label-md text-on-surface">${ing.name}</span>
                    </div>
                    <span class="text-on-surface-variant font-body-md">${ing.quantity}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Instructions with internal scroll -->
            <div>
              <h3 class="font-title-md flex items-center gap-2 text-secondary mb-3">
                <span class="material-symbols-outlined">menu_book</span>
                Cách nấu
              </h3>
              <div class="bg-surface-container-low rounded-xl px-5 py-4 max-h-[40vh] overflow-y-auto">
                <ul class="space-y-2 list-none">
                  ${steps || '<li class="text-on-surface-variant italic">Không có hướng dẫn chi tiết</li>'}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Sticky bottom buttons -->
        <div class="flex-shrink-0 p-4 md:p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
          <div class="flex gap-gutter-md">
            <button class="flex-1 bg-primary text-on-primary py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg" id="recipe-cook-btn">
              <span class="material-symbols-outlined">cooking</span>
              Nấu Ăn
            </button>
            <button class="px-5 py-3.5 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high transition-all" id="recipe-close-alt">
              Đóng
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Try to load real image for overlay header
    loadDishImage(dish.name, 'recipe-header-img');

    // Close handlers
    overlay.querySelector('#recipe-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#recipe-close-alt')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Nấu Ăn handler — thay thế giỏ hàng cũ
    overlay.querySelector('#recipe-cook-btn')?.addEventListener('click', () => {
      const ings = dish.ingredients || [];
      MealPlan.setCart(ings);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.saveState();
      overlay.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
    });
  }

  function getIngredientIcon(name) {
    const map = [
      ['thịt', 'bò', 'gà', 'heo', 'lợn', 'cá', 'tôm'], 'restaurant',
      ['rau', 'xà lách', 'cải', 'bông', 'giá', 'rau thơm', 'húng', 'mùi', 'ngò'], 'eco',
      ['muối', 'tiêu', 'đường', 'nước mắm', 'hạt nêm', 'bột ngọt', 'bột canh', 'bột nghệ'], 'science',
      ['bánh', 'phở', 'mì', 'bún', 'miến', 'cơm', 'gạo', 'bột'], 'ramen_dining',
      ['tỏi'], 'garlic',
      ['hành'], 'garden',
      ['ớt'], 'whatshot',
      ['chanh'], 'lemon',
      ['gừng'], 'local_fire_department',
      ['sả'], 'grass',
      ['trái cây', 'táo', 'cam', 'chuối', 'xoài', 'dưa'], 'apple',
      ['sữa', 'trứng', 'bơ', 'phô mai', 'cream'], 'egg',
      ['dầu', 'mỡ', 'bơ thực vật'], 'oil_barrel',
      ['khoai', 'khoai tây', 'khoai lang', 'cà rốt', 'củ'], 'nutrition',
      ['nấm'], 'rainy',
      ['đậu', 'đậu phụ', 'tàu hũ'], 'grain',
      ['lạc', 'đậu phộng', 'vừng', 'mè'], 'seed',
      ['mắm', 'tương', 'xì dầu', 'dầu hào', 'dầu mè', 'tương ớt', 'tương cà', 'rượu', 'giấm'], 'science',
    ];
    const lower = name.toLowerCase();
    for (let i = 0; i < map.length; i += 2) {
      if (map[i].some(k => lower.includes(k))) return map[i + 1];
    }
    return 'inventory_2';
  }

  // ---- Trích xuất phương pháp chế biến từ query ----
  function extractCookingMethod(query) {
    const methods = ['luộc', 'chiên', 'rán', 'xào', 'kho', 'hấp', 'nướng', 'rim', 'om', 'nấu', 'nộm', 'gỏi', 'salad'];
    const lower = query.toLowerCase();
    for (const method of methods) {
      if (lower.includes(method)) return method;
    }
    return null;
  }

  // ---- Lọc kết quả theo quy tắc ưu tiên ----
  function filterByPriority(dishes, query) {
    try {
      const lower = query.toLowerCase();
      const method = extractCookingMethod(query);

      const mainIngredient = method
        ? lower.replace(method, '').trim()
        : lower;

      const priority1 = [];
      const priority2 = [];
      const rejected = [];

      dishes.forEach(d => {
        if (!d || !d.name) return;
        const dName = d.name.toLowerCase();
        const dDesc = (d.description || '').toLowerCase();
        const dText = dName + ' ' + dDesc;

        if (method) {
          if (dText.includes(method)) {
            if (mainIngredient && dText.includes(mainIngredient)) {
              priority1.push(d);
            } else {
              priority2.push(d);
            }
          } else {
            rejected.push(d);
          }
        } else {
          if (dName.includes(lower)) priority1.push(d);
          else rejected.push(d);
        }
      });

      const result = [...priority1, ...priority2].slice(0, 5);

      if (result.length === 0) {
        return dishes.filter(d => {
          if (!d || !d.name) return false;
          const dName = d.name.toLowerCase();
          return mainIngredient.split(/\s+/).some(w => w.length > 1 && dName.includes(w));
        }).slice(0, 3);
      }

      return result;
    } catch (e) {
      console.warn('filterByPriority error:', e);
      return dishes.slice(0, 5); // fallback: show first 5
    }
  }

  // ---- Search: cache DB trước, DeepSeek nếu món mới ----
  async function handleSearch(query) {
    if (!query.trim()) {
      await loadRandomDishes();
      return;
    }

    isSearchMode = true;
    lastSearchQuery = query;

    const grid = document.getElementById('dish-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p class="text-on-surface-variant font-body-md">Đang tìm kiếm gợi ý cho "${query}"...</p>
        </div>`;
    }

    // 1. Gọi API search — cache server check trước
    let dishes = [];
    try {
      const res = await fetch('/api/search-dishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (data.dishes) dishes = data.dishes;
    } catch (e) {
      console.warn('Search API error:', e);
    }

    // 2. Client-side filter: ưu tiên theo phương pháp chế biến
    if (dishes.length > 0) {
      dishes = filterByPriority(dishes, query);
    }

    // 3. Fallback cuối
    if (dishes.length === 0) {
      const sample = getSampleDishes();
      dishes = filterByPriority(sample, query);
      if (dishes.length === 0) dishes = sample.filter(d =>
        d.ingredients.some(i => query.toLowerCase().includes(i.name.toLowerCase()))
      );
      if (dishes.length === 0) dishes = sample.slice(0, 3);
    }

    renderDishes(dishes);
  }

  // ===================== Camera / Upload =====================
  // Dùng MealPlan.openCamera({ mode: 'dish', onResult: callback }) từ app.js

  // ---- Init ----
  function initHome() {
    const searchInput = document.getElementById('dish-search');
    const btnSchedule = document.getElementById('btn-schedule');
    const feedback = document.getElementById('schedule-feedback');
    const btnCamera = document.getElementById('btn-camera');

    if (!searchInput || !btnSchedule) return;

    // Auto-load random dishes on page load
    loadRandomDishes();

    // Xem thêm button
    document.getElementById('btn-load-more')?.addEventListener('click', loadMoreDishes);

    // Live search on Enter
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleSearch(searchInput.value);
      }
    });

    // Schedule button
    btnSchedule.addEventListener('click', async () => {
      if (!searchInput.value.trim()) {
        searchInput.focus();
        return;
      }

      await handleSearch(searchInput.value);

      if (feedback) {
        feedback.textContent = `✓ Đã tìm thấy món cho "${searchInput.value}"`;
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 3000);
      }
    });

    // Camera button
    if (btnCamera) {
      btnCamera.addEventListener('click', () => {
        MealPlan.openCamera({
          mode: 'dish',
          onResult: (result) => {
            if (result.success && result.data) {
              if (typeof showRecipeDetail === 'function') {
                showRecipeDetail(result.data);
              } else {
                MealPlan.showToast(`📍 ${result.data.name}`, 'success', 4000);
              }
            } else {
              MealPlan.showToast(result.error || 'Không thể nhận diện món ăn!', 'error');
            }
          }
        });
      });
    }
  }

  window.renderHomeDishes = renderDishes;

  document.addEventListener('DOMContentLoaded', initHome);
})();
