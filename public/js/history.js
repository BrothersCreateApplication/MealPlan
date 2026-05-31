// ===================== Lịch Sử & Thói Quen Module =====================

(function() {
  // ---- State ----
  let filterState = {
    search: '',
    dateFrom: '',
    dateTo: '',
    showAll: false // for "load more"
  };

  const favoriteDishes = [
    {
      name: 'Salad Địa Trung Hải',
      icon: 'eco',
      frequency: '5 lần/tháng',
      description: 'Món ăn giúp bạn duy trì cân nặng tốt nhất trong tháng.'
    },
    {
      name: 'Mì Ý Pesto',
      icon: 'ramen_dining',
      frequency: '4 lần/tháng',
      description: 'Bạn thường chọn món này khi cần chuẩn bị nhanh dưới 15 phút.'
    },
    {
      name: 'Gà Nướng Khoai Lang',
      icon: 'set_meal',
      frequency: '3 lần/tháng',
      description: 'Món ăn cung cấp năng lượng ổn định cho các buổi tập chiều.'
    }
  ];

  // ---- Helper: parse date string "dd/mm/yyyy" -> Date ----
  function parseDateVN(dateStr) {
    if (!dateStr) return null;
    // Handle "dd/mm/yyyy" format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return isNaN(d.getTime()) ? null : d;
    }
    // Handle ISO "yyyy-mm-dd"
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // ---- Format Date to "dd/mm/yyyy" ----
  function formatDateVN(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN'); // "dd/mm/yyyy"
  }

  // ---- Format ISO string to "dd/mm/yyyy" ----
  function formatISOToVN(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return formatDateVN(d);
  }

  // ---- Filter history ----
  function getFilteredHistory() {
    let history = MealPlan.state.history || [];

    // Filter by search keyword
    if (filterState.search.trim()) {
      const kw = filterState.search.trim().toLowerCase();
      history = history.filter(h =>
        (h.dishName || '').toLowerCase().includes(kw)
      );
    }

    // Filter by date from
    if (filterState.dateFrom) {
      const fromDate = new Date(filterState.dateFrom + 'T00:00:00');
      if (!isNaN(fromDate.getTime())) {
        history = history.filter(h => {
          const hDate = parseDateVN(h.date) || new Date(h.dateISO || h.date);
          return hDate >= fromDate;
        });
      }
    }

    // Filter by date to
    if (filterState.dateTo) {
      const toDate = new Date(filterState.dateTo + 'T23:59:59');
      if (!isNaN(toDate.getTime())) {
        history = history.filter(h => {
          const hDate = parseDateVN(h.date) || new Date(h.dateISO || h.date);
          return hDate <= toDate;
        });
      }
    }

    // Sort newest first (by dateISO or date)
    history.sort((a, b) => {
      const aDate = new Date(a.dateISO || parseDateVN(a.date) || 0);
      const bDate = new Date(b.dateISO || parseDateVN(b.date) || 0);
      return bDate - aDate;
    });

    return history;
  }

  // ===================== Main render =====================

  async function renderHistory() {
    await loadAIInsights();
    renderChart();
    renderTopItems();
    renderHistoryList();
    renderFavorites();
    updateCountBadge();
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

    // Calculate date range
    const dates = history
      .map(h => parseDateVN(h.date) || new Date(h.dateISO || h.date))
      .filter(d => !isNaN(d.getTime()));
    const minDate = dates.length > 0 ? formatDateVN(new Date(Math.min(...dates))) : '';
    const maxDate = dates.length > 0 ? formatDateVN(new Date(Math.max(...dates))) : '';

    let summary = `Đã nấu ${historyCount} bữa, tổng chi ${MealPlan.formatCurrency(totalSpent)}.`;
    if (minDate && maxDate !== minDate) {
      summary += ` Từ ${minDate} → ${maxDate}.`;
    }
    if (todayMeals.length > 0) {
      summary = `Hôm nay nấu ${todayMeals.length} bữa, chi ${MealPlan.formatCurrency(todaySpent)}. ` + summary;
    }

    textEl.textContent = summary;
  }

  // ===================== Chart =====================

  function renderChart() {
    const container = document.getElementById('spending-chart');
    if (!container) return;
    const trend = document.getElementById('spending-trend');

    const history = getFilteredHistory();
    let weeklyTotals = [0, 0, 0, 0, 0];
    let maxVal = 1;

    if (history.length > 0) {
      history.forEach((item, idx) => {
        const weekIdx = Math.min(Math.floor(idx / Math.max(history.length / 5, 1)), 4);
        weeklyTotals[weekIdx] += item.cost || 0;
      });
      maxVal = Math.max(...weeklyTotals, 1);
    } else {
      weeklyTotals = [95000, 110000, 140000, 105000, 125000];
      maxVal = 150000;
    }

    container.innerHTML = weeklyTotals.map((val, idx) => {
      const pct = Math.max((val / maxVal) * 100, 5);
      return `
        <div class="chart-bar w-full bg-secondary/20 rounded-t-lg relative group" style="height: ${pct}%">
          <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-on-surface text-white px-2 py-1 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">${MealPlan.formatCurrency(val)}</div>
        </div>`;
    }).join('');

    if (trend) {
      const total = weeklyTotals.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const avg = total / weeklyTotals.filter(v => v > 0).length;
        trend.innerHTML = `Chi tiêu trung bình: <span class="text-secondary font-bold">${MealPlan.formatCurrency(Math.round(avg))}</span>/tuần`;
      } else {
        trend.textContent = 'Chưa có dữ liệu chi tiêu.';
      }
    }
  }

  // ===================== Top Items =====================

  function renderTopItems() {
    const container = document.getElementById('top-items');
    if (!container) return;

    container.innerHTML = MealPlan.state.topItems.map(item => `
      <div class="flex flex-col items-center p-3 bg-surface-container rounded-lg">
        <span class="material-symbols-outlined text-primary mb-2">${item.icon}</span>
        <span class="text-label-md text-center">${item.name}</span>
        <span class="text-[10px] text-on-surface-variant">${item.count}</span>
      </div>
    `).join('');
  }

  // ===================== History List (có filter + delete) =====================

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
          <div class="text-center py-8">
            <span class="material-symbols-outlined text-4xl text-outline mb-3">history</span>
            <p class="text-on-surface-variant">Chưa có lịch sử nấu ăn.</p>
            <p class="text-sm text-on-surface-variant mt-1">Lên lịch bữa ăn ở trang chủ!</p>
          </div>`;
        if (emptyFilterMsg) emptyFilterMsg.classList.add('hidden');
      }
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    if (emptyFilterMsg) emptyFilterMsg.classList.add('hidden');

    // Pagination: show 5 normally, more on "load more"
    const displayLimit = filterState.showAll ? filtered.length : Math.min(5, filtered.length);
    const display = filtered.slice(0, displayLimit);

    container.innerHTML = display.map((item, idx) => {
      const dateStr = item.date || formatISOToVN(item.dateISO);
      return `
      <div class="history-item flex gap-stack-md p-3 hover:bg-surface-container-low rounded-lg transition-colors group relative ${idx > 0 ? 'border-t border-outline-variant/30 pt-4' : ''}">
        <div class="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container flex items-center justify-center">
          <span class="material-symbols-outlined text-outline text-3xl">restaurant_menu</span>
        </div>
        <div class="flex-1 flex flex-col justify-between min-w-0">
          <div>
            <div class="flex items-start justify-between gap-2">
              <h4 class="font-label-md text-on-surface">${item.dishName}</h4>
              <button class="history-delete-btn opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-error flex-shrink-0 p-0.5" data-id="${item.id}" title="Xoá mục này">
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p class="text-[12px] text-on-surface-variant">${dateStr}</p>
            ${item.items ? `<p class="text-[11px] text-on-surface-variant mt-1 truncate" title="${item.items}">🛒 ${item.items}</p>` : ''}
          </div>
          <div class="flex justify-between items-center mt-1">
            <span class="text-[11px] text-on-surface-variant">
              ${item.totalItems ? `${item.totalItems} nguyên liệu` : ''}
              ${item.owned > 0 ? `, ${item.owned} đã có` : ''}
            </span>
            ${item.cost ? `<span class="font-price-tag text-secondary font-bold">${MealPlan.formatCurrency(item.cost)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    // Load more button
    if (loadMoreBtn) {
      const hasMore = filtered.length > displayLimit;
      loadMoreBtn.style.display = hasMore ? 'block' : 'none';
      if (hasMore) {
        loadMoreBtn.textContent = `Tải thêm (${filtered.length - displayLimit} còn lại)`;
      }
    }

    // Attach delete events
    container.querySelectorAll('.history-delete-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const id = this.dataset.id;
        deleteHistoryItem(id);
      });
    });
  }

  // ---- Delete single history item ----
  async function deleteHistoryItem(id) {
    const history = MealPlan.state.history;
    const idx = history.findIndex(h => String(h.id) === String(id));
    if (idx === -1) return;

    const item = history[idx];
    const confirmed = await MealPlan.showConfirm(`Xoá "${item.dishName}" khỏi lịch sử?`);
    if (!confirmed) return;

    history.splice(idx, 1);
    MealPlan.saveState();
    renderHistory();
    MealPlan.showToast(`Đã xoá "${item.dishName}"`, 'info');
  }

  // ---- Delete ALL history ----
  async function deleteAllHistory() {
    const history = MealPlan.state.history;
    if (history.length === 0) {
      MealPlan.showToast('Không có lịch sử để xoá.', 'info');
      return;
    }

    const c1 = await MealPlan.showConfirm(`Xoá tất cả ${history.length} mục lịch sử? Hành động này không thể hoàn tác!`);
    if (!c1) return;
    const c2 = await MealPlan.showConfirm('Bạn chắc chắn muốn xoá TOÀN BỘ lịch sử nấu ăn?');
    if (!c2) return;

    MealPlan.state.history = [];
    MealPlan.saveState();
    renderHistory();
    MealPlan.showToast('Đã xoá tất cả lịch sử!', 'info');
  }

  // ===================== Favorites =====================

  function renderFavorites() {
    const container = document.getElementById('favorite-carousel');
    if (!container) return;

    container.innerHTML = favoriteDishes.map(dish => `
      <div class="min-w-[260px] bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
        <div class="h-28 bg-gradient-to-br from-secondary/20 to-primary-container/30 flex items-center justify-center">
          <span class="material-symbols-outlined text-5xl text-primary/50">${dish.icon}</span>
        </div>
        <div class="p-4">
          <div class="flex justify-between items-start mb-2">
            <h4 class="font-label-md text-on-surface">${dish.name}</h4>
            <span class="bg-primary-container text-on-primary-container text-[10px] px-2 py-1 rounded whitespace-nowrap">${dish.frequency}</span>
          </div>
          <p class="text-[12px] text-on-surface-variant mb-3">${dish.description}</p>
          <button class="w-full py-2 bg-surface-container-high text-primary rounded-lg font-label-md hover:bg-primary-container/20 transition-colors"
            onclick="MealPlan.navigate('home'); var inp=document.getElementById('dish-search'); if(inp){inp.value='${dish.name}'; inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));}">
            Thêm vào kế hoạch
          </button>
        </div>
      </div>
    `).join('');
  }

  // ===================== Init =====================

  function initHistory() {
    // Apply filter
    document.getElementById('btn-apply-history-filter')?.addEventListener('click', () => {
      filterState.search = document.getElementById('history-search')?.value || '';
      filterState.dateFrom = document.getElementById('history-date-from')?.value || '';
      filterState.dateTo = document.getElementById('history-date-to')?.value || '';
      filterState.showAll = false; // reset pagination
      renderHistory();
    });

    // Clear filter
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

    // Delete all
    document.getElementById('btn-delete-all-history')?.addEventListener('click', deleteAllHistory);

    // Enter key in search field triggers filter
    document.getElementById('history-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-apply-history-filter')?.click();
      }
    });

    // Load more
    document.getElementById('load-more-history')?.addEventListener('click', () => {
      filterState.showAll = true;
      renderHistoryList();
    });
  }

  // Expose for navigation refresh
  window.renderHistory = renderHistory;

  document.addEventListener('DOMContentLoaded', initHistory);
})();
