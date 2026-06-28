/**
 * boot.js — Service worker, button router, app startup. Load last.
 * Edit here: new data-action buttons, background refresh listeners.
 */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function dismissLoadScreen() {
    const ls = document.getElementById('loadScreen');
    if (!ls) return;
    ls.style.pointerEvents = 'none';
    ls.style.opacity = '0';
    setTimeout(() => { ls.style.display = 'none'; }, 300);
}

function showFileProtocolBanner() {
    if (location.protocol !== 'file:') return;
    const bar = document.createElement('div');
    bar.id = 'fileProtocolBanner';
    bar.textContent = 'Opened as a local file — run a local server for full PWA support. Onboarding and saves still work this session.';
    bar.style.cssText = [
        'position:fixed',
        'left:12px',
        'right:12px',
        'bottom:12px',
        'z-index:5000',
        'padding:10px 12px',
        'border-radius:12px',
        'background:#1d1d1f',
        'color:#fff',
        'font:600 12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif',
        'text-align:center',
        'box-shadow:0 8px 24px rgba(0,0,0,0.25)',
    ].join(';');
    document.body.appendChild(bar);
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
        'chart-prev': () => chartNav(-1),
        'chart-next': () => chartNav(1),
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
        'export-backup': exportProgressBackup,
        'import-backup': openImportPicker,
    };
    if (actions[action]) actions[action]();
}

document.addEventListener('click', handleDataAction, true);

document.getElementById('celebrationOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'celebrationOverlay') closeCelebration();
});

document.getElementById('resetConfirmInput')?.addEventListener('input', checkResetInput);
document.getElementById('importFileInput')?.addEventListener('change', onImportFileSelected);

// Dynamic HTML (chart SVG, science rows) still uses inline handlers — expose on window.
window.chartNav = chartNav;
window.toggleSciencePhase = toggleSciencePhase;

// Dismiss load screen early so it never blocks taps if init throws later.
setTimeout(dismissLoadScreen, 400);

try {
    init();
} catch (err) {
    console.error('King init failed:', err);
}
checkOnboarding();
showFileProtocolBanner();
if (safeGet('onboardingComplete')) {
    try { checkNewDay(); } catch (err) { console.error('King day check failed:', err); }
}

// Re-check day when user returns to app from background
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkNewDay();
        renderWeeklyStreak();
    }
});

// Move weekly timeline traveler as the day progresses (6h / 12h / 18h / 24h stages)
setInterval(() => {
    if (document.visibilityState === 'visible' && safeGet('onboardingComplete')) {
        renderWeeklyStreak();
    }
}, 5 * 60 * 1000);

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
