// ===================== Giỏ Đi Chợ & Chi Phí Module =====================

(function() {

  function renderCart() {
    const container = document.getElementById('cart-items');
    const neededCount = document.getElementById('cart-needed-count');
    const ownedCount = document.getElementById('cart-owned-count');

    const items = MealPlan.state.cart;
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center shadow-sm border border-outline-variant/20">
          <span class="material-symbols-outlined text-5xl text-outline mb-4">shopping_bag</span>
          <p class="text-on-surface-variant font-body-md">Giỏ hàng trống. Thêm nguyên liệu từ trang chủ!</p>
        </div>`;
      if (neededCount) neededCount.textContent = '0';
      if (ownedCount) ownedCount.textContent = '0';
      updateSummary(0, 0);
      return;
    }

    const needed = items.filter(i => i.status === 'needed');
    const owned = items.filter(i => i.status === 'owned');
    if (neededCount) neededCount.textContent = needed.length;
    if (ownedCount) ownedCount.textContent = owned.length;

    container.innerHTML = items.map((item, idx) => {
      const isOwned = item.status === 'owned';
      return `
        <div class="cart-item-wrapper bg-surface-container-lowest rounded-xl p-3 shadow-sm border transition-all ${isOwned ? 'border-outline-variant/40 bg-surface-container-high/40' : 'border-outline-variant/20'}" data-id="${item.id}" data-idx="${idx}">
          <div class="flex items-center gap-stack-sm">
            <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container flex items-center justify-center ${isOwned ? 'opacity-40' : ''}">
              <span class="material-symbols-outlined text-outline text-xl">${getIconForItem(item.name)}</span>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-title-md ${isOwned ? 'text-on-surface-variant line-through' : 'text-on-surface'}">${item.name}</h3>
              <p class="text-[13px] text-on-surface-variant">${item.quantity}</p>
            </div>
            <!-- Trạng thái: Đã có sẵn / Cần mua -->
            <div class="flex items-center bg-surface-container-high rounded-xl p-0.5 gap-0.5 shadow-inner">
              <button class="cart-toggle-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isOwned ? 'bg-surface text-on-surface shadow-sm' : 'bg-primary text-on-primary shadow-sm'}" data-id="${item.id}" data-status="needed">
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">shopping_bag</span>
                  Cần mua
                </span>
              </button>
              <button class="cart-toggle-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isOwned ? 'bg-primary-container text-on-primary-container shadow-sm' : 'bg-transparent text-on-surface-variant hover:bg-surface-container-low'}" data-id="${item.id}" data-status="owned">
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">check</span>
                  Đã có
                </span>
              </button>
            </div>
          </div>
          ${!isOwned ? `
          <div class="flex items-center gap-2 mt-2 ml-[52px]">
            <div class="relative flex-1 max-w-36">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm font-semibold">đ</span>
              <input type="number" class="cart-price-input w-full pl-7 pr-2 py-2 bg-surface-container-low border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm outline-none transition-all"
                value="${item.price || ''}"
                placeholder="Nhập giá"
                data-id="${item.id}">
            </div>
            <button class="cart-remove-btn text-on-surface-variant hover:text-error transition-colors p-1" data-id="${item.id}" title="Xoá">
              <span class="material-symbols-outlined">remove_circle_outline</span>
            </button>
          </div>` : `
          <div class="flex items-center justify-between mt-2 ml-[52px]">
            <span class="text-xs text-on-surface-variant italic">✓ Đã có sẵn, không cần mua</span>
            <button class="cart-remove-btn text-on-surface-variant hover:text-error transition-colors p-1" data-id="${item.id}" title="Xoá">
              <span class="material-symbols-outlined">remove_circle_outline</span>
            </button>
          </div>`}
        </div>`;
    }).join('');

    // Attach events
    attachCartEvents();
    updateSummary();
  }

  function attachCartEvents() {
    // Set needed or owned (2 buttons per item, both have data-id + dataset.status)
    document.querySelectorAll('.cart-toggle-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const wrapper = this.closest('.cart-item-wrapper');
        const id = parseFloat(this.dataset.id);
        const wantedStatus = this.dataset.status;
        if (!wantedStatus) return; // fallback: toggle
        // Find the item and set the exact status wanted
        const item = MealPlan.state.cart.find(c => c.id === id);
        if (item && item.status !== wantedStatus) {
          item.status = wantedStatus;
          if (wantedStatus === 'owned') {
            // Clear price since it's already owned
            item.price = 0;
          }
          MealPlan.saveState();
          renderCart();
        }
      });
    });

    // Price input
    document.querySelectorAll('.cart-price-input').forEach(input => {
      input.addEventListener('input', function() {
        const id = parseFloat(this.dataset.id);
        const val = parseInt(this.value) || 0;
        MealPlan.updateCartItemPrice(id, val);
        updateSummary();
      });
    });

    // Remove
    document.querySelectorAll('.cart-remove-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = parseFloat(this.dataset.id);
        MealPlan.removeFromCart(id);
        renderCart();
      });
    });
  }

  function updateSummary(forcedNeeded, forcedSavings) {
    const summary = MealPlan.getCartSummary();

    const subtotal = forcedNeeded !== undefined ? forcedNeeded : summary.totalNeeded;
    const savings = forcedSavings !== undefined ? forcedSavings : summary.totalOwned;
    const total = subtotal;

    document.getElementById('cart-subtotal').textContent = MealPlan.formatCurrency(subtotal);
    document.getElementById('cart-savings').textContent = `-${MealPlan.formatCurrency(savings)}`;
    document.getElementById('cart-total').textContent = MealPlan.formatCurrency(total);

    // Update footer
    MealPlan.updateFooterCart();
  }

  function getIconForItem(name) {
    const map = [
      ['thịt', 'bò', 'gà', 'heo', 'lợn'], 'lunch_dining',
      ['cá', 'tôm'], 'set_meal',
      ['rau', 'xà lách', 'cải', 'bông', 'giá', 'rau thơm', 'húng', 'mùi', 'ngò'], 'eco',
      ['muối', 'tiêu', 'đường', 'nước mắm', 'hạt nêm', 'bột ngọt', 'bột canh', 'bột nghệ'], 'spa',
      ['mắm', 'tương', 'xì dầu', 'dầu hào', 'dầu mè', 'tương ớt', 'tương cà', 'rượu', 'giấm'], 'spa',
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
    ];

    const lower = name.toLowerCase();
    for (let i = 0; i < map.length; i += 2) {
      if (map[i].some(k => lower.includes(k))) return map[i + 1];
    }
    return 'inventory_2';
  }

  // Checkout
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cart-checkout')?.addEventListener('click', () => {
      const summary = MealPlan.getCartSummary();
      if (summary.items === 0) {
        MealPlan.showToast('Giỏ hàng trống!', 'warning');
        return;
      }

      // Build item breakdown
      const boughtItems = MealPlan.state.cart
        .filter(i => i.status === 'needed' && i.price > 0)
        .map(i => `${i.name} (${MealPlan.formatCurrency(i.price)})`);
      const itemSummary = boughtItems.length > 0 ? boughtItems.join(', ') : '';

      // Get dish name — use currentMealName if set, otherwise fallback
      const dishName = MealPlan.state.currentMealName || `Bữa ăn (${summary.items} món)`;

      // Add to history with full tracking
      MealPlan.state.history.unshift({
        id: MealPlan.generateId(),
        dishName: dishName,
        date: new Date().toLocaleDateString('vi-VN'),
        dateISO: new Date().toISOString(),
        calories: '--',
        cost: summary.totalNeeded,
        items: itemSummary,
        owned: MealPlan.state.cart.filter(i => i.status === 'owned').length,
        totalItems: summary.items,
        image: ''
      });

      // Reset current meal name
      MealPlan.state.currentMealName = '';

      // Clear cart
      MealPlan.clearCart();
      MealPlan.showToast(`Đã hoàn tất "${dishName}"!`, 'success');
      renderCart();
    });

    document.getElementById('cart-cancel')?.addEventListener('click', () => {
      MealPlan.clearCart();
      MealPlan.showToast('Đã huỷ giỏ hàng!', 'info');
      renderCart();
      MealPlan.navigate('home');
    });
  });

  // Expose for navigation refresh
  window.renderCart = renderCart;
})();
