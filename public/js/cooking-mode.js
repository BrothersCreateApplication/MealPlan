// ===================== Cooking Mode (Step-by-Step) =====================

(function() {

  let cookingState = null; // { steps, currentStep, dish, entryId, timerRemaining, timerInterval }

  // ---- Parse instructions thành steps ----
  function parseSteps(dish) {
    const raw = dish.instructions || '';
    // Xử lý cả newline thật \n và literal "\n"
    const normalized = raw.replace(/\\n/g, '\n');
    const lines = normalized.split('\n').filter(l => l.trim());

    // Dùng regex phát hiện "1. ...", "1) ...", "Bước 1: ..."
    const stepHeaderRe = /^(\d+)[\.\)]\s*(.*)|^Bước\s*(\d+)[:\s]*(.*)/i;
    const steps = [];
    let current = null;

    for (const line of lines) {
      const m = line.match(stepHeaderRe);
      if (m) {
        if (current) steps.push(current);
        const text = (m[2] || m[4] || line).trim();
        current = { number: steps.length + 1, instructions: [text], tip: '', timerSeconds: 0 };
      } else if (current) {
        const clean = line.trim();
        if (clean.includes('💡') || clean.toLowerCase().includes('mẹo')) {
          const tipText = clean.replace(/^💡\s*/i, '').replace(/^Mẹo[:\s]*/i, '').trim();
          if (tipText) current.tip = tipText;
        } else {
          current.instructions.push(clean);
        }
      }
    }
    if (current) steps.push(current);

    // Fallback: không có số thứ tự → mỗi dòng là 1 bước
    if (steps.length === 0 && lines.length > 0) {
      lines.forEach(line => {
        const clean = line.replace(/^💡\s*/i, '').replace(/^Mẹo[:\s]*/i, '').trim();
        if (!clean) return;
        if (line.includes('💡') || line.toLowerCase().includes('mẹo')) {
          if (steps.length > 0) steps[steps.length - 1].tip = clean;
          return;
        }
        steps.push({ number: steps.length + 1, instructions: [clean], tip: '', timerSeconds: 0 });
      });
    }

    // Phân phối ingredients đều cho các steps (nếu dish có ingredients)
    const ings = dish.ingredients || [];
    if (ings.length > 0 && steps.length > 0) {
      const perStep = Math.ceil(ings.length / steps.length);
      steps.forEach((step, idx) => {
        step.ingredients = ings.slice(idx * perStep, (idx + 1) * perStep);
      });
    } else {
      steps.forEach(s => s.ingredients = []);
    }

    return steps;
  }

  // ---- Cooking Mode Overlay ----
  function openCookingMode(dish, entryId) {
    const steps = parseSteps(dish);
    if (steps.length === 0) {
      MealPlan.showToast('Không có hướng dẫn nấu!', 'warning');
      return;
    }

    // Xoá overlay cũ nếu có
    document.querySelector('.cooking-mode-overlay')?.remove();

    cookingState = {
      steps,
      currentStep: 0,
      dish,
      entryId,
      timerRemaining: 0,
      timerInterval: null,
      completedSteps: []
    };

    // HTML overlay — full-screen mobile, modal desktop
    const overlay = document.createElement('div');
    overlay.className = 'cooking-mode-overlay fixed inset-0 z-[300] bg-surface flex flex-col animate-fade-in';
    overlay.innerHTML = `
      <!-- Top Bar -->
      <div class="flex-shrink-0 bg-surface border-b border-outline-variant/20 px-4 py-3">
        <div class="flex items-center gap-2">
          <button class="cooking-back-btn p-1 -ml-1 rounded-lg hover:bg-surface-container-high transition-all" title="Thoát nấu">
            <span class="material-symbols-outlined text-on-surface">close</span>
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="font-title-md text-sm text-on-surface truncate">${dish.name}</h2>
            <p class="text-[11px] text-on-surface-variant">${dish.time || '--'} • ${dish.calories || '--'}</p>
          </div>
          <span id="cooking-step-indicator" class="text-xs text-on-surface-variant font-label-md bg-surface-container-high px-2 py-1 rounded-lg">1/${steps.length}</span>
        </div>
      </div>

      <!-- Progress Bar -->
      <div class="flex-shrink-0 px-4 py-2 bg-surface border-b border-outline-variant/10">
        <div class="flex items-center gap-3">
          <div class="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div id="cooking-progress-bar" class="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500" style="width: 0%"></div>
          </div>
          <span id="cooking-progress-text" class="text-xs text-on-surface-variant font-label-md whitespace-nowrap">Bước 1 / ${steps.length}</span>
        </div>
      </div>

      <!-- Scrollable Body -->
      <div class="flex-1 overflow-y-auto min-h-0" id="cooking-body">
        <div class="p-4 space-y-4">
          <!-- Current Step Card -->
          <div id="cooking-step-card" class="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/20 overflow-hidden">
            <div class="p-5">
              <div id="cooking-step-instructions" class="text-body-lg text-on-surface font-semibold leading-relaxed space-y-2">
                <!-- Rendered by JS -->
              </div>
            </div>
          </div>

          <!-- Dùng ở bước này -->
          <div id="cooking-step-ingredients" class="bg-surface-container-low rounded-xl overflow-hidden border border-outline-variant/20 hidden">
            <div class="px-4 py-3 border-b border-outline-variant/20">
              <h4 class="font-label-md text-xs text-on-surface-variant flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[16px]">checklist</span>
                Dùng ở bước này
              </h4>
            </div>
            <div class="divide-y divide-outline-variant/10" id="cooking-ingredients-list">
              <!-- Rendered by JS -->
            </div>
          </div>

          <!-- Tip -->
          <div id="cooking-tip" class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 hidden">
            <div class="flex items-start gap-2.5">
              <span class="material-symbols-outlined text-amber-500 flex-shrink-0 text-xl">lightbulb</span>
              <p id="cooking-tip-text" class="text-sm text-amber-800 leading-relaxed"></p>
            </div>
          </div>

          <!-- Timer -->
          <div id="cooking-timer" class="bg-surface-container-low rounded-xl px-4 py-3 border border-outline-variant/20 hidden">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">timer</span>
                <span id="cooking-timer-display" class="font-title-md text-lg font-bold text-on-surface">00:00</span>
              </div>
              <div class="flex gap-2">
                <button id="cooking-timer-toggle" class="bg-primary text-on-primary px-4 py-1.5 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px]">play_arrow</span>
                  <span>Bắt đầu</span>
                </button>
                <button id="cooking-timer-reset" class="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-xs font-label-md hover:bg-surface-container-high transition-all hidden">
                  <span class="material-symbols-outlined text-[16px]">refresh</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div class="flex-shrink-0 border-t border-outline-variant/20 bg-surface px-4 py-3">
        <div class="flex gap-3">
          <button id="cooking-prev-btn" class="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md hover:bg-surface-container-high active:scale-[0.98] transition-all disabled:opacity-30 disabled:pointer-events-none">
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
            Quay lại
          </button>
          <button id="cooking-next-btn" class="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-primary text-on-primary font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-sm">
            Tiếp theo
            <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
          <button id="cooking-done-btn" class="flex-1 hidden items-center justify-center gap-1.5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-title-md hover:opacity-90 active:scale-[0.98] transition-all shadow-sm">
            <span class="material-symbols-outlined text-[18px]">check_circle</span>
            Hoàn thành
          </button>
        </div>
      </div>

      <!-- Bottom Utilities -->
      <div class="flex-shrink-0 border-t border-outline-variant/20 bg-surface px-4 py-2">
        <div class="flex justify-around">
          <button id="cooking-util-ingredients" class="flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg hover:bg-surface-container-high transition-all text-on-surface-variant">
            <span class="material-symbols-outlined text-xl">shopping_basket</span>
            <span class="text-[10px] font-label-md">Nguyên liệu</span>
          </button>
          <button id="cooking-util-steps" class="flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg hover:bg-surface-container-high transition-all text-on-surface-variant">
            <span class="material-symbols-outlined text-xl">menu_book</span>
            <span class="text-[10px] font-label-md">Tất cả bước</span>
          </button>
          <button id="cooking-util-tts" class="flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg hover:bg-surface-container-high transition-all text-on-surface-variant">
            <span class="material-symbols-outlined text-xl">volume_up</span>
            <span class="text-[10px] font-label-md">Đọc lại</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden'; // Prevent background scroll

    // ---- Render step ----
    renderStep(0);

    // ---- Attach events ----
    overlay.querySelector('#cooking-prev-btn').addEventListener('click', goToPrevStep);
    overlay.querySelector('#cooking-next-btn').addEventListener('click', goToNextStep);
    overlay.querySelector('#cooking-done-btn').addEventListener('click', handleComplete);
    overlay.querySelector('.cooking-back-btn').addEventListener('click', handleExit);

    overlay.querySelector('#cooking-timer-toggle').addEventListener('click', toggleTimer);
    overlay.querySelector('#cooking-timer-reset').addEventListener('click', resetTimer);

    overlay.querySelector('#cooking-util-ingredients').addEventListener('click', showIngredientsPanel);
    overlay.querySelector('#cooking-util-steps').addEventListener('click', showAllStepsPanel);
    overlay.querySelector('#cooking-util-tts').addEventListener('click', speakCurrentStep);
  }

  // ===================== Step Rendering =====================

  function renderStep(idx) {
    const state = cookingState;
    if (!state) return;
    const step = state.steps[idx];
    if (!step) return;

    state.currentStep = idx;

    // Progress bar
    const progress = ((idx + 1) / state.steps.length) * 100;
    document.getElementById('cooking-progress-bar').style.width = progress + '%';
    document.getElementById('cooking-progress-text').textContent = `Bước ${idx + 1} / ${state.steps.length}`;
    document.getElementById('cooking-step-indicator').textContent = `${idx + 1}/${state.steps.length}`;

    // Instructions
    const instEl = document.getElementById('cooking-step-instructions');
    if (step.instructions.length > 0) {
      instEl.innerHTML = step.instructions.map(line =>
        `<p class="text-[18px] text-on-surface leading-relaxed font-semibold">${line}</p>`
      ).join('');
    } else {
      instEl.innerHTML = '<p class="text-[18px] text-on-surface-variant italic">Không có hướng dẫn chi tiết</p>';
    }

    // Ingredients per step
    const ingSection = document.getElementById('cooking-step-ingredients');
    const ingList = document.getElementById('cooking-ingredients-list');
    if (step.ingredients && step.ingredients.length > 0) {
      ingSection.classList.remove('hidden');
      ingList.innerHTML = step.ingredients.map(ing => `
        <div class="flex items-center justify-between px-4 py-2.5">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
            <span class="text-sm font-label-md text-on-surface">${ing.name}</span>
          </div>
          <span class="text-xs text-on-surface-variant">${ing.quantity || ''}</span>
        </div>
      `).join('');
    } else {
      ingSection.classList.add('hidden');
    }

    // Tip
    const tipEl = document.getElementById('cooking-tip');
    const tipText = document.getElementById('cooking-tip-text');
    if (step.tip) {
      tipEl.classList.remove('hidden');
      tipText.textContent = step.tip;
    } else {
      tipEl.classList.add('hidden');
    }

    // Timer
    const timerEl = document.getElementById('cooking-timer');
    if (step.timerSeconds > 0) {
      timerEl.classList.remove('hidden');
      cookingState.timerRemaining = step.timerSeconds;
      updateTimerDisplay();
      document.getElementById('cooking-timer-toggle').classList.remove('hidden');
      document.getElementById('cooking-timer-reset').classList.add('hidden');
    } else {
      timerEl.classList.add('hidden');
    }

    // Bottom buttons
    document.getElementById('cooking-prev-btn').classList.toggle('hidden', idx === 0);
    document.getElementById('cooking-next-btn').classList.toggle('hidden', idx === state.steps.length - 1);
    document.getElementById('cooking-done-btn').classList.toggle('hidden', idx !== state.steps.length - 1);

    // Scroll lên đầu
    document.getElementById('cooking-body')?.scrollTo({ top: 0, behavior: 'smooth' });

    // TTS đọc step mới
    speakStepText(step);
  }

  // ---- Navigation ----
  function goToPrevStep() {
    if (!cookingState || cookingState.currentStep <= 0) return;
    renderStep(cookingState.currentStep - 1);
  }

  function goToNextStep() {
    if (!cookingState) return;
    if (cookingState.currentStep < cookingState.steps.length - 1) {
      // Đánh dấu step hiện tại đã hoàn thành
      if (!cookingState.completedSteps.includes(cookingState.currentStep)) {
        cookingState.completedSteps.push(cookingState.currentStep);
      }
      renderStep(cookingState.currentStep + 1);
    }
  }

  // ===================== Timer =====================

  function toggleTimer() {
    if (!cookingState) return;
    const btn = document.getElementById('cooking-timer-toggle');
    if (cookingState.timerInterval) {
      // Pause
      clearInterval(cookingState.timerInterval);
      cookingState.timerInterval = null;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">play_arrow</span> Tiếp tục';
    } else {
      // Start/Resume
      if (cookingState.timerRemaining <= 0) return;
      cookingState.timerInterval = setInterval(() => {
        cookingState.timerRemaining--;
        updateTimerDisplay();
        if (cookingState.timerRemaining <= 0) {
          clearInterval(cookingState.timerInterval);
          cookingState.timerInterval = null;
          btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span> Hết giờ!';
          MealPlan.showToast('⏰ Hết giờ!', 'info', 3000);
          document.getElementById('cooking-timer-reset')?.classList.remove('hidden');
        }
      }, 1000);
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">pause</span> Tạm dừng';
    }
  }

  function resetTimer() {
    if (!cookingState) return;
    if (cookingState.timerInterval) {
      clearInterval(cookingState.timerInterval);
      cookingState.timerInterval = null;
    }
    const step = cookingState.steps[cookingState.currentStep];
    cookingState.timerRemaining = step.timerSeconds;
    updateTimerDisplay();
    const btn = document.getElementById('cooking-timer-toggle');
    btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">play_arrow</span> Bắt đầu';
    document.getElementById('cooking-timer-reset')?.classList.add('hidden');
  }

  function updateTimerDisplay() {
    const rem = cookingState?.timerRemaining || 0;
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    document.getElementById('cooking-timer-display').textContent =
      String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ===================== Panel: Nguyên liệu (bottom sheet) =====================

  function showIngredientsPanel() {
    const state = cookingState;
    if (!state) return;
    const ings = state.dish.ingredients || [];
    if (ings.length === 0) {
      MealPlan.showToast('Không có nguyên liệu!', 'info');
      return;
    }

    // Phân loại theo bước hiện tại
    const stepIdx = state.currentStep;
    const totalSteps = state.steps.length;
    const perStep = Math.max(1, Math.ceil(ings.length / totalSteps));

    const done = ings.slice(0, stepIdx * perStep);          // đã dùng
    const current = ings.slice(stepIdx * perStep, (stepIdx + 1) * perStep); // đang dùng
    const upcoming = ings.slice((stepIdx + 1) * perStep);   // sắp dùng

    const existing = document.querySelector('.cooking-panel-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'cooking-panel-overlay fixed inset-0 z-[350] bg-black/50 flex items-end justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full max-w-lg rounded-t-2xl shadow-2xl animate-slide-up max-h-[70vh] flex flex-col">
        <div class="flex-shrink-0 px-5 py-4 border-b border-outline-variant/20">
          <div class="flex items-center justify-between">
            <h3 class="font-title-md text-on-surface font-semibold flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">shopping_basket</span>
              Nguyên liệu
            </h3>
            <button class="panel-close-btn p-1 rounded-full hover:bg-surface-container-high transition-all">
              <span class="material-symbols-outlined text-on-surface-variant">close</span>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          ${done.length > 0 ? `
          <div>
            <p class="font-label-md text-xs text-emerald-600 mb-2 flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]">check_circle</span>
              Đã dùng (${done.length})
            </p>
            ${done.map(ing => `
              <div class="flex items-center justify-between px-3 py-2 bg-surface-container-low rounded-lg mb-1 opacity-60">
                <span class="text-sm text-on-surface line-through">${ing.name}</span>
                <span class="text-xs text-on-surface-variant">${ing.quantity || ''}</span>
              </div>
            `).join('')}
          </div>` : ''}
          <div>
            <p class="font-label-md text-xs text-primary mb-2 flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL'1">play_arrow</span>
              Đang dùng (${current.length})
            </p>
            ${current.map(ing => `
              <div class="flex items-center justify-between px-3 py-2.5 bg-primary-container/20 rounded-lg mb-1 border border-primary/20">
                <span class="text-sm font-label-md text-on-surface">${ing.name}</span>
                <span class="text-xs text-on-surface-variant">${ing.quantity || ''}</span>
              </div>
            `).join('')}
          </div>
          ${upcoming.length > 0 ? `
          <div>
            <p class="font-label-md text-xs text-on-surface-variant mb-2 flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]">schedule</span>
              Sắp dùng (${upcoming.length})
            </p>
            ${upcoming.map(ing => `
              <div class="flex items-center justify-between px-3 py-2 bg-surface-container-low rounded-lg mb-1">
                <span class="text-sm text-on-surface-variant">${ing.name}</span>
                <span class="text-xs text-on-surface-variant">${ing.quantity || ''}</span>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('.panel-close-btn').forEach(el => el.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // ===================== Panel: Tất cả bước (bottom sheet) =====================

  function showAllStepsPanel() {
    const state = cookingState;
    if (!state) return;

    const existing = document.querySelector('.cooking-panel-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'cooking-panel-overlay fixed inset-0 z-[350] bg-black/50 flex items-end justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full max-w-lg rounded-t-2xl shadow-2xl animate-slide-up max-h-[70vh] flex flex-col">
        <div class="flex-shrink-0 px-5 py-4 border-b border-outline-variant/20">
          <div class="flex items-center justify-between">
            <h3 class="font-title-md text-on-surface font-semibold flex items-center gap-2">
              <span class="material-symbols-outlined text-secondary">menu_book</span>
              Tất cả bước
            </h3>
            <button class="panel-close-btn p-1 rounded-full hover:bg-surface-container-high transition-all">
              <span class="material-symbols-outlined text-on-surface-variant">close</span>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-5 space-y-1">
          ${state.steps.map((step, idx) => {
            const isCurrent = idx === state.currentStep;
            const isDone = state.completedSteps.includes(idx);
            let statusIcon, statusColor, bg;
            if (isDone) {
              statusIcon = 'check_circle';
              statusColor = 'text-emerald-600';
              bg = 'bg-emerald-50 border-emerald-200';
            } else if (isCurrent) {
              statusIcon = 'play_arrow';
              statusColor = 'text-primary';
              bg = 'bg-primary-container/10 border-primary/30';
            } else {
              statusIcon = 'radio_button_unchecked';
              statusColor = 'text-outline';
              bg = 'bg-surface-container-low';
            }
            return `
              <div class="flex items-center gap-3 px-3 py-2.5 rounded-xl border ${bg} transition-all cursor-pointer hover:brightness-95 step-item" data-step="${idx}">
                <span class="material-symbols-outlined ${statusColor} text-xl">${statusIcon}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-label-md text-on-surface ${isDone ? 'line-through opacity-60' : ''}">${step.instructions[0]?.slice(0, 50) || `Bước ${idx + 1}`}</p>
                  <p class="text-xs text-on-surface-variant truncate">${step.instructions[0] || ''}</p>
                </div>
                <span class="text-xs text-on-surface-variant">B${idx + 1}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('.panel-close-btn').forEach(el => el.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Click vào step → chuyển đến step đó + đóng panel
    overlay.querySelectorAll('.step-item').forEach(el => {
      el.addEventListener('click', () => {
        const stepIdx = parseInt(el.dataset.step);
        if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx < cookingState.steps.length) {
          renderStep(stepIdx);
          overlay.remove();
        }
      });
    });
  }

  // ===================== Text-to-Speech =====================

  function speakStepText(step) {
    // Không tự động đọc — user bấm nút "Đọc lại" mới đọc
  }

  function speakCurrentStep() {
    if (!cookingState) return;
    const step = cookingState.steps[cookingState.currentStep];
    if (!step) return;

    const text = `Bước ${step.number}: ` +
      step.instructions.join('. ') +
      (step.tip ? `. Mẹo: ${step.tip}` : '');

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } else {
      MealPlan.showToast('Trình duyệt không hỗ trợ đọc', 'warning');
    }
  }

  // ===================== Complete & Exit =====================

  function handleComplete() {
    const state = cookingState;
    if (!state) return;

    // Đánh dấu step cuối đã hoàn thành
    if (!state.completedSteps.includes(state.currentStep)) {
      state.completedSteps.push(state.currentStep);
    }

    if (state.entryId) {
      // Cập nhật entry cũ (shopped → cooked)
      const existing = MealPlan.state.history.find(h => h.id === state.entryId);
      if (existing) {
        existing.status = 'cooked';
        existing.date = new Date().toLocaleDateString('vi-VN');
        existing.dateISO = new Date().toISOString();
      }
    } else {
      // Tạo entry mới
      const entry = window.createHistoryEntry?.(state.dish, 'cooked');
      if (entry) MealPlan.state.history.unshift(entry);
    }

    MealPlan.state.currentMealName = '';
    MealPlan.saveState();
    closeCookingMode();
    MealPlan.showToast(`🎉 Đã nấu xong "${state.dish.name}"!`, 'success', 4000);
    // Chuyển sang tab Nấu ăn để thấy trạng thái Đã nấu
    MealPlan.navigate('cooking');
    if (window.renderCooking) window.renderCooking();
  }

  function handleExit() {
    if (!cookingState) return closeCookingMode();

    // Nếu đang ở bước đầu và chưa hoàn thành bước nào, không confirm
    if (cookingState.currentStep === 0 && cookingState.completedSteps.length === 0) {
      closeCookingMode();
      return;
    }

    MealPlan.showConfirm('Bạn có chắc muốn thoát? Tiến trình nấu sẽ không được lưu.', 'Thoát nấu ăn')
      .then(confirmed => {
        if (confirmed) closeCookingMode();
      });
  }

  function closeCookingMode() {
    if (cookingState?.timerInterval) {
      clearInterval(cookingState.timerInterval);
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    cookingState = null;
    document.querySelector('.cooking-mode-overlay')?.remove();
    document.body.style.overflow = '';
  }

  // ===================== Expose =====================

  window.openCookingMode = openCookingMode;

})();
