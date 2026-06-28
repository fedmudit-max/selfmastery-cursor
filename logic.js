/**
 * logic.js — State, storage, dates, and business rules.
 * No DOM — UI lives in ui-main.js, ui-actions.js, ui-overlays.js, ui-history.js, ui-day.js, boot.js.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════
//  STORAGE
// ════════════════════════════════════════════════════════

let _memStorage = {};

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
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

function safeGet(key) {
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch { /* file:// or private mode */ }
    try {
        const v = sessionStorage.getItem(key);
        if (v !== null) return v;
    } catch { /* same */ }
    return _memStorage[key] ?? null;
}

function safeSet(key, val) {
    try {
        localStorage.setItem(key, val);
        return;
    } catch { /* file:// or private mode */ }
    try {
        sessionStorage.setItem(key, val);
        return;
    } catch { /* same */ }
    _memStorage[key] = val;
}

function safeRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    delete _memStorage[key];
}

const BACKUP_FORMAT = 'king-backup';
const BACKUP_VERSION = 1;

/** Snapshot of app state for export to a JSON file on the user's device. */
function buildBackupPayload() {
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        onboardingComplete: safeGet('onboardingComplete') === 'true',
        state: JSON.parse(JSON.stringify(state)),
    };
}

/**
 * Parse an exported backup file (or raw saved state JSON).
 * @returns {{ ok: true, state, exportedAt, onboardingComplete } | { ok: false, error: string }}
 */
function parseBackupJson(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: 'invalid-json' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'invalid-json' };
    }

    let saved = parsed;
    let exportedAt = null;
    let onboardingComplete = null;

    if (parsed.format === BACKUP_FORMAT) {
        if (!parsed.state || typeof parsed.state !== 'object') {
            return { ok: false, error: 'missing-state' };
        }
        saved = parsed.state;
        exportedAt = parsed.exportedAt || null;
        onboardingComplete = parsed.onboardingComplete;
    }

    if (typeof saved.attempt !== 'number' || !saved.score || typeof saved.score !== 'object') {
        return { ok: false, error: 'not-king-backup' };
    }

    return {
        ok: true,
        state: mergeSavedState(saved),
        exportedAt,
        onboardingComplete,
    };
}

function recordLastBackupAt(iso) {
    safeSet(LAST_BACKUP_KEY, iso || new Date().toISOString());
}

function clearLastBackupAt() {
    safeRemove(LAST_BACKUP_KEY);
}

function formatLastBackupLabel() {
    const raw = safeGet(LAST_BACKUP_KEY);
    if (!raw) return 'Never';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 'Never';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ════════════════════════════════════════════════════════
//  DATES — local timezone; never parse YYYY-MM-DD as UTC
// ════════════════════════════════════════════════════════

function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dateKeyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function daysBetweenKeys(fromKey, toKey) {
    return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / MS_PER_DAY);
}

function addDaysToKey(key, n) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + n);
    return dateKeyFromDate(d);
}

function dayOfYearFromKey(key) {
    const d = parseDateKey(key);
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / MS_PER_DAY);
}

function todayKey() {
    const offset = state?.devDateOffset || 0;
    if (!offset) return dateKeyFromDate(new Date());
    return addDaysToKey(dateKeyFromDate(new Date()), offset);
}

// ════════════════════════════════════════════════════════
//  DAILY LOG HELPERS
// ════════════════════════════════════════════════════════

function logStatus(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    return entry.status || null;
}

function dailyLogKey(calDay) {
    return `day-${calDay}`;
}

/** Stable key for dailyLog — wall date so entries survive across journeys. */
function dailyLogStorageKey(calDay, patch) {
    return (patch && patch.date) ? patch.date : dailyLogKey(calDay);
}

function writeDailyLog(calDay, patch) {
    state.dailyLog = state.dailyLog || {};
    state.dailyLog[dailyLogStorageKey(calDay, patch)] = patch;
}

function nextSlipCount(logDate, calDay) {
    const key = logDate || dailyLogKey(calDay);
    const prev = state.dailyLog?.[key];
    if (prev && logStatus(prev) === 'slip') {
        return (prev.slipCount || 1) + 1;
    }
    return 1;
}

/** Re-key legacy day-N entries to YYYY-MM-DD when a date is stored on the entry. */
function migrateDailyLogToDateKeys(log) {
    const out = {};
    for (const [key, entry] of Object.entries(log || {})) {
        if (typeof entry === 'object' && entry.date) {
            out[entry.date] = entry;
        } else {
            out[key] = entry;
        }
    }
    return out;
}

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════

function getDefaultState() {
    return {
        calendarDay: 1,
        todayStatus: 'none',
        todayFailCount: 0,
        lastOpenedDate: '',
        lastCheckedDate: '',
        attempt: 1,
        score: { success: 0, failures: 0 },
        currentStreak: 0,
        longestStreak: 0,
        longestStreakAtStreakStart: 0,
        day50Count: 0,
        day100Count: 0,
        journeyMilestones: {
            75: 0, 100: 0, 150: 0, 200: 0,
            300: 0, 400: 0, 500: 0, 750: 0, 1000: 0,
        },
        bestJourney: { success: 0, failures: 0 },
        completedJourneys: [],
        currentJourneyStreaks: [],
        pastJourneyStreaks: [],
        urgesSurfed: 0,
        urgeLog: [],
        dailyLog: {},
        recordCelebrated: false,
        pendingNextJourney: false,
        journeyEndedDate: '',
        devDateOffset: 0,
    };
}

/** Infer personal-best baseline for saves that predate longestStreakAtStreakStart. */
function migrateLongestStreakAtStart(merged, saved) {
    if (saved.longestStreakAtStreakStart !== undefined) {
        return merged.longestStreakAtStreakStart;
    }
    const streak = merged.currentStreak || 0;
    const longest = merged.longestStreak || 0;
    if (streak === 0) return longest;
    if (streak < longest) return longest;
    return 0;
}

/** Backfill slipCount on today's log entry from todayFailCount (legacy saves). */
function syncTodaySlipCountInLog(s) {
    if (s.todayStatus !== 'failed' || s.todayFailCount < 2) return;
    const dateKey = s.lastOpenedDate || todayKey();
    const entry = s.dailyLog?.[dateKey] || s.dailyLog?.[dailyLogKey(s.calendarDay)];
    if (entry && logStatus(entry) === 'slip') {
        entry.slipCount = Math.max(entry.slipCount || 1, s.todayFailCount);
    }
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
    merged.dailyLog = migrateDailyLogToDateKeys(saved.dailyLog || defaults.dailyLog);
    merged.urgeLog = saved.urgeLog || defaults.urgeLog;
    merged.longestStreakAtStreakStart = migrateLongestStreakAtStart(merged, saved);

    syncTodaySlipCountInLog(merged);
    return merged;
}

let state = getDefaultState();

/** Replace app state in place so every script keeps the same global state object. */
function replaceState(next) {
    for (const key of Object.keys(state)) {
        delete state[key];
    }
    Object.assign(state, next);
}

// ════════════════════════════════════════════════════════
//  SCORING & JOURNEY RULES
// ════════════════════════════════════════════════════════

function formatJourneyScore(score) {
    return `${score.success}/${score.failures}`;
}

function isBetterJourneyScore(success, failures, best) {
    if (success > best.success) return true;
    if (success < best.success) return false;
    // Same strong-day count — at 9–10 failures the full score (including failures) counts.
    if (failures >= MAX_FAILURES - 1) {
        return failures >= best.failures;
    }
    return failures < best.failures;
}

function pickBetterJourneyScore(candidate, best) {
    return isBetterJourneyScore(candidate.success, candidate.failures, best)
        ? { success: candidate.success, failures: candidate.failures }
        : { success: best.success, failures: best.failures };
}

function bestScoreFromCompletedJourneys(journeys) {
    if (!journeys.length) return null;
    return journeys.reduce(
        (best, journey) => pickBetterJourneyScore(journey.score, best),
        { success: 0, failures: 0 },
    );
}

/** Best score shown in the header — includes live 9/10-failure progress. */
function getDisplayBestJourney() {
    const { success, failures } = state.score;
    if (failures >= MAX_FAILURES - 1) {
        return pickBetterJourneyScore({ success, failures }, state.bestJourney);
    }
    return state.bestJourney;
}

function updateBestJourney() {
    const { success, failures } = state.score;
    if (isBetterJourneyScore(success, failures, state.bestJourney)) {
        state.bestJourney = { success, failures };
    }
}

function isAwaitingNextJourney() {
    return !!state.pendingNextJourney;
}

function journeyIsOver(s) {
    return s.score.failures >= MAX_FAILURES;
}

function canLogToday() {
    return !isAwaitingNextJourney() && !journeyIsOver(state);
}

function streakSegmentBeforeSlip() {
    // First slip of the calendar day archives the streak built so far.
    return state.todayStatus === 'none' ? state.currentStreak : 0;
}

function isPersonalBestStreak(streak, recordToBeat) {
    return streak > recordToBeat
        && recordToBeat > 0
        && !state.recordCelebrated
        && !STREAK_MILESTONES[streak];
}

/** Which Day 1–7 insight to show — the day you're working on, not the last one completed. */
function getWeeklyInsightDay(progress) {
    if (!progress || progress <= 0) return 1;
    if (progress >= 7) return state.todayStatus === 'success' ? 7 : 1;
    if (state.todayStatus === 'success') return progress;
    return progress + 1;
}

/** Latest wall-date (YYYY-MM-DD) with a strong-day log entry. */
function getLastStrongLogDate() {
    const log = state.dailyLog || {};
    let latest = '';
    for (const entry of Object.values(log)) {
        if (logStatus(entry) !== 'strong') continue;
        const date = typeof entry === 'object' && entry.date ? entry.date : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest) latest = date;
    }
    return latest;
}

/** After a full 7-day week, show a fresh timeline from the next calendar day onward. */
function shouldRefreshWeeklyTimeline(streak) {
    if (!streak || streak <= 0 || streak % 7 !== 0) return false;
    const lastStrong = getLastStrongLogDate();
    if (!lastStrong) return state.todayStatus !== 'success';
    return lastStrong !== todayKey();
}

/** Day 1–7 within the current weekly streak cycle (0 when no streak). Resets after every 7 days. */
function getWeeklyStreakDay(streak) {
    if (!streak || streak <= 0) return 0;
    if (shouldRefreshWeeklyTimeline(streak)) return 0;
    return ((streak - 1) % 7) + 1;
}

/** Which 7-day week of the current streak (1-based). */
function getWeeklyStreakWeek(streak) {
    if (!streak || streak <= 0) return 0;
    return Math.floor((streak - 1) / 7) + 1;
}

/** Measured layout: label span + dot centers (% of track width). */
let weeklyTrackLayout = null;

function setWeeklyTrackLayout(layout) {
    weeklyTrackLayout = layout;
}

/** Center of day N (1–7) on the weekly track, as % of track width. */
function getWeeklyDotCenterPct(day) {
    if (weeklyTrackLayout?.dotCenters) {
        return weeklyTrackLayout.dotCenters[day - 1];
    }
    return ((2 * day - 1) / 14) * 100;
}

/** 0–1 progress along today's segment (8h→⅓, 16h→⅔, 24h→100%). */
function getIntraDaySegmentProgress() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    if (hours < 8) return (hours / 8) * (1 / 3);
    if (hours < 16) return (1 / 3) + ((hours - 8) / 8) * (1 / 3);
    return (2 / 3) + ((hours - 16) / 8) * (1 / 3);
}

/** Green connector fill % along the stretched line to match traveler position. */
function getWeeklyGreenPct(streak) {
    const progress = getWeeklyStreakDay(streak);
    if (progress <= 0) return 0;

    let travelerPct;
    if (progress >= 7) {
        travelerPct = getWeeklyDotCenterPct(7);
    } else if (state.todayStatus === 'success') {
        travelerPct = getWeeklyDotCenterPct(progress);
    } else {
        const from = getWeeklyDotCenterPct(progress);
        const to   = getWeeklyDotCenterPct(progress + 1);
        travelerPct = from + (to - from) * getIntraDaySegmentProgress();
    }

    if (weeklyTrackLayout?.lineLeftPct != null) {
        const lineWidth = weeklyTrackLayout.lineRightPct - weeklyTrackLayout.lineLeftPct;
        if (lineWidth <= 0) return 0;
        return Math.min(100, Math.max(0,
            ((travelerPct - weeklyTrackLayout.lineLeftPct) / lineWidth) * 100));
    }

    if (progress >= 7) return 100;
    if (state.todayStatus === 'success') {
        return (progress / 6) * 100;
    }
    return ((progress - 1 + getIntraDaySegmentProgress()) / 6) * 100;
}

/** Active dot position (% from left) sliding toward the next day dot through the day. */
function getWeeklyActiveTraveler(streak) {
    const progress = getWeeklyStreakDay(streak);
    if (!progress) return null;
    if (progress >= 7) {
        return { leftPct: getWeeklyDotCenterPct(7) };
    }
    if (state.todayStatus === 'success') {
        return { leftPct: getWeeklyDotCenterPct(progress) };
    }
    const from = getWeeklyDotCenterPct(progress);
    const to = getWeeklyDotCenterPct(progress + 1);
    const t = getIntraDaySegmentProgress();
    return { leftPct: from + (to - from) * t };
}

function markTodayStatus(dateKey, status) {
    if (dateKey === todayKey()) {
        state.todayStatus = status;
    }
}

// ════════════════════════════════════════════════════════
//  DAY LOGGING
// ════════════════════════════════════════════════════════

/**
 * Log a strong day. Updates state only — UI layer handles celebrations.
 * @returns {{ streak, successCount, isNewRecord, prevLongest, recordToBeat }}
 */
function applyStrongDay({ logDate, suppressUI = false } = {}) {
    if (!canLogToday()) {
        return {
            streak: state.currentStreak,
            successCount: state.score.success,
            isNewRecord: false,
            prevLongest: state.longestStreak,
            recordToBeat: state.longestStreakAtStreakStart,
        };
    }

    const dateKey = logDate || todayKey();
    const calDay = state.calendarDay;

    state.score.success++;
    state.currentStreak++;

    writeDailyLog(calDay, { status: 'strong', day: calDay, date: dateKey });

    const prevLongest = state.longestStreak;
    const recordToBeat = state.longestStreakAtStreakStart;
    const isNewRecord = isPersonalBestStreak(state.currentStreak, recordToBeat);

    if (state.currentStreak > state.longestStreak) {
        state.longestStreak = state.currentStreak;
    }

    if (!suppressUI && isNewRecord) {
        state.recordCelebrated = true;
    }

    if (state.currentStreak === 50) state.day50Count++;
    if (state.currentStreak === 100) state.day100Count++;

    updateBestJourney();
    markTodayStatus(dateKey, 'success');

    return {
        streak: state.currentStreak,
        successCount: state.score.success,
        isNewRecord: !suppressUI && isNewRecord,
        prevLongest,
        recordToBeat,
    };
}

function advanceCalendarDay() {
    state.calendarDay++;
    state.todayStatus = 'none';
    state.todayFailCount = 0;
}

/** Log a slip for a given calendar day. Each slip uses one journey chance; slipCount tracks multiples same day. */
function applySlipDay({ logDate, calDay }) {
    state.currentJourneyStreaks.push(streakSegmentBeforeSlip());
    state.score.failures++;
    state.longestStreakAtStreakStart = state.longestStreak;
    state.currentStreak = 0;
    state.recordCelebrated = false;

    writeDailyLog(calDay, {
        status: 'slip',
        day: calDay,
        date: logDate,
        slipCount: nextSlipCount(logDate, calDay),
    });

    state.todayFailCount++;
    updateBestJourney();
    markTodayStatus(logDate, 'failed');
}

/** Slip for today — single path used by manual fail button. */
function recordSlipToday() {
    applySlipDay({ logDate: todayKey(), calDay: state.calendarDay });
    return state.score.failures;
}

// ════════════════════════════════════════════════════════
//  ABSENCE / CATCH-UP
// ════════════════════════════════════════════════════════

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
 * @returns {Array<{result: object, suppressUI: boolean}>}
 */
function autoStrongAbsentDays(today) {
    today = today || todayKey();
    const results = [];

    if (!state.lastOpenedDate || state.lastOpenedDate === today) {
        return results;
    }

    if (daysBetweenKeys(state.lastOpenedDate, today) <= 1) {
        return results;
    }

    // Last-opened day counts as strong if the user never logged it.
    if (state.todayStatus === 'none') {
        results.push({
            result: applyStrongDay({ logDate: state.lastOpenedDate, suppressUI: true }),
            suppressUI: true,
        });
    }

    const queue = buildGapDayQueue(state.lastOpenedDate, today);
    for (let i = 0; i < queue.length; i++) {
        const dateKey = queue[i];
        const isLast = i === queue.length - 1;

        if (dateKey === today && state.todayStatus === 'failed') continue;

        advanceCalendarDay();
        results.push({
            result: applyStrongDay({ logDate: dateKey, suppressUI: !isLast }),
            suppressUI: !isLast,
        });
    }

    return results;
}

// ════════════════════════════════════════════════════════
//  JOURNEY END
// ════════════════════════════════════════════════════════

/**
 * Archive the completed journey and wait until the next calendar day to begin the next one.
 * @returns comparison data for the UI popup, or null if already archived
 */
function archiveCompletedJourney() {
    if (isAwaitingNextJourney()) return null;

    const prevBestScore = bestScoreFromCompletedJourneys(state.completedJourneys);
    const comparison = {
        attempt: state.attempt,
        score: { ...state.score },
        prevBestScore,
    };

    state.completedJourneys.push({
        attempt: state.attempt,
        score: { ...state.score },
        date: new Date().toISOString(),
    });

    state.pastJourneyStreaks.push({
        attempt: state.attempt,
        streaks: [...state.currentJourneyStreaks],
        date: new Date().toISOString(),
    });

    state.pendingNextJourney = true;
    state.journeyEndedDate = todayKey();

    return comparison;
}

/** Start the next journey after the ended journey's calendar day has passed. */
function beginNextJourney() {
    if (!isAwaitingNextJourney()) return;

    state.attempt++;
    state.score = { success: 0, failures: 0 };
    state.longestStreakAtStreakStart = state.longestStreak;
    state.currentStreak = 0;
    state.calendarDay = 1;
    state.currentJourneyStreaks = [];
    state.recordCelebrated = false;
    state.todayStatus = 'none';
    state.todayFailCount = 0;
    state.pendingNextJourney = false;
    state.journeyEndedDate = '';
}
