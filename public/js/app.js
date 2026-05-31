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
    region: 'all',       // 'all' | 'bac' | 'trung' | 'nam'
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


  // ---- Camera: chụp ảnh món ăn hoặc tủ lạnh (dùng Gemini Flash-Lite) ----
  // options: { onResult: function(data), mode: 'dish'|'fridge' }
  function openCamera(options) {
    const modal = document.getElementById('camera-modal');
    if (!modal) return;

    const video = document.getElementById('camera-preview');
    const canvas = document.getElementById('camera-canvas');
    const capture = document.getElementById('camera-capture');
    const shoot = document.getElementById('camera-shoot');
    const retake = document.getElementById('camera-retake');
    const confirmBtn = document.getElementById('camera-confirm');
    const uploadLabel = document.getElementById('camera-upload-label');
    const loading = document.getElementById('camera-loading');

    const mode = options?.mode || 'dish';

    modal.classList.remove('hidden');
    video.classList.remove('hidden');
    capture.classList.add('hidden');
    shoot.classList.remove('hidden');
    retake.classList.add('hidden');
    confirmBtn.classList.add('hidden');
    uploadLabel.classList.remove('hidden');
    loading.classList.add('hidden');

    // Start camera
    let stream = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        stream = s;
        video.srcObject = s;
      })
      .catch(() => {
        showToast('Không thể mở camera, bạn có thể tải ảnh lên!', 'warning');
        shoot.classList.add('hidden');
      });

    function closeModal() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      modal.classList.add('hidden');
    }
    document.getElementById('camera-close').onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // Shoot
    shoot.onclick = () => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      capture.src = dataUrl;
      video.classList.add('hidden');
      shoot.classList.add('hidden');
      capture.classList.remove('hidden');
      retake.classList.remove('hidden');
      confirmBtn.classList.remove('hidden');
      uploadLabel.classList.add('hidden');
    };

    // Retake
    retake.onclick = () => {
      video.classList.remove('hidden');
      capture.classList.add('hidden');
      shoot.classList.remove('hidden');
      retake.classList.add('hidden');
      confirmBtn.classList.add('hidden');
      uploadLabel.classList.remove('hidden');
    };

    // Confirm → analyze with Gemini
    const analyze = (imageDataUrl) => {
      loading.classList.remove('hidden');
      if (stream) stream.getTracks().forEach(t => t.stop());

      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const max = 800;
        if (w > max || h > max) {
          const ratio = Math.min(max / w, max / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.7);

        fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressed, mode, region: getRegion() })
        })
        .then(r => r.json())
        .then(result => {
          loading.classList.add('hidden');
          modal.classList.add('hidden');
          closeModal();
          if (options?.onResult) {
            options.onResult(result);
          }
        })
        .catch(() => {
          loading.classList.add('hidden');
          showToast('Lỗi kết nối!', 'error');
        });
      };
      img.src = imageDataUrl;
    };

    confirmBtn.onclick = () => analyze(capture.src);

    // Upload from file
    document.getElementById('camera-file-input').onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        capture.src = dataUrl;
        video.classList.add('hidden');
        shoot.classList.add('hidden');
        capture.classList.remove('hidden');
        retake.classList.remove('hidden');
        confirmBtn.classList.remove('hidden');
        uploadLabel.classList.add('hidden');
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    };
  }


  // ---- Region helpers ----
  const REGIONS = [
    { value: 'all', label: 'Tất cả', emoji: '🇻🇳' },
    { value: 'bac', label: 'Miền Bắc', emoji: '🏔️' },
    { value: 'trung', label: 'Miền Trung', emoji: '🏖️' },
    { value: 'nam', label: 'Miền Nam', emoji: '🌴' },
  ];

  function getRegionLabel(val) {
    const r = REGIONS.find(r => r.value === val);
    return r ? r.label : 'Tất cả';
  }

  function getRegion() {
    return state.region || 'all';
  }

  function setRegion(val) {
    state.region = val;
    saveState();
    renderRegionPickers();
  }

  function renderRegionPickers() {
    ['region-picker-home', 'region-picker-fridge'].forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      container.innerHTML = REGIONS.map(r => `
        <button class="region-btn px-4 py-2 rounded-full text-sm font-label-md transition-all ${
          state.region === r.value
            ? 'bg-primary text-on-primary shadow-sm'
            : 'bg-surface-container-high text-on-surface-variant hover:bg-primary-container/30'
        }" data-region="${r.value}">
          ${r.emoji} ${r.label}
        </button>
      `).join('');
    });
    // Attach events
    document.querySelectorAll('.region-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setRegion(btn.dataset.region);
      });
    });
  }

  // ---- Init ----
  function init() {
    loadState();

    if (!state.region) state.region = 'all';

    renderRegionPickers();

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
    removeFavorite,
    openCamera,
    getRegion,
    setRegion,
    REGIONS,
    getRegionLabel
  };
})();

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => MealPlan.init());
