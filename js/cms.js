function parseCSV(text) {
  if (!text.trim()) return [];
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQ && next === '"') {
      cur += '"';
      i += 1;
    } else if (char === '"') {
      inQ = !inQ;
    } else if (char === ',' && !inQ) {
      row.push(cur);
      cur = '';
    } else if ((char === '\n' || char === '\r') && !inQ) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += char;
    }
  }
  row.push(cur);
  rows.push(row);

  const headers = (rows.shift() || []).map(h => h.trim());
  if (!headers[0]) return [];
  return rows.map((values, rowIndex) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    obj.__rowIndex = rowIndex + 1;
    return obj;
  }).filter(r => r[headers[0]]);
}

function getUploadTime(row) {
  const raw = String(row?.upload_date || '').trim();
  if (!raw) return 0;

  // Older rows only have YYYY-MM-DD. New rows use full ISO timestamps.
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? 0 : time;
}

function sortDesksLatest(desks) {
  return desks.slice().sort((a, b) => {
    const uploadDiff = getUploadTime(b) - getUploadTime(a);
    if (uploadDiff) return uploadDiff;
    return (b.__rowIndex || 0) - (a.__rowIndex || 0);
  });
}

function findLatestDesk(desks, predicate) {
  return sortDesksLatest(desks).find(predicate);
}

function getObjectIndex(row) {
  const parts = String(row?.object_id || '').split('_');
  const index = Number.parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(index) ? index : null;
}

function latestObjectState(rows) {
  const ordered = rows
    .slice()
    .sort((a, b) => (a.__rowIndex || 0) - (b.__rowIndex || 0));

  let baselineStart = -1;
  const seenIds = new Set();
  ordered.forEach((row, index) => {
    if (getObjectIndex(row) === 0 && !seenIds.has(row.object_id)) baselineStart = index;
    if (row.object_id) seenIds.add(row.object_id);
  });

  const latestById = new Map();
  ordered.slice(Math.max(0, baselineStart)).forEach(row => {
    if (!row.object_id) return;
    latestById.set(row.object_id, row);
  });
  return [...latestById.values()];
}

function hasObjectPosition(row) {
  const x = parseFloat(row.x);
  const y = parseFloat(row.y);
  const z = parseFloat(row.z);
  return ![x, y, z].some(Number.isNaN);
}

function getDeskMeta(row) {
  const raw = String(row?.owner || '');
  if (!raw.startsWith('askdesk:')) return { owner: raw };
  try {
    return JSON.parse(raw.slice(8));
  } catch {
    return { owner: '' };
  }
}

function encodeDeskMeta(meta) {
  return `askdesk:${JSON.stringify(meta)}`;
}

async function fetchSheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${name}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  return parseCSV(await res.text());
}

window.CMS = {
  async fetchDesks() {
    return fetchSheet('desks');
  },
  async fetchObjects(desk_id) {
    const all = await fetchSheet('objects');
    return latestObjectState(all.filter(o => o.desk_id === desk_id)).filter(hasObjectPosition);
  },
  sortDesksLatest,
  findLatestDesk,
  getDeskMeta,
  encodeDeskMeta,
};
