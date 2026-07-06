'use strict';

// ═══════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════
const Storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const KEYS = {
  CLIENTS:  'ct_clients',
  ENTRIES:  'ct_entries',
  SESSION:  'ct_session',   // { client, startTime }
  SETTINGS: 'ct_settings'
};

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let clients    = Storage.get(KEYS.CLIENTS,  ['לקוח א׳', 'לקוח ב׳']);
let entries    = Storage.get(KEYS.ENTRIES,  []);
let session    = Storage.get(KEYS.SESSION,  null);
let settings   = Storage.get(KEYS.SETTINGS, { reminderMinutes: 60 });

let timerInterval    = null;
let reminderInterval = null;
let lastNotifiedMin  = 0;
let isMinimized      = false;
let dragSrcIndex     = null;

// ═══════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════
const panels = {
  idle:    document.getElementById('panel-idle'),
  running: document.getElementById('panel-running'),
  edit:    document.getElementById('panel-edit')
};
const miniBar            = document.getElementById('mini-bar');
const clientSelect       = document.getElementById('client-select');
const timerDisplay       = document.getElementById('timer-display');
const runningClientName  = document.getElementById('running-client-name');
const editList           = document.getElementById('edit-list');
const miniStatus         = document.getElementById('mini-status');
const miniTime           = document.getElementById('mini-time');
const miniIndicator      = document.getElementById('mini-indicator');
const miniActionBtn      = document.getElementById('mini-action-btn');
const notifBar           = document.getElementById('notif-bar');
const activityInput      = document.getElementById('activity-input');
const activityInputRunning = document.getElementById('activity-input-running');

// ═══════════════════════════════════════
//  PANEL SWITCHING
// ═══════════════════════════════════════
function showPanel(name) {
  Object.values(panels).forEach(p => p.classList.remove('active'));
  miniBar.classList.remove('active');
  if (isMinimized) {
    miniBar.classList.add('active');
  } else {
    if (panels[name]) panels[name].classList.add('active');
  }
}

function currentPanel() {
  if (session) return 'running';
  return 'idle';
}

// ═══════════════════════════════════════
//  CLIENT SELECT
// ═══════════════════════════════════════
function refreshClientSelect() {
  const prev = clientSelect.value;
  clientSelect.innerHTML = '<option value="">בחרי לקוח...</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === prev) opt.selected = true;
    clientSelect.appendChild(opt);
  });
}

// ═══════════════════════════════════════
//  TIMER
// ═══════════════════════════════════════
function elapsedMs() {
  if (!session) return 0;
  return Date.now() - new Date(session.startTime).getTime();
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function tickTimer() {
  const ms = elapsedMs();
  const formatted = formatDuration(ms);
  timerDisplay.textContent = formatted;
  miniTime.textContent = formatted;
  checkReminder(ms);
}

function syncActivity() {
  // keep both activity fields in sync
  activityInputRunning.value = activityInput.value;
}

function startTimer(clientName) {
  session = { client: clientName, startTime: new Date().toISOString() };
  Storage.set(KEYS.SESSION, session);
  lastNotifiedMin = 0;

  runningClientName.textContent = clientName;
  activityInputRunning.value = activityInput.value;
  updateMiniBar();
  showPanel('running');

  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
  requestNotificationPermission();
}

function stopTimer() {
  if (!session) return;

  clearInterval(timerInterval);
  timerInterval = null;

  const end = new Date().toISOString();
  const durationMs = elapsedMs();

  const activity = activityInputRunning.value.trim();

  const entry = {
    id:         Date.now(),
    client:     session.client,
    start:      session.startTime,
    end:        end,
    durationMs: durationMs,
    activity:   activity
  };

  entries.push(entry);
  Storage.set(KEYS.ENTRIES, entries);

  session = null;
  Storage.set(KEYS.SESSION, null);

  // clear activity fields
  activityInput.value = '';
  activityInputRunning.value = '';

  showPanel('idle');
  updateMiniBar();
}

// ═══════════════════════════════════════
//  MINIMIZE
// ═══════════════════════════════════════
function updateMiniBar() {
  if (session) {
    miniIndicator.innerHTML = '<span class="dot-red"></span>';
    miniActionBtn.textContent = '⏹ עצור';
    miniActionBtn.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)';
    miniActionBtn.style.color = '#fff';
    miniTime.textContent = formatDuration(elapsedMs());
  } else {
    miniIndicator.textContent = '⏸';
    miniActionBtn.textContent = '▶ התחל';
    miniActionBtn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    miniActionBtn.style.color = '#fff';
    miniTime.textContent = '';
  }
}

function toggleMinimize() {
  isMinimized = !isMinimized;
  if (isMinimized) {
    Object.values(panels).forEach(p => p.classList.remove('active'));
    miniBar.classList.add('active');
    updateMiniBar();
  } else {
    miniBar.classList.remove('active');
    showPanel(currentPanel());
  }
}

// ═══════════════════════════════════════
//  EDIT CLIENTS
// ═══════════════════════════════════════
let editClients = []; // working copy during edit

function openEdit() {
  editClients = [...clients];
  renderEditList();
  showPanel('edit');
}

function renderEditList() {
  editList.innerHTML = '';
  editClients.forEach((name, idx) => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.draggable = true;
    row.dataset.idx = idx;

    row.innerHTML = `
      <span class="drag-handle" title="גרור לשינוי סדר">⠿</span>
      <input class="client-input" type="text" value="${escapeHtml(name)}" data-idx="${idx}" />
      <button class="delete-btn" data-idx="${idx}" title="מחק">🗑</button>
    `;

    // drag events
    row.addEventListener('dragstart', onDragStart);
    row.addEventListener('dragover',  onDragOver);
    row.addEventListener('dragleave', onDragLeave);
    row.addEventListener('drop',      onDrop);
    row.addEventListener('dragend',   onDragEnd);

    // input change
    row.querySelector('.client-input').addEventListener('input', e => {
      editClients[+e.target.dataset.idx] = e.target.value;
    });

    // delete
    row.querySelector('.delete-btn').addEventListener('click', e => {
      editClients.splice(+e.target.dataset.idx, 1);
      renderEditList();
    });

    editList.appendChild(row);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function saveEdit() {
  // filter empty names, trim
  clients = editClients.map(c => c.trim()).filter(Boolean);
  Storage.set(KEYS.CLIENTS, clients);
  refreshClientSelect();
  showPanel('idle');
}

// ── Drag to reorder ──
function onDragStart(e) {
  dragSrcIndex = +this.dataset.idx;
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}
function onDragLeave() {
  this.classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const targetIndex = +this.dataset.idx;
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

  // save current input values before re-render
  editList.querySelectorAll('.client-input').forEach(inp => {
    editClients[+inp.dataset.idx] = inp.value;
  });

  const [moved] = editClients.splice(dragSrcIndex, 1);
  editClients.splice(targetIndex, 0, moved);
  renderEditList();
}
function onDragEnd() {
  editList.querySelectorAll('.client-row').forEach(r => r.classList.remove('drag-over'));
  dragSrcIndex = null;
}

// ═══════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════
function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    notifBar.style.display = 'flex';
  }
}

function checkReminder(ms) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const elapsedMin = Math.floor(ms / 60000);
  const interval   = settings.reminderMinutes;
  const dueMin     = Math.floor(elapsedMin / interval) * interval;

  if (elapsedMin > 0 && dueMin > lastNotifiedMin && elapsedMin >= interval) {
    lastNotifiedMin = dueMin;
    const h = Math.floor(elapsedMin / 60);
    const m = elapsedMin % 60;
    const label = h > 0 ? `${h} שעות${m > 0 ? ` ו-${m} דקות` : ''}` : `${m} דקות`;
    new Notification('Client Timer — תזכורת', {
      body: `השעון רץ כבר ${label} עבור ${session?.client || ''}. שכחת לעצור?`,
      icon: './icon.svg',
      tag:  'ct-reminder'
    });
  }
}

// ═══════════════════════════════════════
//  MINI BAR ACTION
// ═══════════════════════════════════════
miniActionBtn.addEventListener('click', () => {
  if (session) {
    stopTimer();
  } else {
    const client = clients[0];
    if (!client) { alert('הוסיפי לקוח תחילה'); return; }
    startTimer(client);
  }
  updateMiniBar();
});

// ═══════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════

// Start
document.getElementById('btn-start').addEventListener('click', () => {
  const client = clientSelect.value;
  if (!client) { clientSelect.style.borderColor = '#ef4444'; clientSelect.focus(); return; }
  clientSelect.style.borderColor = '';
  startTimer(client);
});

// Stop
document.getElementById('btn-stop').addEventListener('click', stopTimer);

// Minimize / expand
document.getElementById('btn-minimize-idle').addEventListener('click', toggleMinimize);
document.getElementById('btn-minimize-running').addEventListener('click', toggleMinimize);
document.getElementById('btn-expand').addEventListener('click', toggleMinimize);

// Edit open/close
document.getElementById('btn-open-edit').addEventListener('click', openEdit);
document.getElementById('btn-close-edit').addEventListener('click', () => showPanel('idle'));
document.getElementById('btn-save-clients').addEventListener('click', saveEdit);

// Add client
document.getElementById('btn-add-client').addEventListener('click', () => {
  editClients.push('');
  renderEditList();
  // focus last input
  const inputs = editList.querySelectorAll('.client-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// Sync activity between idle and running panels
activityInput.addEventListener('input', () => {
  activityInputRunning.value = activityInput.value;
});
activityInputRunning.addEventListener('input', () => {
  activityInput.value = activityInputRunning.value;
});

// Notification permission
document.getElementById('btn-allow-notif').addEventListener('click', () => {
  Notification.requestPermission().then(p => {
    if (p === 'granted') notifBar.style.display = 'none';
  });
});

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  refreshClientSelect();

  // Restore running session after page refresh
  if (session) {
    runningClientName.textContent = session.client;
    showPanel('running');
    timerInterval = setInterval(tickTimer, 1000);
    tickTimer();
    requestNotificationPermission();
  } else {
    showPanel('idle');
  }

  // Show notification bar if not yet decided
  if ('Notification' in window && Notification.permission === 'default' && !session) {
    notifBar.style.display = 'flex';
  }
}

init();
