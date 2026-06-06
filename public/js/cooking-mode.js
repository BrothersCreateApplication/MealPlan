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

    // Fallback cuối: nếu chỉ có 1 dòng nhưng nhiều câu → tách bằng dấu câu
    if (steps.length === 1 && lines.length <= 2) {
      const text = steps[0].instructions.join(' ');
      // Tách bằng dấu chấm, chấm than, chấm hỏi, chấm phẩy
      const sentences = text.split(/(?<=[.!?;])\s+/).filter(s => s.trim().length > 5);
      if (sentences.length > 1) {
        steps.length = 0;
        sentences.forEach(s => {
          const clean = s.trim();
          if (!clean) return;
          let timerSeconds = 0;
          const timerMatch = clean.match(/(\d+)\s*(phút|giây|s|min)/i);
          if (timerMatch) {
            const val = parseInt(timerMatch[1]);
            timerSeconds = timerMatch[2].match(/phút|min/i) ? val * 60 : val;
          }
          steps.push({
            number: steps.length + 1,
            instructions: [clean],
            tip: '',
            timerSeconds,
            ingredients: []
          });
        });
      }
    }

    // Phân phối ingredients dựa trên nội dung từng bước thay vì chia đều
    const ings = dish.ingredients || [];
    if (ings.length > 0 && steps.length > 0) {
      const stepIngs = matchIngredientsToSteps(ings, steps);
      steps.forEach((step, idx) => {
        step.ingredients = stepIngs[idx] || [];
      });
    } else {
      steps.forEach(s => s.ingredients = []);
    }

    return steps;
  }

  // ---- Ghép nguyên liệu với bước nấu dựa trên nội dung text ----
  function matchIngredientsToSteps(ings, steps) {
    const results = steps.map(() => []);
    const matchedAnywhere = new Set(); // index nguyên liệu có match ít nhất 1 bước

    // Tách tên nguyên liệu thành các từ khoá
        function getKeyWords(name) {
      const stopWords = ['và', 'của', 'cho', 'với', 'các', 'một', 'những', 'đã', 'đang', 'vào', 'ra'];
      return name.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 2 && !stopWords.includes(w));
    }

    // Escape special regex characters
    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function ingredientMatchesStep(ing, stepText) {
      const name = ing.name.toLowerCase();
      // Full name match
      if (name.length >= 2 && stepText.includes(name)) return true;
      // Keyword match (ten ghep nhu "ca loc" match "ca")
      const keywords = getKeyWords(name);
      if (keywords.length > 1) {
        for (const kw of keywords) {
          try {
            const escaped = escapeRegex(kw);
            const regex = new RegExp('(^|[\\s,.;:!?\'"])' + escaped + '([\\s,.;:!?\'"]|$)', 'i');
            if (regex.test(stepText)) return true;
          } catch (e) {
            // Skip invalid regex
          }
        }
      }
      return false;
    }

    // Match tất cả nguyên liệu vào từng bước dựa trên nội dung
    steps.forEach((step, idx) => {
      const stepText = (step.instructions || []).join(' ').toLowerCase();
      ings.forEach((ing, i) => {
        // Tránh push trùng trong cùng 1 bước
        if (results[idx].some(existing => existing.name === ing.name)) return;
        if (ingredientMatchesStep(ing, stepText)) {
          results[idx].push(ing);
          matchedAnywhere.add(i);
        }
      });
    });

    // Fallback: nguyên liệu không match được chỗ nào — cho vào bước đầu tiên
    const remaining = [];
    ings.forEach((ing, i) => {
      if (!matchedAnywhere.has(i)) remaining.push({ ing, i });
    });
    if (remaining.length > 0) {
      const perStep = Math.max(1, Math.ceil(remaining.length / steps.length));
      remaining.forEach((item, idx) => {
        const targetStep = Math.min(Math.floor(idx / perStep), steps.length - 1);
        results[targetStep].push(item.ing);
      });
    }

    return results;
  }

  // ---- Cooking Mode Overlay ----
  function openCookingMode(dish, entryId) {
    // Kiểm tra dish hợp lệ
    if (!dish || !dish.name) {
      console.error('[CookingMode] Invalid dish data:', dish);
      MealPlan.showToast('Không tìm thấy thông tin món ăn!', 'error');
      return;
    }

    // Parse steps; fallback nếu không parse được
    let steps;
    try {
      steps = parseSteps(dish);
    } catch (err) {
      console.error('[CookingMode] parseSteps error:', err);
      steps = [];
    }
    if (!steps || steps.length === 0) {
      const raw = (dish.instructions || '').replace(/\\n/g, '\n').trim();
      if (raw) {
        // Fallback: gom toàn bộ instructions vào 1 step duy nhất
        steps = [{
          number: 1,
          instructions: raw.split('\n').filter(l => l.trim()),
          tip: '',
          timerSeconds: 0,
          ingredients: dish.ingredients || []
        }];
      } else {
        // Thực sự không có hướng dẫn — tạo step mặc định
        steps = [{
          number: 1,
          instructions: ['Bắt đầu nấu ăn nào! Không có hướng dẫn chi tiết cho món này.'],
          tip: '',
          timerSeconds: 0,
          ingredients: dish.ingredients || []
        }];
      }
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

    try {
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
    } catch (err) {
      console.error('[CookingMode] Error creating overlay:', err);
      cookingState = null;
      document.querySelector('.cooking-mode-overlay')?.remove();
      document.body.style.overflow = '';
      MealPlan.showToast('Không thể mở chế độ nấu!', 'error');
    }
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

    // Dùng step.ingredients đã được match theo keyword, không chia đều
    const stepIdx = state.currentStep;

    // done: nguyên liệu từ các bước đã qua (không tính bước hiện tại)
    const doneNames = new Set();
    const done = [];
    for (let i = 0; i < stepIdx; i++) {
      (state.steps[i].ingredients || []).forEach(ing => {
        if (!doneNames.has(ing.name)) {
          doneNames.add(ing.name);
          done.push(ing);
        }
      });
    }

    // current: nguyên liệu bước hiện tại (luôn hiển thị)
    const current = state.steps[stepIdx]?.ingredients || [];
    const currentNames = new Set(current.map(ing => ing.name));

    // upcoming: các bước còn lại — chỉ lấy những nguyên liệu chưa thấy
    const upcoming = [];
    const seenUpcoming = new Set();
    for (let i = stepIdx + 1; i < state.steps.length; i++) {
      (state.steps[i].ingredients || []).forEach(ing => {
        if (!seenUpcoming.has(ing.name) && !currentNames.has(ing.name)) {
          seenUpcoming.add(ing.name);
          upcoming.push(ing);
        }
      });
    }
    // Phần còn lại của nguyên liệu tổng (không được match vào step nào)
    ings.forEach(ing => {
      if (!seenUpcoming.has(ing.name) && !currentNames.has(ing.name)) {
        seenUpcoming.add(ing.name);
        upcoming.push(ing);
      }
    });

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

  // Dịch position tiếng Anh → tiếng Việt (AI không dùng tên Việt thì fallback)
  function translatePosition(pos) {
    if (!pos) return '';
    // Nếu đã là tiếng Việt thì giữ nguyên
    if (/[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(pos)) return pos;
    const map = {
      'bottom': 'Đáy', 'top': 'Mặt trên', 'left': 'Bên trái', 'right': 'Bên phải',
      'center': 'Chính giữa', 'all-over': 'Rải đều', 'left right': 'Hai bên',
      'top-right': 'Trên phải', 'top-left': 'Trên trái',
      'bottom-right': 'Dưới phải', 'bottom-left': 'Dưới trái'
    };
    return map[pos] || pos;
  }

  function buildPlatingHTML(p, dishName) {
    // Build step list
    const stepsHTML = (p.steps || []).map(s => {
      const color = s.color || '#888';
      const posVi = translatePosition(s.position);
      return `
        <div class="flex items-start gap-3 group">
          <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-white font-bold text-sm shadow-sm" style="background:${color}">
            ${s.step}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <h4 class="font-label-md text-sm text-on-surface">${s.title}</h4>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">${posVi} · ${s.coverage}% tô/đĩa</span>
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

  // ===================== Expose =====================

  window.openCookingMode = openCookingMode;
  window.showPlatingGuide = showPlatingGuide;

})();
