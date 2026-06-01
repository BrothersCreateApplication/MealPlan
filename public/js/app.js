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
    let permissionError = false;

    async function startCamera() {
      try {
        // Thử dùng camera sau trước (environment), fallback về trước (user)
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } }
        });
        video.srcObject = stream;
        // Đảm bảo video bắt đầu play (quan trọng trên Android PWA)
        await video.play();
        console.log('[Camera] Stream started successfully');
        return true;
      } catch (err) {
        console.error('[Camera] Error:', err.name, err.message);
        stream = null;

        if (err.name === 'NotAllowedError') {
          permissionError = true;
          showCameraPermissionHelp();
        } else if (err.name === 'NotFoundError') {
          showToast('Thiết bị không có camera!', 'warning');
        } else {
          showToast('Không thể mở camera, bạn có thể tải ảnh lên!', 'warning');
        }
        shoot.classList.add('hidden');
        return false;
      }
    }

    function showCameraPermissionHelp() {
      const existing = document.querySelector('.camera-perm-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'camera-perm-overlay fixed inset-0 z-[260] bg-black/60 flex items-center justify-center p-4 animate-fade-in';
      overlay.innerHTML = `
        <div class="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-slide-up">
          <div class="bg-gradient-to-br from-amber-500 to-orange-500 p-5 text-center">
            <span class="material-symbols-outlined text-4xl text-white mb-2">no_photography</span>
            <h3 class="font-title-md text-white">Camera bị chặn</h3>
            <p class="text-white/70 text-xs mt-1">Vui lòng cấp quyền camera để chụp ảnh</p>
          </div>
          <div class="p-5 space-y-3">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span class="font-bold text-amber-700 text-sm">1</span>
              </div>
              <div>
                <p class="font-label-md text-sm text-on-surface">Mở Cài đặt Chrome</p>
                <p class="text-xs text-on-surface-variant">Bấm icon 🔒 trên thanh địa chỉ → Quyền → Camera</p>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span class="font-bold text-amber-700 text-sm">2</span>
              </div>
              <div>
                <p class="font-label-md text-sm text-on-surface">Chọn "Cho phép"</p>
                <p class="text-xs text-on-surface-variant">Chuyển từ "Đã chặn" → "Cho phép" rồi tải lại trang</p>
              </div>
            </div>
            <div class="bg-amber-50 rounded-xl p-3 text-xs text-amber-800">
              💡 <strong>Mẹo:</strong> Vào Cài đặt Android → Ứng dụng → Chrome → Quyền → Camera → Cho phép
            </div>
          </div>
          <div class="p-5 pt-0 flex gap-3">
            <button class="cam-perm-retry flex-1 py-3 rounded-xl bg-primary text-on-primary font-label-md hover:opacity-90 active:scale-[0.98] transition-all">
              🔄 Thử lại
            </button>
            <button class="cam-perm-dismiss px-5 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high transition-all">
              Đóng
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.cam-perm-retry')?.addEventListener('click', async () => {
        overlay.remove();
        // Reset video và thử lại
        video.classList.remove('hidden');
        shoot.classList.remove('hidden');
        capture.classList.add('hidden');
        retake.classList.add('hidden');
        confirmBtn.classList.add('hidden');
        uploadLabel.classList.remove('hidden');
        await startCamera();
      });
      overlay.querySelector('.cam-perm-dismiss')?.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    startCamera();

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
          body: JSON.stringify({ image: compressed, mode })
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


  // ---- PWA Install Prompt ----
  let deferredPrompt = null;
  let installPromptShown = false;

  function initPWAInstall() {
    // Bắt sự kiện beforeinstallprompt (Chrome/Android)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;

      // Hiện prompt sau 5 giây nếu chưa cài và chưa hiện lần nào
      const dismissed = sessionStorage.getItem('pwa-prompt-dismissed');
      if (!dismissed && !installPromptShown) {
        setTimeout(() => showInstallPrompt(), 5000);
      }
    });

    // Kiểm tra đã cài chưa
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installPromptShown = true;
      sessionStorage.setItem('pwa-installed', '1');
    });

    // Safari/iPhone: show hướng dẫn sau 8 giây (không có beforeinstallprompt)
    const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      const dismissed = sessionStorage.getItem('pwa-prompt-dismissed');
      if (!dismissed) {
        setTimeout(() => showIOSInstallGuide(), 8000);
      }
    }
  }

  function showInstallPrompt() {
    if (installPromptShown) return;
    installPromptShown = true;

    const existing = document.querySelector('.pwa-install-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'pwa-install-overlay fixed inset-0 z-[350] bg-black/60 flex items-end md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-white w-full md:max-w-sm md:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up overflow-hidden">
        <!-- Header gradient -->
        <div class="bg-gradient-to-br from-primary to-emerald-400 p-6 text-center relative">
          <div class="w-20 h-20 mx-auto bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-lg mb-3">
            <span class="text-5xl">🥘</span>
          </div>
          <h3 class="font-headline-lg text-white text-lg">Cài app Vào Bếp</h3>
          <p class="text-white/70 text-sm mt-1">Nấu ăn nhanh hơn, không cần mở trình duyệt</p>
          <button class="pwa-close absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all">
            <span class="material-symbols-outlined text-white text-lg">close</span>
          </button>
        </div>

        <!-- Benefits -->
        <div class="p-5 space-y-3">
          <div class="flex items-center gap-3 bg-emerald-50 rounded-xl p-3">
            <span class="material-symbols-outlined text-emerald-600 text-2xl">bolt</span>
            <div>
              <p class="font-label-md text-sm text-on-surface">Mở nhanh 1 chạm</p>
              <p class="text-xs text-on-surface-variant">Icon ngay trên màn hình chính</p>
            </div>
          </div>
          <div class="flex items-center gap-3 bg-indigo-50 rounded-xl p-3">
            <span class="material-symbols-outlined text-indigo-600 text-2xl">phone_iphone</span>
            <div>
              <p class="font-label-md text-sm text-on-surface">Full màn hình</p>
              <p class="text-xs text-on-surface-variant">Không thanh địa chỉ, trải nghiệm như app</p>
            </div>
          </div>
          <div class="flex items-center gap-3 bg-amber-50 rounded-xl p-3">
            <span class="material-symbols-outlined text-amber-600 text-2xl">wifi_off</span>
            <div>
              <p class="font-label-md text-sm text-on-surface">Dùng offline</p>
              <p class="text-xs text-on-surface-variant">Xem công thức đã lưu kể cả khi không có mạng</p>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="p-5 pt-0 flex gap-3">
          <button class="pwa-dismiss flex-1 py-3.5 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high transition-all">
            Để sau
          </button>
          <button class="pwa-install flex-1 py-3.5 rounded-xl bg-primary text-on-primary font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2">
            <span class="material-symbols-outlined">download</span>
            Cài đặt ngay
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Events
    overlay.querySelector('.pwa-close')?.addEventListener('click', () => dismiss());
    overlay.querySelector('.pwa-dismiss')?.addEventListener('click', () => dismiss());
    overlay.querySelector('.pwa-install')?.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') {
          sessionStorage.setItem('pwa-installed', '1');
        }
      }
      dismiss();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });

    function dismiss() {
      sessionStorage.setItem('pwa-prompt-dismissed', '1');
      overlay.classList.add('animate-fade-out');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // Safari/iPhone: không có beforeinstallprompt, show hướng dẫn thủ công
  function showIOSInstallGuide() {
    if (installPromptShown) return;
    installPromptShown = true;

    const overlay = document.createElement('div');
    overlay.className = 'pwa-install-overlay fixed inset-0 z-[350] bg-black/60 flex items-end md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-white w-full md:max-w-sm md:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up overflow-hidden">
        <div class="bg-gradient-to-br from-primary to-emerald-400 p-6 text-center relative">
          <div class="w-20 h-20 mx-auto bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-lg mb-3">
            <span class="text-5xl">🥘</span>
          </div>
          <h3 class="font-headline-lg text-white text-lg">Cài Vào Bếp lên iPhone</h3>
          <p class="text-white/70 text-sm mt-1">2 bước đơn giản</p>
          <button class="pwa-close absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all">
            <span class="material-symbols-outlined text-white text-lg">close</span>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-start gap-4">
            <div class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">1</div>
            <div>
              <p class="font-label-md text-sm text-on-surface">Bấm nút Share</p>
              <p class="text-xs text-on-surface-variant mt-0.5">Nút <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-[11px]"><span class="material-symbols-outlined text-[14px]">ios_share</span> Share</span> ở góc dưới màn hình Safari</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">2</div>
            <div>
              <p class="font-label-md text-sm text-on-surface">Chọn "Add to Home Screen"</p>
              <p class="text-xs text-on-surface-variant mt-0.5">Kéo xuống chọn <strong>Add to Home Screen</strong> → bấm <strong>Add</strong></p>
            </div>
          </div>
        </div>
        <div class="p-5 pt-0">
          <button class="pwa-dismiss w-full py-3.5 rounded-xl bg-primary text-on-primary font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/25">
            Đã hiểu!
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.pwa-close')?.addEventListener('click', () => dismiss());
    overlay.querySelector('.pwa-dismiss')?.addEventListener('click', () => dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });

    function dismiss() {
      sessionStorage.setItem('pwa-prompt-dismissed', '1');
      overlay.classList.add('animate-fade-out');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // ---- Init ----
  function init() {
    loadState();

    // Init PWA install prompt
    initPWAInstall();

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
  };
})();

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => MealPlan.init());
