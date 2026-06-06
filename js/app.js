/**
 * app.js — Main Application Logic
 * PI Retrospective App — SAFe 6.0
 *
 * Depends on: store.js, ai-engine.js, polarion.js (loaded before this file)
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   APP STATE
   ═══════════════════════════════════════════════════════════════ */
let state = {
  retro: null,
  currentPhase: 0,
  currentUser: null,        // Active logged-in participant object
  pendingNoteColumn: null,
  pendingNoteId: null,
  pendingActionId: null,
  aiSuggestions: [],
  polarionToken: '',
  polarionConnected: false,
  confirmCallback: null
};

const PHASES = [
  { id: 'phase-setup',        label: 'Setup',        icon: '🚀' },
  { id: 'phase-participants', label: 'Participants',  icon: '👥' },
  { id: 'phase-context',      label: 'PI Context',   icon: '📅' },
  { id: 'phase-board',        label: 'Retro Board',  icon: '🗂️' },
  { id: 'phase-actions',      label: 'Actions',      icon: '⚡' },
  { id: 'phase-analytics',    label: 'Analytics',    icon: '📊' },
  { id: 'phase-report',       label: 'Report',       icon: '📋' },
  { id: 'phase-export',       label: 'Export',       icon: '📤' }
];

/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */
const Toast = {
  show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${_escHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toast-out 300ms ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

/* ═══════════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════════ */
function _escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmt(dateStr) {
  if (!dateStr) return '';
  try { return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return dateStr; }
}

function _allParticipants() {
  if (!state.retro) return [];
  const sorted = [...(state.retro.participants || [])]
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [state.retro.host, ...sorted].filter(Boolean);
}

function _participantById(id) {
  return _allParticipants().find(p => p.id === id) || null;
}

function _participantName(id) {
  return _participantById(id)?.name || 'Unknown';
}

function _populateParticipantSelect(selectEl, includeBlank = true) {
  // _allParticipants() already returns host-first, then members sorted A→Z
  const parts = _allParticipants();
  let html = includeBlank ? '<option value="">— Select —</option>' : '';
  for (const p of parts) {
    html += `<option value="${_escHtml(p.id)}">${_escHtml(p.name)}${p.isHost ? ' (Host)' : ''}</option>`;
  }
  selectEl.innerHTML = html;
}

function _avatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function _autoSave() {
  if (state.retro) {
    Store.saveActive(state.retro)
      .then(() => {
        // Silent success for auto-save
        const indicator = document.getElementById('auto-save-indicator');
        if (indicator) indicator.style.opacity = '1';
      })
      .catch(e => {
        console.error('Auto-save failed:', e);
        // Show error only if critical (not just network timeout)
        if (e.message && e.message.includes('Firebase')) {
          Toast.show('⚠️ Save failed - using local storage', 'warning', 5000);
        }
      });
  }
}

function _isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function _appUrl() {
  // Returns the base URL of the app (origin + path, no hash/query)
  const loc = window.location;
  return loc.origin + loc.pathname;
}

/* ── OTP / Invitation Helpers ───────────────────────────────── */
function _generateOTP() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, '0');
}

function _loadOTPs() {
  try { return JSON.parse(sessionStorage.getItem('pi-retro-otps') || '{}'); }
  catch { return {}; }
}

function _storeOTP(participantId, otp) {
  const stored = _loadOTPs();
  stored[participantId] = { otp, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  sessionStorage.setItem('pi-retro-otps', JSON.stringify(stored));
}

function _clearOTP(participantId) {
  const stored = _loadOTPs();
  delete stored[participantId];
  sessionStorage.setItem('pi-retro-otps', JSON.stringify(stored));
}

function _validateOTP(inputOtp) {
  const trimmed = inputOtp.trim();
  if (!trimmed) return null;
  const stored = _loadOTPs();
  for (const [pid, entry] of Object.entries(stored)) {
    if (entry.otp === trimmed && Date.now() < entry.expiresAt) {
      return _participantById(pid);
    }
  }
  return null;
}

function _openInviteModal() {
  const participants = (state.retro?.participants || []).filter(p => !p.isHost);

  // Generate OTPs for all participants (re-use unexpired ones)
  const otps = _loadOTPs();
  participants.forEach(p => {
    if (!otps[p.id] || Date.now() >= otps[p.id].expiresAt) {
      _storeOTP(p.id, _generateOTP());
    }
  });
  const freshOtps = _loadOTPs();

  const rows = participants.map(p => {
    const otp = freshOtps[p.id]?.otp || '------';
    const email = p.email;
    const appUrl = _appUrl();
    const mailtoBody = encodeURIComponent(
      `Hi ${p.name},\n\nYou have been invited to join the "${state.retro?.piName || 'PI Retrospective'}" board.\n\nClick the link below to open the app:\n${appUrl}\n\nOnce the page loads, enter your one-time login code when prompted:\n\n    ${otp}\n\nThis code is valid for 24 hours.\n\n— ${state.retro?.host?.name || 'The Host'}`
    );
    const mailtoSubject = encodeURIComponent(`Invitation: PI Retrospective — ${state.retro?.piName || ''}`);
    const mailtoHref = email
      ? `mailto:${encodeURIComponent(email)}?subject=${mailtoSubject}&body=${mailtoBody}`
      : null;

    return `
      <div class="invite-row" data-invite-pid="${_escHtml(p.id)}">
        <div class="invite-row-avatar" style="background:${_escHtml(p.color || '#0052CC')}">${_escHtml(_avatarInitials(p.name))}</div>
        <div class="invite-row-info">
          <div class="invite-row-name">${_escHtml(p.name)}</div>
          <div class="invite-row-email">${email ? _escHtml(email) : '<em class="no-email">No email registered</em>'}</div>
        </div>
        <div class="invite-row-otp">
          <span class="otp-code" id="otp-code-${_escHtml(p.id)}">${_escHtml(otp)}</span>
        </div>
        <div class="invite-row-actions">
          <button class="btn btn-sm btn-outline copy-otp-btn" data-copy-pid="${_escHtml(p.id)}" title="Copy code to clipboard">📋 Copy</button>
          ${mailtoHref ? `<a class="btn btn-sm btn-primary" href="${mailtoHref}" target="_blank" rel="noopener noreferrer">✉️ Send Email</a>` : ''}
          <button class="btn btn-sm btn-ghost regen-otp-btn" data-regen-pid="${_escHtml(p.id)}" title="Regenerate code">🔄</button>
        </div>
      </div>`;
  });

  const bodyEl = document.getElementById('invite-modal-body');
  if (!bodyEl) return;

  bodyEl.innerHTML = participants.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:32px">No participants added yet. Go to the Participants step to add team members.</p>'
    : `<p class="invite-modal-hint">Each participant receives a unique 6-digit code valid for 24 hours. They enter it on the login screen to identify themselves on this board.</p>
       <div class="invite-list">${rows.join('')}</div>`;

  _showModal('invite-modal');
}

function _isHost() {
  return state.currentUser?.isHost === true;
}

/* ══════════════════════════════════════════════════════════════
   LOADER / SPINNER HELPERS
   ══════════════════════════════════════════════════════════════ */
function _showLoader(show = true, text = 'Loading...') {
  const loader = document.getElementById('app-loader');
  if (!loader) return;
  if (show) {
    const textEl = loader.querySelector('.loader-text');
    if (textEl) textEl.textContent = text;
    loader.classList.remove('hidden');
  } else {
    loader.classList.add('hidden');
  }
}

function _hideLoader() {
  _showLoader(false);
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════ */
function _showPhase(phaseIndex) {
  // Members (non-hosts) can only access the Retro Board phase
  if (!_isHost()) phaseIndex = 3;

  // Validate index
  if (phaseIndex < 0 || phaseIndex >= PHASES.length) return;

  // Show loader
  const phaseName = PHASES[phaseIndex]?.label || 'Loading';
  _showLoader(true, `Loading ${phaseName}...`);

  // Hide all phases
  PHASES.forEach((p, i) => {
    const el = document.getElementById(p.id);
    if (el) el.classList.toggle('hidden', i !== phaseIndex);
  });

  state.currentPhase = phaseIndex;
  _renderWizardNav();
  _refreshPhaseContent(phaseIndex);

  // Hide loader after content is refreshed
  setTimeout(() => _hideLoader(), 300);

  // Scroll to top
  document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function _refreshCurrentPhase() {
  // Re-render the current phase to reflect changes from real-time sync
  if (state.currentPhase !== undefined && state.currentPhase >= 0) {
    // CRITICAL: Ensure data structures exist before rendering
    if (!state.retro.piContext) state.retro.piContext = { events: [], milestones: [], specialOccurrences: [] };
    if (!state.retro.actionItems) state.retro.actionItems = [];
    
    // Show subtle indicator that data was synced from another user
    const indicator = document.getElementById('auto-save-indicator');
    if (indicator) {
      indicator.title = 'Data synchronized from another user';
      indicator.style.opacity = '0.7';
      setTimeout(() => { if (indicator) indicator.style.opacity = '1'; }, 2000);
    }
    _refreshPhaseContent(state.currentPhase);
  }
}

function _renderWizardNav() {
  const nav = document.getElementById('step-wizard');
  if (!nav) return;
  const isHost = _isHost();
  nav.innerHTML = PHASES.map((p, i) => {
    // Members only see the Retro Board phase
    if (!isHost && i !== 3) return '';

    let cls = '';
    if (i === state.currentPhase) cls = 'active';
    else if (i < state.currentPhase) cls = 'completed';

    const numContent = i < state.currentPhase ? '✓' : (i + 1);
    return `
      <div class="step-item">
        ${isHost && i > 0 ? '<span class="step-sep">›</span>' : ''}
        <button class="step-btn ${cls}" data-phase="${i}" title="${_escHtml(p.label)}">
          <span class="step-num">${numContent}</span>
          <span class="step-label">${_escHtml(p.label)}</span>
        </button>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   HOME SCREEN
   ═══════════════════════════════════════════════════════════════ */
function _showHome() {
  document.getElementById('home-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
  state.retro = null;
  _renderHistory();
}

function _showApp(retro, isNew = false) {
  // CRITICAL: Ensure data structures exist
  if (!retro.piContext) retro.piContext = { events: [], milestones: [], specialOccurrences: [] };
  if (!retro.actionItems) retro.actionItems = [];
  
  state.retro = retro;
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  // Set up real-time listener for live collaboration
  Store.subscribeToActive((updatedRetro) => {
    if (updatedRetro) {
      // CRITICAL: Ensure data structures exist in updated data too
      if (!updatedRetro.piContext) updatedRetro.piContext = { events: [], milestones: [], specialOccurrences: [] };
      if (!updatedRetro.actionItems) updatedRetro.actionItems = [];
      
      // SMART MERGE: Only update from Firestore if timestamp is newer
      // This prevents stale listener data from overwriting local edits
      const currentUpdatedAt = state.retro?.updatedAt ? new Date(state.retro.updatedAt) : null;
      const incomingUpdatedAt = updatedRetro.updatedAt ? new Date(updatedRetro.updatedAt) : null;
      
      // Only replace if Firestore data is actually newer
      if (!currentUpdatedAt || (incomingUpdatedAt && incomingUpdatedAt > currentUpdatedAt)) {
        state.retro = updatedRetro;
      } else {
        // Local version is newer - only update metadata that won't affect user edits
        // Merge only safe fields: host name, session mode, objectives
        if (state.retro) {
          state.retro.host = updatedRetro.host;
          state.retro.piName = updatedRetro.piName;
          state.retro.artName = updatedRetro.artName;
          state.retro.teamName = updatedRetro.teamName;
          state.retro.piObjectives = updatedRetro.piObjectives;
          state.retro.sessionMode = updatedRetro.sessionMode;
        }
      }
      // Refresh UI to show updated data
      _refreshCurrentPhase();
    }
  }).catch(err => {
    console.warn('[App] Real-time listener setup failed:', err);
  });

  if (isNew) {
    // Auto-login as the host for brand-new sessions
    _setCurrentUser(retro.host);
  } else {
    // Try to restore from sessionStorage
    const savedId = sessionStorage.getItem('pi-retro-user-id');
    const allP = [retro.host, ...(retro.participants || [])].filter(Boolean);
    const restored = allP.find(p => p.id === savedId);
    if (restored) {
      _setCurrentUser(restored);
    } else {
      _setCurrentUser(null);
      // Show login overlay so participant can identify themselves
      setTimeout(() => _showLoginOverlay(), 200);
    }
  }
  _showPhase(0);
}

function _canArchiveRetro(retro) {
  const items = retro.actionItems || [];
  return items.every(a => a.status === 'in-progress' || a.status === 'done');
}

async function _renderHistory() {
  // Show loader during history load
  _showLoader(true, 'Loading previous retrospectives...');
  
  const history = await Store.loadHistory();
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  if (history.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    _hideLoader();
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = history.map(h => {
    const ww  = h.board?.wentWell?.length     || 0;
    const ci  = h.board?.couldImprove?.length || 0;
    const dw  = h.board?.didntGoWell?.length  || 0;
    const ai  = h.actionItems?.length         || 0;
    const dt  = _fmt(h.updatedAt || h.createdAt);
    const isArchived = h.status === 'archived';
    const canArchive = !isArchived && _canArchiveRetro(h);
    const archiveControl = isArchived
      ? `<span class="history-card-archived-badge">Archived</span>`
      : `<button class="history-card-archive${canArchive ? '' : ' history-card-archive--disabled'}"
           data-archive-id="${_escHtml(h.id)}"
           title="${canArchive
             ? 'Archive this retrospective'
             : 'Cannot archive: one or more action items are still Open'}">📦</button>`;
    return `
    <div class="history-card${isArchived ? ' history-card--archived' : ''}" data-retro-id="${_escHtml(h.id)}">
      <button class="history-card-delete" data-delete-id="${_escHtml(h.id)}" title="Delete">✕</button>
      ${archiveControl}
      <div class="history-card-title">${_escHtml(h.piName)}</div>
      <div class="history-card-meta">${_escHtml(h.artName || '')}${h.artName ? ' · ' : ''}${dt}</div>
      <div class="history-card-stats">
        <span class="history-stat green">${ww} Went Well</span>
        <span class="history-stat amber">${ci} Improve</span>
        <span class="history-stat red">${dw} Issues</span>
        <span class="history-stat blue">${ai} Actions</span>
      </div>
    </div>`;
  }).join('');

  // Hide loader after rendering
  _hideLoader();
}

/* ═══════════════════════════════════════════════════════════════
   PHASE CONTENT REFRESH
   ═══════════════════════════════════════════════════════════════ */
function _refreshPhaseContent(phaseIndex) {
  switch (phaseIndex) {
    case 0: _refreshSetup();        break;
    case 1: _refreshParticipants(); break;
    case 2: _refreshContext();      break;
    case 3: _refreshBoard();        break;
    case 4: _refreshActions();      break;
    case 5: _refreshAnalytics();    break;
    case 6: _refreshReport();       break;
    case 7: _refreshExport();       break;
  }
  // Update header
  const piName = state.retro?.piName || '—';
  document.getElementById('header-pi-name').textContent = piName;
  document.getElementById('header-participant-count').textContent =
    (_allParticipants().length).toString();
}

/* ── Phase 0: Setup ─────────────────────────────────────────── */
function _refreshSetup() {
  if (!state.retro) return;
  const r = state.retro;
  document.getElementById('inp-pi-name').value       = r.piName     || '';
  document.getElementById('inp-pi-start').value      = r.startDate  || '';
  document.getElementById('inp-pi-end').value        = r.endDate    || '';
  document.getElementById('inp-art-name').value      = r.artName    || '';
  document.getElementById('inp-team-name').value        = r.teamName        || '';
  document.getElementById('inp-pi-objectives').value    = r.piObjectives    || '';
  document.getElementById('inp-host-name').value     = r.host?.name || '';
  document.getElementById('inp-session-mode').value  = r.sessionMode || 'synchronous';
}

function _collectSetup() {
  const r = state.retro;
  r.piName       = document.getElementById('inp-pi-name').value.trim();
  r.startDate    = document.getElementById('inp-pi-start').value;
  r.endDate      = document.getElementById('inp-pi-end').value;
  r.artName      = document.getElementById('inp-art-name').value.trim();
  r.teamName        = document.getElementById('inp-team-name').value.trim();
  r.piObjectives    = document.getElementById('inp-pi-objectives').value.trim();
  r.sessionMode  = document.getElementById('inp-session-mode').value;

  const hostName = document.getElementById('inp-host-name').value.trim();
  if (hostName && r.host) {
    r.host.name = hostName;
    // Sync current user name if they are the host
    if (state.currentUser && state.currentUser.id === r.host.id) {
      state.currentUser.name = hostName;
      _updateCurrentUserBadge();
    }
  }
  _autoSave();
}

/* ── Phase 1: Participants ──────────────────────────────────── */
function _refreshParticipants() {
  const grid  = document.getElementById('participants-grid');
  const empty = document.getElementById('participants-empty');
  const countEl = document.getElementById('participants-count-num');
  const parts = _allParticipants();
  const isFinal = !!state.retro?.participantsFinal;

  // Reflect the finalize checkbox state
  const chk = document.getElementById('participants-final-chk');
  if (chk) chk.checked = isFinal;

  // Toggle locked appearance on the whole section
  const section = document.getElementById('phase-participants');
  if (section) section.classList.toggle('participants-locked', isFinal);

  countEl.textContent = parts.length;
  document.getElementById('header-participant-count').textContent = parts.length;

  if (parts.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = parts.map(p => `
    <div class="participant-card ${p.isHost ? 'is-host' : ''}" data-pid="${_escHtml(p.id)}">
      ${!p.isHost ? `<button class="participant-delete" data-delete-pid="${_escHtml(p.id)}" title="Remove participant">✕</button>` : ''}
      <div class="participant-header">
        <div class="participant-avatar" style="background:${_escHtml(p.color || '#0052CC')}">
          ${_escHtml(_avatarInitials(p.name))}
        </div>
        <div class="participant-info">
          <div class="participant-name-display" id="name-display-${_escHtml(p.id)}">${_escHtml(p.name)}</div>
          <div class="participant-id">ID: ${_escHtml(p.shortId)}</div>
          <div class="participant-email ${p.email ? '' : 'participant-email--empty'}" id="email-display-${_escHtml(p.id)}">${p.email ? _escHtml(p.email) : 'No email set'}</div>
        </div>
      </div>
      <div class="participant-badges">
        ${p.isHost ? '<span class="badge badge-host">HOST</span>' : '<span class="badge badge-member">Member</span>'}
      </div>
      <div class="participant-actions">
        <button class="btn btn-sm btn-outline edit-name-btn" data-pid="${_escHtml(p.id)}" data-pname="${_escHtml(p.name)}">
          ✏️ Edit Name
        </button>
        <button class="btn btn-sm btn-outline edit-email-btn" data-pid="${_escHtml(p.id)}" data-pemail="${_escHtml(p.email || '')}">
          ✉️ Edit Email
        </button>
      </div>
    </div>`).join('');
}

function _addParticipant(name, email = '') {
  const trimmed = (name || '').trim();
  
  // Validation: empty name
  if (!trimmed) {
    Toast.show('Participant name cannot be empty', 'warning');
    return;
  }
  
  // Validation: duplicate name (case-insensitive)
  const existing = _allParticipants().find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    Toast.show(`Participant "${existing.name}" already exists`, 'warning');
    return;
  }
  
  const p = Schema.newParticipant(trimmed, false);
  p.email = email;
  state.retro.participants.push(p);
  _autoSave();
  _refreshParticipants();
}

async function _copyParticipantsFromPrevious() {
  const history = await Store.loadHistory();
  // Find the most recent previous retro that is not the current one
  const prev = history.find(h => h.id !== state.retro?.id);
  if (!prev) {
    Toast.show('No previous PI Retrospective found in history.', 'warning');
    return;
  }

  // Collect all participants from previous (host + members), excluding host
  const prevMembers = (prev.participants || []).filter(Boolean);
  if (prevMembers.length === 0) {
    Toast.show(`"${prev.piName}" has no members to copy.`, 'warning');
    return;
  }

  // Avoid duplicating participants already present (match by name, case-insensitive)
  const existingNames = new Set(
    _allParticipants().map(p => p.name.trim().toLowerCase())
  );

  let added = 0;
  prevMembers.forEach(src => {
    if (existingNames.has(src.name.trim().toLowerCase())) return;
    const p = Schema.newParticipant(src.name, false);
    p.email = src.email || '';
    state.retro.participants.push(p);
    existingNames.add(src.name.trim().toLowerCase());
    added++;
  });

  if (added === 0) {
    Toast.show('All participants from the previous PI are already in the list.', 'info');
    return;
  }

  _autoSave();
  _refreshParticipants();
  Toast.show(`${added} participant(s) copied from "${prev.piName}".`, 'success');
}

function _deleteParticipant(pid) {
  state.retro.participants = state.retro.participants.filter(p => p.id !== pid);
  _autoSave();
  _refreshParticipants();
}

function _startEditParticipantName(pid, currentName) {
  const displayEl = document.getElementById(`name-display-${pid}`);
  if (!displayEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'participant-name-input';
  input.maxLength = 80;

  displayEl.replaceWith(input);
  input.focus();
  input.select();

  const commitEdit = () => {
    const newName = input.value.trim() || currentName;
    // Update in state
    const allP = _allParticipants();
    const p = allP.find(x => x.id === pid);
    if (p) p.name = newName;
    _autoSave();
    _refreshParticipants();
  };

  input.addEventListener('blur', commitEdit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { _refreshParticipants(); }
  });
}

function _startEditParticipantEmail(pid, currentEmail) {
  const displayEl = document.getElementById(`email-display-${pid}`);
  if (!displayEl) return;

  const input = document.createElement('input');
  input.type = 'email';
  input.value = currentEmail;
  input.className = 'participant-name-input';
  input.maxLength = 120;
  input.placeholder = 'name@example.com';

  displayEl.replaceWith(input);
  input.focus();
  input.select();

  const commitEdit = () => {
    const newEmail = input.value.trim();
    if (newEmail && !_isValidEmail(newEmail)) {
      Toast.show('Invalid email address — changes not saved.', 'warning');
      _refreshParticipants();
      return;
    }
    const p = _allParticipants().find(x => x.id === pid);
    if (p) p.email = newEmail;
    _autoSave();
    _refreshParticipants();
  };

  input.addEventListener('blur', commitEdit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { _refreshParticipants(); }
  });
}

/* ── Phase 2: PI Context ─────────────────────────────────────── */
let _activeCtxTab = 'events';

function _refreshContext() {
  // Restore correct tab visual + panel state on re-entry
  _switchCtxTab(_activeCtxTab);
  _refreshContextCounts();
  // Populate author selects
  ['events', 'milestones', 'special'].forEach(panel => {
    const sel = document.getElementById(`new-${panel === 'special' ? 'special' : panel === 'milestones' ? 'milestone' : 'event'}-author`);
    if (sel) _populateParticipantSelect(sel);
  });
}

function _refreshContextCounts() {
  document.getElementById('events-count').textContent    = (state.retro?.piContext?.events?.length || 0);
  document.getElementById('milestones-count').textContent = (state.retro?.piContext?.milestones?.length || 0);
  document.getElementById('special-count').textContent   = (state.retro?.piContext?.specialOccurrences?.length || 0);
}

function _switchCtxTab(tabKey) {
  _activeCtxTab = tabKey;
  document.querySelectorAll('.ctx-tab').forEach(t => t.classList.toggle('active', t.dataset.ctxTab === tabKey));
  document.querySelectorAll('.ctx-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`ctx-panel-${tabKey}`).classList.remove('hidden');
  _refreshContextTab(tabKey);
}

function _refreshContextTab(tabKey) {
  if (!state.retro) return;
  switch (tabKey) {
    case 'events':     _renderContextList('events-list',     'events-empty',     _renderEventItem);     break;
    case 'milestones': _renderContextList('milestones-list', 'milestones-empty', _renderMilestoneItem); break;
    case 'special':    _renderContextList('special-list',    'special-empty',    _renderSpecialItem);   break;
  }
}

function _renderContextList(listId, emptyId, renderFn) {
  const list  = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  const key   = listId.replace('-list', '');
  const keyMap = { 'events': 'events', 'milestones': 'milestones', 'special': 'specialOccurrences' };
  const dataKey = keyMap[key] || key;
  const items = state.retro?.piContext?.[dataKey] || [];

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = items.map(item => renderFn(item)).join('');
}

function _renderEventItem(ev) {
  return `
  <div class="ctx-item" data-ev-id="${_escHtml(ev.id)}">
    <div class="ctx-item-icon">📣</div>
    <div class="ctx-item-body">
      <div class="ctx-item-text">${_escHtml(ev.text)}</div>
      <div class="ctx-item-meta">
        ${ev.date ? `<span class="ctx-meta-tag">📅 ${_fmt(ev.date)}</span>` : ''}
        ${ev.authorId ? `<span class="ctx-meta-tag">👤 ${_escHtml(_participantName(ev.authorId))}</span>` : ''}
      </div>
    </div>
    <button class="ctx-item-delete" data-delete-ev="${_escHtml(ev.id)}" title="Delete">✕</button>
  </div>`;
}

function _renderMilestoneItem(m) {
  const statusClass = { achieved: 'milestone-achieved', partial: 'milestone-partial', missed: 'milestone-missed' }[m.status] || '';
  const statusLabel = { achieved: '✅ Achieved', partial: '⚠️ Partial', missed: '❌ Missed' }[m.status] || m.status;
  return `
  <div class="ctx-item" data-ms-id="${_escHtml(m.id)}">
    <div class="ctx-item-icon">🏁</div>
    <div class="ctx-item-body">
      <div class="ctx-item-text">${_escHtml(m.text)}</div>
      <div class="ctx-item-meta">
        <span class="milestone-badge ${statusClass}">${statusLabel}</span>
        ${m.date ? `<span class="ctx-meta-tag">📅 ${_fmt(m.date)}</span>` : ''}
        ${m.authorId ? `<span class="ctx-meta-tag">👤 ${_escHtml(_participantName(m.authorId))}</span>` : ''}
      </div>
    </div>
    <button class="ctx-item-delete" data-delete-ms="${_escHtml(m.id)}" title="Delete">✕</button>
  </div>`;
}

function _renderSpecialItem(s) {
  const catIcons = { blocker: '🚧', innovation: '💡', 'team-change': '👥', risk: '⚠️', dependency: '🔗', other: '📌' };
  const catLabels = { blocker: 'Blocker', innovation: 'Innovation', 'team-change': 'Team Change', risk: 'Risk', dependency: 'Dependency', other: 'Other' };
  return `
  <div class="ctx-item" data-sp-id="${_escHtml(s.id)}">
    <div class="ctx-item-icon">${catIcons[s.category] || '📌'}</div>
    <div class="ctx-item-body">
      <div class="ctx-item-text">${_escHtml(s.text)}</div>
      <div class="ctx-item-meta">
        <span class="ctx-meta-tag">${catLabels[s.category] || s.category}</span>
        ${s.authorId ? `<span class="ctx-meta-tag">👤 ${_escHtml(_participantName(s.authorId))}</span>` : ''}
      </div>
    </div>
    <button class="ctx-item-delete" data-delete-sp="${_escHtml(s.id)}" title="Delete">✕</button>
  </div>`;
}

/* ── Phase 3: Retro Board ─────────────────────────────────────── */
function _refreshBoard() {
  ['wentWell', 'couldImprove', 'didntGoWell'].forEach(col => {
    _renderNoteColumn(col);
  });
  _updateBoardStats();

  // Populate board filter — preserve current selections across re-renders
  const filterSel = document.getElementById('board-filter-participant');
  if (filterSel) {
    const prevSelected = new Set(Array.from(filterSel.selectedOptions).map(o => o.value).filter(Boolean));
    const allP = _allParticipants();
    filterSel.innerHTML = allP.map(p =>
      `<option value="${_escHtml(p.id)}"${prevSelected.has(p.id) ? ' selected' : ''}>${_escHtml(p.name)}${p.isHost ? ' (Host)' : ''}</option>`
    ).join('');
    _updateBoardFilterClearLink();
  }

  // Show invite button only for the host
  const inviteBtn = document.getElementById('invite-participants-btn');
  if (inviteBtn) inviteBtn.classList.toggle('hidden', !_isHost());
}

function _renderNoteColumn(colKey) {
  const colMap = { wentWell: 'went-well', couldImprove: 'improve', didntGoWell: 'didnt' };
  const listEl = document.getElementById(`notes-${colMap[colKey]}`);
  if (!listEl) return;

  const filterSel = document.getElementById('board-filter-participant');
  const selectedPids = filterSel ? new Set(Array.from(filterSel.selectedOptions).map(o => o.value).filter(Boolean)) : new Set();
  let notes = state.retro?.board?.[colKey] || [];
  if (selectedPids.size > 0) notes = notes.filter(n => selectedPids.has(n.authorId));

  if (notes.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.82rem;">No notes yet. Click "Add Note" to begin.</div>`;
    return;
  }

  // Sort by most votes first
  const sorted = [...notes].sort((a, b) => (b.votes || 0) - (a.votes || 0));

  listEl.innerHTML = sorted.map(note => _renderStickyNote(note, colKey)).join('');
}

function _renderStickyNote(note, colKey) {
  const author = _participantById(note.authorId);
  const color  = author?.color || '#97A0AF';
  const name   = author?.name  || 'Unknown';
  const initials = _avatarInitials(name);
  const tags = (note.tags || []).map(t => `<span class="note-tag">${_escHtml(t)}</span>`).join('');
  
  // Check if CURRENT user has already voted
  const userHasVoted = state.currentUser && (note.votedBy || []).includes(state.currentUser.id);
  const voteClass = userHasVoted ? 'voted' : '';

  return `
  <div class="sticky-note" data-note-id="${_escHtml(note.id)}" data-col="${_escHtml(colKey)}">
    <div class="note-text">${_escHtml(note.text)}</div>
    <div class="note-footer">
      <div class="note-author">
        <div class="author-dot" style="background:${_escHtml(color)}">${_escHtml(initials)}</div>
        ${_escHtml(name)}
      </div>
      ${tags ? `<div class="note-tags">${tags}</div>` : ''}
      <div class="note-actions">
        <button class="note-vote-btn ${voteClass}" data-vote-note="${_escHtml(note.id)}" data-vote-col="${_escHtml(colKey)}" title="${userHasVoted ? 'Remove vote' : 'Vote'}">
          👍 ${note.votes || 0}
        </button>
        <button class="note-edit-btn" data-edit-note="${_escHtml(note.id)}" data-edit-col="${_escHtml(colKey)}" title="Edit note">✏️</button>
        <button class="note-delete-btn" data-del-note="${_escHtml(note.id)}" data-del-col="${_escHtml(colKey)}" title="Delete note">✕</button>
      </div>
    </div>
  </div>`;
}

function _updateBoardStats() {
  document.getElementById('count-went-well').textContent = state.retro?.board?.wentWell?.length     || 0;
  document.getElementById('count-improve').textContent   = state.retro?.board?.couldImprove?.length || 0;
  document.getElementById('count-didnt').textContent     = state.retro?.board?.didntGoWell?.length  || 0;
}

function _updateBoardFilterClearLink() {
  const sel   = document.getElementById('board-filter-participant');
  const link  = document.getElementById('board-filter-clear');
  if (!sel || !link) return;
  const hasSelection = Array.from(sel.selectedOptions).some(o => o.value);
  link.classList.toggle('hidden', !hasSelection);
}

/* ── Phase 4: Action Items ──────────────────────────────────── */
function _refreshActions() {
  _renderActionItems();

  // Populate filter selects
  const assigneeSel = document.getElementById('action-filter-assignee');
  if (assigneeSel) _populateParticipantSelect(assigneeSel, true);
}

function _renderActionItems() {
  const list  = document.getElementById('action-items-list');
  const empty = document.getElementById('action-items-empty');
  if (!list) return;

  const filterAssignee = document.getElementById('action-filter-assignee')?.value || '';
  const filterPriority = document.getElementById('action-filter-priority')?.value || '';
  const filterStatus   = document.getElementById('action-filter-status')?.value   || '';

  let items = state.retro?.actionItems || [];
  if (filterAssignee) items = items.filter(a => a.assigneeId === filterAssignee);
  if (filterPriority) items = items.filter(a => a.priority   === filterPriority);
  if (filterStatus)   items = items.filter(a => a.status     === filterStatus);

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...items].sort((a, b) =>
    (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  list.innerHTML = sorted.map(a => _renderActionItem(a)).join('');
}

function _renderActionItem(a) {
  const assignee = _participantById(a.assigneeId);
  const assigneeName = assignee ? _escHtml(assignee.name) : '<em>Unassigned</em>';

  const priorityIcons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const prIcon = priorityIcons[a.priority] || '🟡';

  const isOverdue = a.dueDate && a.status !== 'done' && new Date(a.dueDate) < new Date();

  return `
  <div class="action-item priority-${_escHtml(a.priority)}" data-action-id="${_escHtml(a.id)}">
    <div class="action-item-body">
      <div class="action-item-title">${prIcon} ${_escHtml(a.title)}</div>
      ${a.description ? `<div class="action-item-desc">${_escHtml(a.description)}</div>` : ''}
      <div class="action-item-meta">
        <span class="action-meta-pill assignee">👤 ${assigneeName}</span>
        ${a.dueDate ? `<span class="action-meta-pill ${isOverdue ? 'overdue' : ''}">📅 ${_fmt(a.dueDate)}${isOverdue ? ' ⚠️' : ''}</span>` : ''}
        ${a.source === 'ai' ? '<span class="action-meta-pill ai-source">🤖 AI Suggested</span>' : ''}
        <select class="status-select-inline ${_escHtml(a.status)}" data-status-action="${_escHtml(a.id)}" title="Change status">
          <option value="open"        ${a.status === 'open'        ? 'selected' : ''}>📋 Open</option>
          <option value="in-progress" ${a.status === 'in-progress' ? 'selected' : ''}>🔄 In Progress</option>
          <option value="done"        ${a.status === 'done'        ? 'selected' : ''}>✅ Done</option>
        </select>
      </div>
    </div>
    <div class="action-item-actions">
      <button class="action-edit-btn" data-edit-action="${_escHtml(a.id)}" title="Edit">✏️</button>
      <button class="action-delete-btn" data-del-action="${_escHtml(a.id)}" title="Delete">🗑️</button>
    </div>
  </div>`;
}

function _renderAISuggestions(suggestions) {
  const banner = document.getElementById('ai-suggestions-banner');
  const list   = document.getElementById('ai-suggestions-list');
  if (!banner || !list) return;

  if (!suggestions || suggestions.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  state.aiSuggestions = suggestions;
  banner.classList.remove('hidden');

  const existingTitles = new Set((state.retro?.actionItems || []).map(a => a.title));

  list.innerHTML = suggestions.map(s => {
    const alreadyAdded = existingTitles.has(s.title);
    return `
    <div class="ai-suggestion" data-suggestion-id="${_escHtml(s.id)}">
      <div class="ai-suggestion-content">
        <div class="ai-suggestion-title">${_escHtml(s.categoryIcon)} ${_escHtml(s.title)}</div>
        <div class="ai-suggestion-rationale">${_escHtml(s.rationale)}</div>
        <div class="ai-suggestion-meta">
          <span class="ai-priority-tag ${_escHtml(s.priority)}">${_escHtml(s.priority.toUpperCase())}</span>
          <span class="ai-category-tag">${_escHtml(s.category)}</span>
          ${s.isRecurring ? '<span class="ai-category-tag" style="background:#FFE0CC;color:#BF5000">🔁 Recurring</span>' : ''}
        </div>
      </div>
      <button class="ai-suggestion-add-btn" data-add-suggestion="${_escHtml(s.id)}" ${alreadyAdded ? 'disabled' : ''}>
        ${alreadyAdded ? '✓ Added' : '+ Add'}
      </button>
    </div>`;
  }).join('');
}

/* ── Phase 5: Export ─────────────────────────────────────────── */
function _refreshExport() {
  _renderSummary();
  // Pre-fill Polarion config from retro (except token)
  const pol = state.retro?.polarionConfig || {};
  document.getElementById('pol-server-url').value    = pol.serverUrl    || '';
  document.getElementById('pol-project-id').value   = pol.projectId    || '';
  document.getElementById('pol-workitem-type').value = pol.workItemType || 'task';
  document.getElementById('pol-parent-id').value    = pol.parentId     || '';
  document.getElementById('pol-space').value        = pol.space        || '';
  // Never pre-fill token from storage
  document.getElementById('pol-token').value = '';
  state.polarionToken = '';
  state.polarionConnected = false;
  _updatePolarionStatus('neutral', 'Not connected');
}

function _renderSummary() {
  const container = document.getElementById('summary-content');
  if (!container || !state.retro) return;
  const r = state.retro;
  const participants = _allParticipants();

  const miniList = (items, getText) => items.length === 0
    ? '<li style="color:var(--text-muted);font-style:italic">None</li>'
    : items.map(i => `<li>${_escHtml(getText(i))}</li>`).join('');

  container.innerHTML = `
  <div class="summary-block">
    <h4>PI Identification</h4>
    <dl class="summary-kv-grid">
      <dt>PI Name</dt><dd>${_escHtml(r.piName)}</dd>
      <dt>ART</dt><dd>${_escHtml(r.artName || '—')}</dd>
      <dt>Team</dt><dd>${_escHtml(r.teamName || '—')}</dd>
      <dt>Duration</dt><dd>${r.startDate ? `${_fmt(r.startDate)} → ${_fmt(r.endDate)}` : '—'}</dd>
      <dt>Host</dt><dd>${_escHtml(r.host?.name || '—')}</dd>
      <dt>Mode</dt><dd>${_escHtml(r.sessionMode || 'synchronous')}</dd>
      <dt>Participants</dt><dd>${participants.length}</dd>
    </dl>
  </div>

  <div class="summary-block">
    <h4>PI Context</h4>
    <p style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Events (${r.piContext.events.length})</p>
    <ul class="summary-mini-list">${miniList(r.piContext.events, e => `${e.date ? `[${e.date}] ` : ''}${e.text}`)}</ul>
    <p style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin:10px 0 6px;">Milestones (${r.piContext.milestones.length})</p>
    <ul class="summary-mini-list">${miniList(r.piContext.milestones, m => `[${m.status.toUpperCase()}] ${m.text}`)}</ul>
    <p style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin:10px 0 6px;">Special Occurrences (${r.piContext.specialOccurrences.length})</p>
    <ul class="summary-mini-list">${miniList(r.piContext.specialOccurrences, s => `[${s.category}] ${s.text}`)}</ul>
  </div>

  <div class="summary-block">
    <h4>Retrospective Board</h4>
    <p style="font-size:0.82rem;font-weight:600;color:var(--success);margin-bottom:6px;">✅ Went Well (${r.board.wentWell.length})</p>
    <ul class="summary-mini-list">${miniList(r.board.wentWell, n => n.text)}</ul>
    <p style="font-size:0.82rem;font-weight:600;color:var(--warning);margin:10px 0 6px;">⬆️ Could Improve (${r.board.couldImprove.length})</p>
    <ul class="summary-mini-list">${miniList(r.board.couldImprove, n => n.text)}</ul>
    <p style="font-size:0.82rem;font-weight:600;color:var(--danger);margin:10px 0 6px;">❌ Didn't Go Well (${r.board.didntGoWell.length})</p>
    <ul class="summary-mini-list">${miniList(r.board.didntGoWell, n => n.text)}</ul>
  </div>

  <div class="summary-block">
    <h4>Action Items (${r.actionItems.length})</h4>
    <ul class="summary-mini-list">
      ${r.actionItems.length === 0
        ? '<li style="color:var(--text-muted);font-style:italic">None defined</li>'
        : r.actionItems.map(a => {
            const pIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[a.priority] || '🟡';
            const asn = _participantById(a.assigneeId)?.name || 'Unassigned';
            return `<li>${pIcon} <strong>${_escHtml(a.title)}</strong> → ${_escHtml(asn)}${a.dueDate ? ` (by ${_fmt(a.dueDate)})` : ''}</li>`;
          }).join('')}
    </ul>
  </div>`;
}

function _updatePolarionStatus(type, message) {
  const el = document.getElementById('polarion-status');
  if (!el) return;
  el.innerHTML = `<span class="status-dot ${type}"></span><span>${_escHtml(message)}</span>`;
}

function _collectPolarionConfig() {
  state.retro.polarionConfig = {
    serverUrl:    document.getElementById('pol-server-url').value.trim(),
    projectId:    document.getElementById('pol-project-id').value.trim(),
    workItemType: document.getElementById('pol-workitem-type').value.trim() || 'task',
    parentId:     document.getElementById('pol-parent-id').value.trim(),
    space:        document.getElementById('pol-space').value.trim()
    // token: intentionally NOT stored here
  };
  state.polarionToken = document.getElementById('pol-token').value;
  _autoSave();
}

/* ═══════════════════════════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════════════════════════ */
function _openNoteModal(colKey, existingNote = null) {
  state.pendingNoteColumn = colKey;
  state.pendingNoteId     = existingNote?.id || null;

  const colLabels = { wentWell: 'Went Well', couldImprove: 'Could Improve', didntGoWell: "Didn't Go Well" };
  document.getElementById('modal-title').textContent = existingNote ? 'Edit Note' : `Add Note — ${colLabels[colKey] || colKey}`;
  document.getElementById('modal-note-text').value   = existingNote?.text    || '';
  document.getElementById('modal-note-tags').value   = (existingNote?.tags || []).join(', ');

  const authorSel = document.getElementById('modal-note-author');
  if (_isHost()) {
    _populateParticipantSelect(authorSel, false);
    authorSel.value    = existingNote?.authorId || state.currentUser?.id || _allParticipants()[0]?.id || '';
    authorSel.disabled = false;
  } else {
    // Members can only author as themselves
    const user = state.currentUser;
    authorSel.innerHTML = user
      ? `<option value="${_escHtml(user.id)}">${_escHtml(user.name)}</option>`
      : '<option value="">Guest</option>';
    authorSel.value    = user?.id || '';
    authorSel.disabled = true;
  }

  _showModal('note-modal');
}

function _openActionModal(existing = null) {
  state.pendingActionId = existing?.id || null;

  document.getElementById('action-modal-title').textContent = existing ? 'Edit Action Item' : 'Add Action Item';
  document.getElementById('action-title').value             = existing?.title       || '';
  document.getElementById('action-description').value       = existing?.description || '';
  document.getElementById('action-priority').value          = existing?.priority    || 'medium';
  document.getElementById('action-due-date').value          = existing?.dueDate     || '';
  document.getElementById('action-status').value            = existing?.status      || 'open';
  document.getElementById('action-editing-id').value        = existing?.id          || '';

  const assigneeSel = document.getElementById('action-assignee');
  _populateParticipantSelect(assigneeSel, true);
  assigneeSel.value = existing?.assigneeId || state.currentUser?.id || '';

  _showModal('action-modal');
}

function _openConfirm(title, message, onOk) {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  state.confirmCallback = onOk;
  _showModal('confirm-modal');
}

function _showModal(modalId) {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  overlay.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById(modalId).classList.remove('hidden');
}

function _closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  state.pendingNoteColumn = null;
  state.pendingNoteId     = null;
  state.pendingActionId   = null;
  state.confirmCallback   = null;
}

/* ═══════════════════════════════════════════════════════════════
   EVENT HANDLERS
   ═══════════════════════════════════════════════════════════════ */

/* ── Home Screen ─────────────────────────────────────────────── */
function _bindHomeEvents() {
  document.getElementById('create-new-btn').addEventListener('click', async () => {
    const retro = Schema.newRetrospective('', '');
    await Store.saveActive(retro);
    _showApp(retro, true); // isNew = true, auto-login as host
  });

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (confirm('Delete all saved retrospectives? This cannot be undone.')) {
      await Store.clearHistory();
      await _renderHistory();
      Toast.show('History cleared.', 'info');
    }
  });

  document.getElementById('history-list').addEventListener('click', async e => {
    const deleteBtn = e.target.closest('[data-delete-id]');
    if (deleteBtn) {
      const id = deleteBtn.dataset.deleteId;
      // Show confirmation before deleting
      if (!confirm('Delete this retrospective? This action cannot be undone.')) return;
      try {
        await Store.deleteFromHistory(id);
        await _renderHistory();
        Toast.show('Retrospective deleted.', 'success');
      } catch (err) {
        console.error('Delete failed:', err);
        Toast.show('Failed to delete retrospective.', 'error');
      }
      return;
    }

    const archiveBtn = e.target.closest('[data-archive-id]');
    if (archiveBtn) {
      if (archiveBtn.classList.contains('history-card-archive--disabled')) {
        Toast.show(
          'Cannot archive: one or more action items are still Open. Set them to In Progress or Done first.',
          'warning',
          4500
        );
        return;
      }
      const id = archiveBtn.dataset.archiveId;
      // Re-validate eligibility from stored data (defence-in-depth)
      const history = await Store.loadHistory();
      const retro = history.find(h => h.id === id);
      if (retro && !_canArchiveRetro(retro)) {
        Toast.show(
          'Cannot archive: one or more action items are still Open.',
          'warning',
          4500
        );
        return;
      }
      await Store.archiveInHistory(id);
      await _renderHistory();
      Toast.show('Retrospective archived successfully.', 'success');
      return;
    }

    const card = e.target.closest('.history-card');
    if (card) {
      const id = card.dataset.retroId;
      
      // CRITICAL FIX: Check for LIVE active session first
      // Don't overwrite it with old history data
      const activeRetro = await Store.loadActive();
      if (activeRetro && activeRetro.id === id) {
        // Active session exists and matches clicked PI — use the LIVE version
        _showApp(activeRetro, false);
      } else {
        // No active session or different ID — load from history
        const history = await Store.loadHistory();
        const retro = history.find(h => h.id === id);
        if (retro) {
          await Store.saveActive(retro);
          _showApp(retro, false); // false = not new → check login
        }
      }
    }
  });
}

/* ── App Header ──────────────────────────────────────────────── */
function _bindHeaderEvents() {
  document.getElementById('back-home-btn').addEventListener('click', () => {
    _collectCurrentPhase();
    _showHome();
  });

  document.getElementById('step-wizard').addEventListener('click', e => {
    const btn = e.target.closest('[data-phase]');
    if (!btn) return;
    _collectCurrentPhase();
    _showPhase(parseInt(btn.dataset.phase, 10));
  });
}

function _collectCurrentPhase() {
  switch (state.currentPhase) {
    case 0: _collectSetup(); break;
    case 7: _collectPolarionConfig(); break;
  }
  _autoSave();
}

/* ── Phase 0: Setup ─────────────────────────────────────────── */
function _bindSetupEvents() {
  document.getElementById('setup-next-btn').addEventListener('click', () => {
    _collectSetup();
    if (!state.retro.piName) {
      Toast.show('Please enter a PI Name before continuing.', 'warning');
      document.getElementById('inp-pi-name').focus();
      return;
    }
    if (!state.retro.host.name) {
      Toast.show('Please enter the host name before continuing.', 'warning');
      document.getElementById('inp-host-name').focus();
      return;
    }
    _showPhase(state.retro?.participantsFinal ? 2 : 1);
  });
}

/* ── Phase 1: Participants ──────────────────────────────────── */
function _bindParticipantEvents() {
  const addBtn   = document.getElementById('add-participant-btn');
  const nameInp  = document.getElementById('inp-new-participant');
  const emailInp = document.getElementById('inp-new-participant-email');

  const doAdd = () => {
    const name  = nameInp.value.trim();
    const email = emailInp.value.trim();
    if (!name) { Toast.show('Enter a participant name.', 'warning'); return; }
    if (email && !_isValidEmail(email)) { Toast.show('Enter a valid email address.', 'warning'); emailInp.focus(); return; }
    _addParticipant(name, email);
    nameInp.value  = '';
    emailInp.value = '';
    nameInp.focus();
    Toast.show(`${name} added.`, 'success');
  };

  addBtn.addEventListener('click', doAdd);
  nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); emailInp.focus(); } });
  emailInp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

  document.getElementById('participants-grid').addEventListener('click', e => {
    const deleteBtn = e.target.closest('[data-delete-pid]');
    if (deleteBtn) {
      const pid = deleteBtn.dataset.deletePid;
      const p   = _participantById(pid);
      _openConfirm('Remove Participant', `Remove "${p?.name}"? Their retrospective notes will remain.`, () => {
        _deleteParticipant(pid);
        Toast.show(`${p?.name || 'Participant'} removed.`, 'info');
      });
      return;
    }
    const editBtn = e.target.closest('.edit-name-btn');
    if (editBtn) {
      _startEditParticipantName(editBtn.dataset.pid, editBtn.dataset.pname);
      return;
    }
    const editEmailBtn = e.target.closest('.edit-email-btn');
    if (editEmailBtn) {
      _startEditParticipantEmail(editEmailBtn.dataset.pid, editEmailBtn.dataset.pemail);
    }
  });

  document.getElementById('participants-final-chk').addEventListener('change', e => {
    state.retro.participantsFinal = e.target.checked;
    _autoSave();
    _refreshParticipants();
    Toast.show(
      e.target.checked
        ? 'Participant list marked as final. This step will be skipped during navigation.'
        : 'Participant list unlocked.',
      'info'
    );
  });

  document.getElementById('participants-prev-btn').addEventListener('click', () => _showPhase(0));
  document.getElementById('participants-next-btn').addEventListener('click', () => {
    if (_allParticipants().length === 0) {
      Toast.show('Add at least one participant before continuing.', 'warning');
      return;
    }
    _showPhase(2);
  });

  document.getElementById('invite-participants-page-btn').addEventListener('click', _openInviteModal);
  document.getElementById('copy-prev-participants-btn').addEventListener('click', () => _copyParticipantsFromPrevious());
}

/* ── Phase 2: PI Context ─────────────────────────────────────── */
function _bindContextEvents() {
  // Tab switching
  document.querySelectorAll('.ctx-tab').forEach(tab => {
    tab.addEventListener('click', () => _switchCtxTab(tab.dataset.ctxTab));
  });

  // Add event
  document.getElementById('add-event-btn').addEventListener('click', () => {
    const text   = document.getElementById('new-event-text').value.trim();
    const date   = document.getElementById('new-event-date').value;
    const author = document.getElementById('new-event-author').value;
    if (!text) { Toast.show('Enter event description.', 'warning'); return; }
    state.retro.piContext.events.push(Schema.newEvent(text, date, author));
    document.getElementById('new-event-text').value = '';
    _autoSave();
    _refreshContextTab('events');
    _refreshContextCounts();
    Toast.show('Event added.', 'success');
  });

  // Add milestone
  document.getElementById('add-milestone-btn').addEventListener('click', () => {
    const text   = document.getElementById('new-milestone-text').value.trim();
    const date   = document.getElementById('new-milestone-date').value;
    const status = document.getElementById('new-milestone-status').value;
    const author = document.getElementById('new-milestone-author').value;
    if (!text) { Toast.show('Enter milestone description.', 'warning'); return; }
    state.retro.piContext.milestones.push(Schema.newMilestone(text, date, status, author));
    document.getElementById('new-milestone-text').value = '';
    _autoSave();
    _refreshContextTab('milestones');
    _refreshContextCounts();
    Toast.show('Milestone added.', 'success');
  });

  // Add special occurrence
  document.getElementById('add-special-btn').addEventListener('click', () => {
    const text     = document.getElementById('new-special-text').value.trim();
    const category = document.getElementById('new-special-category').value;
    const author   = document.getElementById('new-special-author').value;
    if (!text) { Toast.show('Enter occurrence description.', 'warning'); return; }
    state.retro.piContext.specialOccurrences.push(Schema.newSpecialOccurrence(text, category, author));
    document.getElementById('new-special-text').value = '';
    _autoSave();
    _refreshContextTab('special');
    _refreshContextCounts();
    Toast.show('Occurrence added.', 'success');
  });

  // Delete via event delegation
  ['events-list', 'milestones-list', 'special-list'].forEach(listId => {
    document.getElementById(listId).addEventListener('click', e => {
      const btn = e.target.closest('[data-delete-ev],[data-delete-ms],[data-delete-sp]');
      if (!btn) return;
      if (btn.dataset.deleteEv) {
        state.retro.piContext.events = state.retro.piContext.events.filter(x => x.id !== btn.dataset.deleteEv);
        _autoSave(); _refreshContextTab('events'); _refreshContextCounts();
      } else if (btn.dataset.deleteMs) {
        state.retro.piContext.milestones = state.retro.piContext.milestones.filter(x => x.id !== btn.dataset.deleteMs);
        _autoSave(); _refreshContextTab('milestones'); _refreshContextCounts();
      } else if (btn.dataset.deleteSp) {
        state.retro.piContext.specialOccurrences = state.retro.piContext.specialOccurrences.filter(x => x.id !== btn.dataset.deleteSp);
        _autoSave(); _refreshContextTab('special'); _refreshContextCounts();
      }
    });
  });

  document.getElementById('context-prev-btn').addEventListener('click', () => {
    // Ensure data structures exist before leaving
    if (!state.retro.piContext) state.retro.piContext = { events: [], milestones: [], specialOccurrences: [] };
    _autoSave();
    _showPhase(state.retro?.participantsFinal ? 0 : 1);
  });
  document.getElementById('context-next-btn').addEventListener('click', () => {
    // Ensure data structures exist before leaving
    if (!state.retro.piContext) state.retro.piContext = { events: [], milestones: [], specialOccurrences: [] };
    _autoSave();
    _showPhase(3);
  });
}

/* ── Phase 3: Board ──────────────────────────────────────────── */
function _bindBoardEvents() {
  const colMap = { ww: 'wentWell', ci: 'couldImprove', dw: 'didntGoWell' };

  document.getElementById('invite-participants-btn').addEventListener('click', _openInviteModal);

  // Add note buttons
  ['ww', 'ci', 'dw'].forEach(prefix => {
    document.getElementById(`${prefix}-add-btn`).addEventListener('click', () => {
      _openNoteModal(colMap[prefix], null);
    });
  });

  // Board filter — re-render columns on selection change
  document.getElementById('board-filter-participant').addEventListener('change', () => {
    ['wentWell', 'couldImprove', 'didntGoWell'].forEach(col => _renderNoteColumn(col));
    _updateBoardFilterClearLink();
  });

  // Clear filter link
  document.getElementById('board-filter-clear').addEventListener('click', e => {
    e.preventDefault();
    const sel = document.getElementById('board-filter-participant');
    Array.from(sel.options).forEach(o => { o.selected = false; });
    ['wentWell', 'couldImprove', 'didntGoWell'].forEach(col => _renderNoteColumn(col));
    _updateBoardFilterClearLink();
  });

  // Event delegation for vote + delete
  ['notes-went-well', 'notes-improve', 'notes-didnt'].forEach(listId => {
    document.getElementById(listId).addEventListener('click', e => {
      const voteBtn = e.target.closest('[data-vote-note]');
      if (voteBtn) {
        const noteId = voteBtn.dataset.voteNote;
        const col    = voteBtn.dataset.voteCol;
        const note   = (state.retro.board[col] || []).find(n => n.id === noteId);
        if (note && state.currentUser) {
          const userId = state.currentUser.id;
          const votedBy = note.votedBy || [];
          
          // Check if current user already voted
          const hasVoted = votedBy.includes(userId);
          
          if (hasVoted) {
            // User already voted — remove their vote (toggle off)
            note.votedBy = votedBy.filter(id => id !== userId);
            note.votes = Math.max(0, (note.votes || 1) - 1);
            Toast.show('Vote removed.', 'info');
          } else {
            // User hasn't voted — add their vote
            note.votedBy = [...votedBy, userId];
            note.votes = (note.votes || 0) + 1;
            Toast.show('Voted!', 'success');
          }
          
          _autoSave();
          _renderNoteColumn(col);
          _updateBoardStats();
        } else if (!state.currentUser) {
          Toast.show('Please login to vote.', 'warning');
        }
        return;
      }
      const editBtn = e.target.closest('[data-edit-note]');
      if (editBtn) {
        const noteId = editBtn.dataset.editNote;
        const col    = editBtn.dataset.editCol;
        const note   = (state.retro.board[col] || []).find(n => n.id === noteId);
        if (note) _openNoteModal(col, note);
        return;
      }

      const delBtn = e.target.closest('[data-del-note]');
      if (delBtn) {
        const noteId = delBtn.dataset.delNote;
        const col    = delBtn.dataset.delCol;
        state.retro.board[col] = (state.retro.board[col] || []).filter(n => n.id !== noteId);
        _autoSave();
        _renderNoteColumn(col);
        _updateBoardStats();
      }
    });
  });

  document.getElementById('board-prev-btn').addEventListener('click', () => _showPhase(2));
  document.getElementById('board-next-btn').addEventListener('click', () => _showPhase(4));
}

/* ── Phase 4: Action Items ──────────────────────────────────── */
function _bindActionEvents() {
  document.getElementById('add-action-btn').addEventListener('click', () => _openActionModal(null));

  document.getElementById('ai-suggest-btn').addEventListener('click', async () => {
    const history = await Store.loadHistory();
    const suggestions = AIEngine.analyzeRetrospective(state.retro, history);
    _renderAISuggestions(suggestions);
    Toast.show(`${suggestions.length} AI suggestion(s) generated.`, 'success');
  });

  document.getElementById('ai-prompt-btn').addEventListener('click', async () => {
    const history = await Store.loadHistory();
    const prompt  = AIEngine.generateCopilotPrompt(state.retro, history);
    navigator.clipboard.writeText(prompt)
      .then(() => Toast.show('GitHub Copilot prompt copied to clipboard! Paste it into Copilot Chat.', 'success', 4000))
      .catch(() => {
        // Fallback: open in new window
        const w = window.open('', '_blank');
        w.document.write(`<pre style="white-space:pre-wrap;font-family:monospace;padding:20px">${_escHtml(prompt)}</pre>`);
        Toast.show('Prompt opened in a new window (copy it manually).', 'info', 4000);
      });
  });

  // Filter selects
  ['action-filter-assignee', 'action-filter-priority', 'action-filter-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', _renderActionItems);
  });

  // Add AI suggestion to action items
  document.getElementById('ai-suggestions-list').addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add-suggestion]');
    if (!addBtn || addBtn.disabled) return;
    const sid = addBtn.dataset.addSuggestion;
    const suggestion = state.aiSuggestions.find(s => s.id === sid);
    if (!suggestion) return;

    const action = Schema.newActionItem({
      title:       suggestion.title,
      description: suggestion.description,
      priority:    suggestion.priority,
      source:      'ai'
    });
    state.retro.actionItems.push(action);
    _autoSave();
    addBtn.disabled = true;
    addBtn.textContent = '✓ Added';
    _renderActionItems();
    Toast.show(`Action item added: "${suggestion.title}"`, 'success');
  });

  // Action item status change inline
  document.getElementById('action-items-list').addEventListener('change', e => {
    const sel = e.target.closest('[data-status-action]');
    if (!sel) return;
    const id = sel.dataset.statusAction;
    const ai = state.retro.actionItems.find(a => a.id === id);
    if (ai) {
      ai.status = sel.value;
      sel.className = `status-select-inline ${sel.value}`;
      _autoSave();
    }
  });

  // Edit / delete action items
  document.getElementById('action-items-list').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-action]');
    if (editBtn) {
      const id = editBtn.dataset.editAction;
      const ai = state.retro.actionItems.find(a => a.id === id);
      if (ai) _openActionModal(ai);
      return;
    }
    const delBtn = e.target.closest('[data-del-action]');
    if (delBtn) {
      const id = delBtn.dataset.delAction;
      const ai = state.retro.actionItems.find(a => a.id === id);
      _openConfirm('Delete Action Item', `Delete "${ai?.title}"?`, () => {
        state.retro.actionItems = state.retro.actionItems.filter(a => a.id !== id);
        _autoSave();
        _renderActionItems();
        Toast.show('Action item deleted.', 'info');
      });
    }
  });

  document.getElementById('actions-prev-btn').addEventListener('click', () => {
    // Ensure data structures exist before leaving
    if (!state.retro.actionItems) state.retro.actionItems = [];
    _autoSave();
    _showPhase(3);
  });
  document.getElementById('actions-next-btn').addEventListener('click', () => {
    // Ensure data structures exist before leaving
    if (!state.retro.actionItems) state.retro.actionItems = [];
    _autoSave();
    _showPhase(5);
  });
}

/* ── Phase 5: Export ─────────────────────────────────────────── */
function _bindExportEvents() {
  document.getElementById('export-json-btn').addEventListener('click', () => {
    Store.exportJSON(state.retro);
    Toast.show('JSON exported.', 'success');
  });

  document.getElementById('export-print-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('polarion-test-btn').addEventListener('click', async () => {
    _collectPolarionConfig();
    const cfg = { ...state.retro.polarionConfig, token: state.polarionToken };
    if (!cfg.serverUrl || !cfg.projectId || !cfg.token) {
      Toast.show('Fill in Server URL, Project ID, and API Token first.', 'warning');
      return;
    }
    _updatePolarionStatus('connecting', 'Connecting...');
    try {
      const result = await PolarionAPI.testConnection(cfg);
      state.polarionConnected = true;
      _updatePolarionStatus('success', `Connected — project: "${result.projectName}"`);
      Toast.show('Connected to Polarion successfully!', 'success');
    } catch (err) {
      state.polarionConnected = false;
      _updatePolarionStatus('error', `Connection failed: ${err.message}`);
      Toast.show('Polarion connection failed. See status message.', 'error', 5000);
    }
  });

  document.getElementById('polarion-push-btn').addEventListener('click', async () => {
    _collectPolarionConfig();
    const cfg = { ...state.retro.polarionConfig, token: state.polarionToken };

    if (!cfg.serverUrl || !cfg.projectId || !cfg.token) {
      Toast.show('Fill in Server URL, Project ID, and API Token before pushing.', 'warning');
      return;
    }

    const resultEl = document.getElementById('polarion-result');
    resultEl.classList.remove('hidden', 'success', 'error');
    resultEl.textContent = 'Pushing to Polarion…';

    const opts = {
      pushContext: document.getElementById('pol-push-context').checked,
      pushBoard:   document.getElementById('pol-push-board').checked,
      pushActions: document.getElementById('pol-push-actions').checked
    };

    const progressMessages = [];
    const onProgress = msg => {
      progressMessages.push(msg);
      resultEl.textContent = progressMessages.join('\n');
    };

    try {
      const result = await PolarionAPI.pushRetrospective(state.retro, cfg, opts, onProgress);
      resultEl.classList.add('success');
      resultEl.innerHTML = `✅ <strong>Push successful!</strong><br/>
        Retrospective Work Item: <strong>${_escHtml(result.retroWorkItemId)}</strong><br/>
        Action Items created: <strong>${result.actionItemIds.length}</strong><br/>
        <small>View in Polarion: ${_escHtml(cfg.serverUrl)}/polarion/#/project/${_escHtml(cfg.projectId)}/workitem?id=${_escHtml(result.retroWorkItemId)}</small>`;
      await Store.saveToHistory(state.retro);
      Toast.show('PI Retrospective pushed to Polarion!', 'success', 5000);
    } catch (err) {
      resultEl.classList.add('error');
      resultEl.innerHTML = `❌ <strong>Push failed:</strong> ${_escHtml(err.message)}<br/>
        <small>Note: Cross-origin requests may be blocked by browser CORS policy. 
        Ensure Polarion has CORS configured for this origin, or use a same-origin proxy.</small>`;
      Toast.show('Polarion push failed.', 'error', 5000);
    }
  });

  document.getElementById('export-prev-btn').addEventListener('click', () => _showPhase(6));

  document.getElementById('finish-btn').addEventListener('click', async () => {
    _collectPolarionConfig();
    await Store.saveToHistory(state.retro);
    await Store.clearActive();
    Toast.show('Retrospective saved to history!', 'success');
    setTimeout(() => _showHome(), 1200);
  });
}

/* ── Modals ──────────────────────────────────────────────────── */
function _bindModalEvents() {
  // Note modal
  document.getElementById('modal-save-btn').addEventListener('click', () => {
    const text   = document.getElementById('modal-note-text').value.trim();
    const author = document.getElementById('modal-note-author').value;
    const tagsRaw = document.getElementById('modal-note-tags').value;
    const tags   = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    if (!text) { Toast.show('Note text is required.', 'warning'); return; }
    if (!author) { Toast.show('Select an author.', 'warning'); return; }

    const col = state.pendingNoteColumn;
    if (!col) return;

    if (state.pendingNoteId) {
      // Edit existing
      const note = (state.retro.board[col] || []).find(n => n.id === state.pendingNoteId);
      if (note) { note.text = text; note.authorId = author; note.tags = tags; }
    } else {
      // New note
      const note = Schema.newNote(text, author, tags);
      if (!state.retro.board[col]) state.retro.board[col] = [];
      state.retro.board[col].push(note);
    }
    _autoSave();
    _renderNoteColumn(col);
    _updateBoardStats();
    _closeModal();
    Toast.show('Note saved.', 'success');
  });

  document.getElementById('modal-cancel-btn').addEventListener('click', _closeModal);
  document.getElementById('modal-close-btn').addEventListener('click', _closeModal);

  // Action item modal
  document.getElementById('action-modal-save-btn').addEventListener('click', () => {
    const title       = document.getElementById('action-title').value.trim();
    const description = document.getElementById('action-description').value.trim();
    const assigneeId  = document.getElementById('action-assignee').value;
    const priority    = document.getElementById('action-priority').value;
    const dueDate     = document.getElementById('action-due-date').value;
    const status      = document.getElementById('action-status').value;
    const editingId   = document.getElementById('action-editing-id').value;

    if (!title) { Toast.show('Action item title is required.', 'warning'); return; }

    if (editingId) {
      const existing = state.retro.actionItems.find(a => a.id === editingId);
      if (existing) {
        existing.title       = title;
        existing.description = description;
        existing.assigneeId  = assigneeId;
        existing.priority    = priority;
        existing.dueDate     = dueDate;
        existing.status      = status;
      }
    } else {
      const ai = Schema.newActionItem({ title, description, assigneeId, priority, dueDate, status, source: 'manual' });
      state.retro.actionItems.push(ai);
    }

    _autoSave();
    _renderActionItems();
    _closeModal();
    Toast.show('Action item saved.', 'success');
  });

  document.getElementById('action-modal-cancel-btn').addEventListener('click', _closeModal);
  document.getElementById('action-modal-close-btn').addEventListener('click', _closeModal);

  // Confirm modal
  document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    if (state.confirmCallback) state.confirmCallback();
    _closeModal();
  });
  document.getElementById('confirm-cancel-btn').addEventListener('click', _closeModal);

  // Invite modal
  document.getElementById('invite-modal-close-btn').addEventListener('click', _closeModal);
  document.getElementById('invite-modal-close-x-btn').addEventListener('click', _closeModal);

  document.getElementById('invite-modal-body').addEventListener('click', e => {
    const copyBtn = e.target.closest('.copy-otp-btn');
    if (copyBtn) {
      const pid = copyBtn.dataset.copyPid;
      const otp = _loadOTPs()[pid]?.otp || '';
      if (otp) {
        navigator.clipboard.writeText(otp)
          .then(() => Toast.show('Code copied to clipboard!', 'success'))
          .catch(() => Toast.show(`Code: ${otp}`, 'info', 6000));
      }
      return;
    }
    const regenBtn = e.target.closest('.regen-otp-btn');
    if (regenBtn) {
      const pid = regenBtn.dataset.regenPid;
      const newOtp = _generateOTP();
      _storeOTP(pid, newOtp);
      const codeEl = document.getElementById(`otp-code-${pid}`);
      if (codeEl) codeEl.textContent = newOtp;
      // Refresh mailto href on the send button
      const p = _participantById(pid);
      if (p?.email) {
        const row = regenBtn.closest('.invite-row');
        const sendBtn = row?.querySelector('a.btn-primary');
        if (sendBtn) {
          const appUrl = _appUrl();
          const mailtoBody = encodeURIComponent(
            `Hi ${p.name},\n\nYou have been invited to join the "${state.retro?.piName || 'PI Retrospective'}" board.\n\nClick the link below to open the app:\n${appUrl}\n\nOnce the page loads, enter your one-time login code when prompted:\n\n    ${newOtp}\n\nThis code is valid for 24 hours.\n\n— ${state.retro?.host?.name || 'The Host'}`
          );
          const mailtoSubject = encodeURIComponent(`Invitation: PI Retrospective — ${state.retro?.piName || ''}`);
          sendBtn.href = `mailto:${encodeURIComponent(p.email)}?subject=${mailtoSubject}&body=${mailtoBody}`;
        }
      }
      Toast.show('New code generated.', 'success');
    }
  });

  // Click outside modal to close
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) _closeModal();
  });
}

/* ── Phase 5: Analytics ─────────────────────────────────────── */
function _refreshAnalytics() {
  if (!state.retro) return;
  _renderKPICards();
  // Defer drawing until layout is painted
  setTimeout(() => _drawAllCharts(), 50);
}

function _renderKPICards() {
  const r = state.retro;
  const container = document.getElementById('analytics-kpi-row');
  if (!container) return;

  const totalNotes   = (r.board.wentWell?.length || 0) + (r.board.couldImprove?.length || 0) + (r.board.didntGoWell?.length || 0);
  const totalActions = r.actionItems?.length || 0;
  const doneActions  = (r.actionItems || []).filter(a => a.status === 'done').length;
  const completePct  = totalActions > 0 ? Math.round((doneActions / totalActions) * 100) : 0;
  const msTotal      = r.piContext?.milestones?.length || 0;
  const msAchieved   = (r.piContext?.milestones || []).filter(m => m.status === 'achieved').length;
  const msPct        = msTotal > 0 ? Math.round((msAchieved / msTotal) * 100) : null;
  const msColorClass = msPct === null ? 'blue' : msPct >= 80 ? 'green' : msPct >= 50 ? 'amber' : 'red';

  const kpis = [
    { icon: '📝', label: 'Total Notes', value: totalNotes,
      sub: `${r.board.wentWell?.length||0} well · ${r.board.couldImprove?.length||0} improve · ${r.board.didntGoWell?.length||0} issues`,
      color: 'blue' },
    { icon: '👥', label: 'Participants', value: _allParticipants().length,
      sub: `Host: ${_escHtml(r.host?.name || '—')}`,
      color: 'green' },
    { icon: '⚡', label: 'Action Items', value: totalActions,
      sub: `${doneActions} done · ${completePct}% complete`,
      color: 'amber' },
    { icon: '🏁', label: 'Milestones', value: msPct !== null ? `${msAchieved}/${msTotal}` : '—',
      sub: msPct !== null ? `${msPct}% achieved` : 'None recorded',
      color: msColorClass }
  ];

  container.innerHTML = kpis.map(k => `
    <div class="kpi-card kpi-${k.color}">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-body">
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    </div>`).join('');
}

function _drawAllCharts() {
  const r = state.retro;
  if (!r) return;

  const cw = size => {
    const el = document.getElementById(size);
    if (!el) return 560;
    const card = el.closest('.chart-card');
    return card ? Math.max(card.clientWidth - 48, 320) : 560;
  };

  // ── Board Distribution ──
  const wwC = r.board.wentWell?.length     || 0;
  const ciC = r.board.couldImprove?.length || 0;
  const dwC = r.board.didntGoWell?.length  || 0;
  ChartRenderer.drawDonut('chart-board-dist', [
    { label: 'Went Well',      value: wwC, color: '#00875A' },
    { label: 'Could Improve',  value: ciC, color: '#FF8B00' },
    { label: "Didn't Go Well", value: dwC, color: '#DE350B' }
  ], { size: 190, centerText: wwC + ciC + dwC, centerLabel: 'notes' });

  _renderChartLegend('legend-board-dist', [
    { label: `Went Well (${wwC})`,       color: '#00875A' },
    { label: `Could Improve (${ciC})`,   color: '#FF8B00' },
    { label: `Didn't Go Well (${dwC})`,  color: '#DE350B' }
  ]);

  // ── Action Items by Priority ──
  const prKeys   = ['critical','high','medium','low'];
  const prColors = ['#DE350B','#FF8B00','#FFAB00','#00875A'];
  const prCounts = prKeys.map(p => (r.actionItems || []).filter(a => a.priority === p).length);
  ChartRenderer.drawDonut('chart-action-priority', prKeys.map((p, i) => ({
    label: p, value: prCounts[i], color: prColors[i]
  })), { size: 190, centerText: r.actionItems?.length || 0, centerLabel: 'actions' });

  _renderChartLegend('legend-action-priority', prKeys.map((p, i) => ({
    label: `${p[0].toUpperCase() + p.slice(1)} (${prCounts[i]})`, color: prColors[i]
  })));

  // ── Action Items by Status ──
  const stKeys   = ['open','in-progress','done'];
  const stLabels = ['Open','In Progress','Done'];
  const stColors = ['#0052CC','#FF8B00','#00875A'];
  const stCounts = stKeys.map(s => (r.actionItems || []).filter(a => a.status === s).length);
  const total    = r.actionItems?.length || 0;
  ChartRenderer.drawDonut('chart-action-status', stKeys.map((s, i) => ({
    label: stLabels[i], value: stCounts[i], color: stColors[i]
  })), { size: 190, centerText: `${stCounts[2]}/${total}`, centerLabel: 'done' });

  _renderChartLegend('legend-action-status', stLabels.map((l, i) => ({
    label: `${l} (${stCounts[i]})`, color: stColors[i]
  })));

  // ── Participant Contributions ──
  const allP = _allParticipants();
  if (allP.length > 0) {
    const groups = allP.map(p => ({
      label: p.name.split(' ')[0],
      values: [
        (r.board.wentWell     || []).filter(n => n.authorId === p.id).length,
        (r.board.couldImprove || []).filter(n => n.authorId === p.id).length,
        (r.board.didntGoWell  || []).filter(n => n.authorId === p.id).length
      ]
    }));
    ChartRenderer.drawGroupedBar('chart-participant', groups,
      ['#00875A','#FF8B00','#DE350B'],
      ['Went Well','Could Improve',"Didn't Go Well"],
      { width: cw('chart-participant'), height: 240 });
  }

  // ── Milestone Achievement ──
  const milestones = r.piContext?.milestones || [];
  const msCard = document.getElementById('milestones-chart-card');
  if (milestones.length === 0 && msCard) {
    msCard.classList.add('hidden');
  } else if (msCard) {
    msCard.classList.remove('hidden');
    ChartRenderer.drawHBar('chart-milestones', [
      { label: 'Achieved', value: milestones.filter(m => m.status === 'achieved').length, color: '#00875A' },
      { label: 'Partial',  value: milestones.filter(m => m.status === 'partial').length,  color: '#FF8B00' },
      { label: 'Missed',   value: milestones.filter(m => m.status === 'missed').length,   color: '#DE350B' }
    ], { width: cw('chart-milestones'), barHeight: 34, gap: 12 });
  }

  // ── Historical Trend ──
  Store.loadHistory().then(history => {
    const trendCard = document.getElementById('historical-trend-card');
    if (history.length >= 2 && trendCard) {
      trendCard.classList.remove('hidden');
      const last5 = [...history].slice(0, 5).reverse(); // oldest → newest
      ChartRenderer.drawLine('chart-historical', [
        { label: 'Went Well',      color: '#00875A', data: last5.map(h => h.board?.wentWell?.length     || 0) },
        { label: 'Could Improve',  color: '#FF8B00', data: last5.map(h => h.board?.couldImprove?.length || 0) },
        { label: "Didn't Go Well", color: '#DE350B', data: last5.map(h => h.board?.didntGoWell?.length  || 0) },
        { label: 'Actions',        color: '#0052CC', data: last5.map(h => h.actionItems?.length         || 0) }
      ], last5.map(h => h.piName || '?'),
      { width: cw('chart-historical'), height: 220 });
    } else if (trendCard) {
      trendCard.classList.add('hidden');
    }
  }).catch(err => {
    console.error('[Analytics] Failed to load history:', err);
  });
}

function _renderChartLegend(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(item => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${_escHtml(item.color)}"></div>
      <span>${_escHtml(item.label)}</span>
    </div>`).join('');
}

/* ── Phase 6: Report ─────────────────────────────────────────── */
function _refreshReport() {
  const container = document.getElementById('report-content');
  if (!container || !state.retro) return;
  const r   = state.retro;
  const allP = _allParticipants();

  const boardCol = (title, items, colorClass) => `
    <div class="report-board-col">
      <div class="report-board-col-header ${colorClass}">${title} (${items.length})</div>
      <div class="report-board-notes">
        ${items.length === 0 ? '<p class="report-empty">None</p>' :
          items.map(n => {
            const a = _participantById(n.authorId);
            return `<div class="report-note">
              <div class="report-note-text">${_escHtml(n.text)}</div>
              <div class="report-note-author">${a ? `— ${_escHtml(a.name)}` : ''}${n.tags?.length ? ` · ${n.tags.map(t => `#${t}`).join(' ')}` : ''}</div>
            </div>`;
          }).join('')}
      </div>
    </div>`;

  const ctxSection = (label, items, getText) => `
    <div class="report-ctx-row">
      <h4>${label} (${items.length})</h4>
      ${items.length === 0 ? '<p class="report-empty">None recorded.</p>' :
        `<ul class="report-ctx-list">${items.map(i => `<li>${_escHtml(getText(i))}</li>`).join('')}</ul>`}
    </div>`;

  container.innerHTML = `
  <div class="report-document-inner">
    <div class="report-doc-header">
      <div class="report-doc-badge">SAFe® 6.0 — PI Retrospective</div>
      <h1 class="report-doc-title">${_escHtml(r.piName)}</h1>
      <div class="report-doc-meta">
        ${r.artName   ? `<span><strong>ART:</strong> ${_escHtml(r.artName)}</span>`                            : ''}
        ${r.teamName        ? `<span><strong>Team:</strong> ${_escHtml(r.teamName)}</span>`                                    : ''}
        ${r.startDate       ? `<span><strong>Period:</strong> ${_fmt(r.startDate)} → ${_fmt(r.endDate)}</span>`                : ''}
        <span><strong>Host:</strong> ${_escHtml(r.host?.name || '—')}</span>
        <span><strong>Mode:</strong> ${_escHtml(r.sessionMode || 'Synchronous')}</span>
        <span><strong>Generated:</strong> ${new Date().toLocaleString()}</span>
      </div>
    </div>

    <div class="report-doc-section">
      <h2>Participants (${allP.length})</h2>
      <div class="report-participants-grid">
        ${allP.map(p => `
          <div class="report-p-chip">
            <div class="report-p-dot" style="background:${_escHtml(p.color || '#0052CC')}">${_escHtml(_avatarInitials(p.name))}</div>
            ${_escHtml(p.name)}${p.isHost ? ' <em>(Host)</em>' : ''}
          </div>`).join('')}
      </div>
    </div>

    ${r.piObjectives ? `
    <div class="report-doc-section">
      <h2>PI Objectives</h2>
      <p class="report-objectives-text">${_escHtml(r.piObjectives)}</p>
    </div>` : ''}

    <div class="report-doc-section">
      <h2>PI Context</h2>
      ${ctxSection('Important Events', r.piContext.events,
          e => `${e.date ? `[${e.date}] ` : ''}${e.text}`)}
      ${ctxSection('Milestones', r.piContext.milestones,
          m => `[${m.status.toUpperCase()}] ${m.text}${m.date ? ` (${m.date})` : ''}`)}
      ${ctxSection('Special Occurrences', r.piContext.specialOccurrences,
          s => `[${s.category}] ${s.text}`)}
    </div>

    <div class="report-doc-section">
      <h2>Retrospective Board</h2>
      <div class="report-board-grid">
        ${boardCol('✅ Went Well',      r.board.wentWell     || [], 'green')}
        ${boardCol('⬆️ Could Improve',  r.board.couldImprove || [], 'amber')}
        ${boardCol("❌ Didn't Go Well", r.board.didntGoWell  || [], 'red')}
      </div>
    </div>

    <div class="report-doc-section">
      <h2>Action Items (${r.actionItems.length})</h2>
      ${r.actionItems.length === 0 ? '<p class="report-empty">No action items defined.</p>' : `
      <table class="report-action-table">
        <thead><tr>
          <th>#</th><th>Title &amp; Description</th><th>Assignee</th>
          <th>Priority</th><th>Due Date</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${r.actionItems.map((a, idx) => {
            const asn = _participantById(a.assigneeId);
            const prIcon = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' }[a.priority] || '🟡';
            const stIcon = { open:'📋', 'in-progress':'🔄', done:'✅' }[a.status] || '📋';
            const overdue = a.dueDate && a.status !== 'done' && new Date(a.dueDate) < new Date();
            return `<tr class="${a.status === 'done' ? 'row-done' : ''} ${overdue ? 'row-overdue' : ''}">
              <td>${idx + 1}</td>
              <td><strong>${_escHtml(a.title)}</strong>${a.description ? `<br/><small>${_escHtml(a.description.slice(0,120))}${a.description.length>120?'…':''}</small>` : ''}</td>
              <td>${asn ? _escHtml(asn.name) : '<em>Unassigned</em>'}</td>
              <td>${prIcon} ${a.priority}</td>
              <td>${a.dueDate ? _fmt(a.dueDate) + (overdue ? ' ⚠️' : '') : '—'}</td>
              <td>${stIcon} ${a.status}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
    </div>

    <div class="report-signature">
      <p>Generated by PI Retrospective App (SAFe® 6.0 compliant) · ${new Date().toLocaleString()}</p>
      ${state.currentUser ? `<p>Facilitating participant: <strong>${_escHtml(state.currentUser.name)}</strong></p>` : ''}
    </div>
  </div>`;
}

function _generateReportText() {
  const r = state.retro;
  const allP = _allParticipants();
  const hr = '═'.repeat(60);
  const sep = '─'.repeat(40);
  const li  = items => items.length === 0 ? '  (none)' :
    items.map(i => `  • ${i}`).join('\n');

  return [
    hr, `PI RETROSPECTIVE REPORT`, `${r.piName}`, hr, '',
    `ART: ${r.artName || '—'}`,
    `Team: ${r.teamName || '—'}`,
    `Period: ${r.startDate ? `${r.startDate} → ${r.endDate}` : '—'}`,
    `Host: ${r.host?.name || '—'}`,
    `Participants: ${allP.map(p => p.name).join(', ')}`,
    `Generated: ${new Date().toLocaleString()}`, '',
    ...(r.piObjectives ? [sep, 'PI OBJECTIVES', sep, r.piObjectives, ''] : []),
    sep, 'PI CONTEXT', sep,
    'Events:', li((r.piContext.events || []).map(e => `${e.date ? `[${e.date}] ` : ''}${e.text}`)), '',
    'Milestones:', li((r.piContext.milestones || []).map(m => `[${m.status.toUpperCase()}] ${m.text}`)), '',
    'Special Occurrences:', li((r.piContext.specialOccurrences || []).map(s => `[${s.category}] ${s.text}`)), '',
    sep, 'RETROSPECTIVE BOARD', sep,
    '✅ WENT WELL:', li((r.board.wentWell || []).map(n => n.text)), '',
    '⬆️  COULD IMPROVE:', li((r.board.couldImprove || []).map(n => n.text)), '',
    '❌ DIDN\'T GO WELL:', li((r.board.didntGoWell || []).map(n => n.text)), '',
    sep, `ACTION ITEMS (${r.actionItems.length})`, sep,
    ...(r.actionItems.length === 0 ? ['  (none)'] :
      r.actionItems.map((a, i) => {
        const asn = _participantById(a.assigneeId)?.name || 'Unassigned';
        return `${i+1}. [${a.priority.toUpperCase()}][${a.status}] ${a.title}\n   Assignee: ${asn}${a.dueDate ? ` | Due: ${a.dueDate}` : ''}${a.description ? `\n   ${a.description}` : ''}`;
      })),
    '', hr
  ].join('\n');
}

/* ── Login / User Selection ───────────────────────────────────── */
function _setCurrentUser(participant) {
  state.currentUser = participant || null;
  if (participant) {
    sessionStorage.setItem('pi-retro-user-id', participant.id);
  } else {
    sessionStorage.removeItem('pi-retro-user-id');
  }
  _updateCurrentUserBadge();
  // Enforce phase visibility based on role whenever the user changes
  if (state.retro) {
    if (!_isHost()) {
      _showPhase(3);
    } else {
      _renderWizardNav();
    }
  }
}

function _updateCurrentUserBadge() {
  const btn    = document.getElementById('current-user-btn');
  const avatar = document.getElementById('current-user-avatar');
  const name   = document.getElementById('current-user-name');
  if (!btn) return;

  if (state.currentUser) {
    btn.classList.remove('hidden');
    avatar.style.background = state.currentUser.color || '#97A0AF';
    avatar.textContent      = _avatarInitials(state.currentUser.name);
    name.textContent        = state.currentUser.name;
  } else {
    btn.classList.remove('hidden');
    avatar.style.background = '#97A0AF';
    avatar.textContent      = '?';
    name.textContent        = 'Guest';
  }
}

function _showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  _renderLoginGrid();
  overlay.classList.remove('hidden');
}

function _hideLoginOverlay() {
  document.getElementById('login-overlay')?.classList.add('hidden');
}

function _renderLoginGrid() {
  const grid = document.getElementById('login-grid');
  if (!grid || !state.retro) return;
  const allP = _allParticipants();

  if (allP.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:var(--text-muted)">No participants added yet. Complete the Setup phase first.</p>';
    return;
  }

  grid.innerHTML = allP.map(p => `
    <div class="login-participant-card ${p.isHost ? 'is-host' : ''}" data-login-pid="${_escHtml(p.id)}">
      <div class="login-p-avatar" style="background:${_escHtml(p.color || '#0052CC')}">
        ${_escHtml(_avatarInitials(p.name))}
      </div>
      <div class="login-p-name">${_escHtml(p.name)}</div>
      <div class="login-p-id">ID: ${_escHtml(p.shortId)}</div>
      ${p.isHost ? '<span class="login-p-badge">HOST</span>' : ''}
    </div>`).join('');
}

/* ── Bind Events: Analytics ─────────────────────────────────── */
function _bindAnalyticsEvents() {
  document.getElementById('analytics-prev-btn').addEventListener('click', () => _showPhase(4));
  document.getElementById('analytics-next-btn').addEventListener('click', () => _showPhase(6));
}

/* ── Bind Events: Report ────────────────────────────────────── */
function _bindReportEvents() {
  document.getElementById('report-prev-btn').addEventListener('click', () => _showPhase(5));
  document.getElementById('report-next-btn').addEventListener('click', () => _showPhase(7));

  document.getElementById('report-print-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('report-copy-btn').addEventListener('click', () => {
    const text = _generateReportText();
    navigator.clipboard.writeText(text)
      .then(() => Toast.show('Report copied to clipboard!', 'success'))
      .catch(() => {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(`<pre style="white-space:pre-wrap;font-family:monospace;padding:20px;font-size:13px">${_escHtml(text)}</pre>`);
          Toast.show('Report opened in new window. Copy it manually.', 'info', 4000);
        }
      });
  });

  document.getElementById('report-email-btn').addEventListener('click', () => {
    const r = state.retro;
    const subject = encodeURIComponent(`PI Retrospective Report: ${r.piName}`);
    const body    = encodeURIComponent(_generateReportText().slice(0, 1800) + '\n\n[Full report truncated for email ...]');
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  });
}

/* ── Bind Events: Login ─────────────────────────────────────── */
function _bindLoginEvents() {
  document.getElementById('login-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-login-pid]');
    if (!card) return;
    const pid  = card.dataset.loginPid;
    const participant = _participantById(pid);
    if (participant) {
      _setCurrentUser(participant);
      _hideLoginOverlay();
      Toast.show(`Logged in as ${participant.name}`, 'success');
    }
  });

  document.getElementById('login-guest-btn').addEventListener('click', () => {
    _setCurrentUser(null);
    _hideLoginOverlay();
    Toast.show('Continuing as Guest. Notes will not be attributed.', 'info');
  });

  document.getElementById('login-otp-btn').addEventListener('click', () => {
    const input = document.getElementById('login-otp-input').value.trim();
    if (!input) { Toast.show('Enter your 6-digit invitation code.', 'warning'); return; }
    const participant = _validateOTP(input);
    if (!participant) {
      Toast.show('Invalid or expired code. Ask the host to resend an invitation.', 'error', 4000);
      return;
    }
    _clearOTP(participant.id);
    _hideLoginOverlay();
    _setCurrentUser(participant);
    Toast.show(`Welcome, ${participant.name}!`, 'success');
  });

  document.getElementById('login-otp-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-otp-btn').click();
  });

  document.getElementById('current-user-btn').addEventListener('click', () => {
    if (!state.retro) return;
    _showLoginOverlay();
  });
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-SAVE TICKER
   ═══════════════════════════════════════════════════════════════ */
function _startAutoSaveTicker() {
  setInterval(() => {
    if (state.retro) {
      _collectCurrentPhase();
    }
  }, 30000); // every 30 seconds
}

/* ═══════════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════════ */
async function _init() {
  // Check for active session
  const active = await Store.loadActive();

  // Bind all event handlers
  _bindHomeEvents();
  _bindHeaderEvents();
  _bindSetupEvents();
  _bindParticipantEvents();
  _bindContextEvents();
  _bindBoardEvents();
  _bindActionEvents();
  _bindAnalyticsEvents();
  _bindReportEvents();
  _bindExportEvents();
  _bindModalEvents();
  _bindLoginEvents();

  // Start auto-save
  _startAutoSaveTicker();
  
  // Set up Firestore connection monitoring to detect network issues
  Store.setupConnectionMonitoring().catch(err => {
    console.warn('[App] Connection monitoring unavailable (will continue in offline mode)');
  });

  // Show home screen
  await _renderHistory();

  // If there's an active in-progress retro, offer to resume
  if (active && active.status === 'in-progress') {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:fixed;bottom:80px;right:24px;
      background:var(--primary);color:white;
      padding:16px 20px;border-radius:12px;
      box-shadow:var(--shadow-lg);
      z-index:1500;
      font-size:0.9rem;font-weight:500;
      max-width:320px;line-height:1.4;
    `;
    banner.innerHTML = `
      <div style="margin-bottom:10px;">
        <strong>Resume Retrospective?</strong><br/>
        <span style="font-size:0.82rem;opacity:0.85">${_escHtml(active.piName || 'Untitled PI')}</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button id="resume-yes" style="flex:1;padding:7px;background:white;color:var(--primary);border:none;border-radius:7px;font-weight:700;cursor:pointer;">Resume</button>
        <button id="resume-no"  style="flex:1;padding:7px;background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:7px;cursor:pointer;">Dismiss</button>
      </div>`;
    document.body.appendChild(banner);

    banner.querySelector('#resume-yes').addEventListener('click', () => {
      banner.remove();
      _showApp(active, false); // not new — show login
    });
    banner.querySelector('#resume-no').addEventListener('click', () => banner.remove());
  }
}

// Boot the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}
