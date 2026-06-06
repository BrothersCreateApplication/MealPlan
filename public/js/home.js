// ===================== Trang Chủ Module =====================

(function() {
  let currentDishes = []; // cache for detail button by index
  let isSearchMode = false;
  let lastSearchQuery = '';
  let isLoadingMore = false;
  let currentAbortController = null; // để huỷ search cũ khi search mới

  // ---- Dish image helpers ----
  // Dùng emoji thuần, không gọi API ảnh bên ngoài cho nhanh
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

  // Bỏ loadDishImage — dùng emoji thuần

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
        // "Xem thêm" — lấy random mới khác với món đã hiển thị
        try {
          const res = await fetch('/api/random-dishes', { method: 'POST' });
          const data = await res.json();
          if (data.dishes) newDishes = data.dishes;
        } catch (e) {}
        if (newDishes.length === 0) {
          newDishes = getSampleDishes();
        }
      }
    } catch (e) {
      console.warn('Load more error:', e);
      // Not in search mode: fallback to sample
      if (!isSearchMode) newDishes = getSampleDishes();
    }

    if (newDishes.length === 0 && !isSearchMode) {
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
        description: 'Thịt ba chỉ luộc chín tới, thái lát mỏng, chấm nước mắm tỏi ớt. Món đơn giản mà ngon cơm.',
        ingredients: [
          { name: 'Thịt ba chỉ', quantity: '300g', price: 0 },
          { name: 'Muối', quantity: '1 thìa', price: 0 },
          { name: 'Sả', quantity: '2 cây', price: 0 }
        ],
        instructions: '1. Thịt ba chỉ rửa sạch với muối, để ráo.\n2. Bắc nồi nước lạnh ngập thịt, thêm 1 thìa muối và 2 cây sả đập dập.\n3. Đun lửa lớn đến khi nước sôi, hạ lửa vừa. Luộc 15-20 phút.\n4. Dùng đũa xiên thử — nếu thịt mềm và không có nước hồng chảy ra là chín.\n5. Tắt bếp, ngâm thịt trong nồi thêm 5 phút để thịt mềm và giữ ngọt.\n6. Vớt thịt ra, để nguội bớt 2-3 phút rồi thái lát mỏng vừa ăn (0.5cm).\n7. Pha nước mắm tỏi ớt: 2 muỗng nước mắm + 1 muỗng đường + 1 muỗng nước cốt chanh + tỏi ớt băm.\n💡 Mẹo: Luộc bằng nước lạnh giúp thịt chín đều, không bị dai. Không luộc quá lâu sẽ bị nát.'
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
        instructions: '1. Thịt ba chỉ rửa sạch, luộc chín như hướng dẫn món thịt luộc (khoảng 20 phút).\n2. Vớt thịt để nguội, thái lát mỏng 0.3-0.5cm.\n3. Rau sống nhặt, rửa sạch, ngâm nước muối loãng 5 phút, vớt để ráo.\n4. Bánh tráng nhúng nhanh qua nước lã cho hơi mềm (không nhúng ướt quá).\n5. Trải bánh tráng ra thớt hoặc đĩa. Xếp rau sống vào 1/3 dưới cùng.\n6. Đặt 2-3 lát thịt lên trên rau. Cuốn chặt tay từ dưới lên, gấp 2 bên mép vào trong.\n7. Pha nước mắm chua ngọt: 1 nước mắm + 1 đường + 2 nước + chanh tỏi ớt.\n💡 Mẹo: Không nhúng bánh tráng quá lâu sẽ bị rách. Cuốn đến đâu ăn đến đó, không để lâu bánh bị khô.'
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

    // Detail button → show overlay (fetch full dish + ingredients)
    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        let dish = currentDishes[idx];

        // Fallback: try to find by name
        if (!dish) {
          const name = this.dataset.dishName;
          dish = currentDishes.find(d => d && d.name === name);
        }

        // Nếu dish không có ingredients, fetch từ server
        if (dish && (!dish.ingredients || dish.ingredients.length === 0)) {
          try {
            const res = await fetch(`/api/dishes/${encodeURIComponent(dish.name)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.dish) dish = data.dish;
            }
          } catch (e) {
            console.warn('Failed to fetch dish details:', e);
          }
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
  function showRecipeDetail(dish, mode, cookingEntryId) {
    // Nếu là chế độ nấu ăn → dùng Cooking Mode mới
    if (mode === 'cook') {
      // Gọi openCookingMode từ cooking-mode.js
      if (window.openCookingMode) {
        window.openCookingMode(dish, cookingEntryId);
      } else {
        MealPlan.showToast('Chưa tải Cooking Mode!', 'error');
      }
      return;
    }

    const existing = document.querySelector('.recipe-overlay');
    if (existing) existing.remove();

    const bottomButtons = `
      <button class="flex-1 bg-primary text-on-primary py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg" id="recipe-cook-btn">
        <span class="material-symbols-outlined">shopping_cart</span>
        Đi Chợ
      </button>
      <button class="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg" id="recipe-cook-now-btn">
        <span class="material-symbols-outlined">cooking</span>
        Nấu Ăn
      </button>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'recipe-overlay fixed inset-0 z-[200] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full max-h-[100dvh] md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto min-h-0">
          <div class="p-5 md:p-6">
            <div class="flex justify-end mb-2">
              <button class="bg-surface-container-high text-on-surface-variant p-1.5 rounded-full hover:bg-surface-container-highest transition-all" id="recipe-close">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
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

            <!-- Health Analysis Button -->
            <div class="mt-5 mb-5">
              <button id="health-analysis-btn" class="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-md">
                <span class="material-symbols-outlined">monitor_heart</span>
                Phân tích sức khỏe
              </button>
              <p class="text-xs text-on-surface-variant text-center mt-1">Đánh giá tác động lên tim, thận, gan</p>
            </div>

            <!-- YouTube video embed -->
            <div class="mt-3">
              <h3 class="font-title-md flex items-center gap-2 text-error mb-3">
                <span class="material-symbols-outlined">smart_display</span>
                Video hướng dẫn
              </h3>
              <div id="youtube-video-container" class="bg-surface-container-low rounded-xl overflow-hidden aspect-video flex items-center justify-center">
                <div class="text-center p-6">
                  <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p class="text-xs text-on-surface-variant">Đang tìm video hướng dẫn...</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sticky bottom buttons -->
        <div class="flex-shrink-0 p-4 md:p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
          <div class="flex gap-gutter-md">
            ${bottomButtons}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Tìm video YouTube
    loadYouTubeVideo(dish.name);

    // Close handlers
    overlay.querySelector('#recipe-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Đi Chợ handler — thay thế giỏ hàng cũ
    if (overlay.querySelector('#recipe-cook-btn')) {
      overlay.querySelector('#recipe-cook-btn').addEventListener('click', () => {
        const ings = dish.ingredients || [];
        MealPlan.setCart(ings);
        MealPlan.state.currentMealName = dish.name;
        MealPlan.state.currentDishData = dish;
        MealPlan.saveState();
        overlay.remove();
        MealPlan.navigate('cart');
        if (window.renderCart) window.renderCart();
      });
    }

    // Nấu Ăn handler — mở cooking mode
    if (overlay.querySelector('#recipe-cook-now-btn')) {
      overlay.querySelector('#recipe-cook-now-btn').addEventListener('click', () => {
        const currentDish = dish;
        const currentEntryId = cookingEntryId;
        overlay.remove();
        try {
          showRecipeDetail(currentDish, 'cook', currentEntryId);
        } catch (err) {
          console.error('[MealPlan] Error entering cooking mode:', err);
          MealPlan.showToast('Không thể vào chế độ nấu!', 'error');
        }
      });
    }

    // Hoàn thành handler (chế độ cook) — lưu vào history với status 'cooked'
    if (overlay.querySelector('#recipe-complete-btn')) {
      overlay.querySelector('#recipe-complete-btn').addEventListener('click', () => {
        if (cookingEntryId) {
          // Cập nhật entry đã tồn tại (từ Sẵn sàng nấu)
          const existing = MealPlan.state.history.find(h => h.id === cookingEntryId);
          if (existing) {
            existing.status = 'cooked';
            existing.date = new Date().toLocaleDateString('vi-VN');
            existing.dateISO = new Date().toISOString();
          }
        } else {
          // Tạo mới entry
          const entry = createHistoryEntry(dish, 'cooked');
          MealPlan.state.history.unshift(entry);
        }
        MealPlan.state.currentMealName = '';
        MealPlan.saveState();
        overlay.remove();
        MealPlan.showToast(`Đã nấu xong "${dish.name}"! 🎉`, 'success', 3000);
      });
    }

    // Phân tích sức khỏe handler
    overlay.querySelector('#health-analysis-btn')?.addEventListener('click', async () => {
      await showHealthAnalysis(dish);
    });
  }

  // ---- Lưu dish vào history với đầy đủ thông tin ----
  function createHistoryEntry(dish, status) {
    const ings = dish.ingredients || [];
    const itemsStr = ings.map(i => `${i.name} (${i.quantity})`).join(', ');
    return {
      id: MealPlan.generateId(),
      dishName: dish.name,
      status: status || 'shopped', // 'shopped' = đã đi chợ, 'cooked' = đã nấu xong
      date: new Date().toLocaleDateString('vi-VN'),
      dateISO: new Date().toISOString(),
      calories: dish.calories || '--',
      cost: 0,
      items: itemsStr,
      owned: 0,
      totalItems: ings.length,
      image: '',
      // Lưu full dish data để khi bấm Nấu ăn trong history có thể hiện lại công thức
      dishData: {
        name: dish.name,
        time: dish.time,
        calories: dish.calories,
        difficulty: dish.difficulty,
        description: dish.description,
        ingredients: ings,
        instructions: dish.instructions
      }
    };
  }

  // ---- Phân tích sức khỏe món ăn (Heart, Kidneys, Liver) ----
  async function showHealthAnalysis(dish) {
    const existing = document.querySelector('.health-analysis-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'health-analysis-overlay fixed inset-0 z-[250] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full max-h-[100dvh] md:max-h-[90vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
        <!-- Header -->
        <div class="flex-shrink-0 p-5 md:p-6 border-b border-outline-variant/20">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
                <span class="material-symbols-outlined text-white">monitor_heart</span>
              </div>
              <div>
                <h2 class="font-title-md text-on-surface">Phân tích sức khỏe</h2>
                <p class="text-xs text-on-surface-variant">${dish.name}</p>
              </div>
            </div>
            <button class="health-analysis-close p-1.5 rounded-full hover:bg-surface-container-high transition-all">
              <span class="material-symbols-outlined text-on-surface-variant">close</span>
            </button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div id="health-analysis-body" class="flex-1 overflow-y-auto p-5 md:p-6 min-h-0">
          <!-- Loading state -->
          <div class="text-center py-8" id="health-loading">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mx-auto mb-4"></div>
            <p class="text-on-surface font-label-md mb-1">AI đang phân tích...</p>
            <p class="text-xs text-on-surface-variant">Đánh giá tác động lên tim, thận và gan</p>
          </div>

          <!-- Results (hidden initially) -->
          <div id="health-results" class="hidden space-y-5"></div>

          <!-- Error state -->
          <div id="health-error" class="hidden text-center py-8">
            <span class="material-symbols-outlined text-4xl text-error mb-3">error_outline</span>
            <p class="text-on-surface font-label-md">Không thể phân tích món ăn</p>
            <p class="text-xs text-on-surface-variant mt-1">Vui lòng thử lại sau</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex-shrink-0 p-4 md:p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
          <div class="flex gap-gutter-md">
            <button class="health-cart-btn flex-1 bg-primary text-on-primary py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg">
              <span class="material-symbols-outlined">shopping_cart</span>
              Đi Chợ
            </button>
            <button class="health-cook-now-btn flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg">
              <span class="material-symbols-outlined">cooking</span>
              Nấu Ăn
            </button>
            <button class="health-analysis-close px-5 py-3.5 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high transition-all">
              Đóng
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    overlay.querySelectorAll('.health-analysis-close').forEach(el => el.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Đi Chợ handler
    overlay.querySelector('.health-cart-btn')?.addEventListener('click', () => {
      const ings = dish.ingredients || [];
      MealPlan.setCart(ings);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.state.currentDishData = dish;
      MealPlan.saveState();
      overlay.remove();
      document.querySelector('.recipe-overlay')?.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
    });

    // Nấu Ăn handler — mở recipe ở chế độ cook
    overlay.querySelector('.health-cook-now-btn')?.addEventListener('click', () => {
      overlay.remove();
      document.querySelector('.recipe-overlay')?.remove();
      try {
        showRecipeDetail(dish, 'cook');
      } catch (err) {
        console.error('[MealPlan] Error entering cooking mode:', err);
        MealPlan.showToast('Không thể vào chế độ nấu!', 'error');
      }
    });

    // Gọi API phân tích
    try {
      const res = await fetch('/api/health-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dish })
      });
      const data = await res.json();

      if (data.success && data.analysis) {
        renderHealthResults(data.analysis);
      } else {
        showHealthError();
      }
    } catch (err) {
      console.error('Health analysis error:', err);
      showHealthError();
    }
  }

  // ---- Render kết quả phân tích ----
  function renderHealthResults(analysis) {
    const loading = document.getElementById('health-loading');
    const results = document.getElementById('health-results');
    const error = document.getElementById('health-error');
    if (!results) return;

    if (loading) loading.classList.add('hidden');
    if (error) error.classList.add('hidden');
    if (results) results.classList.remove('hidden');

    const n = analysis.nutrients || {};

    function getLevelConfig(level) {
      switch (level) {
        case 'positive': return {
          bg: 'bg-emerald-50 border-emerald-200',
          icon: 'check_circle',
          iconBg: 'bg-emerald-500',
          iconColor: 'text-white',
          badge: 'bg-emerald-100 text-emerald-700',
          badgeText: 'Tốt',
          label: 'Lành mạnh'
        };
        case 'warning': return {
          bg: 'bg-amber-50 border-amber-200',
          icon: 'warning',
          iconBg: 'bg-amber-500',
          iconColor: 'text-white',
          badge: 'bg-amber-100 text-amber-700',
          badgeText: 'Trung bình',
          label: 'Cần chú ý'
        };
        case 'danger': return {
          bg: 'bg-red-50 border-red-200',
          icon: 'error',
          iconBg: 'bg-red-500',
          iconColor: 'text-white',
          badge: 'bg-red-100 text-red-700',
          badgeText: 'Cao',
          label: 'Cần hạn chế'
        };
        default: return getLevelConfig('warning');
      }
    }

    function renderOrganCard(organKey, organData, organLabel, organIcon) {
      const cfg = getLevelConfig(organData.level);
      return `
        <div class="rounded-xl border ${cfg.bg} p-4 transition-all hover:shadow-sm">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg ${cfg.iconBg} flex items-center justify-center shadow-sm">
              <span class="material-symbols-outlined text-white text-xl">${organIcon}</span>
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h4 class="font-title-md text-on-surface font-semibold">${organLabel}</h4>
                <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.badge}">${cfg.badgeText}</span>
              </div>
              <p class="text-xs font-semibold mt-0.5 ${organData.level === 'positive' ? 'text-emerald-600' : organData.level === 'danger' ? 'text-red-600' : 'text-amber-600'}">${organData.title}</p>
            </div>
            <span class="material-symbols-outlined ${organData.level === 'positive' ? 'text-emerald-500' : organData.level === 'danger' ? 'text-red-500' : 'text-amber-500'}">${cfg.icon}</span>
          </div>
          <p class="text-sm text-on-surface-variant leading-relaxed mb-2">${organData.summary}</p>
          <div class="bg-white/60 rounded-lg p-3">
            <p class="text-xs font-label-md flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px] text-primary">lightbulb</span>
              <span>${organData.advice}</span>
            </p>
          </div>
        </div>
      `;
    }

    // Nutrients bar
    const nutrientsHtml = `
      <div class="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
        <h4 class="font-label-md text-on-surface-variant text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px]">bar_chart</span>
          Chỉ số dinh dưỡng ước tính
        </h4>
        <div class="grid grid-cols-5 gap-2 text-center">
          <div class="bg-white rounded-lg p-2.5">
            <div class="font-title-md font-bold text-orange-600 text-sm">${n.calories || '--'}</div>
            <div class="text-[10px] text-on-surface-variant">Calories</div>
          </div>
          <div class="bg-white rounded-lg p-2.5">
            <div class="font-title-md font-bold text-blue-600 text-sm">${n.protein || '--'}</div>
            <div class="text-[10px] text-on-surface-variant">Protein</div>
          </div>
          <div class="bg-white rounded-lg p-2.5">
            <div class="font-title-md font-bold text-amber-600 text-sm">${n.carbs || '--'}</div>
            <div class="text-[10px] text-on-surface-variant">Carbs</div>
          </div>
          <div class="bg-white rounded-lg p-2.5">
            <div class="font-title-md font-bold text-purple-600 text-sm">${n.fats || '--'}</div>
            <div class="text-[10px] text-on-surface-variant">Chất béo</div>
          </div>
          <div class="bg-white rounded-lg p-2.5">
            <div class="font-title-md font-bold text-red-600 text-sm">${n.sodium || '--'}</div>
            <div class="text-[10px] text-on-surface-variant">Natri</div>
          </div>
        </div>
      </div>
    `;

    // Organ cards
    const heartHtml = renderOrganCard('heart', analysis.heart, 'Tim mạch', 'monitor_heart');
    const kidneysHtml = renderOrganCard('kidneys', analysis.kidneys, 'Thận', 'water_drop');
    const liverHtml = renderOrganCard('liver', analysis.liver, 'Gan', 'spa');

    // Star rating (1-5★) — hỗ trợ nửa sao (VD: 4.5 → 4 vàng + 1 nửa vàng)
    const rating = analysis.rating || 3;
    const fullStars = Math.floor(rating);
    const decimal = rating - fullStars;
    const adjustedFull = decimal >= 0.75 ? fullStars + 1 : fullStars;

    const starHtml = Array.from({ length: 5 }, (_, i) => {
      if (i < adjustedFull) return '<span class="text-yellow-300 text-base">★</span>';
      if (i === fullStars && decimal >= 0.25 && decimal < 0.75) {
        // Nửa sao: gradient vàng → trắng ngang 50%
        return '<span class="text-base" style="background:linear-gradient(90deg,#FBBF24 50%,rgba(255,255,255,0.4) 50%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">★</span>';
      }
      return '<span class="text-white/40 text-base">★</span>';
    }).join('');

    const overall = analysis.overall || '';

    results.innerHTML = `
      ${nutrientsHtml}
      ${heartHtml}
      ${kidneysHtml}
      ${liverHtml}
      ${overall ? `
      <div class="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl p-4 text-white shadow-md">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined">summarize</span>
            <h4 class="font-title-md font-semibold">Đánh giá tổng quan</h4>
          </div>
          <div class="flex items-center gap-1 bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full">
            <span class="text-yellow-300 text-base flex">${starHtml}</span>
            <span class="text-sm font-bold ml-1">${rating.toFixed(1)}</span>
          </div>
        </div>
        <p class="text-sm text-white/90 leading-relaxed">${overall}</p>
      </div>` : ''}
    `;
  }

  function showHealthError() {
    const loading = document.getElementById('health-loading');
    const results = document.getElementById('health-results');
    const error = document.getElementById('health-error');
    if (loading) loading.classList.add('hidden');
    if (results) results.classList.add('hidden');
    if (error) error.classList.remove('hidden');
  }

  // ---- Tìm video YouTube cho món ăn ----
  async function loadYouTubeVideo(dishName) {
    try {
      const res = await fetch(`/api/youtube-video?dish=${encodeURIComponent(dishName)}`);
      const data = await res.json();
      const container = document.getElementById('youtube-video-container');
      if (!container) return;

      if (data.videoId) {
        container.innerHTML = `
          <iframe class="w-full h-full aspect-video"
            src="https://www.youtube.com/embed/${data.videoId}?autoplay=0&rel=0"
            title="${data.title || dishName}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
          </iframe>
        `;
      } else {
        container.innerHTML = `
          <div class="text-center p-6">
            <span class="material-symbols-outlined text-3xl text-outline mb-2">videocam_off</span>
            <p class="text-xs text-on-surface-variant">Không tìm thấy video hướng dẫn</p>
          </div>
        `;
      }
    } catch (e) {
      const container = document.getElementById('youtube-video-container');
      if (container) {
        container.innerHTML = `
          <div class="text-center p-6">
            <span class="material-symbols-outlined text-3xl text-outline mb-2">videocam_off</span>
            <p class="text-xs text-on-surface-variant">Lỗi tải video</p>
          </div>
        `;
      }
    }
  }

  function getIngredientIcon(name) {
    const map = [
      ['thịt', 'bò', 'gà', 'heo', 'lợn'], 'lunch_dining',
      ['cá', 'tôm'], 'set_meal',
      ['rau', 'xà lách', 'cải', 'bông', 'giá', 'rau thơm', 'húng', 'mùi', 'ngò'], 'eco',
      ['muối', 'tiêu', 'đường', 'nước mắm', 'hạt nêm', 'bột ngọt', 'bột canh', 'bột nghệ'], 'spa',
      ['bánh', 'phở', 'mì', 'bún', 'miến', 'cơm', 'gạo', 'bột'], 'ramen_dining',
      ['tỏi'], 'garlic',
      ['hành'], 'garden',
      ['ớt'], 'whatshot',
      ['chanh'], 'lemon',
      ['gừng'], 'local_fire_department',
      ['sả'], 'grass',
      ['trái cây', 'táo', 'cam', 'chuối', 'xoài', 'dưa'], 'apple',
      ['sữa', 'trứng', 'bơ', 'phô mai', 'cream'], 'egg_alt',
      ['dầu', 'mỡ', 'bơ thực vật'], 'oil_barrel',
      ['khoai', 'khoai tây', 'khoai lang', 'cà rốt', 'củ'], 'nutrition',
      ['nấm'], 'rainy',
      ['đậu', 'đậu phụ', 'tàu hũ'], 'grain',
      ['lạc', 'đậu phộng', 'vừng', 'mè'], 'seed',
      ['mắm', 'tương', 'xì dầu', 'dầu hào', 'dầu mè', 'tương ớt', 'tương cà', 'rượu', 'giấm'], 'spa',
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

      const result = [...priority1, ...priority2].slice(0, 10);

      // Fallback: chỉ lấy món có tên chứa chính xác cụm từ gốc
      if (result.length === 0) {
        return dishes.filter(d => {
          if (!d || !d.name) return false;
          return d.name.toLowerCase().includes(lower);
        }).slice(0, 6);
      }

      return result;
    } catch (e) {
      console.warn('filterByPriority error:', e);
      return dishes.slice(0, 10); // fallback: show first 10
    }
  }

  // ---- Search: SSE streaming — DB trước, AI stream sau ----
  async function handleSearch(query) {
    if (!query.trim()) {
      await loadRandomDishes();
      return;
    }

    isSearchMode = true;
    lastSearchQuery = query;
    currentDishes = []; // Reset dishes từ search trước

    // Huỷ search cũ nếu có
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    signal.addEventListener('abort', () => {
      // Search cũ đã bị huỷ — bỏ qua
    });

    const grid = document.getElementById('dish-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p class="text-on-surface-variant font-body-md">🔍 Đang tìm kiếm gợi ý cho "${query}"...</p>
          <p class="text-xs text-on-surface-variant mt-2" id="search-status">Đang tra cứu cơ sở dữ liệu...</p>
        </div>`;
    }

    // Dùng SSE để nhận DB results + AI stream
    let allDishes = [];
    let seenNames = new Set();

    try {
      const res = await fetch(`/api/search-dishes-stream?query=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE — mỗi event là "data: {json}\n\n"
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const match = event.match(/^data: (.+)/m);
          if (!match) continue;

          try {
            const payload = JSON.parse(match[1]);

            if (payload.type === 'db') {
              // DB results — hiển thị ngay lập tức
              const dbDishes = Array.isArray(payload.dishes) ? payload.dishes : [];
              dbDishes.forEach(d => {
                const key = d.name.toLowerCase();
                if (!seenNames.has(key)) {
                  seenNames.add(key);
                  allDishes.push(d);
                }
              });

              if (allDishes.length > 0) {
                // Có DB results — render ngay
                renderDishes(allDishes);
              }
              // Nếu DB rỗng: giữ nguyên loading, chờ AI

              const statusEl = document.getElementById('search-status');
              if (!statusEl) continue;
              if (allDishes.length >= 6) {
                statusEl.textContent = '✓ Đã tìm đủ món từ cơ sở dữ liệu';
              } else if (allDishes.length > 0) {
                statusEl.textContent = `🔎 Có ${allDishes.length} món từ dữ liệu, AI đang tạo thêm...`;
              } else {
                statusEl.textContent = '🤖 Không có trong DB, AI đang tìm món mới...';
              }

            } else if (payload.type === 'ai_start') {
              // AI bắt đầu generate
              const statusEl = document.getElementById('search-status');
              if (statusEl) statusEl.textContent = '🤖 AI đang tạo công thức mới, sẽ hiển thị dần...';

              // Nếu đang ở loading state, render DB results trước
              if (allDishes.length > 0 && document.querySelector('.animate-spin')) {
                renderDishes(allDishes);
              }

            } else if (payload.type === 'ai') {
              // Nhận từng món từ AI stream
              const dish = payload.dish;
              if (dish && dish.name) {
                const key = dish.name.toLowerCase();
                if (!seenNames.has(key)) {
                  seenNames.add(key);
                  allDishes.push(dish);

                  // Append card mới
                  appendSingleDish(dish, allDishes.length - 1);
                }
              }

            } else if (payload.type === 'done') {
              // Hoàn tất
              const statusEl = document.getElementById('search-status');
              if (statusEl) statusEl.textContent = '✓ Hoàn tất!';

              // Nếu không có kết quả nào sau khi hoàn tất, hiển thị thông báo
              if (allDishes.length === 0) {
                const grid = document.getElementById('dish-grid');
                if (grid) {
                  grid.innerHTML = `
                    <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
                      <span class="material-symbols-outlined text-5xl text-outline mb-4">search_off</span>
                      <p class="text-on-surface-variant font-body-md">Không tìm thấy món "${query}"</p>
                      <p class="text-xs text-on-surface-variant mt-2">Hãy thử từ khóa khác hoặc thêm món qua camera</p>
                    </div>`;
                }
              }
            }
          } catch (e) {
            // skip parse error
          }
        }
      }
    } catch (e) {
      // Nếu là do tự huỷ (search mới), bỏ qua — không fallback
      if (e.name === 'AbortError') return;

      console.warn('Search stream error, falling back to regular API:', e);

      // Fallback: gọi POST API cũ
      let dishes = [];
      try {
        const fallbackRes = await fetch('/api/search-dishes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await fallbackRes.json();
        if (data.dishes) dishes = data.dishes;
      } catch (e2) {
        console.warn('Fallback search error:', e2);
      }

      if (dishes.length > 0) {
        dishes = filterByPriority(dishes, query);
        renderDishes(dishes);
      } else {
        // Không có kết quả — show not found
        const grid = document.getElementById('dish-grid');
        if (grid) {
          grid.innerHTML = `
            <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
              <span class="material-symbols-outlined text-5xl text-outline mb-4">search_off</span>
              <p class="text-on-surface-variant font-body-md">Không tìm thấy món "${query}"</p>
              <p class="text-xs text-on-surface-variant mt-2">Hãy thử từ khóa khác hoặc thêm món qua camera</p>
            </div>`;
        }
      }
    }

    // Fallback: nếu không có món nào (cả DB + AI đều rỗng)
    if (allDishes.length === 0) {
      const grid = document.getElementById('dish-grid');
      if (grid) {
        // Không dùng getSampleDishes() — chỉ hiện thông báo không tìm thấy
        grid.innerHTML = `
          <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
            <span class="material-symbols-outlined text-5xl text-outline mb-4">search_off</span>
            <p class="text-on-surface-variant font-body-md">Không tìm thấy món "${query}"</p>
            <p class="text-xs text-on-surface-variant mt-2">Hãy thử từ khóa khác hoặc thêm món qua camera</p>
          </div>`;
      }
    }
  }

  // ---- Append single dish card (cho AI stream) ----
  function appendSingleDish(dish, idx) {
    const grid = document.getElementById('dish-grid');
    if (!grid) return;

    // Thêm vào currentDishes để tránh trùng khi Xem thêm
    currentDishes.push(dish);

    // Nếu grid đang ở loading state, thay thế nội dung
    if (grid.querySelector('.animate-spin')) {
      grid.innerHTML = '';
      return renderDishes(currentDishes);
    }

    // Nếu grid đang hiện "Không tìm thấy món" — thay thế bằng dishes
    if (grid.textContent.includes('Không tìm thấy')) {
      return renderDishes(currentDishes);
    }

    const { gradient, emoji } = getDishVisual(dish.name);
    const cardHtml = `
      <div class="dish-card bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all group overflow-hidden border border-surface-container-high animate-fade-in">
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

    grid.insertAdjacentHTML('beforeend', cardHtml);

    // Attach events
    attachSingleDishEvents(dish, idx);
  }

  // ---- Attach events cho 1 dish mới ----
  function attachSingleDishEvents(dish, idx) {
    // Attach detail btn — tìm nút cuối cùng
    const btns = document.querySelectorAll('.detail-btn');
    const lastBtn = btns[btns.length - 1];
    if (lastBtn) {
      lastBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showRecipeDetail(dish);
      });
    }

    // Attach fav btn — cuối cùng
    const favBtns = document.querySelectorAll('.fav-btn');
    const lastFav = favBtns[favBtns.length - 1];
    if (lastFav) {
      lastFav.addEventListener('click', function(e) {
        e.stopPropagation();
        const icon = this.querySelector('.material-symbols-outlined');
        const added = MealPlan.toggleFavorite(dish);
        MealPlan.saveState();
        if (added) {
          icon.style.setProperty('font-variation-settings', "'FILL' 1");
          icon.classList.remove('opacity-40');
        } else {
          icon.style.setProperty('font-variation-settings', "'FILL' 0");
          icon.classList.add('opacity-40');
        }
      });
    }
  }

  // ===================== Gợi ý món theo thể trạng =====================

  // ---- Tính BMI, BMR, TDEE ----
  function calculateBodyMetrics(gender, age, weight, height, goal) {
    // BMI
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);

    // BMI status
    let bmiStatus, bmiColor, bmiBadgeBg;
    if (bmi < 18.5) { bmiStatus = 'Gầy'; bmiColor = 'text-blue-600'; bmiBadgeBg = 'bg-blue-100'; }
    else if (bmi < 23) { bmiStatus = 'Bình thường'; bmiColor = 'text-emerald-600'; bmiBadgeBg = 'bg-emerald-100'; }
    else if (bmi < 25) { bmiStatus = 'Thừa cân'; bmiColor = 'text-amber-600'; bmiBadgeBg = 'bg-amber-100'; }
    else if (bmi < 30) { bmiStatus = 'Béo phì độ I'; bmiColor = 'text-orange-600'; bmiBadgeBg = 'bg-orange-100'; }
    else { bmiStatus = 'Béo phì độ II'; bmiColor = 'text-red-600'; bmiBadgeBg = 'bg-red-100'; }

    // BMR — Mifflin-St Jeor
    let bmr;
    if (gender === 'male') {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    // TDEE — giả định sedentary (1.2), có thể thêm activity level sau
    const activityFactor = 1.2;
    const tdee = bmr * activityFactor;

    // Calorie target theo mục tiêu
    let calTarget, goalLabel;
    switch (goal) {
      case 'lose':
        calTarget = tdee - 500;
        goalLabel = 'Giảm cân';
        break;
      case 'gain_muscle':
        calTarget = tdee + 300;
        goalLabel = 'Tăng cơ';
        break;
      case 'gain_weight':
        calTarget = tdee + 500;
        goalLabel = 'Tăng cân';
        break;
      default:
        calTarget = tdee;
        goalLabel = 'Giữ dáng';
    }

    return {
      bmi: Math.round(bmi * 10) / 10,
      bmiStatus,
      bmiColor,
      bmiBadgeBg,
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      calTarget: Math.round(calTarget),
      goalLabel,
      // Protein gợi ý: tăng cơ = nhiều protein, tăng cân = vừa phải
      proteinMin: Math.round(weight * (goal === 'gain_muscle' ? 1.6 : 1.0)),
      proteinMax: Math.round(weight * (goal === 'gain_muscle' ? 2.0 : 1.4)),
    };
  }

  // ---- Mở bottom sheet nhập liệu ----
  function openBodyForm() {
    const overlay = document.getElementById('body-recommend-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeBodyForm() {
    const overlay = document.getElementById('body-recommend-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function closeBodyResult() {
    const overlay = document.getElementById('body-result-overlay');
    if (overlay) overlay.classList.add('hidden');
    const content = document.getElementById('body-result-content');
    if (content) { content.innerHTML = ''; }
  }

  // ---- Hàm lấy calories từ dish string ----
  function extractCalories(dish) {
    if (!dish) return null;
    const calStr = (dish.calories || '').replace(/[^0-9]/g, '');
    return calStr ? parseInt(calStr) : null;
  }

  // ---- Render metrics card (hiển thị ngay, không cần chờ API) ----
  function renderBodyMetrics(metrics) {
    const loading = document.getElementById('body-result-loading');
    const content = document.getElementById('body-result-content');
    const error = document.getElementById('body-result-error');
    if (!content) return;

    loading.classList.add('hidden');
    error.classList.add('hidden');
    content.classList.remove('hidden');

    content.innerHTML = `
      <div class="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-title-md text-sm font-semibold text-white/90">Chỉ số cơ thể</h3>
          <span class="bg-white/20 backdrop-blur-sm px-3 py-0.5 rounded-full text-xs">${metrics.goalLabel}</span>
        </div>
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <div class="text-2xl font-bold">${metrics.bmi}</div>
            <div class="text-xs text-white/70">BMI</div>
            <div class="mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${metrics.bmiBadgeBg} ${metrics.bmiColor}">${metrics.bmiStatus}</div>
          </div>
          <div class="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <div class="text-2xl font-bold">${metrics.bmr}</div>
            <div class="text-xs text-white/70">BMR</div>
            <div class="text-[10px] text-white/60">kcal/ngày</div>
          </div>
          <div class="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <div class="text-2xl font-bold">${metrics.tdee}</div>
            <div class="text-xs text-white/70">TDEE</div>
            <div class="text-[10px] text-white/60">kcal/ngày</div>
          </div>
        </div>
        <div class="bg-white/15 backdrop-blur-sm rounded-lg p-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-lg">local_fire_department</span>
            <span class="text-sm text-white/80">Nên nạp mỗi ngày</span>
          </div>
          <div class="text-right">
            <span class="text-2xl font-bold">${metrics.calTarget}</span>
            <span class="text-xs text-white/70"> kcal</span>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-white/70">
          <div class="bg-white/10 rounded-lg px-3 py-2">
            Protein: <strong class="text-white">${metrics.proteinMin}-${metrics.proteinMax}g/ngày</strong>
          </div>
          <div class="bg-white/10 rounded-lg px-3 py-2">
            Mỗi bữa ≈ <strong class="text-white">${Math.round(metrics.calTarget / 3)} kcal</strong>
          </div>
        </div>
      </div>
      <!-- Dishes section heading — dishes will stream in below -->
      <div id="body-dishes-section">
        <h3 class="font-title-md text-on-surface flex items-center gap-2 mb-3 mt-4">
          <span class="material-symbols-outlined text-indigo-500">restaurant</span>
          Gợi ý món ăn phù hợp
        </h3>
        <div id="body-dishes-list" class="space-y-3">
          <div class="bg-surface-container-low rounded-xl p-6 text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-3"></div>
            <p class="text-sm text-on-surface-variant">AI đang phân tích và đưa ra món ăn phù hợp...</p>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Append một dish ----
  function appendBodyDish(dishData) {
    const list = document.getElementById('body-dishes-list');
    if (!list) return;

    // Remove loading placeholder if present
    const loading = list.querySelector('.body-dishes-loading');
    if (loading) loading.remove();

    const dish = dishData.dish || dishData;
    const matchPct = dishData.matchPercent || null;
    const cal = extractCalories(dish);
    const perMeal = null; // We'll compute from the metrics card if needed
    const calDiff = cal ? null : null; // skip badge for now

    const card = document.createElement('div');
    card.className = 'bg-surface-container-low rounded-xl overflow-hidden border border-outline-variant/20 hover:shadow-md transition-all animate-fade-in';

    // Store dish data for detail/cook buttons
    card.dataset.dishName = dish.name;

    card.innerHTML = `
      <div class="p-4">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <h4 class="font-title-md text-sm text-on-surface">${dish.name}</h4>
            <div class="flex items-center gap-3 mt-1">
              <span class="flex items-center gap-1 text-xs text-on-surface-variant">
                <span class="material-symbols-outlined text-[14px]">schedule</span> ${dish.time || '--'}
              </span>
              <span class="flex items-center gap-1 text-xs text-on-surface-variant">
                <span class="material-symbols-outlined text-[14px]">local_fire_department</span> ${dish.calories || '--'}
              </span>
              ${dish.difficulty ? `<span class="px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant rounded text-[10px] font-semibold">${dish.difficulty}</span>` : ''}
            </div>
          </div>
          ${matchPct ? `<div class="flex flex-col items-center ml-2">
            <div class="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
              <span class="font-price-tag font-bold text-sm text-indigo-600">${matchPct}%</span>
            </div>
            <span class="text-[10px] text-on-surface-variant mt-0.5">phù hợp</span>
          </div>` : ''}
        </div>
        ${dish.description ? `<p class="text-xs text-on-surface-variant mt-2 line-clamp-1">${dish.description}</p>` : ''}
        <div class="flex gap-2 mt-3">
          <button class="body-dish-detail flex-1 bg-surface-container-high text-indigo-600 py-2 rounded-lg text-xs font-label-md hover:bg-indigo-50 active:scale-[0.98] transition-all flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-[15px]">article</span>
            Xem chi tiết
          </button>
          <button class="body-dish-cart flex-1 bg-primary text-white py-2 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1 shadow-sm">
            <span class="material-symbols-outlined text-[15px]">shopping_cart</span>
            Đi Chợ
          </button>
          <button class="body-dish-cook flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-2 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1 shadow-sm">
            <span class="material-symbols-outlined text-[15px]">cooking</span>
            Nấu Ăn
          </button>
        </div>
      </div>
    `;

    // Attach events
    card.querySelector('.body-dish-detail')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('body-result-overlay')?.classList.add('hidden');
      showRecipeDetail(dish);
    });
    card.querySelector('.body-dish-cart')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const ings = dish.ingredients || [];
      MealPlan.setCart(ings);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.state.currentDishData = dish;
      MealPlan.saveState();
      document.getElementById('body-result-overlay')?.classList.add('hidden');
      document.querySelector('.recipe-overlay')?.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
      MealPlan.showToast(`Đã thêm "${dish.name}" vào giỏ!`, 'success');
    });
    card.querySelector('.body-dish-cook')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('body-result-overlay')?.classList.add('hidden');
      document.querySelector('.recipe-overlay')?.remove();
      try {
        window.showRecipeDetail(dish, 'cook');
      } catch (err) {
        console.error('[MealPlan] Error entering cooking mode:', err);
        MealPlan.showToast('Không thể vào chế độ nấu!', 'error');
      }
    });

    list.appendChild(card);
  }

  // ---- Gọi API đề xuất (đơn giản: POST → AI trả về → hiển thị) ----
  let bodyMetricsCache = null; // Lưu metrics để xem thêm
  let bodyDishCount = 0;       // Đếm số món đã có

  async function handleBodyRecommend() {
    const gender = document.querySelector('input[name="body-gender"]:checked')?.value || 'male';
    const age = parseInt(document.getElementById('body-age')?.value || '30');
    const weight = parseFloat(document.getElementById('body-weight')?.value || '65');
    const height = parseInt(document.getElementById('body-height')?.value || '165');
    const goal = document.querySelector('input[name="body-goal"]:checked')?.value || 'maintain';

    if (!age || age < 10 || age > 120 || !weight || weight < 20 || !height || height < 80) {
      MealPlan.showToast('Vui lòng nhập thông tin hợp lệ!', 'warning');
      return;
    }

    // Đóng form
    closeBodyForm();

    // Reset result overlay
    const loading = document.getElementById('body-result-loading');
    const content = document.getElementById('body-result-content');
    if (loading) loading.classList.remove('hidden');
    if (content) { content.classList.add('hidden'); content.innerHTML = ''; }
    document.getElementById('body-result-error')?.classList.add('hidden');

    // Mở result overlay
    const resultOverlay = document.getElementById('body-result-overlay');
    if (resultOverlay) resultOverlay.classList.remove('hidden');

    // Tính metrics ngay lập tức (client-side)
    const metrics = calculateBodyMetrics(gender, age, weight, height, goal);
    bodyMetricsCache = { gender, age, weight, height, goal, metrics };
    bodyDishCount = 0;
    renderBodyMetrics(metrics);

    await fetchAndShowDishes(false);
  }

  // ---- Gọi API lấy món ----
  async function fetchAndShowDishes(loadMore) {
    if (!bodyMetricsCache) return;
    const { gender, age, weight, height, goal, metrics } = bodyMetricsCache;

    // Show loading trong dishes list
    const list = document.getElementById('body-dishes-list');
    if (!list) return;

    if (loadMore) {
      // Thêm loading vào cuối
      const loader = document.createElement('div');
      loader.className = 'bg-surface-container-low rounded-xl p-6 text-center body-dishes-loading';
      loader.innerHTML = '<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-3"></div><p class="text-sm text-on-surface-variant">AI đang phân tích và đưa ra món ăn phù hợp...</p>';
      list.appendChild(loader);
    }

    try {
      const res = await fetch('/api/recommend-by-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gender, age, weight, height, goal,
          bmi: metrics.bmi, bmr: metrics.bmr, tdee: metrics.tdee, calTarget: metrics.calTarget,
          loadMore: loadMore,
          skipCount: bodyDishCount // AI sẽ biết cần đề xuất món mới
        })
      });
      const data = await res.json();

      // Xoá loading
      if (loadMore) {
        const spinner = list.querySelector('.body-dishes-loading');
        if (spinner) spinner.remove();
      } else {
        const spinner = list.querySelector('.animate-spin');
        if (spinner) spinner.parentElement.remove();
      }

      if (data.success && data.dishes && data.dishes.length > 0) {
        data.dishes.forEach(d => {
          appendBodyDish(d);
          bodyDishCount++;
        });

        // Thêm nút Xem thêm nếu chưa có
        if (!document.getElementById('body-load-more-btn')) {
          const btnWrap = document.createElement('div');
          btnWrap.id = 'body-load-more-btn';
          btnWrap.innerHTML = `
            <button id="btn-body-load-more" class="w-full mt-3 py-3 border-2 border-dashed border-outline-variant/50 rounded-xl text-on-surface-variant font-label-md text-sm hover:bg-surface-container-low hover:border-indigo-300 transition-all">
              <span class="flex items-center justify-center gap-2">
                <span class="material-symbols-outlined text-[18px]">refresh</span>
                Xem thêm món ăn
              </span>
            </button>
          `;
          list.insertAdjacentElement('afterend', btnWrap);

          document.getElementById('btn-body-load-more')?.addEventListener('click', async () => {
            await fetchAndShowDishes(true);
          });
        }
      } else {
        if (loadMore) {
          MealPlan.showToast('Đã hiển thị tất cả món phù hợp!', 'info');
        } else {
          list.innerHTML = '<div class="bg-surface-container-low rounded-xl p-6 text-center"><span class="material-symbols-outlined text-3xl text-outline mb-2">search_off</span><p class="text-sm text-on-surface-variant">Không tìm thấy món ăn phù hợp</p></div>';
        }
      }
    } catch (err) {
      console.error('Body recommend error:', err);
      const spinner = list.querySelector('.animate-spin, .body-dishes-loading');
      if (spinner) spinner.remove();
      if (!loadMore) {
        list.innerHTML = '<div class="bg-surface-container-low rounded-xl p-6 text-center"><span class="material-symbols-outlined text-3xl text-error mb-2">error_outline</span><p class="text-sm text-on-surface-variant">Lỗi kết nối, vui lòng thử lại</p></div>';
      }
    }
  }

  // ---- Camera / Upload ----
  // Dùng MealPlan.openCamera({ mode: 'dish', onResult: callback }) từ app.js

  // ---- Xác định buổi trong ngày ----
  function getMealPeriod() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'breakfast';   // sáng: 5h-11h
    if (h >= 11 && h < 14) return 'lunch';       // trưa: 11h-14h
    if (h >= 14 && h < 21) return 'dinner';      // tối: 14h-21h
    return 'night';                               // khuya: 21h-5h
  }

  function getPeriodMeta(period) {
    switch (period) {
      case 'breakfast':
        return {
          label: '🌅 Gợi ý món sáng',
          greeting: 'Chào buổi sáng',
          sub: 'Những món ăn sáng phổ biến người Việt hay ăn ☀️',
          icon: 'wb_sunny',
          gradient: 'from-amber-400 to-orange-500',
          query: 'món sáng'
        };
      case 'lunch':
        return {
          label: '☀️ Gợi ý món trưa',
          greeting: 'Chào buổi trưa',
          sub: 'Cơm trưa đầy đủ dinh dưỡng cho một ngày làm việc 🍚',
          icon: 'light_mode',
          gradient: 'from-orange-400 to-red-500',
          query: 'món trưa'
        };
      case 'dinner':
        return {
          label: '🌆 Gợi ý món tối',
          greeting: 'Chào buổi tối',
          sub: 'Bữa tối sum họp gia đình ấm cúng 🍲',
          icon: 'dark_mode',
          gradient: 'from-indigo-500 to-purple-600',
          query: 'món tối'
        };
      case 'night':
        return {
          label: '🌙 Gợi ý món khuya',
          greeting: 'Khuya rồi còn đói không?',
          sub: 'Đồ ăn nhẹ cho bữa khuya ⭐',
          icon: 'bedtime',
          gradient: 'from-slate-600 to-indigo-800',
          query: 'món khuya'
        };
    }
  }

  // ---- Load dishes theo buổi ----
  let currentPeriod = 'breakfast';

  async function loadMealDishes(period) {
    currentPeriod = period;
    const meta = getPeriodMeta(period);
    const grid = document.getElementById('dish-grid');
    if (!grid) return;

    isSearchMode = false;
    lastSearchQuery = '';

    // Cập nhật UI greeting & period header
    const greetEl = document.getElementById('greeting-text');
    if (greetEl) greetEl.textContent = meta.greeting;
    const greetSub = document.getElementById('greeting-sub');
    if (greetSub) greetSub.textContent = meta.sub;

    const periodTitle = document.getElementById('period-title');
    if (periodTitle) periodTitle.textContent = meta.label;
    const periodSub = document.getElementById('period-sub');
    if (periodSub) periodSub.textContent = meta.sub;
    const periodIcon = document.getElementById('period-icon');
    if (periodIcon) {
      periodIcon.className = `w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0`;
      periodIcon.innerHTML = `<span class="material-symbols-outlined text-white text-[16px]">${meta.icon}</span>`;
    }

    // Loading state
    grid.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high p-4 col-span-full text-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-on-surface-variant font-body-md">Đang tìm món phù hợp cho buổi này...</p>
      </div>`;

    let dishes = [];
    try {
      const res = await fetch(`/api/dishes/meal/${period}?_=${Date.now()}`);
      const data = await res.json();
      if (data.dishes) dishes = data.dishes;
    } catch (e) {
      console.warn('Failed to load meal dishes:', e);
    }

    if (dishes.length === 0) {
      // Fallback: nếu API không trả, dùng random
      try {
        const res = await fetch('/api/random-dishes', { method: 'POST' });
        const data = await res.json();
        if (data.dishes) dishes = data.dishes;
      } catch (e) {}
    }

    if (dishes.length === 0) {
      dishes = getSampleDishes();
    }

    renderDishes(dishes);
  }

  // ---- Init period-based loading ----
  function initPeriodSuggestions() {
    const period = getMealPeriod();
    loadMealDishes(period);
  }

  // ---- Init ----
  function initHome() {
    const searchInput = document.getElementById('dish-search');
    const btnSchedule = document.getElementById('btn-schedule');
    const feedback = document.getElementById('schedule-feedback');
    const btnCamera = document.getElementById('btn-camera');

    if (!searchInput || !btnSchedule) return;

    // Auto-load dishes theo buổi
    initPeriodSuggestions();

    // Xem thêm button — cũng load thêm theo buổi
    document.getElementById('btn-load-more')?.addEventListener('click', async () => {
      if (isSearchMode) {
        await loadMoreDishes();
      } else {
        // Load thêm món từ random
        await loadMoreDishes();
      }
    });

    // Kiểm tra đồng hồ — tự động đổi buổi mỗi khi trang được active lại
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.getElementById('page-home')?.classList.contains('active')) {
        const newPeriod = getMealPeriod();
        if (newPeriod !== currentPeriod) {
          loadMealDishes(newPeriod);
        }
      }
    });

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

    // Body recommend card — mở form
    document.getElementById('btn-body-recommend')?.addEventListener('click', openBodyForm);

    // Body recommend form
    document.getElementById('body-recommend-close')?.addEventListener('click', closeBodyForm);
    document.getElementById('body-recommend-close-alt')?.addEventListener('click', closeBodyForm);
    document.getElementById('btn-body-analyze')?.addEventListener('click', handleBodyRecommend);

    // Body recommend result
    document.querySelectorAll('.body-result-close').forEach(el => el.addEventListener('click', closeBodyResult));

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

  // Expose globally for other modules
  window.renderHomeDishes = renderDishes;
  window.showHealthAnalysis = showHealthAnalysis;
  window.showRecipeDetail = showRecipeDetail;
  window.createHistoryEntry = createHistoryEntry;
  window.loadMealDishes = loadMealDishes;
  window.getMealPeriod = getMealPeriod;

  document.addEventListener('DOMContentLoaded', initHome);
})();
