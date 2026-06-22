/**
 * ui-history.js — Charts and history views: streak chart, month grid, lifetime stats.
 * Edit here: graph layout, calendar colors, lifetime totals display.
 */

function switchChartMode(mode) {
    chartMode = mode;
    chartPage = -1;
    document.getElementById('toggleStreaks').classList.toggle('active', mode === 'streaks');
    document.getElementById('toggleJourneys').classList.toggle('active', mode === 'journeys');
    document.getElementById('chartTitle').textContent = mode === 'streaks' ? 'Streak History' : 'Journey Progress';
    renderChart();
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
//  LIFETIME STATS
// ════════════════════════════════════════════════════════

function renderLifetimeStats() {
    const journeys = state.attempt;
    const pastStrong = state.completedJourneys.reduce((sum, j) => sum + (j.score.success || 0), 0);
    const totalStrong = pastStrong + state.score.success;
    const pastRelapses = state.completedJourneys.reduce((sum, j) => sum + (j.score.failures || 0), 0);
    const totalRelapses = pastRelapses + state.score.failures;

    document.getElementById('lifetimeJourneys').textContent = journeys;
    document.getElementById('lifetimeStrong').textContent   = totalStrong;
    document.getElementById('lifetimeRelapses').textContent = totalRelapses;
}
