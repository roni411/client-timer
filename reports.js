'use strict';

// ═══════════════════════════════════════
//  DATA
// ═══════════════════════════════════════
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

const allClients = load('ct_clients', []);
const allEntries = load('ct_entries', []);

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let selectedClients = new Set(allClients);
let dateFrom = null;
let dateTo   = null;

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
allClients.forEach((c, i) => { clientColor[c] = BADGE_COLORS[i % BADGE_COLORS.length]; });

// ═══════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">אין רשומות בטווח הנבחר</td></tr>';
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
      <td>${formatTime(e.start)}</td>
      <td>${formatTime(e.end)}</td>
      <td class="duration-cell">${formatDurationFull(e.durationMs)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totals row
  const totals = document.createElement('tr');
  totals.className = 'totals-row';
  totals.innerHTML = `
    <td colspan="4" style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">סה"כ</td>
    <td class="duration-cell">${formatDurationFull(totalMs)}</td>
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

  const rows = filtered.map(e => ({
    'תאריך':           formatDate(e.start),
    'לקוח':            e.client,
    'פעילות':          e.activity || '',
    'שעת התחלה':      formatTime(e.start),
    'שעת סיום':       formatTime(e.end),
    'משך (שע:דק:שנ)': formatDurationFull(e.durationMs)
  }));

  const ws = XLSX.utils.json_to_sheet(rows, { header: ['תאריך','לקוח','פעילות','שעת התחלה','שעת סיום','משך (שע:דק:שנ)'] });

  // Column widths
  ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'דוח זמן');

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
//  INIT
// ═══════════════════════════════════════
renderClientPills();
applyPreset('month');
