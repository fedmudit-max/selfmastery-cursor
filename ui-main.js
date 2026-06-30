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
let lifetimePanelOpen = false;
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
    renderWeeklyStreak();
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
    if (failures === 9) return 'relapse-9';
    return 'relapse-10';
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

    const breakdownEl = document.getElementById('currentJourneyBreakdown');
    if (breakdownEl) {
        breakdownEl.textContent =
            `${success} strong ${success === 1 ? 'day' : 'days'} · ` +
            `${failures} ${failures === 1 ? 'slip' : 'slips'}`;
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
    const tier = getRelapseScoreTier(state.score.failures);
    const labelEl = document.getElementById('chancesLabel');

    if (labelEl) {
        labelEl.className = `chances-label ${tier}`;
        labelEl.textContent =
            `💪 ${remaining} ${remaining === 1 ? 'chance' : 'chances'} remaining`;
    }
}

function renderButtons() {
    const successBtn = document.getElementById('successBtn');
    const failBtn    = document.getElementById('failBtn');

    if (isAwaitingNextJourney()) {
        successBtn.disabled = true;
        successBtn.classList.remove('logged');
        successBtn.textContent = '✓ I STAYED STRONG TODAY';
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
        successBtn.textContent = '✓ I STAYED STRONG TODAY';
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

function syncWeeklyTrackWidth(track) {
    track.style.width = '100%';
    track.style.maxWidth = '100%';
    track.style.marginLeft = '0';
    track.style.marginRight = '0';
}

/** Visual half-width of each dot marker (must match CSS). */
function getWeeklyMarkerRadius(step) {
    if (step.classList.contains('target')) return 7;
    if (step.classList.contains('done')) return 6;
    return 4;
}

function layoutWeeklyTrack(track) {
    const rail = track.querySelector('.weekly-streak-rail');
    const labelsRow = track.querySelector('.weekly-streak-labels');
    if (!rail || !labelsRow) return;

    syncWeeklyTrackWidth(track);

    const steps = [...rail.querySelectorAll('.weekly-step')];
    const labels = [...labelsRow.querySelectorAll('.weekly-step-label-col')];
    if (steps.length !== 7 || labels.length !== 7) return;

    const trackWidth = track.getBoundingClientRect().width;
    if (trackWidth <= 0) return;

    const rStart = getWeeklyMarkerRadius(steps[0]);
    const rEnd   = getWeeklyMarkerRadius(steps[6]);
    const firstCenter = rStart;
    const lastCenter  = trackWidth - rEnd;
    const innerSpan   = lastCenter - firstCenter;
    if (innerSpan <= 0) return;

    steps.forEach((step, i) => {
        const cx = firstCenter + (i / 6) * innerSpan;
        step.style.left = `${cx}px`;
        step.style.top = '50%';
        step.style.transform = 'translate(-50%, -50%)';
    });

    labels.forEach((col, i) => {
        const cx = firstCenter + (i / 6) * innerSpan;
        const r  = getWeeklyMarkerRadius(steps[i]);
        if (i === 0) {
            col.style.left = `${cx - r}px`;
            col.style.transform = 'none';
            col.style.textAlign = 'left';
        } else if (i === 6) {
            col.style.left = `${cx + r}px`;
            col.style.transform = 'translateX(-100%)';
            col.style.textAlign = 'right';
        } else {
            col.style.left = `${cx}px`;
            col.style.transform = 'translateX(-50%)';
            col.style.textAlign = 'center';
        }
    });

    rail.style.setProperty('--weekly-line-left', `${firstCenter}px`);
    rail.style.setProperty('--weekly-line-width', `${innerSpan}px`);

    const dotCenters = steps.map((_, i) =>
        ((firstCenter + (i / 6) * innerSpan) / trackWidth) * 100);

    setWeeklyTrackLayout({
        dotCenters,
        lineLeftPct:  (firstCenter / trackWidth) * 100,
        lineRightPct: (lastCenter / trackWidth) * 100,
    });

    const streak = state.currentStreak;
    rail.style.setProperty('--weekly-green', String(getWeeklyGreenPct(streak)));

    const traveler = rail.querySelector('.weekly-active-traveler');
    if (traveler) {
        const pos = getWeeklyActiveTraveler(streak);
        if (pos) traveler.style.left = `${pos.leftPct}%`;
    }
}

function renderWeeklyStreakInsight(progress) {
    const titleEl = document.getElementById('weeklyStreakDayTitle');
    const textEl  = document.getElementById('weeklyStreakDayText');

    if (isWeeklySlipReflectDay()) {
        if (titleEl) titleEl.textContent = WEEKLY_SLIP_REFLECT.title;
        if (textEl)  textEl.textContent  = WEEKLY_SLIP_REFLECT.body;
        return;
    }

    const day     = getWeeklyInsightDay(progress);
    const insight = WEEKLY_DAY_INSIGHTS[day] || WEEKLY_DAY_INSIGHTS[1];
    if (titleEl) titleEl.textContent = `Day ${day} — ${insight.title}`;
    if (textEl)  textEl.textContent  = insight.body;
}

function renderWeeklyStreak() {
    const track = document.getElementById('weeklyStreakTrack');
    if (!track) return;

    const streak   = state.currentStreak;
    const progress = getWeeklyStreakDay(streak);
    renderWeeklyStreakInsight(progress);
    const traveler = getWeeklyActiveTraveler(streak);

    let railHtml   = '';
    let labelHtml  = '';
    for (let day = 1; day <= 7; day++) {
        const done    = progress > 0 && day <= progress;
        const current = done && day === progress;
        const isTarget = day === 7 && !done;
        const stepCls  = ['weekly-step', isTarget ? 'target' : '', done ? 'done' : '', current ? 'current' : ''].filter(Boolean).join(' ');
        const labelCls = ['weekly-step-label-col', done ? 'done' : '', current ? 'current' : ''].filter(Boolean).join(' ');
        const marker  = isTarget
            ? `<div class="weekly-step-marker"><svg class="weekly-step-bullseye-svg" viewBox="0 0 18 18" aria-hidden="true">
                <line class="dart-shaft" x1="3.3" y1="2.5" x2="8.55" y2="8.35" stroke="#9a7b4f" stroke-width="1.1" stroke-linecap="round"/>
                <path class="dart-feather dart-feather-a" d="M3.3 2.5 L2.15 1.15 L3.45 3.15 Z"/>
                <path class="dart-feather dart-feather-b" d="M3.3 2.5 L4.35 1.25 L3.85 3.35 Z"/>
                <circle class="ring-outer" cx="9" cy="9" r="6.5" fill="rgba(255,69,58,0.12)" stroke="#ff453a" stroke-width="1.8"/>
                <circle class="ring-mid" cx="9" cy="9" r="3.25" fill="#fff" stroke="#ff453a" stroke-width="1.15"/>
                <circle class="ring-core" cx="9" cy="9" r="1.05" fill="#ff3b30"/>
                <path class="dart-tip" d="M8.15 7.95 L9.45 9.3 L7.9 9.05 Z"/>
            </svg></div>`
            : '<div class="weekly-step-marker"><div class="weekly-step-dot" aria-hidden="true"></div></div>';
        railHtml += `<div class="${stepCls}">${marker}</div>`;
        labelHtml += `<div class="${labelCls}"><div class="weekly-step-label">Day ${day}</div></div>`;
    }

    const travelerHtml = traveler
        ? '<div class="weekly-active-traveler" aria-hidden="true"></div>'
        : '';

    track.innerHTML = `
        <div class="weekly-streak-rail">
            ${railHtml}
            ${travelerHtml}
        </div>
        <div class="weekly-streak-labels">${labelHtml}</div>`;
    requestAnimationFrame(() => layoutWeeklyTrack(track));

    if (!track._weeklyResizeObs && typeof ResizeObserver !== 'undefined') {
        track._weeklyResizeObs = new ResizeObserver(() => layoutWeeklyTrack(track));
        track._weeklyResizeObs.observe(track);
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
