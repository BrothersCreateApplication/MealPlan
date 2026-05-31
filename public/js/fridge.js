// ===================== Tủ Lạnh Module =====================

(function() {
  const state = {
    ingredients: [],
    suggestions: [],       // all current suggestions
    isLoadingMore: false
  };

  // ---- Render ingredient tags ----
  function renderTags() {
    const container = document.getElementById('fridge-tags-container');
    if (!container) return;

    if (state.ingredients.length === 0) {
      container.innerHTML = `<span class="text-on-surface-variant text-sm italic">Nhập nguyên liệu bên dưới...</span>`;
      return;
    }

    container.innerHTML = state.ingredients.map((ing, idx) => `
      <span class="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-container text-on-primary-container rounded-full text-sm font-label-md">
        ${ing}
        <button class="remove-ing-btn hover:text-error transition-colors" data-idx="${idx}">
          <span class="material-symbols-outlined text-[16px]">close</span>
        </button>
      </span>
    `).join('');

    // Attach remove events
    container.querySelectorAll('.remove-ing-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        state.ingredients.splice(idx, 1);
        renderTags();
      });
    });
  }

  // ---- Add ingredient ----
  function addIngredient(name) {
    const trimmed = name.trim();
    if (!trimmed) return false;

    // Normalize: capitalize first letter of each word
    const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();

    // Check duplicate (case-insensitive)
    if (state.ingredients.some(i => i.toLowerCase() === normalized.toLowerCase())) {
      MealPlan.showToast(`"${normalized}" đã có trong danh sách!`, 'info');
      return false;
    }

    state.ingredients.push(normalized);
    renderTags();
    return true;
  }

  // ---- Gọi API gợi ý ----
  async function handleSuggest() {
    const container = document.getElementById('fridge-suggestions');
    if (!container) return;

    if (state.ingredients.length === 0) {
      MealPlan.showToast('Vui lòng nhập ít nhất 1 nguyên liệu!', 'warning');
      return;
    }

    // Show loading
    container.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm border border-outline-variant/20">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-on-surface-variant font-body-md">Đang phân tích tủ lạnh và gợi ý món ăn...</p>
        <p class="text-xs text-on-surface-variant mt-2">Đang tìm trong DB ${state.ingredients.length > 3 ? '(có thể gọi AI nếu cần)' : '...'}</p>
      </div>`;

    let suggestions = [];
    try {
      const res = await fetch('/api/suggest-by-ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: state.ingredients })
      });
      const data = await res.json();
      if (data.suggestions) suggestions = data.suggestions;
    } catch (e) {
      console.warn('Suggestion API error:', e);
    }

    if (suggestions.length === 0) {
      container.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm border border-outline-variant/20">
          <span class="material-symbols-outlined text-5xl text-outline mb-4">youtube_searched_for</span>
          <p class="text-on-surface-variant font-body-md">Không tìm thấy món ăn phù hợp với nguyên liệu hiện có.</p>
          <p class="text-sm text-on-surface-variant mt-2">Thử thêm nguyên liệu khác hoặc xem gợi ý ở trang chủ!</p>
        </div>`;
      document.getElementById('btn-fridge-load-more')?.classList.add('hidden');
      return;
    }

    renderSuggestions(suggestions, container);
  }

  // ---- Load thêm gợi ý tủ lạnh ----
  async function handleFridgeLoadMore() {
    if (state.isLoadingMore || state.ingredients.length === 0) return;
    state.isLoadingMore = true;

    const btn = document.getElementById('btn-fridge-load-more');
    if (btn) {
      btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Đang tải...</span>';
      btn.disabled = true;
    }

    let newSuggestions = [];
    try {
      const res = await fetch('/api/suggest-by-ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: state.ingredients, forceAI: true })
      });
      const data = await res.json();
      if (data.suggestions) newSuggestions = data.suggestions;
    } catch (e) {
      console.warn('Fridge load more error:', e);
    }

    // Filter duplicates by dish name
    const existingNames = new Set(state.suggestions.map(s => s.dish?.name));
    const uniqueNew = newSuggestions.filter(s => s.dish?.name && !existingNames.has(s.dish.name));

    if (uniqueNew.length === 0) {
      MealPlan.showToast('Đã hiển thị tất cả gợi ý!', 'info');
      if (btn) {
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined text-[18px]">refresh</span> Xem thêm gợi ý</span>';
        btn.disabled = false;
      }
      state.isLoadingMore = false;
      return;
    }

    // Append
    state.suggestions = [...state.suggestions, ...uniqueNew];
    appendSuggestions(uniqueNew);

    if (btn) {
      btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined text-[18px]">refresh</span> Xem thêm gợi ý</span>';
      btn.disabled = false;
    }
    state.isLoadingMore = false;
  }

  // ---- Append suggestion cards (for load more) ----
  function appendSuggestions(newSuggestions) {
    const container = document.getElementById('fridge-suggestions');
    if (!container) return;

    const startIdx = state.suggestions.length - newSuggestions.length;
    const html = newSuggestions.map((s, i) => renderSuggestionCard(s, startIdx + i)).join('');
    container.insertAdjacentHTML('beforeend', html);

    // Re-attach events
    container.querySelectorAll('.suggestion-detail-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        const s = state.suggestions[idx];
        if (s && s.dish) showSuggestionDetail(s);
      });
    });

    container.querySelectorAll('.suggestion-cook-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        const s = state.suggestions[idx];
        if (s && s.dish) {
          MealPlan.setCart(s.dish.ingredients || []);
          MealPlan.state.currentMealName = s.dish.name;
          MealPlan.saveState();
          MealPlan.navigate('cart');
          if (window.renderCart) window.renderCart();
          MealPlan.showToast(`Đã thêm "${s.dish.name}" vào danh sách nấu!`, 'success');
        }
      });
    });
  }

  // ---- Render suggestion cards ----
  function renderSuggestions(suggestions, container) {
    if (!container) container = document.getElementById('fridge-suggestions');
    if (!container) return;

    // Store for load more
    state.suggestions = suggestions;

    const hasHighMatch = suggestions.some(s => s.matchPercent >= 80);
    const fromCacheStr = suggestions.length > 0 ? '' : '';

    container.innerHTML = `
      <div class="space-y-1 mb-3">
        <h2 class="font-title-md font-semibold text-on-surface flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">lightbulb</span>
          Gợi ý cho tủ lạnh của bạn
        </h2>
        <p class="text-xs text-on-surface-variant">Tìm thấy ${suggestions.length} món phù hợp</p>
      </div>
      ${suggestions.map((s, idx) => renderSuggestionCard(s, idx)).join('')}
    `;

    // Show/hide load more button
    const loadMoreBtn = document.getElementById('btn-fridge-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.classList.toggle('hidden', suggestions.length < 3);
    }

    // Attach events
    container.querySelectorAll('.suggestion-detail-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        const s = suggestions[idx];
        if (s && s.dish) {
          showSuggestionDetail(s);
        }
      });
    });

    container.querySelectorAll('.suggestion-cook-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        const s = suggestions[idx];
        if (s && s.dish) {
          const ings = s.dish.ingredients || [];
          MealPlan.setCart(ings);
          MealPlan.state.currentMealName = s.dish.name;
          MealPlan.saveState();
          MealPlan.navigate('cart');
          if (window.renderCart) window.renderCart();
          MealPlan.showToast(`Đã thêm "${s.dish.name}" vào danh sách nấu!`, 'success');
        }
      });
    });
  }

  // ---- Single suggestion card ----
  function renderSuggestionCard(s, idx) {
    const dish = s.dish;
    if (!dish) return '';

    const matchColor = s.matchPercent >= 80 ? 'text-primary' :
                        s.matchPercent >= 50 ? 'text-secondary' : 'text-on-surface-variant';
    const matchBg = s.matchPercent >= 80 ? 'bg-primary/10' :
                     s.matchPercent >= 50 ? 'bg-secondary/10' : 'bg-surface-container-high';

    // Missing ingredients list
    const missingHtml = s.missing && s.missing.length > 0
      ? `<div class="mt-2 pt-2 border-t border-outline-variant/20">
          <p class="text-xs font-label-md text-error flex items-center gap-1 mb-1">
            <span class="material-symbols-outlined text-[14px]">add_shopping_cart</span>
            Cần mua thêm:
          </p>
          <div class="flex flex-wrap gap-1.5">
            ${s.missing.map(m => `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 bg-error-container/30 text-error text-xs rounded-full">${m.name} <span class="opacity-70">${m.quantity}</span></span>`).join('')}
          </div>
        </div>`
      : `<div class="mt-2 pt-2 border-t border-outline-variant/20">
          <p class="text-xs font-label-md text-primary flex items-center gap-1">
            <span class="material-symbols-outlined text-[14px]">check_circle</span>
            ✅ Đủ nguyên liệu! Chỉ cần gia vị cơ bản.
          </p>
        </div>`;

    return `
      <div class="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20 hover:shadow-md transition-all">
        <div class="p-4">
          <div class="flex items-start justify-between mb-2">
            <div class="flex-1 min-w-0">
              <h3 class="font-title-md text-on-surface">${dish.name}</h3>
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
            <!-- Match badge -->
            <div class="flex flex-col items-center ml-3">
              <div class="w-14 h-14 rounded-full ${matchBg} flex items-center justify-center">
                <span class="font-price-tag font-bold text-lg ${matchColor}">${s.matchPercent}%</span>
              </div>
              <span class="text-[10px] text-on-surface-variant mt-0.5">phù hợp</span>
            </div>
          </div>

          ${dish.description ? `<p class="text-sm text-on-surface-variant mb-2 line-clamp-2">${dish.description}</p>` : ''}

          <!-- Matched ingredients -->
          ${s.matched && s.matched.length > 0 ? `
          <div class="flex flex-wrap gap-1.5 mb-1">
            ${s.matched.map(m => `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
              <span class="material-symbols-outlined text-[12px]">check_small</span> ${m.name}
            </span>`).join('')}
          </div>` : ''}

          ${missingHtml}

          <!-- Actions -->
          <div class="flex gap-2 mt-3">
            <button class="suggestion-detail-btn flex-1 bg-surface-container-high text-primary py-2 rounded-lg text-xs font-label-md hover:bg-primary-container/30 active:scale-[0.98] transition-all" data-idx="${idx}">
              <span class="material-symbols-outlined text-[16px] align-middle">article</span> Xem công thức
            </button>
            <button class="suggestion-cook-btn bg-primary text-on-primary py-2 px-4 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-1" data-idx="${idx}">
              <span class="material-symbols-outlined text-[16px]">cooking</span> Nấu
            </button>
          </div>
        </div>
      </div>`;
  }

  // ---- Suggestion detail overlay (reuse recipe style but with ingredient markers) ----
  function showSuggestionDetail(s) {
    const dish = s.dish;
    if (!dish) return;

    const existing = document.querySelector('.recipe-overlay');
    if (existing) existing.remove();

    // Get visual
    const lower = dish.name.toLowerCase();
    const visuals = {
      'cà': { gradient: 'bg-gradient-to-br from-blue-400/30 to-teal-300/30', emoji: '🐟' },
      'tôm': { gradient: 'bg-gradient-to-br from-pink-400/30 to-orange-300/30', emoji: '🦐' },
      'gà': { gradient: 'bg-gradient-to-br from-amber-400/30 to-yellow-300/30', emoji: '🍗' },
      'bò': { gradient: 'bg-gradient-to-br from-red-500/30 to-orange-400/30', emoji: '🥩' },
      'heo': { gradient: 'bg-gradient-to-br from-rose-400/30 to-pink-300/30', emoji: '🐷' },
      'lợn': { gradient: 'bg-gradient-to-br from-rose-400/30 to-pink-300/30', emoji: '🐷' },
      'rau': { gradient: 'bg-gradient-to-br from-green-400/30 to-emerald-300/30', emoji: '🥬' },
      'canh': { gradient: 'bg-gradient-to-br from-teal-400/30 to-cyan-300/30', emoji: '🥣' },
      'salad': { gradient: 'bg-gradient-to-br from-lime-400/30 to-green-300/30', emoji: '🥗' },
      'kho': { gradient: 'bg-gradient-to-br from-amber-500/30 to-orange-400/30', emoji: '🍲' },
      'xào': { gradient: 'bg-gradient-to-br from-orange-400/30 to-yellow-300/30', emoji: '🥘' },
      'luộc': { gradient: 'bg-gradient-to-br from-teal-400/30 to-cyan-300/30', emoji: '🥟' },
      'chiên': { gradient: 'bg-gradient-to-br from-amber-400/30 to-yellow-300/30', emoji: '🍳' },
      'nướng': { gradient: 'bg-gradient-to-br from-red-500/30 to-orange-400/30', emoji: '🔥' },
    };
    let gradient = 'bg-gradient-to-br from-primary/10 to-primary-container/20';
    let emoji = '🍽️';
    for (const [key, v] of Object.entries(visuals)) {
      if (lower.includes(key)) { gradient = v.gradient; emoji = v.emoji; break; }
    }

    // Available ingredient names for checking
    const availableNames = s.matched ? s.matched.map(m => m.name.toLowerCase()) : [];

    const steps = (dish.instructions || '')
      .split('\n')
      .filter(s => s.trim())
      .map((step, i) => {
        const clean = step.replace(/^\d+[\.\s)]+\s*/, '');
        return `<li class="flex gap-3">
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-on-primary text-xs font-bold flex-shrink-0 mt-0.5">${i + 1}</div>
          <div class="flex-1 pt-0.5"><span class="font-label-md text-on-surface">${clean}</span></div>
        </li>`;
      }).join('<li class="my-2 border-t border-outline-variant/20"></li>');

    const overlay = document.createElement('div');
    overlay.className = 'recipe-overlay fixed inset-0 z-[200] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full h-full md:h-auto md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
        <div class="relative h-36 md:h-48 flex items-center justify-center overflow-hidden flex-shrink-0 ${gradient}">
          <span class="text-6xl md:text-7xl">${emoji}</span>
          <button class="absolute top-4 right-4 bg-black/30 backdrop-blur-md text-white p-2 rounded-full hover:bg-black/50 transition-all" id="recipe-close">
            <span class="material-symbols-outlined">close</span>
          </button>
          <!-- Match badge overlaid -->
          <div class="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full shadow flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${s.matchPercent >= 80 ? 'bg-primary' : s.matchPercent >= 50 ? 'bg-secondary' : 'bg-on-surface-variant'}"></span>
            <span class="font-price-tag text-sm font-bold">${s.matchPercent}% phù hợp</span>
          </div>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto md:overflow-y-visible">
          <div class="p-5 md:p-6">
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

            <!-- Ingredients with availability markers -->
            <div class="mb-5">
              <h3 class="font-title-md flex items-center gap-2 text-primary mb-3">
                <span class="material-symbols-outlined">shopping_basket</span>
                Nguyên liệu
              </h3>
              <div class="bg-surface-container-low rounded-xl divide-y divide-outline-variant/20 overflow-hidden">
                ${(dish.ingredients || []).map(ing => {
                  const isAvail = availableNames.some(a => ing.name.toLowerCase().includes(a) || a.includes(ing.name.toLowerCase()));
                  return `
                    <div class="flex items-center justify-between px-4 py-2.5 ${isAvail ? '' : 'opacity-60'}">
                      <div class="flex items-center gap-3">
                        ${isAvail
                          ? `<span class="material-symbols-outlined text-primary text-[18px]">check_circle</span>`
                          : `<span class="material-symbols-outlined text-outline text-[18px]">radio_button_unchecked</span>`
                        }
                        <span class="font-label-md text-on-surface">${ing.name}</span>
                        ${isAvail ? '<span class="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Có sẵn</span>' : ''}
                      </div>
                      <span class="text-on-surface-variant font-body-md">${ing.quantity}</span>
                    </div>
                  `;
                }).join('')}
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
            <button class="suggestion-overlay-cook flex-1 bg-primary text-on-primary py-3.5 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg">
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

    // Close handlers
    overlay.querySelector('#recipe-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#recipe-close-alt')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Cook handler
    overlay.querySelector('.suggestion-overlay-cook')?.addEventListener('click', () => {
      const ings = dish.ingredients || [];
      MealPlan.setCart(ings);
      MealPlan.state.currentMealName = dish.name;
      MealPlan.saveState();
      overlay.remove();
      MealPlan.navigate('cart');
      if (window.renderCart) window.renderCart();
    });
  }

  // ---- Init ----
  function initFridge() {
    const input = document.getElementById('fridge-input');
    const btnAdd = document.getElementById('btn-add-ingredient');
    const btnSuggest = document.getElementById('btn-suggest-fridge');
    const btnClear = document.getElementById('btn-clear-fridge');
    const suggestionsContainer = document.getElementById('fridge-suggestions');

    if (!input || !btnAdd || !btnSuggest) return;

    // Add on Enter
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (addIngredient(input.value)) {
          input.value = '';
          input.focus();
        }
      }
    });

    // Add button
    btnAdd.addEventListener('click', () => {
      if (addIngredient(input.value)) {
        input.value = '';
        input.focus();
      }
    });

    // Suggest button
    btnSuggest.addEventListener('click', handleSuggest);

    // Clear button
    btnClear?.addEventListener('click', () => {
      state.ingredients = [];
      state.suggestions = [];
      renderTags();
      document.getElementById('btn-fridge-load-more')?.classList.add('hidden');
      if (suggestionsContainer) {
        suggestionsContainer.innerHTML = `
          <div class="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm border border-outline-variant/20">
            <span class="material-symbols-outlined text-5xl text-outline mb-4">fridge</span>
            <p class="text-on-surface-variant font-body-md">Thêm nguyên liệu và nhấn "Gợi ý món ăn"!</p>
          </div>`;
      }
    });

    // Quick-add buttons
    document.querySelectorAll('.quick-ing-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const name = this.textContent.trim();
        // Toggle: if already added, remove it
        const existingIdx = state.ingredients.findIndex(i => i.toLowerCase() === name.toLowerCase());
        if (existingIdx >= 0) {
          state.ingredients.splice(existingIdx, 1);
        } else {
          state.ingredients.push(name);
        }
        renderTags();
        input.focus();
      });
    });

    // Xem thêm button
    document.getElementById('btn-fridge-load-more')?.addEventListener('click', handleFridgeLoadMore);

    // Camera button — chụp ảnh tủ lạnh
    document.getElementById('btn-fridge-camera')?.addEventListener('click', () => {
      MealPlan.openCamera({
        mode: 'fridge',
        onResult: (result) => {
          if (result.success && result.ingredients && result.ingredients.length > 0) {
            // Thêm từng nguyên liệu vào danh sách
            result.ingredients.forEach(name => addIngredient(name));
            // Focus input
            input.focus();
            MealPlan.showToast(`Đã thêm ${result.ingredients.length} nguyên liệu từ ảnh!`, 'success');
          } else {
            MealPlan.showToast('Không thể nhận diện nguyên liệu từ ảnh!', 'error');
          }
        }
      });
    });

    // Show initial state
    if (suggestionsContainer) {
      suggestionsContainer.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm border border-outline-variant/20">
          <span class="material-symbols-outlined text-5xl text-outline mb-4">kitchen</span>
          <p class="text-on-surface-variant font-body-md">Thêm nguyên liệu và nhấn "Gợi ý món ăn"!</p>
          <p class="text-xs text-on-surface-variant mt-2">Tôi sẽ tìm trong DB trước, nếu chưa có sẽ hỏi AI và lưu lại.</p>
        </div>`;
    }
  }

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', initFridge);
})();
