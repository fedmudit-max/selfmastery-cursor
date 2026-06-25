/**
 * ui-actions.js — User taps: strong, slip, reset, modals, journey end.
 * Edit here: what happens when the user logs or confirms an action.
 */

// ════════════════════════════════════════════════════════
//  USER ACTIONS
// ════════════════════════════════════════════════════════

let pendingImportBackup = null;

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
        action === 'import'  ? formatImportConfirmMessage() :
        'Today was hard. Log it and keep going?';
    document.getElementById('modalConfirmBtn').textContent =
        action === 'success' ? 'Confirm' :
        action === 'reset'   ? 'Yes, reset all' :
        action === 'import'  ? 'Restore progress' :
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
    pendingImportBackup = null;
}

function confirmAction() {
    const action = pendingAction;
    if (!action) return;
    const importBackup = action === 'import' ? pendingImportBackup : null;
    pendingAction = null;
    pendingImportBackup = null;

    const confirmBtn = document.getElementById('modalConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    closeModal();

    if (action === 'success') recordSuccess();
    else if (action === 'fail') recordFailure();
    else if (action === 'reset') resetAll();
    else if (action === 'import') restoreImportBackup(importBackup);
}

function resetAll() {
    safeRemove(STORAGE_KEY);
    safeRemove('onboardingComplete');
    clearLastBackupAt();
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
            message: `You just beat your personal best! Old record: ${result.recordToBeat} days. You are rewriting your own limits.`,
        }), 400);
    }
    triggerStreakMilestone(result.streak);
    checkJourneyMilestone(result.successCount, false);
}

let lastSlipAt = 0;

function recordFailure() {
    const now = Date.now();
    if (now - lastSlipAt < 800) return;
    lastSlipAt = now;

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
        { attempt: comparison.attempt, score: comparison.score },
        comparison.prevBestScore
    ), 600);
}

function checkJourneyMilestone(successCount, suppressUI = false) {
    if (!JOURNEY_MILESTONES[successCount]) return;
    state.journeyMilestones[successCount] = (state.journeyMilestones[successCount] || 0) + 1;
    if (!suppressUI) triggerJourneyMilestone(successCount);
}

// ════════════════════════════════════════════════════════
//  BACKUP — export / import JSON on device
// ════════════════════════════════════════════════════════

function formatImportConfirmMessage() {
    if (!pendingImportBackup) return 'Restore this export? Current progress on this device will be replaced.';
    const when = pendingImportBackup.exportedAt
        ? new Date(pendingImportBackup.exportedAt).toLocaleString()
        : 'an earlier save';
    const journey = pendingImportBackup.state?.attempt || 1;
    return `Restore progress exported ${when}? (Journey ${journey}) This replaces your current progress on this device.`;
}

function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function downloadBackupFile(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function finishBackupExport(iso) {
    recordLastBackupAt(iso);
    renderBackupStatus();
}

function exportProgressBackup() {
    if (!isMobileDevice()) {
        showToast(0, 'Export is available on your phone — open the King app there.');
        return;
    }

    const payload = buildBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const filename = `king-backup-${todayKey()}.json`;
    const file = new File([json], filename, { type: 'application/json' });
    const exportedAt = payload.exportedAt;

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], title: 'King progress export' })
            .then(() => {
                finishBackupExport(exportedAt);
                showToast(0, 'Export ready — save to Files or iCloud.');
            })
            .catch((e) => {
                if (e?.name === 'AbortError') return;
                downloadBackupFile(json, filename);
                finishBackupExport(exportedAt);
                showToast(0, 'Export saved to downloads.');
            });
        return;
    }

    downloadBackupFile(json, filename);
    finishBackupExport(exportedAt);
    showToast(0, 'Export saved to downloads.');
}

function openImportPicker() {
    if (!isMobileDevice()) {
        showToast(0, 'Import is available on your phone — open the King app there.');
        return;
    }
    document.getElementById('importFileInput')?.click();
}

function onImportFileSelected(e) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const result = parseBackupJson(String(reader.result || ''));
        if (!result.ok) {
            const msg = result.error === 'invalid-json'
                ? 'That file is not valid JSON.'
                : 'That is not a valid King export file.';
            showToast(0, msg);
            return;
        }
        pendingImportBackup = result;
        showModal('import');
    };
    reader.onerror = () => showToast(0, 'Could not read that file.');
    reader.readAsText(file);
}

function restoreImportBackup(backup) {
    if (!backup?.state) {
        showToast(0, 'Nothing to restore.');
        return;
    }
    replaceState(backup.state);
    if (backup.onboardingComplete === true) {
        safeSet('onboardingComplete', 'true');
    } else if (backup.onboardingComplete === false) {
        safeRemove('onboardingComplete');
    }
    chartPage = -1;
    chartMode = 'streaks';
    currentTab = 0;
    switchTab(0);
    if (backup.exportedAt) recordLastBackupAt(backup.exportedAt);
    saveToStorage(state);
    renderAll();
    if (safeGet('onboardingComplete')) checkNewDay();
    else checkOnboarding();
    showToast(0, 'Progress restored.');
}