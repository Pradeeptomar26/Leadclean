// Pure helper functions shared by the browser app and by the node test script.
// No DOM, no React, no XLSX dependency here — keeps this file testable in plain node.
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.LeadCleanUtils = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Normalizes a raw cell value into a 10-digit Indian mobile number, or null
  // if it doesn't look like one. Handles +91 / 0 / trailing ".0" float artifacts.
  function normalizeMobile(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (s === '') return null;
    s = s.replace(/\.0+$/, '');
    s = s.replace(/[\s\-().]/g, '');
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.length === 12 && s.slice(0, 2) === '91') s = s.slice(2);
    if (s.length === 11 && s.charAt(0) === '0') s = s.slice(1);
    s = s.replace(/\D/g, '');
    if (s.length !== 10) return null;
    if (!/^[6-9]/.test(s)) return null;
    return s;
  }

  // Normalizes a join-key cell so "1234" and "1234.0" compare equal.
  function keyText(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw).trim();
    s = s.replace(/\.0+$/, '');
    return s;
  }

  // A header "shape" that ignores column order and case/whitespace, so the
  // same 60 columns in a different per-sheet order group together.
  function headerShape(header) {
    var norm = header.map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
    norm.sort();
    return JSON.stringify(norm);
  }

  // Ceiling-division split: N rows into "partsWanted" roughly-equal files.
  function rowsPerPart(totalRows, partsWanted) {
    if (partsWanted <= 0) return totalRows;
    return Math.max(1, Math.ceil(totalRows / partsWanted));
  }

  function partsForRowsPerFile(totalRows, rowsPerFile) {
    if (rowsPerFile <= 0) return 1;
    return Math.max(1, Math.ceil(totalRows / rowsPerFile));
  }

  // Groups header-mismatch problems by shape, so N sheets with the same
  // columns in different orders become one block instead of N.
  function groupHeaderProblems(tables, expectedShape) {
    var groups = {}; // shape -> { header, labels: [] }
    tables.forEach(function (t) {
      var shape = headerShape(t.header);
      if (shape === expectedShape) return;
      if (!groups[shape]) groups[shape] = { header: t.header, labels: [] };
      groups[shape].labels.push(t.label);
    });
    return Object.keys(groups).map(function (shape) { return groups[shape]; });
  }

  // Picks the most common header shape across tables (row-weighted), mirroring
  // how the desktop app chose its "expected" header.
  function dominantShape(tables) {
    var counts = {};
    tables.forEach(function (t) {
      var shape = headerShape(t.header);
      counts[shape] = (counts[shape] || 0) + (t.rowCount || 1);
    });
    var best = null, bestCount = -1;
    Object.keys(counts).forEach(function (shape) {
      if (counts[shape] > bestCount) { bestCount = counts[shape]; best = shape; }
    });
    return best;
  }

  // Hand-written CSV parser (handles quoted fields, embedded commas/newlines,
  // "" escaped quotes, CRLF or LF). Used instead of routing CSV through the
  // xlsx library, which keeps both the raw text and its own parsed structures
  // in memory at once — this scans the string once into plain arrays, which
  // matters once files run into the hundreds of MB.
  function parseCsv(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    var n = text.length;
    for (var i = 0; i < n; i++) {
      var ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\r') { continue; }
      if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; continue; }
      field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    var header = (rows[0] || []).map(function (h) { return String(h).trim(); });
    return { header: header, rows: rows.slice(1) };
  }

  function columnUnion(tables) {
    var seen = {}; // name(lower-trim) -> { name, count }
    var order = [];
    tables.forEach(function (t) {
      t.header.forEach(function (h) {
        var key = String(h == null ? '' : h).trim().toLowerCase();
        if (!key) return;
        if (!seen[key]) { seen[key] = { name: h, count: 0 }; order.push(key); }
        seen[key].count += 1;
      });
    });
    return order.map(function (key) { return seen[key]; });
  }

  return {
    normalizeMobile: normalizeMobile,
    keyText: keyText,
    headerShape: headerShape,
    rowsPerPart: rowsPerPart,
    partsForRowsPerFile: partsForRowsPerFile,
    groupHeaderProblems: groupHeaderProblems,
    dominantShape: dominantShape,
    columnUnion: columnUnion,
    parseCsv: parseCsv,
  };
});
