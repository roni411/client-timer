'use strict';

// ═══════════════════════════════════════
//  DATA
// ═══════════════════════════════════════
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

let allClients = [];
let allEntries = []; // loaded from Sheets

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let selectedClients  = new Set();
let dateFrom         = null;
let dateTo           = null;
let editingEntryId   = null;

// Badge colours (cycles through palette)
const BADGE_COLORS = [
  { bg: '#ede9fe', color: '#5b21b6' },
  { bg: '#dcfce7', color: '#15803d' },
  { bg: '#fef3c7', color: '#b45309' },
  { bg: '#fee2e2', color: '#b91c1c' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fce7f3', color: '#9d174d' },
];
const clientColor = {};

// ═══════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatDurationFull(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function startOfDay(d) {
  const r = new Date(d); r.setHours(0,0,0,0); return r;
}

// ═══════════════════════════════════════
//  FILTERING
// ═══════════════════════════════════════
function getFiltered() {
  return allEntries.filter(e => {
    if (!selectedClients.has(e.client)) return false;
    const start = new Date(e.start);
    if (dateFrom && start < dateFrom) return false;
    if (dateTo   && start > dateTo)   return false;
    return true;
  }).sort((a, b) => new Date(b.start) - new Date(a.start)); // newest first
}

// ═══════════════════════════════════════
//  PRESETS
// ═══════════════════════════════════════
function applyPreset(preset) {
  const now = new Date();
  const from = document.getElementById('date-from');
  const to   = document.getElementById('date-to');

  let f, t = startOfDay(now);
  t.setHours(23, 59, 59, 999);

  if (preset === 'week') {
    f = new Date(now);
    f.setDate(now.getDate() - now.getDay());
    f = startOfDay(f);
  } else if (preset === 'month') {
    f = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === '3months') {
    f = new Date(now);
    f.setMonth(now.getMonth() - 3);
    f = startOfDay(f);
  } else {
    f = null; t = null;
  }

  dateFrom = f;
  dateTo   = t;

  from.value = f ? f.toISOString().slice(0,10) : '';
  to.value   = t ? t.toISOString().slice(0,10) : '';

  render();
}

// ═══════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════
function render() {
  const filtered = getFiltered();
  renderChips(filtered);
  renderTable(filtered);
}

function renderChips(entries) {
  const row = document.getElementById('chips-row');
  row.innerHTML = '';

  const totalMs = entries.reduce((s, e) => s + e.durationMs, 0);

  const chips = [
    { label: 'סה"כ שעות', value: formatDuration(totalMs), cls: 'purple' },
    { label: 'רשומות',    value: entries.length,            cls: 'green'  },
  ];

  // Per selected client
  const byClient = {};
  entries.forEach(e => { byClient[e.client] = (byClient[e.client] || 0) + e.durationMs; });
  Object.entries(byClient).forEach(([c, ms]) => {
    chips.push({ label: c, value: formatDuration(ms), cls: '' });
  });

  chips.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'chip';
    div.innerHTML = `
      <div class="chip-label">${ch.label}</div>
      <div class="chip-value ${ch.cls}">${ch.value}</div>
    `;
    row.appendChild(div);
  });
}

function renderTable(entries) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">אין רשומות בטווח הנבחר</td></tr>';
    return;
  }

  const totalMs = entries.reduce((s, e) => s + e.durationMs, 0);

  entries.forEach(e => {
    const col = clientColor[e.client] || BADGE_COLORS[0];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(e.start)}</td>
      <td><span class="badge" style="background:${col.bg};color:${col.color}">${e.client}</span></td>
      <td style="color:#555;max-width:180px;overflow:hidden;text-overflow:ellipsis">${e.activity || '—'}</td>
      <td>${e.end ? formatTime(e.start) : '—'}</td>
      <td>${e.end ? formatTime(e.end)   : '—'}</td>
      <td class="duration-cell">${e.end ? formatDurationFull(e.durationMs) : '—'}</td>
      <td class="actions-cell">
        <button class="row-btn edit-btn" title="עריכה">✏</button>
        <button class="row-btn delete-btn" title="מחיקה">🗑</button>
      </td>
    `;
    tr.querySelector('.edit-btn').addEventListener('click', () => openEditEntry(e));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(e.id));
    tbody.appendChild(tr);
  });

  // Totals row
  const totals = document.createElement('tr');
  totals.className = 'totals-row';
  totals.innerHTML = `
    <td colspan="5" style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">סה"כ</td>
    <td class="duration-cell">${formatDurationFull(totalMs)}</td>
    <td></td>
  `;
  tbody.appendChild(totals);
}

// ═══════════════════════════════════════
//  CLIENT PILLS
// ═══════════════════════════════════════
function renderClientPills() {
  const container = document.getElementById('client-pills');
  container.innerHTML = '';

  // "הכל" pill
  const allPill = document.createElement('label');
  allPill.className = 'pill' + (selectedClients.size === allClients.length ? ' checked' : '');
  allPill.innerHTML = `<input type="checkbox" ${selectedClients.size === allClients.length ? 'checked' : ''} id="pill-all"> הכל`;
  allPill.querySelector('input').addEventListener('change', e => {
    if (e.target.checked) selectedClients = new Set(allClients);
    else selectedClients.clear();
    renderClientPills();
    render();
  });
  container.appendChild(allPill);

  allClients.forEach(c => {
    const checked = selectedClients.has(c);
    const pill = document.createElement('label');
    pill.className = 'pill' + (checked ? ' checked' : '');
    pill.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}> ${c}`;
    pill.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) selectedClients.add(c);
      else selectedClients.delete(c);
      renderClientPills();
      render();
    });
    container.appendChild(pill);
  });
}

// ═══════════════════════════════════════
//  EXCEL EXPORT
// ═══════════════════════════════════════
document.getElementById('btn-export').addEventListener('click', () => {
  const filtered = getFiltered();
  if (filtered.length === 0) { alert('אין נתונים לייצוא בטווח הנבחר'); return; }

  // ── Sheet 1: Summary per client ──
  const byClient = {};
  filtered.forEach(e => { byClient[e.client] = (byClient[e.client] || 0) + e.durationMs; });
  const summaryRows = Object.entries(byClient).map(([client, ms]) => ({
    'לקוח': client, 'סה"כ שעות': formatDuration(ms)
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { header: ['לקוח', 'סה"כ שעות'] });
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 14 }];

  // ── Sheet 2: Detail sorted by client then date ──
  const sorted = [...filtered].sort((a, b) =>
    a.client.localeCompare(b.client) || new Date(a.start) - new Date(b.start)
  );
  const detailRows = sorted.map(e => ({
    'לקוח':            e.client,
    'תאריך':           formatDate(e.start),
    'פעילות':          e.activity || '',
    'שעת התחלה':      e.end ? formatTime(e.start) : '—',
    'שעת סיום':       e.end ? formatTime(e.end)   : '—',
    'משך (שע:דק:שנ)': e.end ? formatDurationFull(e.durationMs) : '—'
  }));
  const wsDetail = XLSX.utils.json_to_sheet(detailRows, { header: ['לקוח','תאריך','פעילות','שעת התחלה','שעת סיום','משך (שע:דק:שנ)'] });
  wsDetail['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'סיכום');
  XLSX.utils.book_append_sheet(wb, wsDetail,  'פירוט');

  const today = new Date().toLocaleDateString('he-IL').replace(/\//g,'-');
  XLSX.writeFile(wb, `client-timer-${today}.xlsx`);
});

// ═══════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyPreset(btn.dataset.preset);
  });
});

// Date inputs
document.getElementById('date-from').addEventListener('change', e => {
  dateFrom = e.target.value ? new Date(e.target.value) : null;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  render();
});
document.getElementById('date-to').addEventListener('change', e => {
  if (e.target.value) {
    dateTo = new Date(e.target.value);
    dateTo.setHours(23, 59, 59, 999);
  } else {
    dateTo = null;
  }
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  render();
});

// ═══════════════════════════════════════
//  ROW ACTIONS (EDIT / DELETE)
// ═══════════════════════════════════════
function deleteEntry(id) {
  if (!confirm('למחוק את הרשומה?')) return;
  Sheets.deleteEntry(id)
    .then(() => Sheets.readEntries())
    .then(rows => { allEntries = rows; render(); })
    .catch(err => { console.error('Failed to delete entry:', err); alert('שגיאה במחיקת הרשומה'); });
}

function openEditEntry(entry) {
  editingEntryId = entry.id;
  document.querySelector('.manual-entry-title').textContent = 'עריכת רשומה';
  manualClient.value   = entry.client;
  manualDate.value     = entry.start.slice(0, 10);
  manualStart.value    = entry.end ? formatTime(entry.start) : '';
  manualEnd.value      = entry.end ? formatTime(entry.end)   : '';
  manualActivity.value = entry.activity || '';
  manualCard.style.display = 'block';
  manualCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════
//  MANUAL ENTRY
// ═══════════════════════════════════════
const manualCard    = document.getElementById('manual-entry-card');
const manualClient  = document.getElementById('manual-client');
const manualDate    = document.getElementById('manual-date');
const manualStart   = document.getElementById('manual-start');
const manualEnd     = document.getElementById('manual-end');
const manualActivity= document.getElementById('manual-activity');

// Populate client dropdown
function populateManualClients() {
  manualClient.innerHTML = '';
  allClients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    manualClient.appendChild(opt);
  });
}

document.getElementById('btn-add-manual').addEventListener('click', () => {
  editingEntryId = null;
  document.querySelector('.manual-entry-title').textContent = 'הוספת רשומה ידנית';
  manualDate.value     = new Date().toISOString().slice(0, 10);
  manualStart.value    = '';
  manualEnd.value      = '';
  manualActivity.value = '';
  manualCard.style.display = 'block';
  manualCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

document.getElementById('btn-cancel-manual').addEventListener('click', () => {
  manualCard.style.display = 'none';
  editingEntryId = null;
  document.querySelector('.manual-entry-title').textContent = 'הוספת רשומה ידנית';
});

document.getElementById('btn-save-manual').addEventListener('click', () => {
  const client   = manualClient.value;
  const date     = manualDate.value;
  const startVal = manualStart.value;
  const endVal   = manualEnd.value;
  const activity = manualActivity.value.trim();

  if (!client || !date) {
    alert('נא למלא לקוח ותאריך');
    return;
  }

  let startISO, endISO, durationMs;
  if (startVal && endVal) {
    startISO   = new Date(`${date}T${startVal}`).toISOString();
    endISO     = new Date(`${date}T${endVal}`).toISOString();
    durationMs = new Date(endISO) - new Date(startISO);
    if (durationMs <= 0) {
      alert('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      return;
    }
  } else {
    startISO   = new Date(`${date}T00:00:00`).toISOString();
    endISO     = '';
    durationMs = 0;
  }

  const entry = {
    id:         Date.now(),
    client,
    start:      startISO,
    end:        endISO,
    durationMs,
    activity,
    manual:     true
  };

  const saveAction = editingEntryId
    ? Sheets.deleteEntry(editingEntryId).then(() => Sheets.appendEntry(entry))
    : Sheets.appendEntry(entry);

  saveAction
    .then(() => Sheets.readEntries())
    .then(rows => {
      allEntries = rows;
      editingEntryId = null;
      document.querySelector('.manual-entry-title').textContent = 'הוספת רשומה ידנית';
      manualCard.style.display = 'none';
      render();
    })
    .catch(err => {
      console.error('Failed to save entry:', err);
      alert('שגיאה בשמירת הרשומה');
    });
});

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
const signinOverlay = document.getElementById('signin-overlay');

document.getElementById('btn-signin').addEventListener('click', () => {
  Sheets.signIn();
});

function onSignedIn() {
  signinOverlay.style.display = 'none';
  Promise.all([Sheets.readClients(), Sheets.readEntries()])
    .then(([clients, entries]) => {
      allClients = clients.length > 0 ? clients : load('ct_clients', []);
      allEntries = entries;
      allClients.forEach((c, i) => { clientColor[c] = BADGE_COLORS[i % BADGE_COLORS.length]; });
      selectedClients = new Set(allClients);
      populateManualClients();
      renderClientPills();
      applyPreset('month');
    })
    .catch(err => {
      console.error('Failed to load data:', err);
      allClients = load('ct_clients', []);
      allClients.forEach((c, i) => { clientColor[c] = BADGE_COLORS[i % BADGE_COLORS.length]; });
      selectedClients = new Set(allClients);
      populateManualClients();
      renderClientPills();
      applyPreset('month');
    });
}

window.addEventListener('load', () => {
  signinOverlay.style.display = 'flex';
  if (typeof google === 'undefined') {
    setTimeout(() => Sheets.init(ready => {
      if (ready) onSignedIn();
      else signinOverlay.style.display = 'flex';
    }), 1000);
  } else {
    Sheets.init(ready => {
      if (ready) onSignedIn();
      else signinOverlay.style.display = 'flex';
    });
  }
});
