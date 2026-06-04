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
        // Tự động phát hiện timer từ instruction
        let timerSeconds = 0;
        const timerMatch = text.match(/(\d+)\s*(phút|giây|s|min)/i);
        if (timerMatch) {
          const val = parseInt(timerMatch[1]);
          timerSeconds = timerMatch[2].match(/phút|min/i) ? val * 60 : val;
        }
        current = { number: steps.length + 1, instructions: [text], tip: '', timerSeconds };
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
        let timerSeconds = 0;
        const timerMatch = clean.match(/(\d+)\s*(phút|giây|s|min)/i);
        if (timerMatch) {
          const val = parseInt(timerMatch[1]);
          timerSeconds = timerMatch[2].match(/phút|min/i) ? val * 60 : val;
        }
        steps.push({ number: steps.length + 1, instructions: [clean], tip: '', timerSeconds });
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
      <div class="flex-shrink-0 bg-surface border-b border-outline-variant/20 px-3 py-2.5">
        <div class="flex items-center gap-2">
          <button class="cooking-back-btn p-0.5 -ml-1 rounded-lg hover:bg-surface-container-high transition-all" title="Thoát nấu">
            <span class="material-symbols-outlined text-on-surface">close</span>
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="font-title-md text-sm text-on-surface truncate">${dish.name}</h2>
          </div>
          <span id="cooking-step-indicator" class="text-xs text-on-surface-variant font-label-md bg-surface-container-high px-2 py-0.5 rounded-lg">1/${steps.length}</span>
        </div>
      </div>

      <!-- Progress Bar -->
      <div class="flex-shrink-0 px-3 py-1.5 bg-surface border-b border-outline-variant/10">
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
            <div id="cooking-progress-bar" class="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500" style="width: 0%"></div>
          </div>
          <span id="cooking-progress-text" class="text-[11px] text-on-surface-variant font-label-md whitespace-nowrap">1 / ${steps.length}</span>
        </div>
      </div>

      <!-- Scrollable Body -->
      <div class="flex-1 overflow-y-auto min-h-0" id="cooking-body">
        <div class="p-3 md:p-4 space-y-3">
          <!-- Current Step Card -->
          <div class="bg-primary-container/10 rounded-2xl border border-primary/10 overflow-hidden">
            <div class="p-4">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span id="cooking-step-number" class="text-white font-bold text-sm"></span>
                </div>
                <span class="text-sm text-on-surface-variant font-label-md">Bước <span id="cooking-step-current"></span> / ${steps.length}</span>
              </div>
              <div id="cooking-step-instructions" class="text-body-lg text-on-surface font-semibold leading-relaxed">
                <!-- Rendered by JS -->
              </div>
            </div>
          </div>

          <!-- Dùng ở bước này -->
          <div id="cooking-step-ingredients" class="bg-surface-container-low rounded-xl overflow-hidden border border-outline-variant/20 hidden">
            <div class="px-3 py-2.5 border-b border-outline-variant/20">
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
          <div id="cooking-tip" class="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 hidden">
            <div class="flex items-start gap-2.5">
              <span class="material-symbols-outlined text-amber-500 flex-shrink-0 text-lg">lightbulb</span>
              <p id="cooking-tip-text" class="text-sm text-amber-800 leading-relaxed"></p>
            </div>
          </div>

          <!-- Timer -->
          <div id="cooking-timer" class="bg-surface-container-low rounded-xl px-3 py-2.5 border border-outline-variant/20 hidden">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">timer</span>
                <span id="cooking-timer-display" class="font-title-md text-lg font-bold text-on-surface">00:00</span>
              </div>
              <div class="flex gap-2">
                <button id="cooking-timer-toggle" class="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-label-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-1">
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
      <div class="flex-shrink-0 border-t border-outline-variant/20 bg-surface px-3 py-2.5">
        <div class="flex gap-2">
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
    document.getElementById('cooking-progress-text').textContent = `${idx + 1} / ${state.steps.length}`;
    document.getElementById('cooking-step-indicator').textContent = `${idx + 1}/${state.steps.length}`;

    // Step number
    document.getElementById('cooking-step-number').textContent = idx + 1;
    document.getElementById('cooking-step-current').textContent = idx + 1;

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
      const existing = MealPlan.state.history.find(h => h.id === state.entryId);
      if (existing) {
        existing.status = 'cooked';
        existing.date = new Date().toLocaleDateString('vi-VN');
        existing.dateISO = new Date().toISOString();
      }
    } else {
      const entry = window.createHistoryEntry?.(state.dish, 'cooked');
      if (entry) MealPlan.state.history.unshift(entry);
    }

    MealPlan.state.currentMealName = '';
    MealPlan.saveState();

    // Đóng cooking mode → hiện Plating Guide
    closeCookingMode();
    showPlatingGuide(state.dish);
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

  // ===================== Plating Guide Overlay =====================

  function showPlatingGuide(dish) {
    const overlay = document.createElement('div');
    overlay.className = 'plating-overlay fixed inset-0 z-[350] bg-black/50 flex md:items-center justify-center animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-surface-container-lowest w-full max-h-[100dvh] md:max-h-[92vh] md:max-w-lg md:rounded-2xl md:mx-4 shadow-2xl flex flex-col animate-slide-up">
        <!-- Header -->
        <div class="flex-shrink-0 p-4 md:p-5 border-b border-outline-variant/20">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md">
                <span class="material-symbols-outlined text-white">palette</span>
              </div>
              <div>
                <h2 class="font-title-md text-on-surface">Trình bày món ăn</h2>
                <p class="text-xs text-on-surface-variant">Hướng dẫn bày trí chuyên nghiệp</p>
              </div>
            </div>
            <button class="plating-close p-1.5 rounded-full hover:bg-surface-container-high transition-all">
              <span class="material-symbols-outlined text-on-surface-variant">close</span>
            </button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto min-h-0 p-4 md:p-5">
          <!-- Loading -->
          <div id="plating-loading" class="text-center py-10">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p class="text-on-surface font-label-md mb-1">🎨 AI đang thiết kế cách bày trí...</p>
            <p class="text-xs text-on-surface-variant">Tạo sơ đồ trình bày cho ${dish.name}</p>
          </div>

          <!-- Result (hidden initially) -->
          <div id="plating-result" class="hidden space-y-4"></div>

          <!-- Error -->
          <div id="plating-error" class="hidden text-center py-8">
            <span class="material-symbols-outlined text-4xl text-error mb-3">palette</span>
            <p class="text-on-surface font-label-md">Không thể tạo hướng dẫn</p>
            <p class="text-xs text-on-surface-variant mt-1">Vui lòng thử lại sau</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex-shrink-0 p-4 md:p-5 border-t border-outline-variant/20 bg-surface-container-lowest flex gap-3">
          <button class="plating-retry flex-1 bg-primary text-on-primary py-3 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm hidden">
            <span class="material-symbols-outlined">refresh</span>
            Thử lại
          </button>
          <button class="plating-done w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white py-3 rounded-xl font-title-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg">
            <span class="material-symbols-outlined">check_circle</span>
            Đã xong!
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => {
      overlay.remove();
      MealPlan.navigate('cooking');
      if (window.renderCooking) window.renderCooking();
    };
    overlay.querySelector('.plating-close')?.addEventListener('click', close);
    overlay.querySelector('.plating-done')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Retry
    overlay.querySelector('.plating-retry')?.addEventListener('click', () => {
      overlay.querySelector('#plating-result').classList.add('hidden');
      overlay.querySelector('#plating-error').classList.add('hidden');
      overlay.querySelector('#plating-loading').classList.remove('hidden');
      overlay.querySelector('.plating-retry').classList.add('hidden');
      fetchPlatingGuide(dish, overlay);
    });

    // Fetch
    fetchPlatingGuide(dish, overlay);
  }

  async function fetchPlatingGuide(dish, overlay) {
    try {
      const res = await fetch('/api/plating-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dish })
      });
      const data = await res.json();

      if (data.success && data.plating) {
        renderPlatingGuide(data.plating, dish.name);
      } else {
        showPlatingError();
      }
    } catch (err) {
      console.error('Plating guide error:', err);
      showPlatingError();
    }
  }

  function showPlatingError() {
    const loading = document.getElementById('plating-loading');
    const result = document.getElementById('plating-result');
    const error = document.getElementById('plating-error');
    const retryBtn = document.querySelector('.plating-retry');
    if (loading) loading.classList.add('hidden');
    if (result) result.classList.add('hidden');
    if (error) error.classList.remove('hidden');
    if (retryBtn) retryBtn.classList.remove('hidden');
  }

  function renderPlatingGuide(plating, dishName) {
    const loading = document.getElementById('plating-loading');
    const result = document.getElementById('plating-result');
    const error = document.getElementById('plating-error');
    if (loading) loading.classList.add('hidden');
    if (error) error.classList.add('hidden');
    if (result) result.classList.remove('hidden');

    result.innerHTML = buildPlatingHTML(plating, dishName);
  }

  function buildPlatingHTML(p, dishName) {
    const layout = p.layout || 'round-plate';

    // Build SVG diagram based on layout
    const svgDiagram = buildLayoutSVG(p, layout);

    // Build step list
    const stepsHTML = (p.steps || []).map(s => {
      const color = s.color || '#888';
      return `
        <div class="flex items-start gap-3 group">
          <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-white font-bold text-sm shadow-sm" style="background:${color}">
            ${s.step}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <h4 class="font-label-md text-sm text-on-surface">${s.title}</h4>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">${s.position} · ${s.coverage}%</span>
            </div>
            <p class="text-xs text-on-surface-variant leading-relaxed">${s.detail}</p>
          </div>
        </div>
      `;
    }).join('');

    // Tips
    const tipsHTML = (p.tips || []).map(t => `
      <li class="flex items-start gap-2 text-xs text-on-surface-variant">
        <span class="text-amber-500 mt-0.5">✨</span>
        <span>${t}</span>
      </li>
    `).join('');

    // Mistakes
    const mistakesHTML = (p.commonMistakes || []).map(m => `
      <li class="flex items-start gap-2 text-xs text-on-surface-variant">
        <span class="text-error mt-0.5">⚠️</span>
        <span>${m}</span>
      </li>
    `).join('');

    return `
      <!-- Style & Plate -->
      <div class="flex items-center gap-3 bg-amber-50 rounded-xl p-3 border border-amber-200">
        <div class="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
          <span class="material-symbols-outlined text-amber-600">restaurant</span>
        </div>
        <div>
          <p class="font-label-md text-sm text-on-surface">${p.style || 'Phong cách Việt'}</p>
          <p class="text-xs text-on-surface-variant">${p.plateType || 'Đĩa trắng'} · ${dishName}</p>
        </div>
      </div>

      <!-- SVG Layout Diagram -->
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-outline-variant/20 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-primary">grid_on</span>
          <h4 class="font-label-md text-xs text-on-surface-variant uppercase tracking-wider">Sơ đồ bày trí</h4>
        </div>
        <div class="p-3 flex justify-center">
          ${svgDiagram}
        </div>
      </div>

      <!-- Step by step -->
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-outline-variant/20 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-primary">format_list_numbered</span>
          <h4 class="font-label-md text-xs text-on-surface-variant uppercase tracking-wider">Thứ tự bày trí</h4>
        </div>
        <div class="p-4 space-y-4">
          ${stepsHTML}
        </div>
      </div>

      <!-- Color Harmony -->
      ${p.colorHarmony ? `
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-outline-variant/20 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-purple-500">palette</span>
          <h4 class="font-label-md text-xs text-on-surface-variant uppercase tracking-wider">Phối màu</h4>
        </div>
        <div class="p-3">
          <p class="text-xs text-on-surface-variant leading-relaxed">${p.colorHarmony}</p>
        </div>
      </div>` : ''}

      <!-- Tips -->
      ${p.tips && p.tips.length > 0 ? `
      <div class="bg-amber-50/50 rounded-xl border border-amber-200/50 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-amber-200/40 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-amber-600">lightbulb</span>
          <h4 class="font-label-md text-xs text-amber-800 uppercase tracking-wider">Mẹo nhà hàng</h4>
        </div>
        <ul class="p-3 space-y-1.5">
          ${tipsHTML}
        </ul>
      </div>` : ''}

      <!-- Common Mistakes -->
      ${p.commonMistakes && p.commonMistakes.length > 0 ? `
      <div class="bg-red-50/50 rounded-xl border border-red-200/50 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-red-200/40 flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px] text-error">warning</span>
          <h4 class="font-label-md text-xs text-error uppercase tracking-wider">Tránh làm</h4>
        </div>
        <ul class="p-3 space-y-1.5">
          ${mistakesHTML}
        </ul>
      </div>` : ''}
    `;
  }

  // ── SVG Layout Diagram ───────────────────────────────────

  function buildLayoutSVG(p, layout) {
    const w = 300, h = layout === 'bowl' ? 220 : 260;

    if (layout === 'bowl') return buildBowlSVG(p, w, h);
    if (layout === 'layered-glass') return buildLayeredGlassSVG(p, w, h);
    return buildRoundPlateSVG(p, w, h);
  }

  function buildBowlSVG(p, w, h) {
    const cx = w / 2, cy = 90, rx = 130, ry = 90;
    const steps = p.steps || [];
    let svg = `<svg viewBox="0 0 ${w} ${h}" class="w-full max-w-[300px]">`;

    // Bowl shape
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fafaf9" stroke="#d1d5db" stroke-width="1.5"/>`;

    // Layers from bottom to top
    steps.sort((a,b) => a.step - b.step);
    steps.forEach((s, i) => {
      const color = s.color || '#888';
      const pos = s.position;
      const cov = (s.coverage || (i === steps.length - 1 ? 100 : 30));

      if (pos === 'bottom') {
        // Bottom layer — fills lower part
        const hFill = ry * 1.2 * cov / 100;
        svg += `<ellipse cx="${cx}" cy="${cy + ry - hFill/2}" rx="${rx * 0.85}" ry="${hFill/2}" fill="${color}" opacity="0.7"/>`;
      } else if (pos === 'all-over' && i === steps.length - 1) {
        // Broth — full bowl with transparency
        svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.92}" ry="${ry * 0.88}" fill="${color}" opacity="0.25"/>`;
      } else if (pos === 'top' || pos === 'center') {
        // Topping — upper partial area
        svg += `<ellipse cx="${cx}" cy="${cy - ry * 0.3}" rx="${rx * cov / 100}" ry="${ry * cov / 180}" fill="${color}" opacity="0.6"/>`;
        svg += `<ellipse cx="${cx - 15}" cy="${cy - ry * 0.35}" rx="${rx * 0.35}" ry="${ry * 0.3}" fill="${color}" opacity="0.5"/>`;
        svg += `<ellipse cx="${cx + 20}" cy="${cy - ry * 0.25}" rx="${rx * 0.3}" ry="${ry * 0.25}" fill="${color}" opacity="0.55"/>`;
      } else if (pos === 'all-over' && i < steps.length - 1) {
        // Sprinkles
        svg += `<circle cx="${cx - 30}" cy="${cy - ry * 0.3}" r="5" fill="${color}" opacity="0.7"/>`;
        svg += `<circle cx="${cx + 25}" cy="${cy - ry * 0.15}" r="4" fill="${color}" opacity="0.6"/>`;
        svg += `<circle cx="${cx}" cy="${cy - ry * 0.4}" r="6" fill="${color}" opacity="0.7"/>`;
        svg += `<circle cx="${cx + 40}" cy="${cy - ry * 0.35}" r="4" fill="${color}" opacity="0.5"/>`;
        svg += `<circle cx="${cx - 45}" cy="${cy - ry * 0.1}" r="3" fill="${color}" opacity="0.6"/>`;
      }
    });

    // Step labels with leader lines
    steps.forEach((s, i) => {
      if (s.position === 'bottom') {
        svg += `<text x="${cx}" y="${cy + ry + 18}" text-anchor="middle" fill="#555" font-size="9" font-weight="600">① ${s.title}</text>`;
      } else if (s.position === 'top' || s.position === 'center') {
        svg += `<text x="${cx - 45}" y="${cy - ry + 12}" text-anchor="start" fill="#555" font-size="9" font-weight="600">② ${s.title}</text>`;
      }
    });

    svg += `</svg>`;
    return svg;
  }

  function buildRoundPlateSVG(p, w, h) {
    const cx = w / 2, cy = h / 2 + 10, r = 135;
    const steps = p.steps || [];
    let svg = `<svg viewBox="0 0 ${w} ${h}" class="w-full max-w-[300px]">`;

    // Plate
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fafaf9" stroke="#d1d5db" stroke-width="1.5"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="none" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4 4"/>`;

    steps.forEach(s => {
      const color = s.color || '#888';
      const pos = s.position;
      const cov = s.coverage || 30;

      if (pos === 'left') {
        // Left side — rice/carb area
        const areaRx = r * 0.55, areaRy = r * 0.7;
        svg += `<ellipse cx="${cx - r * 0.28}" cy="${cy}" rx="${areaRx}" ry="${areaRy}" fill="${color}" opacity="0.8"/>`;
        svg += `<text x="${cx - r * 0.28}" y="${cy + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">①</text>`;
      } else if (pos === 'right') {
        // Right side — meat/topping
        const areaRx = r * 0.45, areaRy = r * 0.55;
        svg += `<ellipse cx="${cx + r * 0.22}" cy="${cy - r * 0.1}" rx="${areaRx}" ry="${areaRy}" fill="${color}" opacity="0.75"/>`;
        svg += `<text x="${cx + r * 0.22}" y="${cy - r * 0.1 + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">②</text>`;
      } else if (pos === 'left right' || pos.includes('right')) {
        // Garnish around
        svg += `<circle cx="${cx - r * 0.5}" cy="${cy + r * 0.35}" r="${r * 0.15}" fill="${color}" opacity="0.6"/>`;
        svg += `<circle cx="${cx + r * 0.55}" cy="${cy + r * 0.3}" r="${r * 0.13}" fill="${color}" opacity="0.55"/>`;
        svg += `<text x="${cx + r * 0.55}" y="${cy + r * 0.3 + 4}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">③</text>`;
      } else if (pos === 'top') {
        // Garnish/topping
        svg += `<circle cx="${cx + r * 0.25}" cy="${cy - r * 0.45}" r="${r * 0.12}" fill="${color}" opacity="0.5"/>`;
        svg += `<circle cx="${cx - r * 0.2}" cy="${cy - r * 0.5}" r="${r * 0.1}" fill="${color}" opacity="0.45"/>`;
        svg += `<text x="${cx + r * 0.25}" y="${cy - r * 0.45 + 4}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">④</text>`;
      } else if (pos === 'center') {
        // Center main dish
        svg += `<ellipse cx="${cx}" cy="${cy}" rx="${r * cov / 100}" ry="${r * cov * 0.7 / 100}" fill="${color}" opacity="0.8"/>`;
        svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">${steps.indexOf(s)+1}</text>`;
      } else if (pos === 'bottom') {
        svg += `<rect x="${cx - r * 0.5}" y="${cy + r * 0.3}" width="${r}" height="${r * 0.2}" rx="6" fill="${color}" opacity="0.55"/>`;
      } else if (pos === 'all-over') {
        svg += `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="3" fill="${color}" opacity="0.6"/>`;
        svg += `<circle cx="${cx + r * 0.4}" cy="${cy - r * 0.3}" r="2.5" fill="${color}" opacity="0.5"/>`;
        svg += `<circle cx="${cx + r * 0.1}" cy="${cy - r * 0.55}" r="3.5" fill="${color}" opacity="0.65"/>`;
        svg += `<circle cx="${cx - r * 0.5}" cy="${cy - r * 0.1}" r="2" fill="${color}" opacity="0.5"/>`;
        svg += `<circle cx="${cx + r * 0.55}" cy="${cy - r * 0.5}" r="3" fill="${color}" opacity="0.55"/>`;
      }
    });

    // Legend
    svg += `<text x="${cx}" y="${cy + r + 20}" text-anchor="middle" fill="#888" font-size="9">Đĩa sứ trắng · ${p.plateType || ''}</text>`;

    svg += `</svg>`;
    return svg;
  }

  function buildLayeredGlassSVG(p, w, h) {
    const cx = w / 2, cy = h - 30, topW = 140, botW = 80, glassH = 180;
    const steps = p.steps || [];
    let svg = `<svg viewBox="0 0 ${w} ${h}" class="w-full max-w-[280px]">`;

    // Glass bowl shape (trapezoid)
    const topY = cy - glassH;
    const points = `${cx - topW/2},${topY} ${cx + topW/2},${topY} ${cx + botW/2},${cy} ${cx - botW/2},${cy}`;
    svg += `<polygon points="${points}" fill="rgba(255,255,255,0.3)" stroke="#d1d5db" stroke-width="1.5"/>`;

    // Layers from bottom to top
    const layerCount = Math.min(steps.length, 5);
    const layerH = (glassH - 10) / layerCount;

    steps.slice(0, 5).forEach((s, i) => {
      const color = s.color || '#888';
      const y = topY + glassH - (i + 1) * layerH;
      const frac = 1 - i / layerCount;
      const lw = botW + (topW - botW) * frac;
      svg += `<rect x="${cx - lw/2}" y="${y}" width="${lw}" height="${layerH - 1}" fill="${color}" opacity="0.75" rx="2"/>`;
      if (s.title.length < 15) {
        svg += `<text x="${cx}" y="${y + layerH/2 + 3}" text-anchor="middle" fill="#fff" font-size="8" font-weight="600">${s.title}</text>`;
      }
    });

    // Labels on the side
    steps.slice(0, 4).forEach((s, i) => {
      const y = topY + glassH - (i + 0.5) * layerH;
      svg += `<text x="${cx - topW/2 - 8}" y="${y + 3}" text-anchor="end" fill="#666" font-size="8" font-weight="600">${s.step}</text>`;
    });

    svg += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="#888" font-size="9">Bát thủy tinh · nhìn từ bên hông</text>`;
    svg += `</svg>`;
    return svg;
  }

  // ===================== Expose =====================

  window.openCookingMode = openCookingMode;
  window.showPlatingGuide = showPlatingGuide;

})();
