'use strict';

// ═══════════════════════════════════════
//  IndexedDB — stores the file handle between sessions
// ═══════════════════════════════════════
function _openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ct-local', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = () => reject(req.error);
  });
}

async function _getStoredHandle() {
  try {
    const db = await _openDb();
    return new Promise(resolve => {
      const req = db.transaction('handles', 'readonly').objectStore('handles').get('dataFile');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function _storeHandle(handle) {
  const db = await _openDb();
  return new Promise(resolve => {
    const tx = db.transaction('handles', 'readwrite');
    if (handle) tx.objectStore('handles').put(handle, 'dataFile');
    else        tx.objectStore('handles').delete('dataFile');
    tx.oncomplete = () => resolve();
  });
}

// ═══════════════════════════════════════
//  FileStore
// ═══════════════════════════════════════
const SHEET_NAME = 'Sheet1';
const HEADERS    = ['id', 'client', 'activity', 'start', 'end', 'durationMs', 'manual'];

const FileStore = {

  _handle: null,
  _wb:     null,

  // ── Init ──────────────────────────────
  // Returns: 'no-file' | 'need-permission' | 'ready'
  async init() {
    const handle = await _getStoredHandle();
    if (!handle) return 'no-file';

    this._handle = handle;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      try {
        await this._load();
        return 'ready';
      } catch {
        // File was moved or deleted — start fresh
        this._handle = null;
        await _storeHandle(null);
        return 'no-file';
      }
    }
    return 'need-permission';
  },

  getFilename() {
    return this._handle ? this._handle.name : '';
  },

  // ── Pick / create file ────────────────
  // Returns: 'ready' | 'cancelled'
  async pickFile() {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'client-timer-data.xlsx',
        types: [{
          description: 'Excel Workbook',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
        }]
      });
      this._handle = handle;
      await _storeHandle(handle);

      // Read existing data if file has content, otherwise init fresh
      const file = await handle.getFile();
      if (file.size > 0) {
        try { await this._load(); return 'ready'; } catch { /* fall through to fresh init */ }
      }
      this._wb = this._newWorkbook();
      await this._save();
      return 'ready';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  },

  // ── Request permission for stored handle ──
  // Returns: true (granted) | false
  async requestPermission() {
    if (!this._handle) return false;
    try {
      const perm = await this._handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
      await this._load();
      return true;
    } catch {
      return false;
    }
  },

  // ── Internal ──────────────────────────
  async _load() {
    const file = await this._handle.getFile();
    if (file.size === 0) {
      this._wb = this._newWorkbook();
      await this._save();
      return;
    }
    const buf = await file.arrayBuffer();
    this._wb = XLSX.read(buf, { type: 'array' });
    if (!this._wb.Sheets[SHEET_NAME]) {
      this._wb.SheetNames.push(SHEET_NAME);
      this._wb.Sheets[SHEET_NAME] = XLSX.utils.aoa_to_sheet([HEADERS]);
      await this._save();
    }
  },

  async _save() {
    const buf      = XLSX.write(this._wb, { type: 'array', bookType: 'xlsx' });
    const writable = await this._handle.createWritable();
    await writable.write(buf);
    await writable.close();
  },

  _newWorkbook() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS]), SHEET_NAME);
    return wb;
  },

  _sheet() { return this._wb.Sheets[SHEET_NAME]; },

  // ── Read all entries ──────────────────
  async readEntries() {
    const rows = XLSX.utils.sheet_to_json(this._sheet(), { header: 1, defval: '' });
    return rows.slice(1)
      .map(r => ({
        id:         String(r[0] || ''),
        client:     String(r[1] || ''),
        activity:   String(r[2] || ''),
        start:      String(r[3] || ''),
        end:        String(r[4] || ''),
        durationMs: parseInt(r[5]) || 0,
        manual:     r[6] === 'true' || r[6] === true
      }))
      .filter(e => e.id && e.start)
      .sort((a, b) => new Date(b.start) - new Date(a.start));
  },

  // ── Append entry ──────────────────────
  async appendEntry(entry) {
    const ws       = this._sheet();
    const ref      = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s:{r:0,c:0}, e:{r:0,c:6} };
    const newRow   = ref.e.r + 1;
    const values   = [
      String(entry.id), entry.client, entry.activity || '',
      entry.start, entry.end || '', String(entry.durationMs), String(entry.manual || false)
    ];
    values.forEach((v, c) => { ws[XLSX.utils.encode_cell({ r: newRow, c })] = { t: 's', v }; });
    ws['!ref'] = XLSX.utils.encode_range({ s: {r:0,c:0}, e: {r: newRow, c: Math.max(6, ref.e.c)} });
    await this._save();
  },

  // ── Delete entry by id ────────────────
  async deleteEntry(id) {
    const ws   = this._sheet();
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const idx  = rows.findIndex((r, i) => i > 0 && String(r[0]) === String(id));
    if (idx === -1) return;

    rows.splice(idx, 1);
    const clientsCell = ws['I1'] ? { ...ws['I1'] } : null;
    const newWs = XLSX.utils.aoa_to_sheet(rows);
    if (clientsCell) newWs['I1'] = clientsCell;
    this._wb.Sheets[SHEET_NAME] = newWs;
    await this._save();
  },

  // ── Read clients (cell I1) ────────────
  async readClients() {
    const ws  = this._sheet();
    const val = ws['I1'] ? String(ws['I1'].v || '') : '';
    return val ? val.split('\n').filter(Boolean) : [];
  },

  // ── Save clients (cell I1) ────────────
  async saveClients(names) {
    this._sheet()['I1'] = { t: 's', v: names.join('\n') };
    await this._save();
  }
};
