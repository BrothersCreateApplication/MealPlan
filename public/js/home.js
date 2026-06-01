// ===================== Trang Chủ Module — Context-Aware Recommendations =====================

(function() {
  'use strict';

  // ---- State ----
  const state = {
    allDishes: [],           // all dishes fetched from DB
    mealPeriod: null,        // 'breakfast' | 'lunch' | 'dinner' | 'night'
    periodName: null,        // Tiếng Việt
    sectionIndex: {},        // { breakfast: 0, lunch: 0, dinner: 0, night: 0 } for cycling
    sectionData: {},         // { breakfast: [], lunch: [], dinner: [], night: [] }
    isSearchMode: false,     // true when user is searching
    lastSearchQuery: '',     // last search query
    searchResults: [],       // search results from API
    isLoading: true,
    mealPeriods: [
      { id: 'breakfast', label: 'Bữa Sáng', hours: [5, 6, 7, 8, 9], icon: 'sunny_snowing', color: 'amber', short: '🌅 Sáng' },
      { id: 'lunch',     label: 'Bữa Trưa', hours: [10, 11, 12, 13, 14], icon: 'wb_sunny', color: 'orange', short: '☀️ Trưa' },
      { id: 'dinner',    label: 'Bữa Chiều/Tối', hours: [15, 16, 17, 18, 19, 20], icon: 'bedtime', color: 'indigo', short: '🌆 Chiều' },
      { id: 'night',     label: 'Ăn Đêm', hours: [21, 22, 23, 0, 1, 2, 3, 4], icon: 'nightlight', color: 'purple', short: '🌙 Đêm' },
    ]
  };

  const mealKeywords = {
    breakfast: { tags: ['bánh canh', 'nui', 'bún', 'phở', 'cơm sườn', 'bánh mì', 'cháo', 'xôi', 'mì', 'ốp la', 'trứng', 'sữa', 'bánh cuốn', 'bánh ướt', 'bánh bèo', 'hủ tiếu', 'miến'], vibe: 'nhẹ nhàng' },
    lunch:     { tags: ['cơm', 'cơm tấm', 'cơm chiên', 'cơm rang', 'cơm gà'], vibe: 'đầy đủ' },
    dinner:    { tags: ['canh', 'xào', 'kho', 'lẩu', 'hấp', 'nướng', 'salad', 'soup', 'súp', 'cơm', 'bún', 'phở', 'cuốn', 'nem', 'gỏi', 'rau'], vibe: 'ấm cúng' },
    night:     { tags: ['cháo', 'súp', 'mì', 'phở nhẹ', 'salad', 'trái cây', 'bánh', 'sữa'], vibe: 'nhẹ nhàng' },
  };

  // ---- Determine meal period from current hour ----
  function getMealPeriod() {
    const h = new Date().getHours();
    for (const period of state.mealPeriods) {
      if (period.hours.includes(h)) return period;
    }
    return state.mealPeriods[2]; // fallback dinner
  }

  // ---- Detect context: chỉ dựa vào giờ hiện tại, bỏ GPS/weather ----
  function detectContext() {
    const period = getMealPeriod();
    state.mealPeriod = period.id;
    state.periodName = period.label;
    updateMealBanner();
  }

  // ---- Update meal banner UI (đơn giản, chỉ buổi + vibe) ----
  function updateMealBanner() {
    const banner = document.getElementById('weather-banner');
    const iconEl = document.getElementById('weather-icon');
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const textEl = document.getElementById('weather-text');
    const contextEl = document.getElementById('context-text');

    if (!banner) return;
    banner.classList.remove('hidden');

    const period = state.mealPeriods.find(p => p.id === state.mealPeriod);
    const kw = mealKeywords[state.mealPeriod];

    iconEl.textContent = period?.icon || 'sunny';
    tempEl.textContent = period?.short || '';
    descEl.textContent = period?.label || '';
    textEl.textContent = `⏰ ${period?.label || ''} — Gợi ý món ${kw?.vibe || 'phù hợp'}`;
    contextEl.textContent = `Hôm nay ${kw?.vibe ? `ăn gì ${kw.vibe}?` : 'nấu gì?'}`;
  }

  // ---- Dish icon lookup (Material Symbols + gradient pair) ----
  const dishIconMap = {
    'salad': { icon: 'nutrition', bg: 'from-lime-400/20 to-green-400/20' },
    'phở': { icon: 'ramen_dining', bg: 'from-amber-400/20 to-orange-400/20' },
    'bánh': { icon: 'bakery_dining', bg: 'from-purple-400/20 to-fuchsia-300/20' },
    'trứng': { icon: 'egg_alt', bg: 'from-yellow-300/20 to-amber-200/20' },
    'cơm': { icon: 'rice_bowl', bg: 'from-orange-400/20 to-yellow-300/20' },
    'canh': { icon: 'soup_kitchen', bg: 'from-teal-400/20 to-cyan-300/20' },
    'nướng': { icon: 'local_fire_department', bg: 'from-red-400/20 to-orange-400/20' },
    'chiên': { icon: 'cooking', bg: 'from-amber-400/20 to-yellow-300/20' },
    'xào': { icon: 'skillet', bg: 'from-orange-400/20 to-yellow-300/20' },
    'kho': { icon: 'stove', bg: 'from-amber-500/20 to-orange-400/20' },
    'luộc': { icon: 'water', bg: 'from-teal-400/20 to-cyan-300/20' },
    'rau': { icon: 'eco', bg: 'from-green-400/20 to-emerald-300/20' },
    'tôm': { icon: 'set_meal', bg: 'from-pink-400/20 to-orange-300/20' },
    'cá': { icon: 'set_meal', bg: 'from-blue-400/20 to-teal-300/20' },
    'gà': { icon: 'lunch_dining', bg: 'from-amber-400/20 to-yellow-300/20' },
    'bò': { icon: 'lunch_dining', bg: 'from-red-400/20 to-orange-400/20' },
    'lẩu': { icon: 'local_fire_department', bg: 'from-red-500/20 to-orange-400/20' },
    'cháo': { icon: 'soup_kitchen', bg: 'from-teal-400/20 to-cyan-300/20' },
    'súp': { icon: 'soup_kitchen', bg: 'from-amber-400/20 to-orange-300/20' },
    'bún': { icon: 'ramen_dining', bg: 'from-amber-400/20 to-orange-400/20' },
    'mì': { icon: 'ramen_dining', bg: 'from-yellow-500/20 to-orange-400/20' },
    'bánh mì': { icon: 'bakery_dining', bg: 'from-amber-400/20 to-yellow-300/20' },
    'sữa': { icon: 'local_cafe', bg: 'from-blue-200/20 to-white/20' },
    'xôi': { icon: 'rice_bowl', bg: 'from-orange-400/20 to-yellow-300/20' },
    'nem': { icon: 'dining', bg: 'from-green-400/20 to-emerald-300/20' },
    'cuốn': { icon: 'dining', bg: 'from-green-400/20 to-teal-300/20' },
    'gỏi': { icon: 'nutrition', bg: 'from-lime-400/20 to-green-400/20' },
  };

  function getDishVisual(name) {
    const lower = name.toLowerCase();
    const sorted = Object.entries(dishIconMap).sort(([a], [b]) => b.length - a.length);
    for (const [key, val] of sorted) {
      if (lower.includes(key)) return val;
    }
    return { icon: 'restaurant', bg: 'from-primary/10 to-primary-container/20' };
  }

  // ---- Fetch all dishes from DB (with timeout) ----
  async function loadAllDishes() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/dishes', { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.dishes && data.dishes.length > 0) {
        state.allDishes = data.dishes;
        return true;
      }
    } catch (e) {
      console.warn('[Home] Failed to load dishes:', e);
    }
    return false;
  }

  // ---- Smart dish filtering per meal (chỉ theo buổi, bỏ weather) ----
  function getDishesForMealPeriod(mealId) {
    const dishes = state.allDishes;
    if (!dishes || dishes.length === 0) return [];

    const mealKw = mealKeywords[mealId] || mealKeywords.lunch;

    // Score each dish
    const scored = dishes.map(dish => {
      let score = 0;
      const name = (dish.name || '').toLowerCase();
      const desc = (dish.description || '').toLowerCase();
      const text = name + ' ' + desc;
      const ings = (dish.ingredients || []).map(i => i.name.toLowerCase()).join(' ');

      // Meal period match
      for (const tag of mealKw.tags) {
        if (text.includes(tag)) score += 3;
        if (ings.includes(tag)) score += 2;
      }

      // Bonus: dishes with complete data
      if (dish.instructions) score += 1;
      if (dish.time) score += 0.5;
      if (dish.calories) score += 0.5;

      if (score === 0) score = 0.01; // always show but low priority

      return { dish, score };
    });

    // Sort by score descending, take top 30
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).map(s => s.dish);
  }

  // ---- Tab config ----
  const tabConfig = {
    breakfast: { label: '🌅 Bữa Sáng', title: '🌅 Bữa Sáng' },
    lunch:     { label: '☀️ Bữa Trưa', title: '☀️ Bữa Trưa' },
    dinner:    { label: '🌆 Bữa Chiều/Tối', title: '🌆 Bữa Chiều/Tối' },
    night:     { label: '🌙 Ăn Đêm', title: '🌙 Ăn Đêm' },
  };

  // ---- Prepare all section data ----
  function prepareAllSections() {
    const mealIds = ['breakfast', 'lunch', 'dinner', 'night'];
    for (const id of mealIds) {
      const dishes = getDishesForMealPeriod(id);
      state.sectionData[id] = dishes;
      state.sectionIndex[id] = 0;
    }
  }

  // ---- Render dish grid for a meal tab (show all dishes, batch-style) ----
  function renderGrid(mealId) {
    const grid = document.getElementById('dish-grid');
    if (!grid) return;

    const titleEl = document.getElementById('meal-grid-title');
    const loadBtn = document.getElementById('btn-load-more');

    // Search mode: use searchResults, show all, no cycle
    if (state.isSearchMode) {
      const results = state.searchResults || [];
      if (titleEl) titleEl.textContent = `🔍 Tìm "${state.lastSearchQuery}"`;
      if (loadBtn) loadBtn.classList.add('hidden');

      if (!results || results.length === 0) {
        grid.innerHTML = `
          <div class="bg-surface-container-lowest rounded-xl p-8 text-center col-span-full border border-outline-variant/20">
            <span class="material-symbols-outlined text-4xl text-outline mb-2">search_off</span>
            <p class="text-sm text-on-surface-variant">Không tìm thấy món "${state.lastSearchQuery}"</p>
            <p class="text-xs text-on-surface-variant mt-2">Hãy thử từ khóa khác hoặc thêm món qua camera</p>
          </div>`;
        return;
      }

      grid.innerHTML = results.map(dish => renderCard(dish)).join('');
      attachGridEvents(grid);
      return;
    }

    // Normal mode: use sectionData
    const dishes = state.sectionData[mealId] || [];
    const idx = state.sectionIndex[mealId] || 0;

    // Update title
    if (titleEl) titleEl.textContent = tabConfig[mealId]?.title || mealId;

    if (!dishes || dishes.length === 0) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center col-span-full border border-outline-variant/20">
          <span class="material-symbols-outlined text-4xl text-outline mb-2">restaurant</span>
          <p class="text-sm text-on-surface-variant">Chưa có gợi ý cho bữa này</p>
        </div>`;
      document.getElementById('btn-load-more')?.classList.add('hidden');
      return;
    }

    // Show first 10 dishes starting at idx, cycle
    const shown = [];
    for (let i = 0; i < dishes.length && shown.length < 10; i++) {
      const d = dishes[(idx + i) % dishes.length];
      if (d && !shown.some(t => t.name === d.name)) shown.push(d);
    }

    grid.innerHTML = shown.map(dish => renderCard(dish)).join('');

    // Attach events
    attachGridEvents(grid);

    // Show/hide load more
    const loadBtn = document.getElementById('btn-load-more');
    if (loadBtn) loadBtn.classList.toggle('hidden', dishes.length <= 10);
  }

  // ---- Render single dish card (compact design) ----
  function renderCard(dish) {
    const visual = getDishVisual(dish.name);
    return `
      <div class="dish-card bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-surface-container-high animate-fade-in">
        <div class="p-3.5">
          <div class="flex items-center gap-2.5">
            <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${visual.bg} text-primary flex-shrink-0">
              <span class="material-symbols-outlined text-[22px]" style="font-variation-settings:'FILL' 1">${visual.icon}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <h4 class="font-label-md text-on-surface truncate">${dish.name}</h4>
                <button class="fav-btn flex-shrink-0 p-0.5 rounded-full hover:bg-surface-container-high transition-all" data-dish="${dish.name}">
                  <span class="material-symbols-outlined text-secondary text-[16px] ${MealPlan.isFavorite(dish.name) ? '' : 'opacity-40'}" style="font-variation-settings: 'FILL' ${MealPlan.isFavorite(dish.name) ? '1' : '0'};">favorite</span>
                </button>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="flex items-center gap-0.5 text-[11px] text-on-surface-variant">
                  <span class="material-symbols-outlined text-[12px]">schedule</span> ${dish.time || '--'}
                </span>
                <span class="flex items-center gap-0.5 text-[11px] text-on-surface-variant">
                  <span class="material-symbols-outlined text-[12px]">local_fire_department</span> ${dish.calories || '--'}
                </span>
                ${dish.difficulty ? `<span class="text-[9px] bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full font-semibold">${dish.difficulty}</span>` : ''}
              </div>
            </div>
            <div class="flex gap-1.5 flex-shrink-0">
              <button class="detail-btn w-9 h-9 flex items-center justify-center bg-surface-container-high text-primary rounded-lg hover:bg-primary-container/30 active:scale-95 transition-all" data-dish-name="${dish.name}" title="Xem chi tiết">
                <span class="material-symbols-outlined text-[18px]">article</span>
              </button>
              <button class="meal-cook-btn w-9 h-9 flex items-center justify-center bg-primary text-on-primary rounded-lg hover:opacity-90 active:scale-95 transition-all" data-dish-name="${dish.name}" title="Nấu ăn">
                <span class="material-symbols-outlined text-[18px]">cooking</span>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- Attach events for dish grid ----
  function attachGridEvents(grid) {
    grid.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const name = this.dataset.dishName;
        const dish = state.allDishes.find(d => d.name === name) || state.searchResults.find(d => d.name === name);
        if (dish) showRecipeDetail(dish);
        else MealPlan.showToast('Không thể hiển thị chi tiết!', 'error');
      });
    });
    grid.querySelectorAll('.meal-cook-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const name = this.dataset.dishName;
        const dish = state.allDishes.find(d => d.name === name) || state.searchResults.find(d => d.name === name);
        if (dish) {
          MealPlan.setCart(dish.ingredients || []);
          MealPlan.state.currentMealName = dish.name;
          MealPlan.saveState();
          MealPlan.navigate('cart');
          if (window.renderCart) window.renderCart();
        }
      });
    });
    grid.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const dishName = this.dataset.dish;
        const dish = state.allDishes.find(d => d.name === dishName);
        const icon = this.querySelector('.material-symbols-outlined');
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
  }

  // ---- Switch tab ----
  let currentMealTab = 'breakfast';

  function switchMealTab(mealId) {
    currentMealTab = mealId;
    // Clear search mode when switching tabs
    state.isSearchMode = false;
    state.searchResults = [];
    // Update tab styles
    document.querySelectorAll('.meal-tab').forEach(tab => {
      const isActive = tab.dataset.meal === mealId;
      tab.classList.toggle('bg-primary', isActive);
      tab.classList.toggle('text-on-primary', isActive);
      tab.classList.toggle('bg-surface-container-high', !isActive);
      tab.classList.toggle('text-on-surface-variant', !isActive);
    });
    renderGrid(mealId);
  }

  // ---- Refresh / cycle a tab (advance by 10 dishes) ----
  function handleRefresh() {
    // If in search mode, re-search with the same query
    if (state.isSearchMode && state.lastSearchQuery) {
      handleSearch(state.lastSearchQuery);
      return;
    }
    const mealId = currentMealTab;
    const dishes = state.sectionData[mealId] || [];
    if (dishes.length <= 10) {
      MealPlan.showToast('Đã hiển thị tất cả món cho bữa này!', 'info');
      return;
    }
    state.sectionIndex[mealId] = (state.sectionIndex[mealId] + 10) % dishes.length;
    renderGrid(mealId);
  }

  // ===================== Recipe Detail Overlay =====================
  function showRecipeDetail(dish) {
    const existing = document.querySelector('.recipe-overlay');
    if (existing) existing.remove();

    const steps = (dish.instructions || '')
      .split('\n')
      .filter(s => s.trim())
      .map((s, i) => {
        const clean = s.replace(/^(Bước|Step)\s*\d+[:\s)]*\s*/i, '').replace(/^\d+[\.\s)]+\s*/, '');
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
        <div class="flex-1 overflow-y-auto md:overflow-y-visible">
          <div class="p-5 md:p-6">
            <div class="flex justify-end mb-2">
              <button class="bg-surface-container-high text-on-surface-variant p-1.5 rounded-full hover:bg-surface-container-highest transition-all" id="recipe-close">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
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
            <div class="mb-5">
              <h3 class="font-title-md flex items-center gap-2 text-primary mb-3">
                <span class="material-symbols-outlined">shopping_basket</span>
                Nguyên liệu cần mua
              </h3>
              <div class="bg-surface-container-low rounded-xl divide-y divide-outline-variant/20 overflow-hidden">
                ${(dish.ingredients || []).map(ing => `
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <div class="flex items-center gap-3">
                      <span class="material-symbols-outlined text-outline text-[18px]">inventory_2</span>
                      <span class="font-label-md text-on-surface">${ing.name}</span>
                    </div>
                    <span class="text-on-surface-variant font-body-md">${ing.quantity}</span>
                  </div>
                `).join('')}
              </div>
            </div>
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
            <div class="mt-5 mb-5">
              <button id="health-analysis-btn" class="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-md">
                <span class="material-symbols-outlined">monitor_heart</span>
                Phân tích sức khỏe
              </button>
              <p class="text-xs text-on-surface-variant text-center mt-1">Đánh giá tác động lên tim, thận, gan</p>
            </div>
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
    loadYouTubeVideo(dish.name);

    overlay.querySelector('#recipe-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#recipe-close-alt')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#recipe-cook-btn')?.addEventListener('click', () => {
      MealPlan.setCart(dish.ingredients || []);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.saveState();
      overlay.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
    });

    overlay.querySelector('#health-analysis-btn')?.addEventListener('click', async () => {
      await showHealthAnalysis(dish);
    });
  }

  // ---- YouTube ----
  async function loadYouTubeVideo(dishName) {
    try {
      const res = await fetch(`/api/youtube-video?dish=${encodeURIComponent(dishName)}`);
      const data = await res.json();
      const container = document.getElementById('youtube-video-container');
      if (!container) return;
      if (data.videoId) {
        container.innerHTML = `<iframe class="w-full h-full aspect-video" src="https://www.youtube.com/embed/${data.videoId}?autoplay=0&rel=0" title="${data.title || dishName}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      } else {
        container.innerHTML = `<div class="text-center p-6"><span class="material-symbols-outlined text-3xl text-outline mb-2">videocam_off</span><p class="text-xs text-on-surface-variant">Không tìm thấy video hướng dẫn</p></div>`;
      }
    } catch (e) {
      const container = document.getElementById('youtube-video-container');
      if (container) container.innerHTML = `<div class="text-center p-6"><span class="material-symbols-outlined text-3xl text-outline mb-2">videocam_off</span><p class="text-xs text-on-surface-variant">Lỗi tải video</p></div>`;
    }
  }

  // ===================== Health Analysis (kept from original) =====================
  async function showHealthAnalysis(dish) {
    const existing = document.querySelector('.health-analysis-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'health-analysis-overlay fixed inset-0 z-[250] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
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
        <div id="health-analysis-body" class="flex-1 overflow-y-auto p-5 md:p-6">
          <div class="text-center py-8" id="health-loading">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mx-auto mb-4"></div>
            <p class="text-on-surface font-label-md mb-1">AI đang phân tích...</p>
            <p class="text-xs text-on-surface-variant">Đánh giá tác động lên tim, thận và gan</p>
          </div>
          <div id="health-results" class="hidden space-y-5"></div>
          <div id="health-error" class="hidden text-center py-8">
            <span class="material-symbols-outlined text-4xl text-error mb-3">error_outline</span>
            <p class="text-on-surface font-label-md">Không thể phân tích món ăn</p>
            <p class="text-xs text-on-surface-variant mt-1">Vui lòng thử lại sau</p>
          </div>
        </div>
        <div class="flex-shrink-0 p-4 md:p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
          <div class="flex gap-gutter-md">
            <button class="health-cook-btn flex-1 bg-primary text-on-primary py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg">
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

    const close = () => overlay.remove();
    overlay.querySelectorAll('.health-analysis-close').forEach(el => el.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.health-cook-btn')?.addEventListener('click', () => {
      MealPlan.setCart(dish.ingredients || []);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.saveState();
      overlay.remove();
      document.querySelector('.recipe-overlay')?.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
    });

    try {
      const res = await fetch('/api/health-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dish })
      });
      const data = await res.json();
      if (data.success && data.analysis) renderHealthResults(data.analysis);
      else showHealthError();
    } catch (err) {
      console.error('Health analysis error:', err);
      showHealthError();
    }
  }

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
        case 'positive': return { bg: 'bg-emerald-50 border-emerald-200', icon: 'check_circle', iconBg: 'bg-emerald-500', iconColor: 'text-white', badge: 'bg-emerald-100 text-emerald-700', badgeText: 'Tốt', label: 'Lành mạnh' };
        case 'warning': return { bg: 'bg-amber-50 border-amber-200', icon: 'warning', iconBg: 'bg-amber-500', iconColor: 'text-white', badge: 'bg-amber-100 text-amber-700', badgeText: 'Trung bình', label: 'Cần chú ý' };
        case 'danger': return { bg: 'bg-red-50 border-red-200', icon: 'error', iconBg: 'bg-red-500', iconColor: 'text-white', badge: 'bg-red-100 text-red-700', badgeText: 'Cao', label: 'Cần hạn chế' };
        default: return getLevelConfig('warning');
      }
    }

    function renderOrganCard(organKey, organData, organLabel, organIcon) {
      const cfg = getLevelConfig(organData.level);
      return `<div class="rounded-xl border ${cfg.bg} p-4 transition-all hover:shadow-sm">
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
      </div>`;
    }

    results.innerHTML = `
      <div class="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
        <h4 class="font-label-md text-on-surface-variant text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px]">bar_chart</span>
          Chỉ số dinh dưỡng ước tính
        </h4>
        <div class="grid grid-cols-5 gap-2 text-center">
          <div class="bg-white rounded-lg p-2.5"><div class="font-title-md font-bold text-orange-600 text-sm">${n.calories || '--'}</div><div class="text-[10px] text-on-surface-variant">Calories</div></div>
          <div class="bg-white rounded-lg p-2.5"><div class="font-title-md font-bold text-blue-600 text-sm">${n.protein || '--'}</div><div class="text-[10px] text-on-surface-variant">Protein</div></div>
          <div class="bg-white rounded-lg p-2.5"><div class="font-title-md font-bold text-amber-600 text-sm">${n.carbs || '--'}</div><div class="text-[10px] text-on-surface-variant">Carbs</div></div>
          <div class="bg-white rounded-lg p-2.5"><div class="font-title-md font-bold text-purple-600 text-sm">${n.fats || '--'}</div><div class="text-[10px] text-on-surface-variant">Chất béo</div></div>
          <div class="bg-white rounded-lg p-2.5"><div class="font-title-md font-bold text-red-600 text-sm">${n.sodium || '--'}</div><div class="text-[10px] text-on-surface-variant">Natri</div></div>
        </div>
      </div>
      ${renderOrganCard('heart', analysis.heart, 'Tim mạch', 'favorite')}
      ${renderOrganCard('kidneys', analysis.kidneys, 'Thận', 'kidney')}
      ${renderOrganCard('liver', analysis.liver, 'Gan', 'liver')}
      ${analysis.overall ? `<div class="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl p-4 text-white shadow-md">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined">summarize</span>
          <h4 class="font-title-md font-semibold">Đánh giá tổng quan</h4>
        </div>
        <p class="text-sm text-white/90 leading-relaxed">${analysis.overall}</p>
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

  // ===================== Search =====================
  async function handleSearch(query) {
    if (!query.trim()) return;

    state.isSearchMode = true;
    state.lastSearchQuery = query;
    state.searchResults = [];

    // Show loading state
    const grid = document.getElementById('dish-grid');
    const titleEl = document.getElementById('meal-grid-title');
    if (titleEl) titleEl.textContent = `🔍 Đang tìm "${query}"...`;
    if (grid) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center col-span-full border border-outline-variant/20">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p class="text-sm text-on-surface-variant">🔍 Đang tìm kiếm "${query}"...</p>
        </div>`;
    }
    document.getElementById('btn-load-more')?.classList.add('hidden');

    try {
      const res = await fetch('/api/search-dishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      state.searchResults = data.dishes || [];
    } catch (e) {
      console.warn('[Home] Search error:', e);
      state.searchResults = [];
    }

    renderGrid(currentMealTab);
  }

  // ===================== Init =====================
  async function initHome() {
    const searchInput = document.getElementById('dish-search');
    const btnSchedule = document.getElementById('btn-schedule');
    const btnCamera = document.getElementById('btn-camera');

    if (!searchInput || !btnSchedule) return;

    // 1. Detect context NGAY — meal period từ giờ hiện tại (đồng bộ, không block)
    detectContext();

    // 2. Load dishes
    const hasDishes = await loadAllDishes();

    if (!hasDishes) {
      const grid = document.getElementById('dish-grid');
      if (grid) grid.innerHTML = `<div class="bg-surface-container-lowest rounded-xl p-8 text-center col-span-full border border-outline-variant/20">
        <span class="material-symbols-outlined text-4xl text-outline mb-2">search_off</span>
        <p class="text-sm text-on-surface-variant">Không thể tải dữ liệu món ăn</p>
      </div>`;
      return;
    }

    // 3. Score and prepare sections
    prepareAllSections();

    // 4. Show initial tab (current period) and render
    const defaultMeal = state.mealPeriod || 'breakfast';
    switchMealTab(defaultMeal);

    // 5. Attach tab click handlers
    document.querySelectorAll('.meal-tab').forEach(tab => {
      tab.addEventListener('click', function(e) {
        e.stopPropagation();
        switchMealTab(this.dataset.meal);
      });
    });

    // 6. Attach refresh button
    document.getElementById('btn-load-more')?.addEventListener('click', handleRefresh);

    // Listen for health analysis requests from fridge.js
    document.addEventListener('health-analysis-requested', async (e) => {
      if (e.detail?.dish) await showHealthAnalysis(e.detail.dish);
    });

    // 7. Search handler
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleSearch(searchInput.value);
      }
    });

    btnSchedule.addEventListener('click', async () => {
      if (!searchInput.value.trim()) { searchInput.focus(); return; }
      await handleSearch(searchInput.value);
    });

    // Camera
    if (btnCamera) {
      btnCamera.addEventListener('click', () => {
        MealPlan.openCamera({
          mode: 'dish',
          onResult: (result) => {
            if (result.success && result.data) {
              if (typeof showRecipeDetail === 'function') showRecipeDetail(result.data);
              else MealPlan.showToast(`📍 ${result.data.name}`, 'success', 4000);
            } else {
              MealPlan.showToast(result.error || 'Không thể nhận diện món ăn!', 'error');
            }
          }
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initHome);
})();
