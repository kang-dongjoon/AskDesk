function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  if (!headers[0]) return [];
  return lines.slice(1).map(line => {
    const values = [];
    let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    values.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').replace(/^"|"$/g, ''); });
    return obj;
  }).filter(r => r[headers[0]]);
}

async function fetchSheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${name}`;
  const res  = await fetch(url);
  return parseCSV(await res.text());
}

window.CMS = {
  async fetchDesks() {
    return fetchSheet('desks');
  },
  async fetchObjects(desk_id) {
    const all = await fetchSheet('objects');
    return all.filter(o => o.desk_id === desk_id);
  },
};
