// ===================== Tab Nấu Ăn Module =====================
// Section 1: Sẵn sàng nấu (shopped) — đã đi chợ, đủ nguyên liệu, chưa nấu
// Section 2: Đã nấu (cooked) — lịch sử đã nấu xong

(function() {

  // ===================== Render chính =====================

  function renderCooking() {
    const history = MealPlan.state.history || [];

    const shopped = history.filter(h => h.status === 'shopped');
    const cooked = history.filter(h => h.status === 'cooked');

    const isEmpty = shopped.length === 0 && cooked.length === 0;

    toggleEmptyState(isEmpty);

    if (isEmpty) return;

    renderReadySection(shopped);
    renderDoneSection(cooked);
  }

  // ---- Empty State ----
  function toggleEmptyState(isEmpty) {
    const emptyEl = document.getElementById('cooking-empty-state');
    const readySection = document.getElementById('cooking-ready-section');
    const doneSection = document.getElementById('cooking-done-section');

    if (isEmpty) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (readySection) readySection.classList.add('hidden');
      if (doneSection) doneSection.classList.add('hidden');
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
      // Show/hide each section individually
    }
  }

  // ===================== Section 1: Sẵn sàng nấu =====================

  function renderReadySection(shopped) {
    const section = document.getElementById('cooking-ready-section');
    const list = document.getElementById('cooking-ready-list');
    const count = document.getElementById('cooking-ready-count');
    if (!section || !list) return;

    if (shopped.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    if (count) count.textContent = shopped.length;

    list.innerHTML = shopped.map(entry => {
      const dish = entry.dishData || {};
      return `
        <div class="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-emerald-200/40 hover:shadow-md transition-all" data-entry-id="${entry.id}">
          <div class="p-4">
            <div class="flex items-start justify-between mb-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-lg">🍗</span>
                  <h4 class="font-title-md text-on-surface font-semibold">${entry.dishName}</h4>
                  <span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5">
                    <span class="material-symbols-outlined text-[12px]">check_circle</span>
                    Đủ nguyên liệu
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-1.5">
                  <span class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">schedule</span>
                    ${dish.time || entry.time || '--'}
                  </span>
                  <span class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">local_fire_department</span>
                    ${dish.calories || entry.calories || '--'}
                  </span>
                  <span class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                    ${entry.date || ''}
                  </span>
                </div>
              </div>
            </div>

            ${dish.ingredients && dish.ingredients.length > 0 ? `
            <div class="bg-surface-container-low rounded-xl px-3 py-2 mb-3">
              <div class="flex items-center justify-between">
                <p class="text-xs text-on-surface-variant">
                  <span class="font-semibold">${dish.ingredients.length}</span> nguyên liệu
                </p>
                <p class="text-xs text-primary font-semibold">
                  Tổng: ${MealPlan.formatCurrency(dish.ingredients.reduce((sum, ing) => sum + (ing.price || 0), 0))}
                </p>
              </div>
              <div class="mt-1.5 space-y-0.5 max-h-20 overflow-y-auto">
                ${dish.ingredients.slice(0, 8).map(ing => `
                  <div class="flex items-center justify-between text-[11px] text-on-surface-variant">
                    <span>${ing.name}</span>
                    <span>${ing.price ? MealPlan.formatCurrency(ing.price) : '—'}</span>
                  </div>
                `).join('')}
                ${dish.ingredients.length > 8 ? `<p class="text-[10px] text-on-surface-variant italic">+${dish.ingredients.length - 8} nguyên liệu khác</p>` : ''}
              </div>
            </div>` : ''}

            <div class="flex gap-2">
              <button class="cooking-start-btn flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-2.5 rounded-lg text-sm font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-sm" data-entry-id="${entry.id}">
                <span class="material-symbols-outlined text-[18px]">play_arrow</span>
                Bắt đầu nấu
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    // Attach events
    list.querySelectorAll('.cooking-start-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const entryId = this.dataset.entryId;
        const entry = MealPlan.state.history.find(h => h.id === entryId);
        if (entry && entry.dishData) {
          window.openCookingMode(entry.dishData, entryId);
        } else {
          MealPlan.showToast('Không có công thức!', 'warning');
        }
      });
    });
  }

  // ===================== Section 2: Đã nấu =====================

  function renderDoneSection(cooked) {
    const section = document.getElementById('cooking-done-section');
    const list = document.getElementById('cooking-done-list');
    const count = document.getElementById('cooking-done-count');
    if (!section || !list) return;

    if (cooked.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    if (count) count.textContent = cooked.length;

    list.innerHTML = cooked.map(entry => {
      const dish = entry.dishData || {};
      return `
        <div class="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20 hover:shadow-md transition-all" data-entry-id="${entry.id}">
          <div class="p-4">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>
                  </span>
                  <h4 class="font-title-md text-on-surface font-semibold">${entry.dishName}</h4>
                </div>
                <div class="flex items-center gap-3 mt-1">
                  <span class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[12px]">calendar_today</span>
                    ${entry.date || ''}
                  </span>
                  <span class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[12px]">local_fire_department</span>
                    ${dish.calories || entry.calories || '--'}
                  </span>
                </div>
              </div>
              <button class="cooking-done-view-btn px-3 py-1.5 bg-surface-container-high text-primary rounded-lg text-xs font-label-md hover:bg-primary-container/30 active:scale-[0.98] transition-all flex items-center gap-1" data-entry-id="${entry.id}">
                <span class="material-symbols-outlined text-[14px]">article</span>
                Chi tiết
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    // Attach events
    list.querySelectorAll('.cooking-done-view-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const entryId = this.dataset.entryId;
        const entry = MealPlan.state.history.find(h => h.id === entryId);
        if (entry && entry.dishData) {
          window.showRecipeDetail(entry.dishData);
        } else {
          MealPlan.showToast('Không có công thức!', 'warning');
        }
      });
    });
  }

  // ===================== Init =====================

  function initCooking() {
    // Go home button
    document.getElementById('btn-go-home-cooking')?.addEventListener('click', () => {
      MealPlan.navigate('home');
    });
  }

  // Expose for navigation
  window.renderCooking = renderCooking;

  document.addEventListener('DOMContentLoaded', initCooking);
})();
