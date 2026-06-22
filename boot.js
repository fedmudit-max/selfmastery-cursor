/**
 * boot.js — Service worker, button router, app startup. Load last.
 * Edit here: new data-action buttons, background refresh listeners.
 */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

(function () {
    'use strict';
    if (window.__KING_NOFAP_BOOTED__) return;
    window.__KING_NOFAP_BOOTED__ = true;

function handleDataAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const action = btn.dataset.action;
    const now = Date.now();
    if (btn === lastActionTap.btn && action === lastActionTap.action && now - lastActionTap.at < 600) return;
    lastActionTap = { btn, action, at: now };

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
        closeCelebration: closeCelebration,
        modalCancel: closeModal,
        modalConfirm: confirmAction,
        urgeSurvived: urgeSurvived,
        closeUrge: closeUrge,
        closeCompare: closeCompare,
        'dev-next-day': devAdvanceOneDay,
    };
    if (actions[action]) actions[action]();
}

document.addEventListener('click', handleDataAction, true);

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
