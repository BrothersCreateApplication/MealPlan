// ===================== Trang Chủ Module — Context-Aware Recommendations =====================

(function() {
  'use strict';

  // ---- State ----
  const state = {
    allDishes: [],           // all dishes fetched from DB
    weather: null,           // { condition, temp, tempLabel, humidity, ... }
    cityName: '',            // detected city for display
    mealPeriod: null,        // 'breakfast' | 'lunch' | 'dinner' | 'night'
    periodName: null,        // Tiếng Việt
    sectionIndex: {},        // { breakfast: 0, lunch: 0, dinner: 0, night: 0 } for cycling
    sectionData: {},         // { breakfast: [], lunch: [], dinner: [], night: [] }
    isLoading: true,
    geoError: false,
    mealPeriods: [
      { id: 'breakfast', label: 'Bữa Sáng', hours: [5, 6, 7, 8, 9], icon: 'sunny_snowing', color: 'amber' },
      { id: 'lunch',     label: 'Bữa Trưa', hours: [10, 11, 12, 13, 14], icon: 'wb_sunny', color: 'orange' },
      { id: 'dinner',    label: 'Bữa Chiều/Tối', hours: [15, 16, 17, 18, 19, 20], icon: 'bedtime', color: 'indigo' },
      { id: 'night',     label: 'Ăn Đêm', hours: [21, 22, 23, 0, 1, 2, 3, 4], icon: 'nightlight', color: 'purple' },
    ]
  };

  // ---- Weather condition mapping ----
  const weatherKeywords = {
    // [condition]: { tags for matching, vibe }
    clear:   { tags: ['nướng', 'salad', 'rau', 'trái cây', 'smoothie', 'lẩu thái', 'bánh mì', 'gỏi', 'nem'], vibe: 'nóng' },
    cloudy:  { tags: ['xào', 'kho', 'canh', 'nấu', 'lẩu', 'bún', 'phở', 'cháo'], vibe: 'mát' },
    foggy:   { tags: ['cháo', 'súp', 'lẩu', 'ấm', 'nóng'], vibe: 'lạnh' },
    drizzly: { tags: ['cháo', 'súp', 'lẩu', 'bún', 'phở', 'ấm', 'nóng', 'canh'], vibe: 'mưa lạnh' },
    rainy:   { tags: ['lẩu', 'cháo', 'súp', 'bún', 'phở', 'canh nóng', 'ấm', 'kho'], vibe: 'mưa lạnh' },
    snowy:   { tags: ['lẩu', 'súp', 'cháo', 'ấm', 'nóng', 'kho'], vibe: 'rét' },
    stormy:  { tags: ['lẩu', 'cháo', 'súp', 'ấm', 'nóng', 'bún', 'phở'], vibe: 'bão' },
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

  // ---- Fetch weather via our proxy ----
  async function fetchWeather(lat, lon) {
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (data.success) {
        state.weather = data.weather;
        if (data.cityName) state.cityName = data.cityName;
      }
    } catch (e) {
      console.warn('[Home] Weather fetch error:', e);
    }
  }

  // ---- Get user location ----
  async function detectContext() {
    const period = getMealPeriod();
    state.mealPeriod = period.id;
    state.periodName = period.label;

    // Default weather (unknown)
    state.weather = { condition: 'unknown', temp: 25, tempLabel: 'moderate', icon: 'help', precipitation: 0 };

    // Try geolocation
    if ('geolocation' in navigator) {
      try {
        const pos = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
          navigator.geolocation.getCurrentPosition(
            (p) => { clearTimeout(timeout); resolve(p); },
            (e) => { clearTimeout(timeout); reject(e); },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
          );
        });
        await fetchWeather(pos.coords.latitude, pos.coords.longitude);
        state.geoError = false;
        // Get city from IP fallback
        try {
          const ipRes = await fetch('https://ipapi.co/json/');
          if (ipRes.ok) { const ipData = await ipRes.json(); if (ipData.city) state.cityName = ipData.city; }
        } catch (_) {}
      } catch (e) {
        state.geoError = true;
        console.warn('[Home] Geolocation failed:', e.message);
        // Try IP-based fallback
        try {
          const ipRes = await fetch('https://ipapi.co/json/');
          if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData.city) state.cityName = ipData.city;
            if (ipData.latitude && ipData.longitude) {
              await fetchWeather(ipData.latitude, ipData.longitude);
              state.geoError = false;
            }
          }
        } catch (ipErr) {
          // Silent fail
        }
      }
    }
    updateWeatherBanner();
  }

  // ---- Update weather banner UI ----
  function updateWeatherBanner() {
    const banner = document.getElementById('weather-banner');
    const iconEl = document.getElementById('weather-icon');
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const textEl = document.getElementById('weather-text');
    const contextEl = document.getElementById('context-text');

    if (!banner) return;
    banner.classList.remove('hidden');

    const w = state.weather;
    if (!w || !w.condition) {
      textEl.textContent = `📍 ${state.cityName || 'Vị trí của bạn'} • ${periodLabel()}`;
      contextEl.textContent = `⏰ ${state.periodName} — Gợi ý món ${periodVibeText()}`;
      return;
    }

    // Map icon
    const iconMap = {
      'clear': 'sunny', 'cloudy': 'cloud', 'foggy': 'foggy',
      'drizzly': 'rainy_light', 'rainy': 'rainy', 'snowy': 'snowy', 'stormy': 'thunderstorm'
    };
    iconEl.textContent = iconMap[w.condition] || 'sunny';

    tempEl.textContent = `${w.temp}°`;
    descEl.textContent = weatherLabel(w.condition);

    const weatherVibe = weatherKeywords[w.condition];
    const vibeText = weatherVibe ? `thời tiết ${weatherVibe.vibe}` : 'bình thường';
    textEl.textContent = `📍 ${state.cityName || 'Vị trí của bạn'} • ${periodLabel()} • ${weatherLabel(w.condition)} • ${w.temp}°C`;
    contextEl.textContent = `⏰ ${state.periodName} — Trời ${weatherLabel(w.condition).toLowerCase()}, gợi ý món ${vibeText}`;
  }

  function weatherLabel(cond) {
    const map = { clear: 'Nắng', cloudy: 'Mây', foggy: 'Sương mù', drizzly: 'Mưa nhẹ', rainy: 'Mưa', snowy: 'Tuyết', stormy: 'Bão' };
    return map[cond] || '--';
  }

  function periodLabel() {
    const labels = { breakfast: '🌅 Sáng', lunch: '☀️ Trưa', dinner: '🌆 Chiều', night: '🌙 Đêm' };
    return labels[state.mealPeriod] || 'Ngày';
  }

  function periodVibeText() {
    const vibes = { breakfast: 'nhẹ nhàng cho bữa sáng', lunch: 'đầy đủ cho bữa trưa', dinner: 'ấm cúng cho bữa tối', night: 'nhẹ nhàng cho khuya' };
    return vibes[state.mealPeriod] || 'ngon';
  }

  // ---- Emoji lookup for dish names ----
  const dishEmojiMap = {
    'salad': '🥗', 'phở': '🍜', 'bánh': '🥟', 'trứng': '🥚', 'cơm': '🍚',
    'canh': '🥣', 'nướng': '🔥', 'chiên': '🍳', 'xào': '🥘', 'kho': '🍲',
    'luộc': '🥟', 'rau': '🥬', 'tôm': '🦐', 'cá': '🐟', 'gà': '🍗',
    'bò': '🥩', 'heo': '🐷', 'lợn': '🐷', 'chả': '🥓', 'mì': '🍝',
    'lẩu': '🍲', 'cháo': '🥣', 'súp': '🥣', 'bún': '🍜', 'bò': '🥩',
    'bánh mì': '🥖', 'sữa': '🥛', 'xôi': '🍚', 'ốp la': '🍳',
  };

  function getDishEmoji(name) {
    const lower = name.toLowerCase();
    // Sort keys by length (longest first) for best match
    const sorted = Object.entries(dishEmojiMap).sort(([a], [b]) => b.length - a.length);
    for (const [key, emoji] of sorted) {
      if (lower.includes(key)) return emoji;
    }
    return '🍽️';
  }

  // ---- Fetch all dishes from DB ----
  async function loadAllDishes() {
    try {
      const res = await fetch('/api/dishes');
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

  // ---- Smart dish filtering per meal + weather ----
  function getDishesForMealPeriod(mealId) {
    const dishes = state.allDishes;
    if (!dishes || dishes.length === 0) return [];

    const weather = state.weather || { tempLabel: 'moderate', condition: 'unknown' };
    const mealKw = mealKeywords[mealId] || mealKeywords.lunch;
    const weatherKw = weatherKeywords[weather.condition] || weatherKeywords.cloudy;

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

      // Weather match
      for (const tag of (weatherKw.tags || [])) {
        if (text.includes(tag)) score += 2;
        if (ings.includes(tag)) score += 1;
      }

      // Temperature-based adjustments
      if (weather.tempLabel === 'hot') {
        if (text.includes('nướng') || text.includes('chiên') || text.includes('kho tàu') || text.includes('thịt kho')) score -= 1;
        if (text.includes('salad') || text.includes('rau') || text.includes('canh chua') || text.includes('gỏi') || text.includes('trái cây')) score += 2;
      } else if (weather.tempLabel === 'cold') {
        if (text.includes('lẩu') || text.includes('cháo') || text.includes('súp') || text.includes('canh nóng') || text.includes('kho')) score += 2;
        if (text.includes('salad') || text.includes('rau sống')) score -= 1;
      }

      // Prefer dishes with full data
      if (dish.instructions) score += 1;
      if (dish.time) score += 0.5;
      if (dish.calories) score += 0.5;

      return { dish, score };
    });

    // Filter: only include dishes with score >= 0 (or top 20)
    const filtered = scored.filter(s => s.score > 0);
    filtered.sort((a, b) => b.score - a.score);

    return filtered.map(s => s.dish);
  }

  // ---- Prepare all section data ----
  function prepareAllSections() {
    const mealIds = ['breakfast', 'lunch', 'dinner', 'night'];
    for (const id of mealIds) {
      const dishes = getDishesForMealPeriod(id);
      state.sectionData[id] = dishes;
      state.sectionIndex[id] = 0;
    }
  }

  // ---- Render a section (3 dishes) ----
  function renderSection(mealId) {
    const grid = document.querySelector(`.meal-grid[data-meal="${mealId}"]`);
    if (!grid) return;

    const dishes = state.sectionData[mealId] || [];
    const idx = state.sectionIndex[mealId] || 0;

    if (!dishes || dishes.length === 0) {
      grid.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-6 text-center col-span-full border border-outline-variant/20">
          <span class="material-symbols-outlined text-4xl text-outline mb-2">restaurant</span>
          <p class="text-sm text-on-surface-variant">Chưa có gợi ý cho bữa này</p>
        </div>`;
      return;
    }

    // Take 3 dishes starting at idx, cycle if needed
    const three = [];
    for (let i = 0; i < 3 && three.length < 3; i++) {
      const d = dishes[(idx + i) % dishes.length];
      if (d && !three.some(t => t.name === d.name)) {
        three.push(d);
      }
    }
    // If still not enough, allow dupes
    while (three.length < 3 && dishes.length > 0) {
      three.push(dishes[three.length % dishes.length]);
    }

    grid.innerHTML = three.map((dish, i) => {
      const absIdx = (idx + i) % dishes.length;
      return `
      <div class="dish-card bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all group overflow-hidden border border-surface-container-high animate-fade-in">
        <div class="p-4">
          <div class="flex items-start justify-between mb-2">
            <h4 class="font-title-md text-on-surface flex-1"><span class="mr-1.5">${getDishEmoji(dish.name)}</span>${dish.name}</h4>
            <button class="fav-btn flex-shrink-0 ml-2 p-1 rounded-full hover:bg-surface-container-high transition-all" data-dish="${dish.name}">
              <span class="material-symbols-outlined text-secondary ${MealPlan.isFavorite(dish.name) ? '' : 'opacity-40'}" style="font-variation-settings: 'FILL' ${MealPlan.isFavorite(dish.name) ? '1' : '0'};">favorite</span>
            </button>
          </div>
          <div class="flex items-center gap-3 mb-2 flex-wrap">
            <span class="flex items-center gap-1 text-xs text-on-surface-variant">
              <span class="material-symbols-outlined text-[14px]">schedule</span>
              ${dish.time || '--'}
            </span>
            <span class="flex items-center gap-1 text-xs text-on-surface-variant">
              <span class="material-symbols-outlined text-[14px]">local_fire_department</span>
              ${dish.calories || '--'}
            </span>
            ${dish.difficulty ? `
            <span class="text-[10px] bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full font-semibold">${dish.difficulty}</span>` : ''}
          </div>
          ${dish.description ? `<p class="text-xs text-on-surface-variant mb-3 line-clamp-2">${dish.description}</p>` : ''}
          <div class="flex gap-2">
            <button class="detail-btn flex-1 bg-surface-container-high text-primary py-2 rounded-lg text-xs font-label-md hover:bg-primary-container/30 active:scale-[0.98] transition-all" data-dish-name="${dish.name}">
              <span class="material-symbols-outlined text-[16px] align-middle">article</span> Xem
            </button>
            <button class="meal-cook-btn flex-1 bg-primary text-on-primary py-2 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1" data-dish-name="${dish.name}">
              <span class="material-symbols-outlined text-[16px]">cooking</span> Nấu
            </button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Attach events for this section
    attachSectionEvents(grid, mealId);

    // Show/hide "Xem thêm" based on availability
    const btn = document.querySelector(`.meal-refresh-btn[data-meal="${mealId}"]`);
    if (btn) {
      btn.classList.toggle('hidden', dishes.length <= 3);
    }
  }

  // ---- Attach events for a section's dish cards ----
  function attachSectionEvents(grid, mealId) {
    // Detail buttons
    grid.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const name = this.dataset.dishName;
        const dish = state.allDishes.find(d => d.name === name);
        if (dish) showRecipeDetail(dish);
        else MealPlan.showToast('Không thể hiển thị chi tiết!', 'error');
      });
    });

    // Cook buttons
    grid.querySelectorAll('.meal-cook-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const name = this.dataset.dishName;
        const dish = state.allDishes.find(d => d.name === name);
        if (dish) {
          MealPlan.setCart(dish.ingredients || []);
          MealPlan.state.currentMealName = dish.name;
          MealPlan.saveState();
          MealPlan.navigate('cart');
          if (window.renderCart) window.renderCart();
        }
      });
    });

    // Favorite buttons
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

  // ---- Refresh / cycle a section (advance by 3 dishes) ----
  function handleRefresh(mealId) {
    const dishes = state.sectionData[mealId] || [];
    if (dishes.length <= 3) {
      MealPlan.showToast('Đã hiển thị tất cả món cho bữa này!', 'info');
      return;
    }

    // Advance index by 3 (skip the current 3, get next 3 new dishes)
    state.sectionIndex[mealId] = (state.sectionIndex[mealId] + 3) % dishes.length;
    renderSection(mealId);
  }

  // ---- Highlight current period ----
  function highlightCurrentPeriod() {
    const sections = document.querySelectorAll('.meal-section');
    sections.forEach(sec => {
      const meal = sec.dataset.meal;
      const badge = sec.querySelector('.section-badge');
      const header = sec.querySelector('.flex.items-center.justify-between');

      if (meal === state.mealPeriod) {
        sec.classList.add('ring-2', 'ring-primary/20', 'rounded-xl', 'p-3', '-mx-1');
        if (badge) badge.classList.remove('hidden');
        // Scroll to this section
        setTimeout(() => {
          header?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 500);
      } else {
        sec.classList.remove('ring-2', 'ring-primary/20', 'rounded-xl', 'p-3', '-mx-1');
        if (badge) badge.classList.add('hidden');
      }
    });
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

  // ===================== Search (kept from original) =====================
  async function handleSearch(query) {
    if (!query.trim()) return;
    // Redirect to search via SSE — show in a single grid
    // For now, fall back to original behavior
    MealPlan.showToast(`🔍 Đã tìm "${query}"`, 'info');
  }

  // ===================== Init =====================
  async function initHome() {
    const searchInput = document.getElementById('dish-search');
    const btnSchedule = document.getElementById('btn-schedule');
    const btnCamera = document.getElementById('btn-camera');

    if (!searchInput || !btnSchedule) return;

    // 1. Detect context (location, weather, time)
    await detectContext();

    // 2. Load all dishes from DB
    const hasDishes = await loadAllDishes();

    if (!hasDishes) {
      // Show fallback in all sections
      ['breakfast', 'lunch', 'dinner', 'night'].forEach(id => {
        const grid = document.querySelector(`.meal-grid[data-meal="${id}"]`);
        if (grid) {
          grid.innerHTML = `<div class="bg-surface-container-lowest rounded-xl p-6 text-center col-span-full border border-outline-variant/20">
            <span class="material-symbols-outlined text-4xl text-outline mb-2">search_off</span>
            <p class="text-sm text-on-surface-variant">Không thể tải dữ liệu món ăn</p>
          </div>`;
        }
      });
      return;
    }

    // 3. Score and prepare sections
    prepareAllSections();

    // 4. Render all sections
    ['breakfast', 'lunch', 'dinner', 'night'].forEach(id => renderSection(id));

    // 5. Highlight current meal period
    highlightCurrentPeriod();

    // 6. Attach refresh buttons
    document.querySelectorAll('.meal-refresh-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const meal = this.dataset.meal;
        handleRefresh(meal);
      });
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
