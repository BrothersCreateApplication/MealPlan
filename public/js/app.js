// ===================== MealPlan App Core =====================

const MealPlan = (function() {
  // ---- State ----
  const state = {
    currentPage: 'home',
    currentDish: null,
    currentMealName: '',
    cart: [],
    history: [],
    dishes: [],
    favorites: [],      // [{ name, time, calories, difficulty, description, ingredients }]
    topItems: [
      { name: 'Trứng gà', icon: 'egg', count: '12 lần/tháng' },
      { name: 'Cải xanh', icon: 'eco', count: '8 lần/tháng' },
      { name: 'Ức gà', icon: 'nutrition', count: '6 lần/tháng' },
      { name: 'Gạo ST25', icon: 'database', count: '4 lần/tháng' }
    ]
  };

  // ---- Persistence ----
  function loadState() {
    try {
      const saved = localStorage.getItem('mealplan_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(state, parsed, { favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [] });
      }
    } catch (e) { /* ignore corrupt data */ }
  }

  function saveState() {
    try {
      const toSave = { ...state, favorites: [...state.favorites] };
      localStorage.setItem('mealplan_state', JSON.stringify(toSave));
    } catch (e) { /* storage full */ }
  }

  // ---- Favorites ----
  function toggleFavorite(dish) {
    if (!dish || !dish.name) return;
    const idx = state.favorites.findIndex(f => f.name === dish.name);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
      return false; // removed
    } else {
      // Store dish info
      state.favorites.push({
        name: dish.name,
        time: dish.time || '',
        calories: dish.calories || '',
        difficulty: dish.difficulty || '',
        description: dish.description || '',
        ingredients: dish.ingredients || []
      });
      return true; // added
    }
  }

  function isFavorite(name) {
    return state.favorites.some(f => f.name === name);
  }

  function removeFavorite(name) {
    const idx = state.favorites.findIndex(f => f.name === name);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
      saveState();
      return true;
    }
    return false;
  }

  // ---- API Client ----
  async function chatWithAI(messages) {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      const json = await res.json();
      if (json.mock) {
        console.warn('Using mock AI response');
      }
      return json;
    } catch (err) {
      console.error('API call failed:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Router ----
  function navigate(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Show target
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Update bottom nav links
    document.querySelectorAll('.nav-link').forEach(el => {
      const isActive = el.dataset.page === page;
      el.classList.toggle('active', isActive);
      if (isActive) {
        el.classList.add('text-primary');
        const icon = el.querySelector('.material-symbols-outlined');
        if (icon) icon.style.setProperty('font-variation-settings', "'FILL' 1");
      } else {
        el.classList.remove('text-primary');
        const icon = el.querySelector('.material-symbols-outlined');
        if (icon) icon.style.setProperty('font-variation-settings', "'FILL' 0");
      }
    });

    state.currentPage = page;
    updateFooterCart();
  }

  // ---- Cart Helpers ----
  function addToCart(items) {
    items.forEach(item => {
      const existing = state.cart.find(c => c.name === item.name);
      if (existing) {
        existing.quantity = item.quantity;
        existing.price = item.price;
      } else {
        state.cart.push({
          id: Date.now() + Math.random(),
          name: item.name,
          quantity: item.quantity || '1',
          price: item.price || 0,
          status: 'needed',
          image: item.image || ''
        });
      }
    });
    saveState();
    updateFooterCart();
  }

  // ---- Thay thế toàn bộ giỏ hàng (dùng khi chọn món mới) ----
  function setCart(items) {
    state.cart = items.map(item => ({
      id: Date.now() + Math.random(),
      name: item.name,
      quantity: item.quantity || '1',
      price: item.price || 0,
      status: 'needed',
      image: item.image || ''
    }));
    saveState();
    updateFooterCart();
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter(c => c.id !== id);
    saveState();
    updateFooterCart();
  }

  function toggleCartItemStatus(id) {
    const item = state.cart.find(c => c.id === id);
    if (item) {
      item.status = item.status === 'needed' ? 'owned' : 'needed';
      saveState();
    }
    return item;
  }

  function updateCartItemPrice(id, price) {
    const item = state.cart.find(c => c.id === id);
    if (item) {
      item.price = price;
      saveState();
    }
  }

  function clearCart() {
    state.cart = [];
    saveState();
    updateFooterCart();
  }

  function getCartSummary() {
    const needed = state.cart.filter(c => c.status === 'needed');
    const owned = state.cart.filter(c => c.status === 'owned');
    const totalNeeded = needed.reduce((sum, c) => sum + (c.price || 0), 0);
    const totalOwned = owned.reduce((sum, c) => sum + (c.price || 0), 0);
    return {
      items: state.cart.length,
      needed: needed.length,
      owned: owned.length,
      totalNeeded,
      totalOwned,
      savings: totalOwned
    };
  }

  // ---- Footer Cart Update (mobile badge) ----
  function updateFooterCart() {
    // kept for future use - cart summary badges
  }

  // ---- Utility ----
  function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
  }

  function generateId() {
    return Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---- Toast Notification ----
  function showToast(message, type = 'success', duration = 3000) {
    const existing = document.querySelector('.toast-container');
    if (existing) existing.remove();

    const colors = {
      success: 'bg-primary text-on-primary',
      error: 'bg-error text-on-error',
      info: 'bg-secondary text-white',
      warning: 'bg-secondary-container text-on-secondary-container'
    };

    const container = document.createElement('div');
    container.className = 'toast-container fixed top-4 right-4 z-[100] animate-slide-in';
    container.innerHTML = `
      <div class="${colors[type] || colors.success} px-6 py-4 rounded-xl shadow-2xl font-label-md flex items-center gap-3 min-w-[280px] max-w-md">
        <span class="material-symbols-outlined">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'}</span>
        <span class="flex-1">${message}</span>
        <button class="toast-close ml-2 opacity-70 hover:opacity-100">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
    `;
    document.body.appendChild(container);

    container.querySelector('.toast-close')?.addEventListener('click', () => container.remove());
    setTimeout(() => {
      if (container.parentNode) {
        container.style.opacity = '0';
        container.style.transform = 'translateX(100%)';
        container.style.transition = 'all 0.3s ease';
        setTimeout(() => container.remove(), 300);
      }
    }, duration);
  }

  // ---- Custom Confirm Dialog ----
  function showConfirm(message, title = 'Xác nhận') {
    return new Promise((resolve) => {
      const existing = document.querySelector('.confirm-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay fixed inset-0 z-[300] bg-black/50 flex items-center justify-center animate-fade-in';
      overlay.innerHTML = `
        <div class="bg-surface-container-lowest rounded-2xl shadow-2xl mx-4 w-full max-w-sm animate-slide-up overflow-hidden">
          <div class="p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-full bg-error-container flex items-center justify-center flex-shrink-0">
                <span class="material-symbols-outlined text-error">help_outline</span>
              </div>
              <h3 class="font-title-md text-on-surface">${title}</h3>
            </div>
            <p class="text-on-surface-variant text-sm mb-6">${message}</p>
            <div class="flex gap-3">
              <button class="confirm-cancel flex-1 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high transition-all">Huỷ</button>
              <button class="confirm-ok flex-1 py-3 rounded-xl bg-error text-on-error font-label-md hover:opacity-90 transition-all">Xác nhận</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector('.confirm-ok').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
      });
    });
  }

  // ---- Init ----
  function init() {
    loadState();

    // Set up navigation
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const page = el.dataset.page;
        navigate(page);
        // Trigger page-specific refresh
        switch (page) {
          case 'cart': if (window.renderCart) window.renderCart(); break;
          case 'history': if (window.renderHistory) window.renderHistory(); break;
        }
      });
    });

    // Initial render
    updateFooterCart();
  }

  return {
    state,
    navigate,
    init,
    chatWithAI,
    addToCart,
    setCart,
    removeFromCart,
    toggleCartItemStatus,
    updateCartItemPrice,
    clearCart,
    getCartSummary,
    formatCurrency,
    generateId,
    showToast,
    showConfirm,
    saveState,
    loadState,
    toggleFavorite,
    isFavorite,
    removeFavorite
  };
})();

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => MealPlan.init());
