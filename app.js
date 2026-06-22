/**
 * app.js — UI, rendering, and user interactions.
 * Business rules live in logic.js; copy/constants in data.js.
 */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

(function () {
    'use strict';
    if (window.__KING_NOFAP_BOOTED__) return;
    window.__KING_NOFAP_BOOTED__ = true;

let pendingAction = null;
let currentTab = 0;
let chartPage = -1;
let chartMode = 'streaks';
let monthOffset = 0;
let gapDayQueue = [];
let gapDayIndex = 0;

function switchChartMode(mode) {
    chartMode = mode;
    chartPage = -1;
    document.getElementById('toggleStreaks').classList.toggle('active', mode === 'streaks');
    document.getElementById('toggleJourneys').classList.toggle('active', mode === 'journeys');
    document.getElementById('chartTitle').textContent = mode === 'streaks' ? 'Streak History' : 'Journey Progress';
    renderChart();
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

function init() {
    const saved = loadFromStorage();
    replaceState(saved ? mergeSavedState(saved) : getDefaultState());
    renderAll();
}

// ════════════════════════════════════════════════════════
//  USER ACTIONS
// ════════════════════════════════════════════════════════

function handleSuccess() {
    if (state.todayStatus === 'failed') {
        showToast(0, 'You already slipped today. Stay strong tomorrow!');
        return;
    }
    if (state.todayStatus === 'success') return;
    showModal('success');
}

function showModal(action) {
    pendingAction = action;
    document.getElementById('modalMessage').textContent =
        action === 'success' ? 'Mark today as successful?' :
        action === 'reset'   ? 'Reset all data?' :
        'Today was hard. Log it and keep going?';
    document.getElementById('modalConfirmBtn').textContent =
        action === 'success' ? 'Confirm' :
        action === 'reset'   ? 'Yes, reset all' :
        'Yes, log it';

    // Show RESET input only for reset action
    const resetWrap  = document.getElementById('resetConfirmWrap');
    const resetInput = document.getElementById('resetConfirmInput');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    if (action === 'reset') {
        resetWrap.style.display = 'block';
        resetInput.value = '';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.4';
    } else {
        resetWrap.style.display = 'none';
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
    }

    document.getElementById('confirmModal').classList.add('active');
}

function checkResetInput() {
    const val = document.getElementById('resetConfirmInput').value.trim().toUpperCase();
    const btn = document.getElementById('modalConfirmBtn');
    btn.disabled    = val !== 'RESET';
    btn.style.opacity = val !== 'RESET' ? '0.4' : '1';
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('active');
    document.getElementById('resetConfirmInput').value = '';
    document.getElementById('resetConfirmWrap').style.display = 'none';
    pendingAction = null;
}

function confirmAction() {
    if (pendingAction === 'success') recordSuccess();
    else if (pendingAction === 'fail') recordFailure();
    else if (pendingAction === 'reset') resetAll();
    closeModal();
}

function resetAll() {
    safeRemove(STORAGE_KEY);
    safeRemove('onboardingComplete');
    replaceState(getDefaultState());
    chartPage = -1;
    chartMode = 'streaks';
    currentTab = 0;
    switchTab(0);
    saveToStorage(state);
    renderAll();
    checkOnboarding();
}


function recordSuccess() {
    state.lastOpenedDate = todayKey();
    const result = applyStrongDay({ logDate: todayKey(), suppressUI: false });
    handleStrongDayUI(result, false);
    chartPage = -1;
    saveAndRender();
    showToast(state.currentStreak);
}

function handleStrongDayUI(result, suppressUI) {
    if (suppressUI || !result) return;
    if (result.isNewRecord) {
        setTimeout(() => showCelebration({
            emoji: '🏆',
            stage: 'NEW PERSONAL BEST',
            title: `${result.streak} Days — New Record!`,
            message: `You just beat your personal best! Old record: ${result.prevLongest} days. You are rewriting your own limits.`,
        }), 400);
    }
    triggerStreakMilestone(result.streak);
    checkJourneyMilestone(result.successCount, false);
}

function recordFailure() {
    state.lastOpenedDate = todayKey();
    const failures = recordSlipToday();
    if (journeyIsOver(state)) {
        completeEndJourney();
    } else {
        chartPage = -1;
        saveAndRender();
        showToast(0, `${failures} chance${failures > 1 ? 's' : ''} used. Keep moving forward. Journey Continues.`);
    }
}

function completeEndJourney() {
    const comparison = endJourney();
    chartPage = -1;
    saveAndRender();
    setTimeout(() => showJourneyComparison(
        { attempt: comparison.attempt, score: comparison.score, bestStreak: comparison.bestStreak },
        comparison.prevJourney
    ), 600);
}

function checkJourneyMilestone(successCount, suppressUI = false) {
    const milestones = [30, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000];
    if (milestones.includes(successCount)) {
        if (successCount >= 75) {
            state.journeyMilestones[successCount] = (state.journeyMilestones[successCount] || 0) + 1;
        }
        if (!suppressUI) triggerJourneyMilestone(successCount);
    }
}

// ════════════════════════════════════════════════════════
//  RENDER — all DOM updates go through here
// ════════════════════════════════════════════════════════

function saveAndRender() {
    const result = saveToStorage(state);
    if (!result.ok) {
        showToast(0, result.error === 'quota'
            ? 'Storage full — export or reset data to keep logging.'
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
    renderMonthGrid();
    renderChart();
}

function renderTopStats() {
    document.getElementById('calendarDay').textContent    = state.calendarDay;
    document.getElementById('currentJourney').textContent = `${state.score.success}/${state.score.failures}`;
    document.getElementById('bestJourney').textContent    = `${state.bestJourney.success}/${state.bestJourney.failures}`;
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

// ════════════════════════════════════════════════════════
//  STREAK CHART
// ════════════════════════════════════════════════════════

function getChartWindow() { return chartMode === 'journeys' ? 4 : 5; }

/**
 * Returns data points for the chart based on current chartMode.
 * Streaks mode: every individual streak across all journeys.
 * Journeys mode: total strong days per completed journey.
 */
function getChartPoints() {
    if (chartMode === 'journeys') {
        // One point per completed journey
        const points = state.completedJourneys.map(j => ({
            val:   j.score.success,
            label: `J${j.attempt}`,
        }));
        // Add current in-progress journey if it has any strong days
        if (state.score.success > 0) {
            points.push({ val: state.score.success, label: `J${state.attempt}…`, live: true });
        }
        return points;
    }

    // Streaks mode — every individual streak in order
    const points = [];
    let num = 1;
    state.pastJourneyStreaks.forEach(journey => {
        (journey.streaks || []).forEach(val => {
            points.push({ val, label: `S${num++}` });
        });
    });
    (state.currentJourneyStreaks || []).forEach(val => {
        points.push({ val, label: `S${num++}` });
    });
    if (state.currentStreak > 0) {
        points.push({ val: state.currentStreak, label: `S${num}…`, live: true });
    }
    return points;
}

function chartNav(dir) {
    const points  = getChartPoints();
    const maxPage = Math.max(0, points.length - getChartWindow());
    if (chartPage === -1) chartPage = maxPage;
    const jump = Math.max(1, Math.floor(points.length / 5));
    chartPage = clamp(chartPage + dir * jump, 0, maxPage);
    renderChart();
}

// Math.clamp polyfill (not in all browsers yet)
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

function renderChart() {
    const points  = getChartPoints();
    const outer   = document.getElementById('chartOuter');
    const H = 180, padT = 24, padB = 36;
    const cH = H - padT - padB;
    const VW = 400;
    const padX = VW * 0.04;
    const yFracs = [0, 0.25, 0.5, 0.75, 1];

    if (points.length === 0) {
        outer.style.display = 'flex';

        // Empty graph — show axes with default scale of 30
        const yMax = 30;
        const yAxisSvg = document.getElementById('chartYAxis');
        yAxisSvg.setAttribute('width', 36);
        yAxisSvg.setAttribute('height', H);
        yAxisSvg.innerHTML = yFracs.map(f => {
            const y = padT + cH - f * cH;
            return `<text x="32" y="${y + 4}" text-anchor="end" font-size="9" font-weight="500"
                fill="rgba(134,134,139,0.5)" font-family="-apple-system,sans-serif">${Math.round(f * yMax)}</text>`;
        }).join('');

        const gridLines = yFracs.map(f => {
            const y = padT + cH - f * cH;
            return `<line x1="${padX}" y1="${y}" x2="${VW - padX}" y2="${y}"
                stroke="rgba(0,0,0,${f === 0 ? '0.10' : '0.04'})"
                stroke-width="${f === 0 ? 1.5 : 1}"/>`;
        }).join('');

        document.getElementById('chartInner').setAttribute('viewBox', `0 0 ${VW} ${H}`);
        document.getElementById('chartInner').innerHTML = `
            ${gridLines}
            <line x1="0" y1="${padT}" x2="0" y2="${padT + cH}"
                stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>
            <text x="${VW/2}" y="${padT + cH/2}" text-anchor="middle"
                font-size="13" fill="rgba(134,134,139,0.6)"
                font-family="-apple-system,sans-serif">Your history starts today</text>`;
        document.getElementById('chartSubtitle').textContent = '';
        return;
    }

    outer.style.display = 'flex';

    const maxPage = Math.max(0, points.length - getChartWindow());
    if (chartPage === -1 || chartPage > maxPage) chartPage = maxPage;

    const show = points.slice(chartPage, chartPage + getChartWindow());

    // Subtitle
    const unit = chartMode === 'journeys' ? 'journey' : 'streak';
    const from = chartPage + 1, to = chartPage + show.length;
    document.getElementById('chartSubtitle').textContent =
        points.length <= getChartWindow()
            ? `${points.length} ${unit}${points.length !== 1 ? 's' : ''}`
            : `${chartMode === 'journeys' ? 'J' : 'S'}${from}–${chartMode === 'journeys' ? 'J' : 'S'}${to} of ${points.length}`;

    // Arrows

    // ── Layout ───────────────────────────────────────
    // Y scale — fixed to all-time best with 25% headroom
    const allTimeMax = Math.max(...points.map(p => p.val), 1);
    const yMax       = Math.max(Math.ceil(allTimeMax * 1.25 / 5) * 5, 5);
    const bestVal = chartMode === 'journeys' ? state.bestJourney.success : state.longestStreak;

    // ── Y axis: 5 evenly spaced labels ───────────────
    const yAxisSvg = document.getElementById('chartYAxis');
    yAxisSvg.setAttribute('width', 36);
    yAxisSvg.setAttribute('height', H);
    yAxisSvg.innerHTML = yFracs.map(f => {
        const y = padT + cH - f * cH;
        return `<text x="32" y="${y + 4}" text-anchor="end" font-size="9" font-weight="500"
            fill="rgba(134,134,139,0.85)" font-family="-apple-system,sans-serif">${Math.round(f * yMax)}</text>`;
    }).join('');

    // ── Grid lines + Y axis line ──────────────────────
    const gridLines = yFracs.map(f => {
        const y = padT + cH - f * cH;
        return `<line x1="${padX}" y1="${y}" x2="${VW - padX}" y2="${y}"
            stroke="rgba(0,0,0,${f === 0 ? '0.10' : '0.05'})"
            stroke-width="${f === 0 ? 1.5 : 1}"/>`;
    }).join('') +
    // Vertical Y axis line — sits at left edge, before the first data point
    `<line x1="0" y1="${padT}" x2="0" y2="${padT + cH}"
        stroke="rgba(0,0,0,0.12)" stroke-width="1.5"/>`;

    // ── Coordinates ──────────────────────────────────
    const isCurrentBest = state.currentStreak > 0 && state.currentStreak === state.longestStreak;

    const pts = show.map((p, i) => ({
        x:          show.length === 1 ? VW / 2 : padX + (i / (show.length - 1)) * (VW - padX * 2 - 24),
        y:          padT + cH - (p.val / yMax) * cH,
        val:        p.val,
        label:      p.label,
        isBest:     !p.live && p.val === bestVal && bestVal > 0,
        isLive:     !!p.live,
        isLiveBest: !!p.live && isCurrentBest,
    }));

    // ── Area fill ─────────────────────────────────────
    const polyPoints = pts.length > 1
        ? `${pts.map(p => `${p.x},${p.y}`).join(' ')} ${pts.at(-1).x},${padT + cH} ${pts[0].x},${padT + cH}`
        : '';

    // ── Line path ─────────────────────────────────────
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

    // ── Dots + labels ─────────────────────────────────
    const nodes = pts.map(p => {
        const color = p.isLiveBest ? '#ff9f0a' : p.isLive ? 'rgba(52,199,89,0.5)' : p.isBest ? '#ff9f0a' : '#34c759';
        const r     = p.isBest || p.isLiveBest ? 6 : 5;
        const halo  = p.isBest
            ? `<circle cx="${p.x}" cy="${p.y}" r="${r + 5}" fill="rgba(255,159,10,0.12)"/>`
            : `<circle cx="${p.x}" cy="${p.y}" r="${r + 5}" fill="rgba(52,199,89,0.08)"/>`;
        return `
            ${halo}
            <circle cx="${p.x}" cy="${p.y}" r="${r}"
                fill="white" stroke="${color}" stroke-width="2.5"/>
            <text x="${p.x}" y="${p.y - 11}" text-anchor="middle"
                font-size="11" font-weight="700" fill="${color}"
                font-family="-apple-system,sans-serif">${p.val}</text>
            <text x="${p.x}" y="${padT + cH + 16}" text-anchor="middle"
                font-size="10" fill="rgba(134,134,139,0.9)"
                font-family="-apple-system,sans-serif">${p.label}</text>`;
    }).join('');

    // Arrow enable states
    const canGoLeft  = chartPage > 0;
    const canGoRight = chartPage < maxPage;
    const hasNav     = points.length > getChartWindow();

    // Left arrow drawn in the Y axis SVG — same vertical position as the "0" label
    const zeroLabelY = padT + cH + 18; // matches y of the 0 label text
    yAxisSvg.innerHTML += hasNav ? `
        <text x="22" y="${zeroLabelY}" text-anchor="end" font-size="18"
            font-family="-apple-system,sans-serif"
            fill="${canGoLeft ? '#34c759' : 'rgba(134,134,139,0.25)'}"
            style="cursor:${canGoLeft ? 'pointer' : 'default'}"
            onclick="${canGoLeft ? 'chartNav(-1)' : ''}">&#9664;</text>` : '';

    // Right arrow inside chartInner, just past the last data point
    const lastPtX = pts.length > 0 ? pts[pts.length - 1].x : VW - padX;
    const arrowsSVG = hasNav ? `
        <text x="${lastPtX + 18}" y="${zeroLabelY}" font-size="18"
            font-family="-apple-system,sans-serif"
            fill="${canGoRight ? '#34c759' : 'rgba(134,134,139,0.25)'}"
            style="cursor:${canGoRight ? 'pointer' : 'default'}"
            onclick="${canGoRight ? 'chartNav(1)' : ''}">&#9654;</text>` : '';

    // ── Render ────────────────────────────────────────
    document.getElementById('chartInner').setAttribute('viewBox', `0 0 ${VW} ${H}`);
    document.getElementById('chartInner').innerHTML = `
        <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stop-color="#34c759" stop-opacity="0.15"/>
                <stop offset="100%" stop-color="#34c759" stop-opacity="0"/>
            </linearGradient>
        </defs>
        ${gridLines}
        ${pts.length > 1 ? `<polygon points="${polyPoints}" fill="url(#areaGrad)"/>` : ''}
        ${pts.length > 1 ? `<path d="${linePath}" fill="none" stroke="#34c759"
            stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
        ${nodes}
        ${arrowsSVG}`;
}

// ════════════════════════════════════════════════════════
//  TOAST  — brief motivational message after a success
// ════════════════════════════════════════════════════════

let toastTimer = null;

function showToast(streak, customMsg) {
    const toast = document.getElementById('toast');
    const msg   = customMsg || TOAST_MESSAGES[Math.floor(Math.random() * TOAST_MESSAGES.length)];
    const sub   = streak > 1 ? `<div style="font-size:12px;opacity:0.65;margin-top:4px">Day ${streak} streak 🔥</div>` : '';
    toast.innerHTML = msg + sub;

    if (toastTimer) clearTimeout(toastTimer);
    toast.classList.remove('show');
    void toast.offsetWidth; // force reflow so animation restarts
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ════════════════════════════════════════════════════════
//  CELEBRATIONS  — popup + confetti
// ════════════════════════════════════════════════════════

function getSuccessRate() {
    const totalDays = state.calendarDay - 1; // days elapsed so far
    if (totalDays < 1) return null;
    const rate = Math.round((state.score.success / totalDays) * 100);
    return { rate, success: state.score.success, total: totalDays };
}

function successRateLine() {
    const r = getSuccessRate();
    if (!r) return '';
    return `\n\n📊 ${r.success} strong days out of ${r.total} — you're at ${r.rate}% success rate. Not perfection. Progress.`;
}

function triggerStreakMilestone(streak) {
    if (STREAK_MILESTONES[streak]) {
        setTimeout(() => showCelebration(STREAK_MILESTONES[streak]), 400);
    }
}

function triggerJourneyMilestone(days) {
    // Day 30 and 50 — show success rate popup only, no full milestone card
    if (days === 30 || days === 50) {
        const r = getSuccessRate();
        if (!r) return;
        setTimeout(() => showCelebration({
            emoji:   days === 30 ? '💪' : '⭐',
            stage:   `${days} JOURNEY DAYS`,
            title:   `${days} Strong Days!`,
            message: `${r.success} strong days out of ${r.total} — you're at ${r.rate}% success rate. Not perfection. Progress.`,
        }), 400);
        return;
    }
    if (JOURNEY_MILESTONES[days]) {
        const data = { ...JOURNEY_MILESTONES[days] };
        if (JOURNEY_SHOW_RATE.has(days)) {
            data.message += successRateLine();
        }
        setTimeout(() => showCelebration(data), 400);
    }
}

function showCelebration({ emoji, stage, title, message }) {
    document.getElementById('celebEmoji').textContent   = emoji;
    document.getElementById('celebStage').textContent   = stage;
    document.getElementById('celebTitle').textContent   = title;
    document.getElementById('celebMessage').textContent = message;
    document.getElementById('celebrationOverlay').classList.add('active');
    launchConfetti();
}

function closeCelebration() {
    document.getElementById('celebrationOverlay').classList.remove('active');
    stopConfetti();
    // If user dismissed the urge count popup manually, still launch the timer
    if (urgePendingTimer) {
        clearTimeout(urgePendingTimer);
        urgePendingTimer = null;
        launchUrgeTimer();
    }
}

// ════════════════════════════════════════════════════════
//  CONFETTI
// ════════════════════════════════════════════════════════

let confettiParticles = [];
let confettiAnimId    = null;

function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx     = canvas.getContext('2d');
    const COLORS  = ['#34c759','#ff9f0a','#007aff','#ff453a','#bf5af2','#ffd60a','#30d158'];

    // Cancel any running animation BEFORE resetting particles
    if (confettiAnimId) {
        cancelAnimationFrame(confettiAnimId);
        confettiAnimId = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    confettiParticles = Array.from({ length: 120 }, () => ({
        x:            Math.random() * canvas.width,
        y:            Math.random() * canvas.height * -1,
        r:            Math.random() * 8 + 4,
        color:        COLORS[Math.floor(Math.random() * COLORS.length)],
        tiltAngle:    0,
        tiltAngleInc: (Math.random() * 0.07 + 0.05) * (Math.random() < 0.5 ? 1 : -1),
        vx:           Math.random() * 2 - 1,
        vy:           Math.random() * 3 + 2,
        alpha:        1,
    }));

    let frame = 0;

    function drawFrame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        frame++;

        confettiParticles.forEach(p => {
            p.tiltAngle += p.tiltAngleInc;
            p.y += p.vy;
            p.x += p.vx;
            if (frame > 120) p.alpha -= 0.012;

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.beginPath();
            ctx.lineWidth   = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + Math.sin(p.tiltAngle) * 12 + p.r / 4, p.y);
            ctx.lineTo(p.x + Math.sin(p.tiltAngle) * 12, p.y + Math.sin(p.tiltAngle) * 12 + p.r / 4);
            ctx.stroke();
            ctx.restore();
        });

        if (frame < 240 && confettiParticles.some(p => p.alpha > 0)) {
            confettiAnimId = requestAnimationFrame(drawFrame);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    drawFrame();
}

function stopConfetti() {
    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    const canvas = document.getElementById('confettiCanvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ════════════════════════════════════════════════════════
//  FEATURE 1: URGE SURFING TIMER
//  A 15-minute countdown with a breathing cycle animation.
//  Urges typically peak and fade within 15 minutes.
// ════════════════════════════════════════════════════════

let urgeSecsLeft  = URGE_DURATION_SECS;
let urgeInterval   = null;
let breathTimeout  = null;

let urgePendingTimer = null;

function startUrgeSurf() {
    // Log this urge with current hour for pattern analysis
    if (!state.urgeLog) state.urgeLog = [];
    state.urgeLog.push({ hour: new Date().getHours(), date: todayKey() });
    saveToStorage(state);

    const count = state.urgesSurfed || 0;
    if (count > 0) {
        showCelebration({
            emoji:   '🌊',
            stage:   'URGE SURFER',
            title:   `${count} Urge${count !== 1 ? 's' : ''} Defeated`,
            message: `You've beaten ${count} urge${count !== 1 ? 's' : ''} before. You know how this ends — it passes. Let's go.`,
        });
        // Auto-launch timer after popup — cancelled if user dismisses early
        if (urgePendingTimer) clearTimeout(urgePendingTimer);
        urgePendingTimer = setTimeout(() => {
            urgePendingTimer = null;
            closeCelebration();
            launchUrgeTimer();
        }, 2200);
    } else {
        launchUrgeTimer();
    }
}

function launchUrgeTimer() {
    // Clear any existing intervals before starting fresh
    clearInterval(urgeInterval);
    clearTimeout(breathTimeout);
    breathTimeout = null;

    urgeSecsLeft = URGE_DURATION_SECS;
    updateUrgeCountdown();
    document.getElementById('urgeOverlay').classList.add('active');
    startBreathing();

    urgeInterval = setInterval(() => {
        urgeSecsLeft--;
        updateUrgeCountdown();
        if (urgeSecsLeft <= 0) {
            clearInterval(urgeInterval);
            document.getElementById('urgePhase').textContent = '✅ You made it through the urge!';
        }
    }, 1000);
}

function updateUrgeCountdown() {
    const m = Math.floor(urgeSecsLeft / 60);
    const s = urgeSecsLeft % 60;
    document.getElementById('urgeCountdown').textContent =
        `${m}:${String(s).padStart(2, '0')}`;
}

function startBreathing() {
    const ring    = document.getElementById('breathRing');
    const label   = document.getElementById('breathLabel');
    const phase   = document.getElementById('urgePhase');
    const CIRCUMFERENCE = 339; // 2 * π * 54

    const PHASES = [
        { label: 'Breathe in',  phase: 'Inhale slowly for 4 seconds…',  offset: 0,            duration: 4 },
        { label: 'Hold',        phase: 'Hold… stay with the feeling…',   offset: 0,            duration: 4 },
        { label: 'Breathe out', phase: 'Exhale slowly for 4 seconds…',   offset: CIRCUMFERENCE, duration: 4 },
        { label: 'Rest',        phase: 'Rest for 2 seconds…',            offset: CIRCUMFERENCE, duration: 2 },
    ];

    let phaseIndex = 0;

    clearTimeout(breathTimeout);

    function runPhase() {
        const p = PHASES[phaseIndex];
        label.textContent = p.label;
        phase.textContent = p.phase;
        ring.style.transition = `stroke-dashoffset ${p.duration}s ease-in-out`;
        ring.style.strokeDashoffset = p.offset;
        phaseIndex = (phaseIndex + 1) % PHASES.length;
        breathTimeout = setTimeout(runPhase, p.duration * 1000);
    }

    runPhase();
}

function urgeSurvived() {
    closeUrge();
    state.urgesSurfed = (state.urgesSurfed || 0) + 1;
    saveToStorage(state);
    showToast(state.currentStreak, `🌊 Urge surfed! That's ${state.urgesSurfed} total. Pure strength.`);
}

function closeUrge() {
    clearInterval(urgeInterval);
    clearTimeout(breathTimeout);
    breathTimeout = null;
    document.getElementById('urgeOverlay').classList.remove('active');
}

// ════════════════════════════════════════════════════════
//  FEATURE 3: JOURNEY COMPARISON CARD
//  Full-screen summary shown at the end of each journey.
//  Compares the just-completed journey against the previous one.
// ════════════════════════════════════════════════════════

/**
 * Shows the journey comparison card.
 * @param {object} current  - { attempt, score: {success, failures} }
 * @param {object|null} prev - previous journey or null if first journey
 */
function showJourneyComparison(current, prev) {
    // Title
    if (prev) {
        document.getElementById('compareTitleText').textContent =
            `Journey ${current.attempt} vs Journey ${prev.attempt}`;
    } else {
        document.getElementById('compareTitleText').textContent =
            `Journey ${current.attempt} Complete`;
    }

    document.getElementById('compareNextNum').textContent = current.attempt + 1;

    const currentBestStreak = current.bestStreak ?? 0;
    const prevBestStreak    = prev
        ? Math.max(...((state.pastJourneyStreaks.find(h => h.attempt === prev.attempt)?.streaks) || []), 0)
        : null;

    const stats = [
        {
            label:   'Strong Days',
            current: current.score.success,
            prev:    prev?.score.success ?? null,
        },
        {
            label:   'Best Streak',
            current: currentBestStreak,
            prev:    prevBestStreak,
        },
    ];

    const grid = document.getElementById('compareGrid');
    grid.innerHTML = stats.map(stat => {
        const hasComparison = stat.prev !== null;
        const currentVal    = stat.current;
        const prevVal       = stat.prev;

        // Direction: better / worse / same
        let arrowColor = '';
        let cssClass   = '';
        if (hasComparison && currentVal !== '—' && prevVal !== '—') {
            const better = stat.lowerIsBetter
                ? Number(currentVal) < Number(prevVal)
                : Number(currentVal) > Number(prevVal);
            const same   = Number(currentVal) === Number(prevVal);
            cssClass   = same ? 'same' : better ? '' : 'worse';
        }

        return `
            <div class="compare-stat">
                <div class="compare-stat-label">${stat.label}</div>
                <div class="compare-stat-values">
                    ${hasComparison ? `<span class="compare-val-old">${prevVal}</span><span class="compare-arrow">→</span>` : ''}
                    <span class="compare-val-new ${cssClass}">${currentVal}</span>
                </div>
            </div>`;
    }).join('');

    // Motivational message
    let message = '';
    if (!prev) {
        message = `Your first journey ends here — ${current.score.success} strong days. Every journey after this is you already knowing you can do it.`;
    } else {
        const diff = current.score.success - prev.score.success;
        if (diff > 0) {
            message = `📈 ${diff} more strong days than last time. You are improving. Each journey you learn yourself better.`;
        } else if (diff < 0) {
            message = `This one was harder. That's okay. The fact you're still here means the fight isn't over. Journey ${current.attempt + 1} starts fresh.`;
        } else {
            message = `Same score, different battle. You held the line. Now push one step further.`;
        }
    }
    document.getElementById('compareMessage').textContent = message;

    document.getElementById('journeyCompareOverlay').classList.add('active');
}

function closeCompare() {
    document.getElementById('journeyCompareOverlay').classList.remove('active');
}

// ════════════════════════════════════════════════════════
//  MONTHLY GRID
// ════════════════════════════════════════════════════════

function monthNav(dir) {
    monthOffset += dir;
    if (monthOffset > 0) monthOffset = 0;

    // Don't go before the month the journey started
    // Find earliest date in dailyLog
    const log   = state.dailyLog || {};
    const dates = Object.values(log)
        .map(e => (typeof e === 'object') ? e.date : null)
        .filter(Boolean)
        .sort();

    if (dates.length > 0) {
        const earliest   = parseDateKey(dates[0]);
        const today      = new Date();
        const minOffset  = (earliest.getFullYear() - today.getFullYear()) * 12
                         + (earliest.getMonth() - today.getMonth());
        if (monthOffset < minOffset) monthOffset = minOffset;
    }

    renderMonthGrid();
}

function renderMonthGrid() {
    const grid     = document.getElementById('monthGrid');
    const subtitle = document.getElementById('monthGridSubtitle');
    const log      = state.dailyLog || {};

    // Apply monthOffset to get the target month
    const ref   = new Date();
    ref.setDate(1);
    ref.setMonth(ref.getMonth() + monthOffset);

    const year           = ref.getFullYear();
    const month          = ref.getMonth();
    const daysInMonth    = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const today          = new Date();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

    // Month + year label
    const monthName = ref.toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('monthGridTitle').textContent = monthName;

    // Disable next arrow if on current month
    const nextBtn = document.getElementById('monthNavNext');
    if (nextBtn) nextBtn.disabled = monthOffset >= 0;

    // Disable prev arrow if at journey start month
    const prevBtn = document.querySelector('.month-nav-btn:first-child');
    if (prevBtn) {
        const dates = Object.values(log)
            .map(e => (typeof e === 'object') ? e.date : null)
            .filter(Boolean).sort();
        if (dates.length > 0) {
            const earliest  = parseDateKey(dates[0]);
            const minOffset = (earliest.getFullYear() - today.getFullYear()) * 12
                            + (earliest.getMonth() - today.getMonth());
            prevBtn.disabled = monthOffset <= minOffset;
        } else {
            prevBtn.disabled = monthOffset <= 0;
        }
    }

    // Build date→status lookup
    const dateStatus = {};
    Object.values(log).forEach(entry => {
        const dateKey = (typeof entry === 'object') ? entry.date : null;
        const status  = logStatus(entry);
        if (dateKey && status) dateStatus[dateKey] = status;
    });

    // Count for subtitle
    let strongCount = 0, slipCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (dateStatus[key] === 'strong') strongCount++;
        if (dateStatus[key] === 'slip')   slipCount++;
    }
    subtitle.textContent = strongCount > 0 || slipCount > 0
        ? `${strongCount} strong · ${slipCount} slip${slipCount !== 1 ? 's' : ''}`
        : 'Your history starts today';

    // Day labels
    const DAY_LABELS = ['S','M','T','W','T','F','S'];
    let html = DAY_LABELS.map(d => `<div class="month-day-label">${d}</div>`).join('');

    // Empty cells before first day
    for (let i = 0; i < firstDayOfWeek; i++) {
        html += `<div class="month-cell future"></div>`;
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
        const key      = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday  = isCurrentMonth && d === today.getDate();
        const isFuture = isCurrentMonth && d > today.getDate();
        const status   = dateStatus[key];

        let cls = 'month-cell';
        if (status === 'strong') cls += ' strong';
        else if (status === 'slip') cls += ' slip';
        else if (isFuture) cls += ' future';
        if (isToday) cls += ' today';

        html += `<div class="${cls}">${d}</div>`;
    }

    grid.innerHTML = html;
}

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

function showGapReviewPrompt(diffDays) {
    document.getElementById('gapReviewTitle').textContent = "You've been away";
    document.getElementById('gapReviewMessage').textContent =
        `You haven't logged for ${diffDays} day${diffDays !== 1 ? 's' : ''}. How did those days go?`;
    document.getElementById('gapReviewChoices').style.display = 'flex';
    document.getElementById('gapReviewDayLog').style.display = 'none';
    document.getElementById('gapReviewOverlay').classList.add('active');
}

function confirmGapAllStrong() {
    document.getElementById('gapReviewOverlay').classList.remove('active');
    applyMultiDayCatchUp(todayKey());
}

function startGapDayByDay() {
    document.getElementById('gapReviewChoices').style.display = 'none';
    document.getElementById('gapReviewDayLog').style.display = 'block';
    gapDayQueue.length = 0;
    gapDayQueue.push(...buildGapDayQueue(state.lastOpenedDate, todayKey()));
    gapDayIndex = 0;
    showNextGapDayPrompt();
}

function showNextGapDayPrompt() {
    if (gapDayIndex >= gapDayQueue.length) {
        document.getElementById('gapReviewOverlay').classList.remove('active');
        finishGapCatchUp();
        return;
    }
    const dateKey = gapDayQueue[gapDayIndex];
    const label   = parseDateKey(dateKey).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
    });
    document.getElementById('gapReviewTitle').textContent = 'Did you stay strong?';
    document.getElementById('gapReviewMessage').textContent =
        `Day ${gapDayIndex + 1} of ${gapDayQueue.length} (${label})`;
}

function logGapDay(result) {
    const dateKey = gapDayQueue[gapDayIndex];
    if (result === 'strong') {
        const suppress = gapDayIndex < gapDayQueue.length - 1;
        handleStrongDayUI(applyStrongDay({ logDate: dateKey, suppressUI: suppress }), suppress);
    } else {
        applySlipDay({ logDate: dateKey, calDay: state.calendarDay });
    }
    if (journeyIsOver(state)) {
        document.getElementById('gapReviewOverlay').classList.remove('active');
        completeEndJourney();
        return;
    }
    advanceCalendarDay();
    gapDayIndex++;
    showNextGapDayPrompt();
}

function finishGapCatchUp() {
    state.lastOpenedDate = todayKey();
    state.lastCheckedDate = todayKey();
    chartPage = -1;
    saveToStorage(state);
    renderAll();
    showToast(state.currentStreak, 'Catch-up complete. Keep going!');
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
//  One fact per day, rotates from a pool of 20.
//  Changes at midnight — same fact all day.
// ════════════════════════════════════════════════════════


function renderLifetimeStats() {
    // Total journeys = current attempt number
    const journeys = state.attempt;

    // Total strong days = current journey strong + all past journeys
    const pastStrong = state.completedJourneys.reduce((sum, j) => sum + (j.score.success || 0), 0);
    const totalStrong = pastStrong + state.score.success;

    // Total relapses = current journey failures + all past journeys failures
    const pastRelapses = state.completedJourneys.reduce((sum, j) => sum + (j.score.failures || 0), 0);
    const totalRelapses = pastRelapses + state.score.failures;

    document.getElementById('lifetimeJourneys').textContent = journeys;
    document.getElementById('lifetimeStrong').textContent   = totalStrong;
    document.getElementById('lifetimeRelapses').textContent = totalRelapses;
}

function renderKnowledgeCard() {
    const fact = KNOWLEDGE_FACTS[dayOfYearFromKey(todayKey()) % KNOWLEDGE_FACTS.length];

    document.getElementById('knowledgeEmoji').textContent    = fact.emoji;
    document.getElementById('knowledgeHeadline').textContent = fact.headline;
    document.getElementById('knowledgeBody').textContent     = fact.body;
}

//  ONBOARDING
//  Shows 3 slides on first launch only.
//  A flag in localStorage prevents it showing again.
// ════════════════════════════════════════════════════════

let currentSlide = 0;

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

// ════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════


// Capture phase so taps work inside overlay cards on mobile Safari.
let lastActionTap = { btn: null, action: '', at: 0 };

function handleDataAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const action = btn.dataset.action;
    const now = Date.now();
    if (btn === lastActionTap.btn && action === lastActionTap.action && now - lastActionTap.at < 450) return;
    lastActionTap = { btn, action, at: now };

    const arg = btn.dataset.arg;
    const actions = {
        success: handleSuccess,
        'modal-fail': () => showModal('fail'),
        'modal-reset': () => showModal('reset'),
        urge: startUrgeSurf,
        'tab-0': () => switchTab(0),
        'tab-1': () => switchTab(1),
        'tab-2': () => switchTab(2),
        'month-prev': () => monthNav(-1),
        'month-next': () => monthNav(1),
        'chart-streaks': () => switchChartMode('streaks'),
        'chart-journeys': () => switchChartMode('journeys'),
        onboardingNext: onboardingNext,
        onboardingSkip: completeOnboarding,
        'yesterday-strong': () => logYesterday('strong'),
        'yesterday-slip': () => logYesterday('slip'),
        gapAllStrong: confirmGapAllStrong,
        gapDayByDay: startGapDayByDay,
        'gap-strong': () => logGapDay('strong'),
        'gap-slip': () => logGapDay('slip'),
        closeCelebration: closeCelebration,
        modalCancel: closeModal,
        modalConfirm: confirmAction,
        urgeSurvived: urgeSurvived,
        closeUrge: closeUrge,
        closeCompare: closeCompare,
        'dev-next-day': devAdvanceOneDay,
    };
    if (action === 'science-toggle' && arg !== undefined) toggleSciencePhase(Number(arg));
    else if (actions[action]) actions[action]();
}

document.addEventListener('click', handleDataAction, true);
document.addEventListener('pointerup', handleDataAction, true);

document.getElementById('celebrationOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'celebrationOverlay') closeCelebration();
});

document.getElementById('resetConfirmInput')?.addEventListener('input', checkResetInput);

// Dynamic HTML (chart SVG, science rows) still uses inline handlers — expose on window.
window.chartNav = chartNav;
window.toggleSciencePhase = toggleSciencePhase;

// Dismiss load screen early so it never blocks taps if init throws later.
setTimeout(() => {
    const ls = document.getElementById('loadScreen');
    if (ls) {
        ls.style.pointerEvents = 'none';
        ls.style.opacity = '0';
        setTimeout(() => { ls.style.display = 'none'; }, 300);
    }
}, 400);

init();
checkOnboarding();
if (safeGet('onboardingComplete')) checkNewDay();

// Re-check day when user returns to app from background
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNewDay();
});

// iOS Safari PWA — fires when restored from cache (bfcache)
window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkNewDay();
});

// iOS Safari PWA — fires on focus when returning from background
window.addEventListener('focus', () => {
    checkNewDay();
});

// iOS Safari PWA — fires when app becomes active again
document.addEventListener('resume', () => {
    checkNewDay();
});

})();
