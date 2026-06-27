/**
 * ui-main.js — Shared UI state, init, save/render hub, main screen cards.
 * Edit here: day counter, chances, buttons, milestone badges, tabs.
 */

let pendingAction = null;
let currentTab = 0;
let chartPage = -1;
let chartMode = 'streaks';
let monthOffset = 0;
let monthPanelOpen = false;
let chartPanelOpen = false;
let toastTimer = null;
let confettiParticles = [];
let confettiAnimId    = null;
let celebrationQueue       = [];
let celebrationShowing     = false;
let celebrationOnClose     = null;
let celebrationAutoCloseId = null;
let urgeSecsLeft  = URGE_DURATION_SECS;
let urgeInterval   = null;
let breathTimeout  = null;
let currentSlide = 0;
let lastActionTap = { btn: null, action: '', at: 0 };

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

function init() {
    const saved = loadFromStorage();
    replaceState(saved ? mergeSavedState(saved) : getDefaultState());
    renderAll();
}

// ════════════════════════════════════════════════════════
//  RENDER — all DOM updates go through here
// ════════════════════════════════════════════════════════

function saveAndRender() {
    const result = saveToStorage(state);
    if (!result.ok) {
        showToast(0, result.error === 'quota'
            ? 'Storage full — use Reset All Data to keep logging.'
            : 'Could not save your progress. Try again.');
    }
    renderAll();
}

function renderAll() {
    renderTopStats();
    renderChances();
    renderButtons();
    renderStreakMilestones();
    renderJourneyMilestones();
    renderBrainCard();
    renderKnowledgeCard();
    renderLifetimeStats();
    renderBackupStatus();
    renderMonthGrid();
    renderChart();
    syncHistoryPanels();
}

function getRelapseScoreTier(failures) {
    if (failures <= 1) return 'relapse-0';
    if (failures <= 3) return 'relapse-2';
    if (failures <= 6) return 'relapse-4';
    if (failures <= 8) return 'relapse-7';
    return 'relapse-9';
}

function renderTopStats() {
    document.getElementById('calendarDay').textContent = state.calendarDay;

    const { success, failures } = state.score;
    const tier = getRelapseScoreTier(failures);
    const currentEl = document.getElementById('currentJourney');
    if (currentEl) {
        currentEl.className = `score-value ${tier}`;
        currentEl.innerHTML =
            `<span class="score-strong">${success}</span>` +
            `<span class="score-sep">/</span>` +
            `<span class="score-failures">${failures}</span>`;
    }

    document.getElementById('bestJourney').textContent = formatJourneyScore(getDisplayBestJourney());
}

function renderBackupStatus() {
    const el = document.getElementById('lastBackupLabel');
    if (!el) return;
    el.textContent = `Last exported: ${formatLastBackupLabel()}`;
}

function renderChances() {
    const grid = document.getElementById('chancesGrid');
    grid.innerHTML = '';

    for (let i = 0; i < MAX_FAILURES; i++) {
        const div = document.createElement('div');
        div.className = 'chance' + (i < state.score.failures ? ' used' : '');
        div.textContent = '💪';
        grid.appendChild(div);
    }

    const remaining = MAX_FAILURES - state.score.failures;
    document.getElementById('chancesLabel').textContent =
        `💪 ${remaining} ${remaining === 1 ? 'chance' : 'chances'} remaining`;
}

function renderButtons() {
    const successBtn = document.getElementById('successBtn');
    const failBtn    = document.getElementById('failBtn');

    if (isAwaitingNextJourney()) {
        successBtn.disabled = true;
        successBtn.classList.remove('logged');
        successBtn.textContent = '✓ I STAYED STRONG';
        failBtn.disabled = true;
        failBtn.textContent = 'New journey starts tomorrow';
        return;
    }

    if (state.todayStatus === 'success') {
        successBtn.disabled = true;
        successBtn.classList.add('logged');
        successBtn.textContent = 'Strong 💪';
        failBtn.disabled = true;
        failBtn.textContent = '✕ Blocked';

    } else if (state.todayStatus === 'failed') {
        successBtn.disabled = true;
        successBtn.classList.remove('logged');
        successBtn.textContent = 'Plan to avoid it next time';

        const ORDINALS = ['', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
        const count    = state.todayFailCount;
        failBtn.disabled    = false;
        failBtn.textContent = count === 0
            ? '✕ I Slipped'
            : `✕ I Slipped ${ORDINALS[count] || `${count}th`} time`;

    } else {
        successBtn.disabled = false;
        successBtn.classList.remove('logged');
        successBtn.textContent = '✓ I STAYED STRONG';
        failBtn.disabled    = false;
        failBtn.textContent = '✕ I Slipped';
    }
}

function renderStreakMilestones() {
    const streak = state.currentStreak;

    const STREAK_MILESTONES_LIST = [
        { id: 'cs-day1',  day: 1,  baseName: 'Day 1',  label: 'Started'      },
        { id: 'cs-day3',  day: 3,  baseName: 'Day 3',  label: 'Early Battle' },
        { id: 'cs-week1', day: 7,  baseName: 'Week 1', label: 'First Week'   },
        { id: 'cs-day10', day: 10, baseName: 'Day 10', label: 'Ten Days'     },
        { id: 'cs-week2', day: 14, baseName: 'Week 2', label: 'Foundation'   },
        { id: 'cs-week3', day: 21, baseName: 'Week 3', label: 'Building'     },
        { id: 'cs-day30', day: 30, baseName: 'Day 30', label: 'One Month'    },
    ];

    STREAK_MILESTONES_LIST.forEach(({ id, day, baseName, label }) => {
        const item   = document.getElementById(id);
        const nameEl = item.querySelector('.milestone-name');
        const statEl = item.querySelector('.milestone-status');

        if (streak === 0) {
            setMilestoneState(item, null);
            nameEl.textContent = baseName;
            statEl.textContent = '—';
        } else if (streak >= day) {
            setMilestoneState(item, 'achieved-glow');
            nameEl.textContent = `${baseName} — ${label}`;
            statEl.textContent = '✓';
        } else {
            setMilestoneState(item, null);
            nameEl.textContent = baseName;
            statEl.textContent = '—';
        }
    });

    // Count badges
    renderCountMilestone('cs-day50',  streak >= 50,  state.day50Count);
    renderCountMilestone('cs-day100', streak >= 100, state.day100Count);

    // Best streak (gold when live record, default when streak ended)
    const best = document.getElementById('bestStreakItem');
    const disp = document.getElementById('longestStreakDisplay');
    if (state.currentStreak > 0 && state.currentStreak >= state.longestStreak) {
        setMilestoneState(best, 'golden');
        disp.textContent = state.currentStreak;
    } else {
        setMilestoneState(best, null);
        disp.textContent = state.longestStreak;
    }
}

/** Sets achieved/achieved-glow/golden/null on a milestone item */
function setMilestoneState(item, className) {
    item.classList.remove('achieved', 'achieved-glow', 'golden');
    if (className) item.classList.add(className);
}

/** Renders a count-based milestone (50-day, 100-day) */
function renderCountMilestone(id, isActive, count) {
    const item   = document.getElementById(id);
    const statEl = item.querySelector('.milestone-status');
    if (isActive) {
        setMilestoneState(item, 'achieved-glow');
        statEl.textContent = count > 0 ? count : '✓';
    } else {
        setMilestoneState(item, null);
        statEl.textContent = count > 0 ? count : '0';
    }
}

function renderJourneyMilestones() {
    const s = state.score.success;

    // ── Identity (always visible) ──────────────────────
    [75, 100, 150].forEach(day => {
        const item   = document.getElementById(`jm-${day}`);
        const statEl = item ? item.querySelector('.milestone-status') : null;
        const reached = s >= day;
        const count   = state.journeyMilestones[day] || 0;
        if (item) setMilestoneState(item, reached ? 'achieved-glow' : null);
        if (statEl) statEl.textContent = reached ? (count > 0 ? count : '✓') : '0';
    });

    // ── Endurance — progressive reveal ─────────────────
    const ENDURANCE = [
        { day: 200, emoji: '🛡️', label: '200 Days', unlockAt: 150 },
        { day: 300, emoji: '⚡', label: '300 Days', unlockAt: 200 },
        { day: 400, emoji: '💎', label: '400 Days', unlockAt: 300 },
    ];

    const endEl = document.getElementById('enduranceSection');
    if (endEl) {
        endEl.innerHTML = '';
        let teaserShown = false;
        for (const m of ENDURANCE) {
            if (s >= m.unlockAt) {
                const reached = s >= m.day;
                const count   = state.journeyMilestones[m.day] || 0;
                const cls     = reached ? 'milestone-item achieved-glow' : 'milestone-item';
                const status  = reached ? (count > 0 ? count : '✓') : '0';
                endEl.innerHTML += `
                    <div class="${cls}" style="margin-bottom:10px">
                        <div class="milestone-info">
                            <div class="milestone-icon">${m.emoji}</div>
                            <div class="milestone-name">${m.label}</div>
                        </div>
                        <div class="milestone-status">${status}</div>
                    </div>`;
            } else if (!teaserShown) {
                endEl.innerHTML += `
                    <div class="next-unlock">
                        <span class="next-unlock-icon">🔒</span>
                        Keep going to unlock
                    </div>`;
                teaserShown = true;
            }
        }
    }

    // ── Legendary — full mystery until 400 days ────────
    const LEGENDARY = [
        { day: 500, emoji: '🦁', label: '500 Days', unlockAt: 400 },
        { day: 750, emoji: '🦅', label: '750 Days', unlockAt: 500 },
        { day: 1000, emoji: '👑', label: '1000 Days', unlockAt: 750 },
    ];

    const legEl = document.getElementById('legendarySection');
    if (legEl) {
        legEl.innerHTML = '';
        if (s < 400) {
            // Full mystery — just a lock, nothing else
            legEl.innerHTML = `<div class="mystery-lock"><span class="mystery-lock-icon">🔒</span></div>`;
        } else {
            let teaserShown = false;
            for (const m of LEGENDARY) {
                if (s >= m.unlockAt) {
                    const reached = s >= m.day;
                    const count   = state.journeyMilestones[m.day] || 0;
                    const cls     = reached ? 'milestone-item achieved-glow' : 'milestone-item';
                    const status  = reached ? (count > 0 ? count : '✓') : '0';
                    legEl.innerHTML += `
                        <div class="${cls}" style="margin-bottom:10px">
                            <div class="milestone-info">
                                <div class="milestone-icon">${m.emoji}</div>
                                <div class="milestone-name">${m.label}</div>
                            </div>
                            <div class="milestone-status">${status}</div>
                        </div>`;
                } else if (!teaserShown) {
                    legEl.innerHTML += `
                        <div class="next-unlock">
                            <span class="next-unlock-icon">🔒</span>
                            Keep going to unlock
                        </div>`;
                    teaserShown = true;
                }
            }
        }
    }
}

function switchTab(index) {
    currentTab = index;
    document.querySelectorAll('.tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === index);
    });
    document.querySelectorAll('.tab-content').forEach((pane, i) => {
        pane.classList.toggle('active', i === index);
    });
    // Re-render science tab when switched to so it's always fresh
    if (index === 2) renderBrainCard();
}
