// ===================== Lịch Sử & Thói Quen Module =====================

(function() {
  // ---- State ----
  let filterState = {
    search: '',
    dateFrom: '',
    dateTo: '',
    showAll: false
  };

  // ---- Helper: parse date ----
  function parseDateVN(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateVN(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN');
  }

  function formatISOToVN(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return formatDateVN(d);
  }

  // ---- Filter history ----
  function getFilteredHistory() {
    let history = MealPlan.state.history || [];

    if (filterState.search.trim()) {
      const kw = filterState.search.trim().toLowerCase();
      history = history.filter(h =>
        (h.dishName || '').toLowerCase().includes(kw)
      );
    }

    if (filterState.dateFrom) {
      const fromDate = new Date(filterState.dateFrom + 'T00:00:00');
      if (!isNaN(fromDate.getTime())) {
        history = history.filter(h => {
          const hDate = parseDateVN(h.date) || new Date(h.dateISO || h.date);
          return hDate >= fromDate;
        });
      }
    }

    if (filterState.dateTo) {
      const toDate = new Date(filterState.dateTo + 'T23:59:59');
      if (!isNaN(toDate.getTime())) {
        history = history.filter(h => {
          const hDate = parseDateVN(h.date) || new Date(h.dateISO || h.date);
          return hDate <= toDate;
        });
      }
    }

    history.sort((a, b) => {
      const aDate = new Date(a.dateISO || parseDateVN(a.date) || 0);
      const bDate = new Date(b.dateISO || parseDateVN(b.date) || 0);
      return bDate - aDate;
    });

    return history;
  }

  // ===================== Main render =====================

  async function renderHistory() {
    const history = MealPlan.state.history || [];
    const favorites = MealPlan.state.favorites || [];
    const isEmpty = history.length === 0 && favorites.length === 0;

    toggleEmptyState(isEmpty);

    if (history.length === 0 && favorites.length > 0) {
      // Có favorites nhưng chưa có history — chỉ hiện favorites
      document.querySelectorAll('#page-history .max-w-4xl > div:not(#history-empty-state):not(#favorites-section):not(h1):not(p)').forEach(s => s.classList.add('hidden'));
      document.querySelector('#page-history .max-w-4xl > h1')?.classList.remove('hidden');
      document.querySelector('#page-history .max-w-4xl > p')?.classList.remove('hidden');
      renderFavorites();
      return;
    }

    if (isEmpty) return;

    await loadAIInsights();
    renderChart();
    renderTopItems();
    renderHistoryList();
    renderFavorites();
    updateCountBadge();
  }

  // ---- Empty State toggle ----
  function toggleEmptyState(isEmpty) {
    const emptyEl = document.getElementById('history-empty-state');
    // Only hide history-dependent sections, NOT favorites
    const sections = document.querySelectorAll('#page-history .max-w-4xl > div:not(#history-empty-state):not(#favorites-section):not(h1):not(p)');

    if (isEmpty) {
      emptyEl?.classList.remove('hidden');
      sections.forEach(s => s.classList.add('hidden'));
      const title = document.querySelector('#page-history .max-w-4xl > h1');
      const subtitle = document.querySelector('#page-history .max-w-4xl > p');
      if (title) title.classList.add('hidden');
      if (subtitle) subtitle.classList.add('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      sections.forEach(s => s.classList.remove('hidden'));
      const title = document.querySelector('#page-history .max-w-4xl > h1');
      const subtitle = document.querySelector('#page-history .max-w-4xl > p');
      if (title) title.classList.remove('hidden');
      if (subtitle) subtitle.classList.remove('hidden');
    }
  }

  // ---- Update count badge ----
  function updateCountBadge() {
    const badge = document.getElementById('history-count-badge');
    if (!badge) return;
    const total = MealPlan.state.history.length;
    badge.textContent = `${total} bữa`;
  }

  // ===================== AI Insights =====================

  async function loadAIInsights() {
    const textEl = document.getElementById('ai-insight-text');
    if (!textEl) return;

    const history = MealPlan.state.history;
    const historyCount = history.length;
    if (historyCount === 0) {
      textEl.textContent = 'Chưa có dữ liệu lịch sử. Hãy bắt đầu lên kế hoạch bữa ăn!';
      return;
    }

    const today = new Date().toLocaleDateString('vi-VN');
    const todayMeals = history.filter(h => h.date === today);
    const totalSpent = history.reduce((sum, h) => sum + (h.cost || 0), 0);
    const todaySpent = todayMeals.reduce((sum, h) => sum + (h.cost || 0), 0);
    const avgPerMeal = historyCount > 0 ? Math.round(totalSpent / historyCount) : 0;

    let summary = '';
    if (todayMeals.length > 0) {
      summary = `Hôm nay bạn đã nấu <strong>${todayMeals.length} bữa</strong>, chi <strong>${MealPlan.formatCurrency(todaySpent)}</strong>. `;
    }
    summary += `Tổng cộng <strong>${historyCount} bữa</strong>, trung bình <strong>${MealPlan.formatCurrency(avgPerMeal)}/bữa</strong>.`;

    const dates = history
      .map(h => parseDateVN(h.date) || new Date(h.dateISO || h.date))
      .filter(d => !isNaN(d.getTime()));
    if (dates.length > 1) {
      const minDate = formatDateVN(new Date(Math.min(...dates)));
      const maxDate = formatDateVN(new Date(Math.max(...dates)));
      if (minDate !== maxDate) {
        summary += ` Từ <strong>${minDate}</strong> → <strong>${maxDate}</strong>.`;
      }
    }

    textEl.innerHTML = summary;
  }

  // ===================== Chart =====================

  function renderChart() {
    const container = document.getElementById('spending-chart');
    const trendEl = document.getElementById('spending-trend');
    const badgeEl = document.getElementById('spending-trend-badge');
    if (!container) return;

    const history = getFilteredHistory();
    const weeklyLabels = ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4', 'Tuần 5'];
    let weeklyTotals = [0, 0, 0, 0, 0];

    if (history.length > 0) {
      history.forEach((item, idx) => {
        const weekIdx = Math.min(Math.floor(idx / Math.max(history.length / 5, 1)), 4);
        weeklyTotals[weekIdx] += item.cost || 0;
      });
    } else {
      weeklyTotals = [95000, 110000, 140000, 105000, 125000];
    }

    const maxVal = Math.max(...weeklyTotals, 1);
    const total = weeklyTotals.reduce((a, b) => a + b, 0);

    if (badgeEl) {
      if (total > 0) {
        const avg = total / weeklyTotals.filter(v => v > 0).length;
        badgeEl.textContent = `TB ${MealPlan.formatCurrency(Math.round(avg))}/tuần`;
      } else {
        badgeEl.textContent = 'Chưa có dữ liệu';
      }
    }

    const colors = ['bg-emerald-400', 'bg-emerald-500', 'bg-emerald-600', 'bg-emerald-500', 'bg-emerald-400'];

    container.innerHTML = weeklyTotals.map((val, idx) => {
      const pct = Math.max((val / maxVal) * 100, 4);
      return `
        <div class="flex flex-col items-center flex-1 h-full justify-end">
          <div class="relative w-full max-w-[32px] group cursor-pointer">
            <div class="chart-bar w-full ${colors[idx]} rounded-t-lg transition-all duration-300 hover:brightness-110 hover:scale-y-[1.03] hover:origin-bottom" style="height: ${pct}%"></div>
            <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-lg pointer-events-none z-20">
              ${MealPlan.formatCurrency(val)}
            </div>
          </div>
        </div>`;
    }).join('');

    const labelsContainer = document.getElementById('chart-labels');
    if (labelsContainer) {
      const labelSpans = labelsContainer.querySelectorAll('span');
      labelSpans.forEach((span, idx) => {
        if (idx < weeklyTotals.length) {
          span.textContent = `${weeklyLabels[idx]}`;
          span.title = MealPlan.formatCurrency(weeklyTotals[idx]);
        }
      });
    }

    if (trendEl) {
      if (total > 0) {
        const avg = total / weeklyTotals.filter(v => v > 0).length;
        trendEl.innerHTML = `Chi tiêu trung bình <span class="text-emerald-600 font-bold">${MealPlan.formatCurrency(Math.round(avg))}</span>/tuần`;
      } else {
        trendEl.textContent = 'Chưa có dữ liệu chi tiêu.';
      }
    }
  }

  // ===================== Top Items =====================

  function renderTopItems() {
    const container = document.getElementById('top-items');
    if (!container) return;

    const items = MealPlan.state.topItems;
    const parseCount = (str) => parseInt(str) || 5;
    const maxCount = Math.max(...items.map(i => parseCount(i.count)), 1);

    container.innerHTML = items.map(item => {
      const count = parseCount(item.count);
      const pct = Math.round((count / maxCount) * 100);
      return `
        <div class="bg-surface-container-low rounded-xl p-4 hover:shadow-md hover:bg-white transition-all group">
          <div class="flex flex-col items-center text-center">
            <div class="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <span class="material-symbols-outlined text-emerald-600">${item.icon}</span>
            </div>
            <span class="font-label-md text-on-surface text-sm font-semibold mb-1">${item.name}</span>
            <span class="text-[11px] text-on-surface-variant mb-3">${item.count}</span>
            <div class="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ===================== History List =====================

  function renderHistoryList() {
    const container = document.getElementById('history-list');
    if (!container) return;

    const filtered = getFilteredHistory();
    const emptyFilterMsg = document.getElementById('history-empty-filter');
    const loadMoreBtn = document.getElementById('load-more-history');

    if (filtered.length === 0) {
      const hasActiveFilter = filterState.search || filterState.dateFrom || filterState.dateTo;
      if (hasActiveFilter) {
        container.innerHTML = '';
        if (emptyFilterMsg) emptyFilterMsg.classList.remove('hidden');
      } else {
        container.innerHTML = `
          <div class="text-center py-10">
            <span class="material-symbols-outlined text-4xl text-outline/30 mb-3">history</span>
            <p class="text-on-surface-variant text-sm">Chưa có lịch sử nấu ăn.</p>
            <p class="text-[12px] text-on-surface-variant mt-1">Lên lịch bữa ăn ở trang chủ!</p>
          </div>`;
        if (emptyFilterMsg) emptyFilterMsg.classList.add('hidden');
      }
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    if (emptyFilterMsg) emptyFilterMsg.classList.add('hidden');

    const displayLimit = filterState.showAll ? filtered.length : Math.min(5, filtered.length);
    const display = filtered.slice(0, displayLimit);

    container.innerHTML = display.map((item, idx) => {
      const dateStr = item.date || formatISOToVN(item.dateISO);
      return `
        <div class="flex items-stretch gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-all group ${idx > 0 ? 'border-t border-outline-variant/10 pt-4' : ''}">
          <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined text-emerald-600 text-2xl">restaurant_menu</span>
          </div>
          <div class="flex-1 min-w-0 flex flex-col justify-center">
            <div class="flex items-start justify-between gap-2">
              <h4 class="font-label-md text-on-surface font-semibold">${item.dishName}</h4>
            </div>
            <div class="flex items-center gap-3 mt-0.5">
              <span class="text-[11px] text-on-surface-variant flex items-center gap-1">
                <span class="material-symbols-outlined text-[12px]">calendar_today</span>
                ${dateStr}
              </span>
              ${item.cost ? `<span class="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                <span class="material-symbols-outlined text-[12px]">payments</span>
                ${MealPlan.formatCurrency(item.cost)}
              </span>` : ''}
            </div>
            ${item.items ? `<p class="text-[10px] text-on-surface-variant mt-1 truncate" title="${item.items}">${item.totalItems ? `${item.totalItems} nguyên liệu` : ''}${item.owned > 0 ? `, ${item.owned} đã có` : ''}</p>` : ''}
          </div>
        </div>`;
    }).join('');

    if (loadMoreBtn) {
      const hasMore = filtered.length > displayLimit;
      loadMoreBtn.style.display = hasMore ? 'block' : 'none';
      if (hasMore) {
        loadMoreBtn.innerHTML = `<span class="flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-[18px]">expand_more</span>
          Tải thêm (${filtered.length - displayLimit} còn lại)
        </span>`;
      }
    }
  }

  // ===================== Favorites =====================

  function getFavVisual(name) {
    const lower = name.toLowerCase();
    const map = [
      ['salad', { emoji: '🥗', gradient: 'from-lime-400/20 to-green-300/20' }],
      ['phở', { emoji: '🍜', gradient: 'from-amber-500/20 to-orange-400/20' }],
      ['bánh', { emoji: '🥟', gradient: 'from-purple-400/20 to-fuchsia-300/20' }],
      ['trứng', { emoji: '🥚', gradient: 'from-yellow-300/20 to-amber-200/20' }],
      ['cơm', { emoji: '🍚', gradient: 'from-orange-400/20 to-yellow-300/20' }],
      ['canh', { emoji: '🥣', gradient: 'from-teal-400/20 to-cyan-300/20' }],
      ['kho', { emoji: '🍲', gradient: 'from-amber-500/20 to-orange-400/20' }],
      ['xào', { emoji: '🥘', gradient: 'from-orange-400/20 to-yellow-300/20' }],
      ['luộc', { emoji: '🥟', gradient: 'from-teal-400/20 to-cyan-300/20' }],
      ['chiên', { emoji: '🍳', gradient: 'from-amber-400/20 to-yellow-300/20' }],
      ['nướng', { emoji: '🔥', gradient: 'from-red-500/20 to-orange-400/20' }],
      ['rau', { emoji: '🥬', gradient: 'from-green-400/20 to-emerald-300/20' }],
      ['tôm', { emoji: '🦐', gradient: 'from-pink-400/20 to-orange-300/20' }],
      ['cá', { emoji: '🐟', gradient: 'from-blue-400/20 to-teal-300/20' }],
      ['gà', { emoji: '🍗', gradient: 'from-amber-400/20 to-yellow-300/20' }],
      ['bò', { emoji: '🥩', gradient: 'from-red-500/20 to-orange-400/20' }],
      ['heo', { emoji: '🐷', gradient: 'from-rose-400/20 to-pink-300/20' }],
      ['lợn', { emoji: '🐷', gradient: 'from-rose-400/20 to-pink-300/20' }],
      ['mì', { emoji: '🍝', gradient: 'from-yellow-500/20 to-orange-400/20' }],
    ];
    map.sort(([a], [b]) => (b || '').length - (a || '').length);
    for (const entry of map) {
      const keywords = Array.isArray(entry) ? entry.slice(0, -1) : [entry[0]];
      const visual = entry[entry.length - 1];
      if (keywords.some(k => lower.includes(k))) return visual;
    }
    return { emoji: '🍽️', gradient: 'from-primary/10 to-primary-container/20' };
  }

  function renderFavorites() {
    const container = document.getElementById('favorite-grid');
    if (!container) return;

    const favorites = MealPlan.state.favorites || [];

    if (favorites.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-8 bg-surface-container-low rounded-xl">
          <span class="material-symbols-outlined text-3xl text-outline block mx-auto mb-2">favorite</span>
          <p class="text-on-surface-variant text-sm">Chưa có món yêu thích.</p>
          <p class="text-[12px] text-on-surface-variant mt-1">Thả tim món ăn ở trang chủ nhé!</p>
        </div>`;
      return;
    }

    container.innerHTML = favorites.map(dish => {
      const visual = getFavVisual(dish.name);
      const desc = dish.description || 'Món ăn yêu thích của bạn';
      const escapedName = dish.name.replace(/'/g, "\\'");
      return `
        <div class="group bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10 hover:shadow-lg hover:border-emerald-200/50 transition-all duration-300">
          <div class="h-28 bg-gradient-to-br ${visual.gradient} flex items-center justify-center relative overflow-hidden">
            <span class="text-4xl transition-transform duration-300 group-hover:scale-110">${visual.emoji}</span>
            <button class="fav-remove-btn absolute top-3 right-3 bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100" data-name="${dish.name}" title="Bỏ yêu thích">
              <span class="material-symbols-outlined text-red-500 text-[16px]">close</span>
            </button>
          </div>
          <div class="p-4">
            <h4 class="font-label-md text-on-surface font-semibold mb-1">${dish.name}</h4>
            <p class="text-[12px] text-on-surface-variant leading-relaxed mb-3">${desc}</p>
            <div class="flex items-center gap-2 mb-3">
              <div class="flex-1 h-1 bg-outline-variant/20 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full" style="width: 100%"></div>
              </div>
              <span class="text-[10px] text-on-surface-variant font-semibold">Yêu thích</span>
            </div>
            <button class="w-full py-2.5 bg-emerald-50 text-emerald-700 rounded-xl font-label-md text-sm hover:bg-emerald-600 hover:text-white active:scale-[0.97] transition-all flex items-center justify-center gap-1.5 group/btn"
              onclick="(function(){ MealPlan.navigate('home'); var inp=document.getElementById('dish-search'); if(inp){inp.value='${escapedName}'; inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));} })()">
              <span class="material-symbols-outlined text-[16px] group-hover/btn:scale-110 transition-transform">add</span>
              Thêm vào kế hoạch
            </button>
          </div>
        </div>`;
    }).join('');

    // Attach remove events
    container.querySelectorAll('.fav-remove-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const name = this.dataset.name;
        MealPlan.removeFavorite(name);
        renderFavorites();
        MealPlan.showToast(`Đã bỏ "${name}" khỏi yêu thích`, 'info');
        // Sync heart icon on home page if visible
        const safename = name.replace(/"/g, '\\"');
        document.querySelectorAll('.fav-btn[data-dish="' + safename + '"]').forEach(fb => {
          const icon = fb.querySelector('.material-symbols-outlined');
          if (icon) {
            icon.style.setProperty('font-variation-settings', "'FILL' 0");
            icon.classList.add('opacity-40');
          }
        });
      });
    });
  }

  // ===================== Init =====================

  function initHistory() {
    document.getElementById('btn-apply-history-filter')?.addEventListener('click', () => {
      filterState.search = document.getElementById('history-search')?.value || '';
      filterState.dateFrom = document.getElementById('history-date-from')?.value || '';
      filterState.dateTo = document.getElementById('history-date-to')?.value || '';
      filterState.showAll = false;
      renderHistory();
    });

    document.getElementById('btn-clear-history-filter')?.addEventListener('click', () => {
      const searchInput = document.getElementById('history-search');
      const dateFrom = document.getElementById('history-date-from');
      const dateTo = document.getElementById('history-date-to');
      if (searchInput) searchInput.value = '';
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
      filterState = { search: '', dateFrom: '', dateTo: '', showAll: false };
      renderHistory();
    });

    document.getElementById('history-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-apply-history-filter')?.click();
      }
    });

    document.getElementById('load-more-history')?.addEventListener('click', () => {
      filterState.showAll = true;
      renderHistoryList();
    });

    document.getElementById('btn-go-home-empty')?.addEventListener('click', () => {
      MealPlan.navigate('home');
    });
  }

  window.renderHistory = renderHistory;

  document.addEventListener('DOMContentLoaded', initHistory);
})();
