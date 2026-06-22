/**
 * logic.js — State, storage, dates, and business rules.
 * No DOM calls — safe to unit test in Node.
 */

// ── Storage ─────────────────────────────────────────────

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function saveToStorage(stateObj) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj));
        return { ok: true };
    } catch (e) {
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22);
        return { ok: false, error: isQuota ? 'quota' : 'unknown' };
    }
}

let _memStorage = {};

function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return _memStorage[key] || null; }
}

function safeSet(key, val) {
    try { localStorage.setItem(key, val); }
    catch (e) { _memStorage[key] = val; }
}

function safeRemove(key) {
    try { localStorage.removeItem(key); }
    catch (e) { delete _memStorage[key]; }
}

// ── Dates (local timezone — never parse YYYY-MM-DD as UTC) ──

function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dateKeyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetweenKeys(fromKey, toKey) {
    const ms = parseDateKey(toKey) - parseDateKey(fromKey);
    return Math.round(ms / (1000 * 60 * 60 * 24));
}

function addDaysToKey(key, n) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + n);
    return dateKeyFromDate(d);
}

function dayOfYearFromKey(key) {
    const d = parseDateKey(key);
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / (1000 * 60 * 60 * 24));
}

function todayKey() {
    return dateKeyFromDate(new Date());
}

function logStatus(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    return entry.status || null;
}

// ── State ───────────────────────────────────────────────

function getDefaultState() {
    return {
        calendarDay:       1,
        todayStatus:       'none',
        todayFailCount:    0,
        lastOpenedDate:    '',
        lastCheckedDate:   '',
        attempt:           1,
        score:             { success: 0, failures: 0 },
        currentStreak:     0,
        longestStreak:     0,
        day50Count:        0,
        day100Count:       0,
        journeyMilestones: {
            75: 0, 100: 0, 150: 0, 200: 0,
            300: 0, 400: 0, 500: 0, 750: 0, 1000: 0,
        },
        bestJourney:           { success: 0, failures: 0 },
        completedJourneys:     [],
        currentJourneyStreaks: [],
        pastJourneyStreaks:    [],
        urgesSurfed:           0,
        urgeLog:               [],
        dailyLog:              {},
        recordCelebrated:      false,
    };
}

function mergeSavedState(saved) {
    const defaults = getDefaultState();
    const merged = { ...defaults, ...saved };

    merged.score = { ...defaults.score, ...(saved.score || saved.currentScore || {}) };
    merged.bestJourney = {
        ...defaults.bestJourney,
        ...(typeof saved.bestJourney === 'object' ? saved.bestJourney : {}),
        ...(typeof saved.highestScore === 'object' ? saved.highestScore : {}),
    };
    merged.journeyMilestones = { ...defaults.journeyMilestones, ...(saved.journeyMilestones || {}) };
    merged.completedJourneys = saved.completedJourneys || saved.attemptHistory || defaults.completedJourneys;
    merged.pastJourneyStreaks = saved.pastJourneyStreaks || saved.streakHistory || defaults.pastJourneyStreaks;
    merged.currentJourneyStreaks = saved.currentJourneyStreaks || saved.currentAttemptStreaks || defaults.currentJourneyStreaks;
    merged.dailyLog = saved.dailyLog || defaults.dailyLog;
    merged.urgeLog = saved.urgeLog || defaults.urgeLog;

    return merged;
}

let state = getDefaultState();

/** Replace app state in place (ES modules cannot reassign the import binding). */
function replaceState(next) {
    for (const key of Object.keys(state)) {
        delete state[key];
    }
    Object.assign(state, next);
}

// ── Business rules ──────────────────────────────────────

function updateBestJourney() {
    const { success, failures } = state.score;
    const best = state.bestJourney;
    const isBetter =
        success > best.success ||
        (success === best.success && failures < best.failures);
    if (isBetter) {
        state.bestJourney = { success, failures };
    }
}

/**
 * Log a strong day. Updates state only — UI layer handles celebrations.
 * @returns {{ streak, successCount, isNewRecord, prevLongest }}
 */
function applyStrongDay({ logDate, suppressUI = false } = {}) {
    const dateKey = logDate || todayKey();
    const calDay  = state.calendarDay;

    state.score.success++;
    state.currentStreak++;
    state.dailyLog = state.dailyLog || {};
    state.dailyLog[`day-${calDay}`] = { status: 'strong', day: calDay, date: dateKey };

    const prevLongest = state.longestStreak;
    const isNewRecord = state.currentStreak > prevLongest
        && prevLongest > 0
        && !state.recordCelebrated
        && !STREAK_MILESTONES[state.currentStreak];

    if (state.currentStreak > state.longestStreak) {
        state.longestStreak = state.currentStreak;
    }

    if (!suppressUI && isNewRecord) {
        state.recordCelebrated = true;
    }

    if (state.currentStreak === 50)  state.day50Count++;
    if (state.currentStreak === 100) state.day100Count++;

    updateBestJourney();

    if (dateKey === todayKey()) {
        state.todayStatus = 'success';
    }

    return {
        streak: state.currentStreak,
        successCount: state.score.success,
        isNewRecord: !suppressUI && isNewRecord,
        prevLongest,
    };
}

function advanceCalendarDay() {
    state.calendarDay++;
    state.todayStatus    = 'none';
    state.todayFailCount = 0;
}

/** Log a slip for a given calendar day. */
function applySlipDay({ logDate, calDay }) {
    const streakToRecord = state.todayStatus === 'none' ? state.currentStreak : 0;
    state.currentJourneyStreaks.push(streakToRecord);
    state.score.failures++;
    state.currentStreak    = 0;
    state.recordCelebrated = false;
    state.dailyLog = state.dailyLog || {};
    state.dailyLog[`day-${calDay}`] = { status: 'slip', day: calDay, date: logDate };
    state.todayFailCount++;
    updateBestJourney();

    if (logDate === todayKey()) {
        state.todayStatus = 'failed';
    }
}

/** Slip for today — single path used by manual fail button. */
function recordSlipToday() {
    applySlipDay({ logDate: todayKey(), calDay: state.calendarDay });
    return state.score.failures;
}

function journeyIsOver(s) {
    return s.score.failures >= MAX_FAILURES;
}

function buildGapDayQueue(lastOpenedDate, today) {
    const diffDays = daysBetweenKeys(lastOpenedDate, today);
    const queue = [];
    for (let i = 1; i <= diffDays; i++) {
        queue.push(addDaysToKey(lastOpenedDate, i));
    }
    return queue;
}

/**
 * Multi-day absence: every missed wall-clock day counts as strong.
 * Used when the user returns after 2+ days away.
 * @returns {{ results: Array<{result: object, suppressUI: boolean}>, journeyEnded: boolean }}
 */
function autoStrongAbsentDays(today) {
    today = today || todayKey();
    const results = [];

    if (!state.lastOpenedDate || state.lastOpenedDate === today) {
        return { results, journeyEnded: false };
    }

    const diffDays = daysBetweenKeys(state.lastOpenedDate, today);
    if (diffDays <= 1) {
        return { results, journeyEnded: false };
    }

    // Last-opened day is strong if the user never logged it
    if (state.todayStatus === 'none') {
        const result = applyStrongDay({ logDate: state.lastOpenedDate, suppressUI: true });
        results.push({ result, suppressUI: true });
        if (journeyIsOver(state)) {
            return { results, journeyEnded: true };
        }
    }

    const queue = buildGapDayQueue(state.lastOpenedDate, today);
    for (let i = 0; i < queue.length; i++) {
        const dateKey = queue[i];
        const isLast = i === queue.length - 1;

        if (dateKey === today && state.todayStatus === 'failed') continue;

        advanceCalendarDay();
        const result = applyStrongDay({ logDate: dateKey, suppressUI: !isLast });
        results.push({ result, suppressUI: !isLast });
        if (journeyIsOver(state)) {
            return { results, journeyEnded: true };
        }
    }

    return { results, journeyEnded: false };
}

/**
 * Archive journey and reset for next attempt.
 * @returns comparison data for the UI popup
 */
function endJourney() {
    state.completedJourneys.push({
        attempt: state.attempt,
        score:   { ...state.score },
        date:    new Date().toISOString(),
    });

    state.pastJourneyStreaks.push({
        attempt: state.attempt,
        streaks: [...state.currentJourneyStreaks],
        date:    new Date().toISOString(),
    });

    if (state.completedJourneys.length > 7) {
        state.completedJourneys  = state.completedJourneys.slice(-7);
        state.pastJourneyStreaks = state.pastJourneyStreaks.slice(-7);
    }

    const comparison = {
        attempt: state.attempt,
        score:   { ...state.score },
        bestStreak: Math.max(...state.currentJourneyStreaks, 0),
        prevJourney: state.completedJourneys.length >= 2
            ? state.completedJourneys[state.completedJourneys.length - 2]
            : null,
    };

    const survivingUrges = state.urgesSurfed || 0;
    const survivingLog   = state.urgeLog || [];

    state.attempt++;
    state.score                 = { success: 0, failures: 0 };
    state.currentStreak         = 0;
    state.calendarDay           = 1;
    state.currentJourneyStreaks = [];
    state.recordCelebrated      = false;
    state.dailyLog              = {};
    state.todayStatus           = 'none';
    state.todayFailCount        = 0;
    state.urgesSurfed           = survivingUrges;
    state.urgeLog               = survivingLog;
    state.lastOpenedDate        = '';
    state.lastCheckedDate       = '';

    return comparison;
}
