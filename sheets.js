'use strict';

// ═══════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════
const SHEETS_CONFIG = {
  CLIENT_ID:  '248217114537-j8nnjnqb8q5cd8oktaqc8cgjgl5v5ihs.apps.googleusercontent.com',
  SHEET_ID:   '1rwPa0q1qAOODU65ws29rCJAEAFPh4NmOI_CIPOZyOpY',
  SHEET_NAME: 'Sheet1',
  SCOPE:      'https://www.googleapis.com/auth/spreadsheets'
};

const API_BASE   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.SHEET_ID}`;
const BATCH_URL  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_CONFIG.SHEET_ID}:batchUpdate`;

// ═══════════════════════════════════════
//  AUTH STATE
// ═══════════════════════════════════════
let _token       = null;
let _tokenExpiry = 0;
let _tokenClient = null;
let _sheetGid    = null; // numeric sheet ID for batchUpdate

const Sheets = {

  // ── Init ──────────────────────────────
  init(onReady) {
    // Restore token from session
    const t = sessionStorage.getItem('ct_gtoken');
    const e = parseInt(sessionStorage.getItem('ct_gexpiry') || '0');
    if (t && e > Date.now() + 30000) {
      _token = t;
      _tokenExpiry = e;
      if (onReady) onReady(true);
      return;
    }

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: SHEETS_CONFIG.CLIENT_ID,
      scope:     SHEETS_CONFIG.SCOPE,
      callback:  (resp) => {
        if (resp.error) { console.error('Auth error', resp); return; }
        _token       = resp.access_token;
        _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        sessionStorage.setItem('ct_gtoken',  _token);
        sessionStorage.setItem('ct_gexpiry', String(_tokenExpiry));
        if (onReady) onReady(true);
      }
    });

    if (onReady) onReady(false); // not yet signed in
  },

  signIn() {
    if (!_tokenClient) return;
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  },

  isSignedIn() {
    return !!_token && _tokenExpiry > Date.now();
  },

  // ── Internal fetch ────────────────────
  async _fetch(url, opts = {}) {
    // Auto-refresh token if close to expiry
    if (_tokenExpiry - Date.now() < 30000 && _tokenClient) {
      await new Promise(res => {
        const orig = _tokenClient.callback;
        _tokenClient.callback = (r) => { orig(r); res(); };
        _tokenClient.requestAccessToken({ prompt: '' });
      });
    }

    const resp = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${_token}`,
        'Content-Type':  'application/json',
        ...(opts.headers || {})
      }
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${err}`);
    }
    return resp.status === 204 ? null : resp.json();
  },

  // ── Get numeric sheet ID (needed for row delete) ──
  async _getSheetGid() {
    if (_sheetGid !== null) return _sheetGid;
    const meta = await this._fetch(API_BASE);
    const sheet = meta.sheets.find(s => s.properties.title === SHEETS_CONFIG.SHEET_NAME);
    _sheetGid = sheet?.properties.sheetId ?? 0;
    return _sheetGid;
  },

  // ── Init headers in sheet ─────────────
  async initHeaders() {
    await this._fetch(
      `${API_BASE}/values/${SHEETS_CONFIG.SHEET_NAME}!A1:G1?valueInputOption=RAW`,
      {
        method: 'PUT',
        body:   JSON.stringify({ values: [['id','לקוח','פעילות','התחלה','סיום','משך_ms','ידני']] })
      }
    );
  },

  // ── Read all entries ──────────────────
  async readEntries() {
    const data = await this._fetch(
      `${API_BASE}/values/${SHEETS_CONFIG.SHEET_NAME}!A2:G`
    );
    const rows = data.values || [];
    return rows
      .map(r => ({
        id:         r[0] || '',
        client:     r[1] || '',
        activity:   r[2] || '',
        start:      r[3] || '',
        end:        r[4] || '',
        durationMs: parseInt(r[5]) || 0,
        manual:     r[6] === 'true'
      }))
      .filter(e => e.id && e.start)
      .sort((a, b) => new Date(b.start) - new Date(a.start));
  },

  // ── Append entry ──────────────────────
  async appendEntry(entry) {
    await this._fetch(
      `${API_BASE}/values/${SHEETS_CONFIG.SHEET_NAME}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body:   JSON.stringify({
          values: [[
            String(entry.id),
            entry.client,
            entry.activity || '',
            entry.start,
            entry.end,
            String(entry.durationMs),
            String(entry.manual || false)
          ]]
        })
      }
    );
  },

  // ── Ensure "Clients" sheet tab exists ─
  async _ensureClientsSheet() {
    const meta = await this._fetch(API_BASE + '?fields=sheets.properties.title');
    const exists = meta.sheets?.some(s => s.properties.title === 'Clients');
    if (!exists) {
      await this._fetch(BATCH_URL, {
        method: 'POST',
        body:   JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Clients' } } }] })
      });
    }
  },

  // ── Read clients ──────────────────────
  async readClients() {
    try {
      const data = await this._fetch(`${API_BASE}/values/Clients!A1:A`);
      return (data.values || []).flat().filter(Boolean);
    } catch { return []; }
  },

  // ── Save clients ──────────────────────
  async saveClients(names) {
    await this._ensureClientsSheet();
    await this._fetch(`${API_BASE}/values/Clients!A1:A:clear`, { method: 'POST', body: '{}' });
    if (names.length === 0) return;
    await this._fetch(
      `${API_BASE}/values/Clients!A1?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: names.map(n => [n]) }) }
    );
  },

  // ── Delete entry by id ────────────────
  async deleteEntry(id) {
    // Find row index
    const data = await this._fetch(
      `${API_BASE}/values/${SHEETS_CONFIG.SHEET_NAME}!A:A`
    );
    const rows = data.values || [];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) { rowIndex = i; break; }
    }
    if (rowIndex === -1) return;

    const gid = await this._getSheetGid();
    await this._fetch(BATCH_URL, {
      method: 'POST',
      body:   JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    gid,
              dimension:  'ROWS',
              startIndex: rowIndex,
              endIndex:   rowIndex + 1
            }
          }
        }]
      })
    });
  }
};
