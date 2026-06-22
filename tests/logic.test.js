/**
 * Tests for logic.js — run with: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_FAILURES } from '../data.js';
import {
    parseDateKey,
    daysBetweenKeys,
    addDaysToKey,
    mergeSavedState,
    getDefaultState,
    replaceState,
    endJourney,
    journeyIsOver,
    buildGapDayQueue,
    applySlipDay,
    recordSlipToday,
    state,
} from '../logic.js';

describe('dates', () => {
    it('daysBetweenKeys counts calendar days in local time', () => {
        assert.equal(daysBetweenKeys('2025-06-01', '2025-06-04'), 3);
        assert.equal(daysBetweenKeys('2025-06-01', '2025-06-01'), 0);
    });

    it('addDaysToKey steps forward correctly', () => {
        assert.equal(addDaysToKey('2025-06-01', 1), '2025-06-02');
        assert.equal(addDaysToKey('2025-12-31', 1), '2026-01-01');
    });

    it('parseDateKey uses local date parts', () => {
        const d = parseDateKey('2025-03-15');
        assert.equal(d.getFullYear(), 2025);
        assert.equal(d.getMonth(), 2);
        assert.equal(d.getDate(), 15);
    });
});

describe('mergeSavedState', () => {
    it('fills missing nested score.failures from defaults', () => {
        const merged = mergeSavedState({ score: { success: 42 } });
        assert.equal(merged.score.success, 42);
        assert.equal(merged.score.failures, 0);
    });

    it('maps legacy key names', () => {
        const merged = mergeSavedState({
            currentScore: { success: 10, failures: 2 },
            attemptHistory: [{ attempt: 1, score: { success: 5, failures: 1 } }],
        });
        assert.equal(merged.score.success, 10);
        assert.equal(merged.completedJourneys.length, 1);
    });
});

describe('journey end', () => {
    it('returns best streak before state reset', () => {
        replaceState(getDefaultState());
        const s = getDefaultState();
        s.currentJourneyStreaks = [5, 12, 20];
        s.score = { success: 87, failures: MAX_FAILURES };
        s.attempt = 2;
        replaceState(s);

        const comparison = endJourney();

        assert.equal(comparison.bestStreak, 20);
        assert.equal(comparison.attempt, 2);
        assert.equal(comparison.score.success, 87);
        assert.equal(state.attempt, 3);
        assert.equal(state.score.failures, 0);
    });
});

describe('slips', () => {
    it('recordSlipToday uses single code path', () => {
        replaceState(getDefaultState());
        const failures = recordSlipToday();
        assert.equal(failures, 1);
        assert.equal(journeyIsOver(state), false);
    });

    it('journey ends at MAX_FAILURES', () => {
        replaceState(getDefaultState());
        for (let i = 0; i < MAX_FAILURES; i++) {
            applySlipDay({ logDate: '2025-06-01', calDay: 1 + i });
        }
        assert.equal(journeyIsOver(state), true);
    });
});

describe('gap queue', () => {
    it('lists each missed day up to today', () => {
        const queue = buildGapDayQueue('2025-06-01', '2025-06-04');
        assert.deepEqual(queue, ['2025-06-02', '2025-06-03', '2025-06-04']);
    });
});
