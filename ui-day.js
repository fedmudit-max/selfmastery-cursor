/**
 * ui-day.js — Day logic, progress cards, onboarding, dev tools.
 * Edit here: yesterday reminder, multi-day catch-up, brain/knowledge cards, onboarding.
 */

// ════════════════════════════════════════════════════════
//  DAY REFRESH
// ════════════════════════════════════════════════════════

function checkNewDay() {
    if (!safeGet('onboardingComplete')) return;

    const today = todayKey();

    if (state.lastCheckedDate === today) return;

    if (!state.lastOpenedDate) {
        state.lastOpenedDate = today;
        state.lastCheckedDate = today;
        saveToStorage(state);
        return;
    }

    if (state.lastOpenedDate === today) {
        state.lastCheckedDate = today;
        saveToStorage(state);
        return;
    }

    const diffDays = daysBetweenKeys(state.lastOpenedDate, today);

    // One day missed and not logged — ask about yesterday
    if (diffDays === 1 && state.todayStatus === 'none') {
        const reminder = document.getElementById('reminderOverlay');
        if (!reminder.classList.contains('active')) {
            reminder.classList.add('active');
        }
        return;
    }

    // One day passed and yesterday was already logged — roll calendar forward
    if (diffDays === 1) {
        advanceCalendarDay();
        state.lastOpenedDate = today;
        state.lastCheckedDate = today;
        chartPage = -1;
        saveToStorage(state);
        renderAll();
        return;
    }

    // Multi-day absence — auto-count every missed day as strong
    if (diffDays > 1) {
        applyMultiDayCatchUp(today);
        return;
    }
}

function applyMultiDayCatchUp(today) {
    const outcome = autoStrongAbsentDays(today);
    state.lastOpenedDate = today;
    state.lastCheckedDate = today;

    if (outcome.journeyEnded) {
        chartPage = -1;
        saveAndRender();
        completeEndJourney();
        return;
    }

    for (const { result, suppressUI } of outcome.results) {
        handleStrongDayUI(result, suppressUI);
    }

    chartPage = -1;
    saveAndRender();

    const last = outcome.results[outcome.results.length - 1];
    if (last && !last.suppressUI && last.result) {
        showToast(last.result.streak, 'Missed days counted as strong 💪');
    }
}

function logYesterday(result) {
    document.getElementById('reminderOverlay').classList.remove('active');
    const yKey = addDaysToKey(todayKey(), -1);

    if (result === 'strong') {
        handleStrongDayUI(applyStrongDay({ logDate: yKey, suppressUI: false }), false);
    } else {
        applySlipDay({ logDate: yKey, calDay: state.calendarDay });
    }

    if (journeyIsOver(state)) { completeEndJourney(); return; }
    advanceCalendarDay();
    state.lastOpenedDate = todayKey();
    state.lastCheckedDate = todayKey();
    chartPage = -1;
    saveToStorage(state);
    renderAll();
}

// ════════════════════════════════════════════════════════
//  BRAIN RECOVERY CARD
//  Shows current neurological phase based on streak length.
// ════════════════════════════════════════════════════════


function renderBrainCard() {
    const streak = state.currentStreak;
    const list   = document.getElementById('scienceList');
    if (!list) return;

    list.innerHTML = BRAIN_PHASES.map((phase, idx) => {
        const isCurrent   = streak >= phase.from && streak < phase.to;
        const isCompleted = streak >= phase.to;

        const toLabel  = phase.to === Infinity ? '365+' : phase.to;
        const dayRange = `Day ${phase.from}–${toLabel}`;

        // Progress within current phase
        const phaseLen = phase.to === Infinity ? 365 : phase.to - phase.from;
        const daysIn   = streak - phase.from;
        const pct      = Math.min(100, Math.round((daysIn / phaseLen) * 100));
        const daysLeft = phase.to === Infinity ? null : phase.to - streak;

        let cls = 'science-item';
        if (isCurrent)   cls += ' current';
        if (isCompleted) cls += ' completed';
        if (!isCurrent && !isCompleted) cls += ' future';

        const badge = isCurrent
            ? `<span class="science-here-badge">You are here</span>`
            : isCompleted
                ? `<span class="science-days-range">✓ Done</span>`
                : `<span class="science-days-range">${dayRange}</span>`;

        const progressBar = isCurrent ? `
            <div class="science-progress-track">
                <div class="science-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="science-progress-label">${daysLeft
                ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} to next phase`
                : 'Final stage reached'}</div>` : '';

        // Current phase: full card. Others: collapsed, tap to expand.
        if (isCurrent) {
            return `
                <div class="${cls}">
                    <div class="science-item-header">
                        <div class="science-item-left">
                            <span class="science-emoji">${phase.emoji}</span>
                            <span class="science-phase-name">${phase.phase}</span>
                        </div>
                        ${badge}
                    </div>
                    <div class="science-desc">${phase.desc}</div>
                    ${progressBar}
                </div>`;
        }

        // Collapsed — just one row, tap to expand
        return `
            <div class="${cls} science-collapsed" onclick="toggleSciencePhase(${idx})">
                <div class="science-item-header" style="margin-bottom:0">
                    <div class="science-item-left">
                        <span class="science-emoji">${phase.emoji}</span>
                        <span class="science-phase-name">${phase.phase}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px">
                        ${badge}
                        <span class="science-chevron" id="chevron-${idx}">›</span>
                    </div>
                </div>
                <div class="science-desc science-expandable" id="expand-${idx}" style="display:none;margin-top:8px">${phase.desc}</div>
            </div>`;
    }).join('');
}

function toggleSciencePhase(idx) {
    const desc    = document.getElementById(`expand-${idx}`);
    const chevron = document.getElementById(`chevron-${idx}`);
    if (!desc) return;
    const open = desc.style.display === 'none';
    desc.style.display    = open ? 'block' : 'none';
    chevron.style.transform = open ? 'rotate(90deg)' : '';
    chevron.style.transition = 'transform 0.2s';
}

// ════════════════════════════════════════════════════════
//  DAILY KNOWLEDGE CARD
// ════════════════════════════════════════════════════════

function renderKnowledgeCard() {
    const fact = KNOWLEDGE_FACTS[dayOfYearFromKey(todayKey()) % KNOWLEDGE_FACTS.length];

    document.getElementById('knowledgeEmoji').textContent    = fact.emoji;
    document.getElementById('knowledgeHeadline').textContent = fact.headline;
    document.getElementById('knowledgeBody').textContent     = fact.body;
}

// ════════════════════════════════════════════════════════
//  ONBOARDING
// ════════════════════════════════════════════════════════


function checkOnboarding() {
    const done = safeGet('onboardingComplete');
    if (!done) {
        currentSlide = 0;
        document.getElementById('onboardingBtn').textContent = 'Next →';
        document.getElementById('onboardingOverlay').style.display = 'flex';
        document.getElementById('onboardingOverlay').classList.remove('hidden');
    } else {
        document.getElementById('onboardingOverlay').style.display = 'none';
    }
}

function onboardingNext() {
    if (currentSlide < TOTAL_SLIDES - 1) {
        // Go to next slide
        document.getElementById(`slide-${currentSlide}`).classList.remove('active');
        document.getElementById(`dot-${currentSlide}`).classList.remove('active');
        currentSlide++;
        document.getElementById(`slide-${currentSlide}`).classList.add('active');
        document.getElementById(`dot-${currentSlide}`).classList.add('active');

        // Last slide — change button to "Let's Begin"
        if (currentSlide === TOTAL_SLIDES - 1) {
            document.getElementById('onboardingBtn').textContent = "Let's Begin 💪";
        }
    } else {
        completeOnboarding();
    }
}

function completeOnboarding() {
    safeSet('onboardingComplete', 'true');
    const overlay = document.getElementById('onboardingOverlay');
    overlay.classList.add('hidden');
    setTimeout(() => overlay.style.display = 'none', 400);
    if (!state.lastOpenedDate) {
        state.lastOpenedDate = todayKey();
        state.lastCheckedDate = todayKey();
        saveToStorage(state);
    }
}

// ════════════════════════════════════════════════════════
//  DEV — simulate next calendar day (testing only)
// ════════════════════════════════════════════════════════

function devAdvanceOneDay() {
    if (!safeGet('onboardingComplete')) {
        showToast(0, 'Finish onboarding first.');
        return;
    }

    advanceCalendarDay();

    state.lastOpenedDate  = todayKey();
    state.lastCheckedDate = todayKey();
    chartPage = -1;
    saveAndRender();
    showToast(state.calendarDay, `Test: Day ${state.calendarDay} ⏭`);
}
