#!/usr/bin/env node
/**
 * NEEL Suite Cloud - Inventory Management module patcher
 *
 *   node patch-inventory.cjs                 -> patches ./src/App.jsx
 *   node patch-inventory.cjs path/to/App.jsx
 *
 * Adds (all-or-nothing, backup saved as App.jsx.inv.bak):
 *   - Inventory Management launchpad (tiles: Stock Management / Stock Monitoring / Reservation Management)
 *   - Dead Stock Analysis            (filter bar, material value help, results table, Excel export)
 *   - Slow or Non-Moving Materials   (same pattern)
 *   - Analyze Stock in Date Range    (opening / receipts / issues / closing)
 *   - Stock - Single Material        (enter / scan a material, stock + movement history)
 *   - Goods Receipt Purchase Order   (MIGO-style screen, posts real material documents)
 * Everything reads your live rawItems / finishedItems / matDocs.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('NEEL_INV_MODULE_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

/* ------------------------------------------------------------------ */
/* MODULE CODE (no backticks / template literals on purpose)           */
/* ------------------------------------------------------------------ */
const MODULE = String.raw`/* NEEL_INV_MODULE_V1 - Inventory Management module */
const INV_SLOC_RAW = 'RM01';
const INV_SLOC_FIN = 'FG01';
const INV_CURRENCIES = ['INR', 'USD', 'EUR'];
const INV_CONSUME = ['261', '551', '601'];
const invToday = () => new Date().toISOString().slice(0, 10);
const invDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const invShiftDay = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const invNum = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const invMoney = (v, cur) => (Number(v) > 0 ? cur + ' ' + invNum(v) : '\u2014');
const invInp = { padding: '6px 8px', borderRadius: 4, border: '1px solid ' + C.border, fontSize: 12.5, background: '#fff', color: C.ink, boxSizing: 'border-box', minWidth: 0 };
const invBtn = { background: 'var(--neel-accent, #0a6ed1)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const invBtnGhost = { background: 'none', border: 'none', color: 'var(--neel-accent, #0a6ed1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const invTh = { padding: '8px 12px', fontSize: 11, color: C.subtext, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', textAlign: 'left' };

function invMaterials(rawItems, finishedItems) {
  const rawList = (rawItems || []).map(r => ({
    key: 'r' + r.id, number: materialNumberForRaw(r.name), name: r.name, group: r.kind || 'Other',
    type: 'Raw material', plant: PLANT_CODE, sloc: INV_SLOC_RAW, qty: Number(r.qty) || 0, unit: r.unit || 'kg',
    price: Number(r.price || r.rate || 0),
  }));
  const finList = (finishedItems || []).map(f => ({
    key: 'f' + f.id, number: materialNumberForSpec(f.spec), name: f.spec, group: f.category || 'Finished goods',
    type: 'Finished goods', plant: PLANT_CODE, sloc: INV_SLOC_FIN, qty: Number(f.qty) || 0, unit: f.unit || 'kg',
    price: Number(f.price || f.rate || 0),
  }));
  return rawList.concat(finList).filter(m => m.number);
}
function invSign(d) { const t = MOVEMENT_TYPES[d.movementType]; return t ? t.sign : 0; }
function invDay(d) { return String(d.postingDate || '').slice(0, 10); }
function invStockAt(m, docs, date) {
  let q = m.qty;
  (docs || []).forEach(d => {
    if (d.materialNumber !== m.number) return;
    const sg = invSign(d); if (!sg) return;
    if (invDay(d) > date) q -= sg * Math.abs(Number(d.quantity) || 0);
  });
  return Math.max(0, q);
}
function invSum(docs, number, from, to, pred) {
  let t = 0;
  (docs || []).forEach(d => {
    if (d.materialNumber !== number) return;
    const day = invDay(d); if (day < from || day > to) return;
    if (pred(invSign(d), d.movementType)) t += Math.abs(Number(d.quantity) || 0);
  });
  return t;
}
function invLastMove(docs, number) {
  let last = '';
  (docs || []).forEach(d => { if (d.materialNumber === number && invDay(d) > last) last = invDay(d); });
  return last;
}
function invHas(a, b) { return !b || String(a || '').toLowerCase().includes(String(b).toLowerCase()); }
function invMatMatch(sel, m) {
  const items = (sel && sel.items) || []; const conds = (sel && sel.conditions) || [];
  if (!items.length && !conds.length) return true;
  if (items.includes(m.number)) return true;
  const num = m.number.toLowerCase(); const nm = String(m.name || '').toLowerCase();
  return conds.some(c => {
    const v = String(c.value || '').toLowerCase(); if (!v) return false;
    if (c.op === 'equals') return num === v || nm === v;
    if (c.op === 'starts') return num.startsWith(v) || nm.startsWith(v);
    return (num + ' ' + nm).includes(v);
  });
}
function invBaseFilter(v, m) {
  return invMatMatch(v.material, m) && invHas(m.plant, v.plant) && invHas(m.sloc, v.sloc) && invHas(m.group, v.group) && invHas(m.type, v.type);
}

function InvModal({ title, onClose, children, footer, width }) {
  return (
    <div role="dialog" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(' + (width || 720) + 'px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 14, flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: '10px 18px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>{footer}</div>}
      </div>
    </div>
  );
}

function MaterialValueHelp({ materials, value, onOk, onCancel, single }) {
  const [tab, setTab] = useState('search');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState((value && value.items) || []);
  const [conds, setConds] = useState((value && value.conditions) || []);
  const shown = materials.filter(m => !applied || (m.number + ' ' + m.name + ' ' + m.group).toLowerCase().includes(applied.toLowerCase()));
  const toggle = (n) => setItems(prev => single ? (prev.includes(n) ? [] : [n]) : (prev.includes(n) ? prev.filter(x => x !== n) : prev.concat([n])));
  const tabBtn = (k, label) => (
    <button type="button" onClick={() => setTab(k)} style={{ background: 'none', border: 'none', borderBottom: tab === k ? '2px solid var(--neel-accent, #0a6ed1)' : '2px solid transparent', color: tab === k ? 'var(--neel-accent, #0a6ed1)' : C.ink, fontWeight: 700, fontSize: 13, padding: '6px 4px', cursor: 'pointer', marginRight: 16 }}>{label}</button>
  );
  return (
    <InvModal title="Material" onClose={onCancel} width={760}
      footer={<>
        <span style={{ marginRight: 'auto', fontSize: 12.5, color: C.subtext }}>{items.length + conds.filter(c => c.value).length === 0 ? 'No Items or Conditions Selected' : items.length + ' item(s), ' + conds.filter(c => c.value).length + ' condition(s) selected'}</span>
        <button type="button" style={invBtn} onClick={() => onOk({ items, conditions: conds.filter(c => c.value) })}>OK</button>
        <button type="button" style={invBtnGhost} onClick={onCancel}>Cancel</button>
      </>}>
      <div style={{ marginBottom: 10 }}>{tabBtn('search', 'Search and Select')}{!single && tabBtn('cond', 'Define Conditions')}</div>
      {tab === 'search' ? (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: 9, color: C.faint }} />
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setApplied(q); }} placeholder="Search" style={Object.assign({}, invInp, { width: '100%', paddingLeft: 28 })} />
            </div>
            <button type="button" style={invBtn} onClick={() => setApplied(q)}>Go</button>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Items ({shown.length})</div>
          <div style={{ border: '1px solid ' + C.border, borderRadius: 6, maxHeight: 300, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: C.panelAlt }}><th style={invTh}></th><th style={invTh}>Material</th><th style={invTh}>Plant</th><th style={invTh}>Material Group</th><th style={invTh}>Material Type</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: C.subtext }}>No materials found.</td></tr>}
                {shown.map(m => (
                  <tr key={m.key} onClick={() => toggle(m.number)} style={{ borderTop: '1px solid ' + C.borderSoft, cursor: 'pointer', background: items.includes(m.number) ? 'var(--neel-accent-soft, #eaf3fc)' : 'transparent' }}>
                    <td style={{ padding: '6px 12px' }}><input type="checkbox" readOnly checked={items.includes(m.number)} /></td>
                    <td style={{ padding: '6px 12px' }}><div style={{ fontWeight: 600, color: C.ink }}>{m.name}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{m.number}</div></td>
                    <td style={{ padding: '6px 12px', color: C.subtext }}>{m.plant}</td>
                    <td style={{ padding: '6px 12px', color: C.subtext }}>{m.group}</td>
                    <td style={{ padding: '6px 12px', color: C.subtext }}>{m.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          {conds.length === 0 && <div style={{ fontSize: 12.5, color: C.subtext, marginBottom: 8 }}>Add a condition to include every material that matches it.</div>}
          {conds.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select value={c.op} onChange={e => setConds(conds.map((x, j) => j === i ? Object.assign({}, x, { op: e.target.value }) : x))} style={invInp}>
                <option value="contains">contains</option><option value="equals">equals</option><option value="starts">starts with</option>
              </select>
              <input value={c.value} onChange={e => setConds(conds.map((x, j) => j === i ? Object.assign({}, x, { value: e.target.value }) : x))} placeholder="Value" style={Object.assign({}, invInp, { flex: 1 })} />
              <button type="button" aria-label="Remove condition" onClick={() => setConds(conds.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={16} /></button>
            </div>
          ))}
          <button type="button" style={invBtnGhost} onClick={() => setConds(conds.concat([{ op: 'contains', value: '' }]))}><Plus size={13} /> Add condition</button>
        </div>
      )}
    </InvModal>
  );
}

function invMatSummary(v) {
  const n = ((v && v.items) || []).length; const c = ((v && v.conditions) || []).length;
  if (!n && !c) return '';
  return (n ? n + ' item' + (n > 1 ? 's' : '') : '') + (n && c ? ' + ' : '') + (c ? c + ' condition' + (c > 1 ? 's' : '') : '');
}

function InvPageFrame({ title, sub, setTab, children, right }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setTab('invhub')} style={Object.assign({}, invBtnGhost, { display: 'inline-flex', alignItems: 'center', gap: 2 })}><ChevronLeft size={15} /> Inventory Management</button>
        <div style={{ flex: 1, minWidth: 200 }}><SectionTitle sub={sub}>{title}</SectionTitle></div>
        {right}
      </div>
      {children}
    </div>
  );
}

function InvAnalyticsPage({ title, sub, setTab, fields, columns, run, materials, matDocs, exportName }) {
  const emptyOf = (f) => f.kind === 'material' ? { items: [], conditions: [] } : '';
  const initial = {};
  fields.forEach(f => { initial[f.key] = f.def !== undefined ? (typeof f.def === 'function' ? f.def() : f.def) : emptyOf(f); });
  const [vals, setVals] = useState(initial);
  const [hidden, setHidden] = useState({});
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [vh, setVh] = useState(null);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const set = (k, v) => setVals(prev => Object.assign({}, prev, { [k]: v }));
  const go = () => {
    const bad = fields.filter(f => f.required && !hidden[f.key] && !String(vals[f.key] === undefined ? '' : vals[f.key]).trim());
    if (bad.length) { setErr('Fill in the required fields: ' + bad.map(f => f.label).join(', ')); return; }
    setErr('');
    const eff = Object.assign({}, vals);
    fields.forEach(f => { if (hidden[f.key]) eff[f.key] = emptyOf(f); });
    setRows(run(eff, { materials, matDocs }));
  };
  const optionsFor = (f) => {
    const src = f.opts ? f.opts(materials) : [];
    return Array.from(new Set(src.filter(Boolean)));
  };
  const visibleRows = (rows || []).filter(r => !q.trim() || Object.values(r).join(' ').toLowerCase().includes(q.trim().toLowerCase()));
  const label = (f) => <label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>{f.label}{f.required && <span style={{ color: C.red }}> *</span>}</label>;
  return (
    <InvPageFrame title={title} sub={sub} setTab={setTab}>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--neel-accent, #0a6ed1)' }}>Standard</div>
          <button type="button" aria-label={collapsed ? 'Show filters' : 'Hide filters'} onClick={() => setCollapsed(v => !v)} style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 14, width: 26, height: 22, cursor: 'pointer', color: C.subtext, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ChevronDown size={14} style={{ transform: collapsed ? 'none' : 'rotate(180deg)' }} />
          </button>
        </div>
        {!collapsed && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: C.faint }} />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search results" style={Object.assign({}, invInp, { width: '100%', paddingLeft: 26 })} />
                </div>
              </div>
              {fields.filter(f => !hidden[f.key]).map(f => (
                <div key={f.key}>
                  {label(f)}
                  {f.kind === 'material' ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input readOnly value={invMatSummary(vals[f.key])} placeholder="All materials" onClick={() => setVh(f.key)} style={Object.assign({}, invInp, { flex: 1, cursor: 'pointer' })} />
                      <button type="button" aria-label="Value help" onClick={() => setVh(f.key)} style={Object.assign({}, invInp, { cursor: 'pointer', padding: '0 8px' })}><Search size={13} /></button>
                      {invMatSummary(vals[f.key]) && <button type="button" aria-label="Clear" onClick={() => set(f.key, emptyOf(f))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={14} /></button>}
                    </div>
                  ) : f.kind === 'select' ? (
                    <select value={vals[f.key]} onChange={e => set(f.key, e.target.value)} style={Object.assign({}, invInp, { width: '100%' })}>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <div>
                      <input type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'} value={vals[f.key]} onChange={e => set(f.key, e.target.value)}
                        list={f.opts ? 'inv-dl-' + f.key : undefined} style={Object.assign({}, invInp, { width: '100%' })} />
                      {f.opts && <datalist id={'inv-dl-' + f.key}>{optionsFor(f).map(o => <option key={o} value={o} />)}</datalist>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {err && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: C.red }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 12, position: 'relative' }}>
              <button type="button" style={invBtn} onClick={go} data-testid="inv-go-btn">Go</button>
              <button type="button" style={invBtnGhost} onClick={() => setAdaptOpen(v => !v)}>Adapt Filters ({fields.filter(f => !hidden[f.key]).length})</button>
              {adaptOpen && (
                <div style={{ position: 'absolute', top: 36, right: 0, background: '#fff', border: '1px solid ' + C.border, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.18)', padding: 10, zIndex: 30, minWidth: 220 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.subtext, marginBottom: 6 }}>Show filters</div>
                  {fields.map(f => (
                    <label key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: C.ink, padding: '3px 0', opacity: f.required ? 0.6 : 1 }}>
                      <input type="checkbox" disabled={!!f.required} checked={!hidden[f.key]} onChange={() => setHidden(prev => Object.assign({}, prev, { [f.key]: !prev[f.key] }))} />
                      {f.label}{f.required ? ' (required)' : ''}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{title}{rows ? ' (' + visibleRows.length + ')' : ''}</div>
          {rows && rows.length > 0 && (
            <ExportButton label="Export" onExport={() => exportToExcel(exportName, { Results: visibleRows.map(r => { const o = {}; columns.forEach(c => { o[c.label] = c.fmt ? c.fmt(r[c.key], r) : r[c.key]; }); return o; }) })} />
          )}
        </div>
        {rows === null ? (
          <EmptyState title={"Let's get some results"} sub="Start by providing your search or filter criteria." />
        ) : visibleRows.length === 0 ? (
          <EmptyState title="No data found" sub="Try changing your filters or the date range." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
              <thead><tr style={{ background: C.panelAlt }}>{columns.map(c => <th key={c.key} style={Object.assign({}, invTh, { textAlign: c.num ? 'right' : 'left' })}>{c.label}</th>)}</tr></thead>
              <tbody>
                {visibleRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                    {columns.map(c => <td key={c.key} className={c.mono ? 'font-mono' : undefined} style={{ padding: '8px 12px', textAlign: c.num ? 'right' : 'left', color: C.ink, whiteSpace: 'nowrap' }}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {vh && <MaterialValueHelp materials={materials} value={vals[vh]} onCancel={() => setVh(null)} onOk={(v) => { set(vh, v); setVh(null); }} />}
    </InvPageFrame>
  );
}

const invCommonFields = [
  { key: 'material', label: 'Material', kind: 'material' },
  { key: 'plant', label: 'Plant', kind: 'text', opts: (ms) => ms.map(m => m.plant) },
  { key: 'sloc', label: 'Storage Location', kind: 'text', opts: (ms) => ms.map(m => m.sloc) },
  { key: 'group', label: 'Material Group', kind: 'text', opts: (ms) => ms.map(m => m.group) },
  { key: 'type', label: 'Material Type', kind: 'text', opts: (ms) => ms.map(m => m.type) },
];

function DeadStockTab({ rawItems, finishedItems, matDocs, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);
  const fields = [
    { key: 'start', label: 'Analytics Start Date', kind: 'date', required: true, def: () => invDaysAgo(90) },
    { key: 'end', label: 'Analytics End Date', kind: 'date', required: true, def: invToday },
    { key: 'cur', label: 'Display Currency', kind: 'select', required: true, options: INV_CURRENCIES, def: 'INR' },
  ].concat(invCommonFields);
  const columns = [
    { key: 'name', label: 'Material' }, { key: 'plant', label: 'Plant' }, { key: 'sloc', label: 'Storage Location' },
    { key: 'group', label: 'Material Group' }, { key: 'type', label: 'Material Type' },
    { key: 'q0', label: 'Stock Quantity (Start Period)', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'v0', label: 'Stock Value (Start Period)', num: true, fmt: (v, r) => invMoney(v, r.cur) },
    { key: 'q1', label: 'Stock Quantity (End Period)', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'v1', label: 'Stock Value (End Period)', num: true, fmt: (v, r) => invMoney(v, r.cur) },
    { key: 'last', label: 'Last Movement', fmt: (v) => v || 'Never' },
  ];
  const run = (v, ctx) => ctx.materials.filter(m => invBaseFilter(v, m)).map(m => {
    const used = invSum(ctx.matDocs, m.number, v.start, v.end, (sg, t) => INV_CONSUME.includes(t));
    const q0 = invStockAt(m, ctx.matDocs, invShiftDay(v.start, -1)); const q1 = invStockAt(m, ctx.matDocs, v.end);
    if (used > 0 || q1 <= 0) return null;
    return { name: m.name, plant: m.plant, sloc: m.sloc, group: m.group, type: m.type, unit: m.unit, cur: v.cur, q0, v0: q0 * m.price, q1, v1: q1 * m.price, last: invLastMove(ctx.matDocs, m.number) };
  }).filter(Boolean);
  return <InvAnalyticsPage title="Dead Stock Analysis" sub="Stock that had no consumption, issue or scrapping in the chosen period." setTab={setTab} fields={fields} columns={columns} run={run} materials={materials} matDocs={matDocs} exportName="dead-stock-analysis.xlsx" />;
}

function SlowMovingTab({ rawItems, finishedItems, matDocs, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);
  const fields = [
    { key: 'days', label: 'Days with Low Consumption', kind: 'number', required: true, def: '90' },
    { key: 'ref', label: 'Reference Date', kind: 'date', required: true, def: invToday },
    { key: 'cur', label: 'Display Currency', kind: 'select', required: true, options: INV_CURRENCIES, def: 'INR' },
    { key: 'ind', label: 'Slow-Moving Indicator', kind: 'select', options: ['All', 'Non-moving', 'Slow-moving'], def: 'All' },
    { key: 'pct', label: 'Slow-moving below (% of stock)', kind: 'number', def: '25' },
  ].concat(invCommonFields);
  const columns = [
    { key: 'name', label: 'Material' }, { key: 'plant', label: 'Plant' }, { key: 'sloc', label: 'Storage Location' },
    { key: 'ind', label: 'Slow-Moving Indicator' }, { key: 'type', label: 'Product Type' }, { key: 'group', label: 'Product Group' },
    { key: 'qty', label: 'Stock Quantity', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'val', label: 'Stock Value', num: true, fmt: (v, r) => invMoney(v, r.cur) },
    { key: 'cons', label: 'Consumption in Period', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
  ];
  const run = (v, ctx) => {
    const days = Math.max(1, Number(v.days) || 90); const from = invShiftDay(v.ref, -days); const pct = Number(v.pct) || 25;
    return ctx.materials.filter(m => m.qty > 0 && invBaseFilter(v, m)).map(m => {
      const cons = invSum(ctx.matDocs, m.number, from, v.ref, (sg, t) => INV_CONSUME.includes(t));
      const ind = cons === 0 ? 'Non-moving' : (cons < m.qty * pct / 100 ? 'Slow-moving' : '');
      if (!ind || (v.ind !== 'All' && v.ind !== ind)) return null;
      return { name: m.name, plant: m.plant, sloc: m.sloc, ind, type: m.type, group: m.group, unit: m.unit, cur: v.cur, qty: m.qty, val: m.qty * m.price, cons };
    }).filter(Boolean);
  };
  return <InvAnalyticsPage title="Slow or Non-Moving Materials" sub="Stock with no or very low consumption over the last N days." setTab={setTab} fields={fields} columns={columns} run={run} materials={materials} matDocs={matDocs} exportName="slow-non-moving-materials.xlsx" />;
}

function AnalyzeStockTab({ rawItems, finishedItems, matDocs, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);
  const fields = [
    { key: 'start', label: 'Start Date', kind: 'date', required: true, def: () => invDaysAgo(30) },
    { key: 'end', label: 'End Date', kind: 'date', required: true, def: invToday },
  ].concat(invCommonFields);
  const columns = [
    { key: 'name', label: 'Material' }, { key: 'plant', label: 'Plant' }, { key: 'sloc', label: 'Storage Location' },
    { key: 'open', label: 'Opening Stock', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'rec', label: 'Receipts', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'iss', label: 'Issues', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
    { key: 'close', label: 'Closing Stock', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },
  ];
  const run = (v, ctx) => ctx.materials.filter(m => invBaseFilter(v, m)).map(m => ({
    name: m.name, plant: m.plant, sloc: m.sloc, unit: m.unit,
    open: invStockAt(m, ctx.matDocs, invShiftDay(v.start, -1)),
    rec: invSum(ctx.matDocs, m.number, v.start, v.end, (sg) => sg > 0),
    iss: invSum(ctx.matDocs, m.number, v.start, v.end, (sg) => sg < 0),
    close: invStockAt(m, ctx.matDocs, v.end),
  }));
  return <InvAnalyticsPage title="Analyze Stock in Date Range" sub="Opening stock, receipts, issues and closing stock for each material." setTab={setTab} fields={fields} columns={columns} run={run} materials={materials} matDocs={matDocs} exportName="stock-in-date-range.xlsx" />;
}

function StockSingleMaterialTab({ rawItems, finishedItems, matDocs, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);
  const [text, setText] = useState('');
  const [number, setNumber] = useState(null);
  const [msg, setMsg] = useState('');
  const [vhOpen, setVhOpen] = useState(false);
  const inputRef = useRef(null);
  const submit = (t) => {
    const s2 = String(t === undefined ? text : t).trim().toLowerCase();
    if (!s2) { setMsg('Enter a material'); return; }
    const exact = materials.find(m => m.number.toLowerCase() === s2 || String(m.name).toLowerCase() === s2);
    if (exact) { setNumber(exact.number); setMsg(''); return; }
    const hits = materials.filter(m => (m.number + ' ' + m.name).toLowerCase().includes(s2));
    if (hits.length === 1) { setNumber(hits[0].number); setText(hits[0].number); setMsg(''); }
    else if (hits.length > 1) { setVhOpen(true); setMsg(''); }
    else { setNumber(null); setMsg('Material "' + t + '" was not found.'); }
  };
  const rowsFor = number ? materials.filter(m => m.number === number) : [];
  const total = rowsFor.reduce((t, m) => t + m.qty, 0);
  const first = rowsFor[0];
  const docs = number ? (matDocs || []).filter(d => d.materialNumber === number).sort((a, b) => String(b.postingDate).localeCompare(String(a.postingDate))).slice(0, 15) : [];
  return (
    <InvPageFrame title="Stock - Single Material" sub="Enter or scan a material to see its stock and latest movements." setTab={setTab}>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12.5, color: C.subtext }}>Material:</label>
          <input ref={inputRef} list="inv-single-dl" autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Material number or name" style={Object.assign({}, invInp, { flex: '1 1 260px', maxWidth: 520 })} />
          <datalist id="inv-single-dl">{materials.map(m => <option key={m.key} value={m.number}>{m.name}</option>)}</datalist>
          <button type="button" style={Object.assign({}, invBtn, { background: '#fff', color: 'var(--neel-accent, #0a6ed1)', border: '1px solid var(--neel-accent, #0a6ed1)' })} onClick={() => setVhOpen(true)}>Select</button>
          <button type="button" style={invBtn} onClick={() => { if (text.trim()) submit(); else { setMsg('Ready to scan - point your barcode scanner at the label.'); if (inputRef.current) inputRef.current.focus(); } }}>Scan</button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 12.5, color: C.subtext }}>{msg}</div>}
      </Card>
      {!first ? (
        <Card><EmptyState title="Stock - Single Material" sub="Enter a material" /></Card>
      ) : (
        <div>
          <Card style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{first.name}</div>
            <div className="font-mono" style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>{first.number}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              {[['Unrestricted-use stock', invNum(total) + ' ' + first.unit], ['Plant', first.plant], ['Storage location', Array.from(new Set(rowsFor.map(r => r.sloc))).join(', ')], ['Material group', first.group], ['Material type', first.type], ['Stock value', invMoney(rowsFor.reduce((t, m) => t + m.qty * m.price, 0), 'INR')]].map(kv => (
                <div key={kv[0]} style={{ border: '1px solid ' + C.borderSoft, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: C.subtext, textTransform: 'uppercase', fontWeight: 700 }}>{kv[0]}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 2 }}>{kv[1]}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700, color: C.ink }}>Latest movements</div>
            {docs.length === 0 ? <EmptyState title="No movements yet" sub="Material documents for this material will appear here." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                  <thead><tr style={{ background: C.panelAlt }}>{['Material doc', 'Posting date', 'Mvt', 'Movement text', 'Quantity', 'Posted by'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                  <tbody>{docs.map(d => {
                    const sg = invSign(d);
                    return (
                      <tr key={d.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                        <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 600, color: C.copper }}>{d.docNumber}</td>
                        <td style={{ padding: '8px 12px', color: C.subtext }}>{formatDateTime(d.postingDate)}</td>
                        <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{d.movementType}</td>
                        <td style={{ padding: '8px 12px', color: C.subtext }}>{(MOVEMENT_TYPES[d.movementType] || {}).text || '\u2014'}</td>
                        <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: sg > 0 ? C.green : sg < 0 ? C.red : C.ink }}>{sg > 0 ? '+' : sg < 0 ? '\u2212' : ''}{invNum(d.quantity)} {d.unit}</td>
                        <td style={{ padding: '8px 12px', color: C.subtext }}>{d.postedBy}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
      {vhOpen && <MaterialValueHelp single materials={materials} value={{ items: number ? [number] : [], conditions: [] }} onCancel={() => setVhOpen(false)}
        onOk={(v) => { setVhOpen(false); if (v.items[0]) { setNumber(v.items[0]); setText(v.items[0]); setMsg(''); } }} />}
    </InvPageFrame>
  );
}

const MIGO_ACTIONS = ['Goods Receipt', 'Cancellation', 'Change', 'Display', 'Goods Issue', 'Place in Storage', 'Release GR Blocked Stock', 'Remove from Storage', 'Return Delivery', 'Subsequent Adjustment', 'Subsequent Delivery', 'Transfer Posting'];
const MIGO_REFS = ['Inbound Delivery', 'Material Document', 'Order', 'Other', 'Outbound Delivery', 'Purchase Order', 'Reservation', 'Summarized JIT Call (Kanban)', 'Transport', 'Transport ID Code'];
function migoLine(n) { return { id: uid(), line: n, matKey: '', qty: '', sloc: INV_SLOC_RAW, batch: '', valType: '' }; }

function GoodsReceiptPoTab({ rawItems, matDocs, onAdjustRaw, user, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, []), [rawItems]);
  const [action, setAction] = useState('Goods Receipt');
  const [ref, setRef] = useState('Purchase Order');
  const [refNo, setRefNo] = useState('');
  const [plant, setPlant] = useState(PLANT_CODE);
  const [docDate, setDocDate] = useState(invToday());
  const [postDate, setPostDate] = useState(invToday());
  const [delNote, setDelNote] = useState('');
  const [bol, setBol] = useState('');
  const [slip, setSlip] = useState('');
  const [headerText, setHeaderText] = useState('');
  const [vendor, setVendor] = useState('');
  const [topTab, setTopTab] = useState('General');
  const [botTab, setBotTab] = useState('Material');
  const [lines, setLines] = useState([migoLine(1)]);
  const [sel, setSel] = useState(0);
  const [held, setHeld] = useState([]);
  const [msg, setMsg] = useState(null);
  const [lookup, setLookup] = useState('');
  const canPost = !!user && canDo(user.role, 'inventory.adjust');
  const setLine = (i, patch) => setLines(prev => prev.map((l, j) => j === i ? Object.assign({}, l, patch) : l));
  const matOf = (l) => materials.find(m => m.key === l.matKey) || null;
  const recent = (matDocs || []).slice(0, 5);
  const reset = () => { setLines([migoLine(1)]); setSel(0); setRefNo(''); setDelNote(''); setBol(''); setSlip(''); setHeaderText(''); setVendor(''); };
  const post = () => {
    if (!canPost) { setMsg({ ok: false, text: 'Your role is not allowed to post goods movements.' }); return; }
    if (ref === 'Purchase Order' && !refNo.trim()) { setMsg({ ok: false, text: 'Enter the purchase order number.' }); return; }
    const filled = lines.filter(l => l.matKey || l.qty);
    if (!filled.length) { setMsg({ ok: false, text: 'Add at least one item.' }); return; }
    const bad = filled.find(l => !matOf(l) || !(Number(l.qty) > 0));
    if (bad) { setMsg({ ok: false, text: 'Item ' + bad.line + ': choose a material and enter a quantity above zero.' }); return; }
    const refDoc = ref === 'Purchase Order' ? 'PO ' + refNo.trim() : (refNo.trim() || null);
    filled.forEach(l => onAdjustRaw(matOf(l).key.slice(1), Number(l.qty), { movementType: '501', refDoc }));
    setMsg({ ok: true, text: filled.length + ' item(s) posted. Material documents were created and the stock was updated.' });
    reset();
  };
  const hold = () => {
    if (!lines.some(l => l.matKey || l.qty)) { setMsg({ ok: false, text: 'Nothing to hold.' }); return; }
    setHeld(prev => prev.concat([{ id: uid(), label: (refNo.trim() ? ref + ' ' + refNo.trim() : 'Held data') + ' (' + lines.length + ')', lines, ref, refNo }]));
    reset(); setMsg({ ok: true, text: 'Document held.' });
  };
  const restore = (h) => { setLines(h.lines); setRef(h.ref); setRefNo(h.refNo); setHeld(prev => prev.filter(x => x.id !== h.id)); setSel(0); };
  const lookupDocs = lookup.trim() ? (matDocs || []).filter(d => String(d.docNumber) === lookup.trim()) : [];
  const small = { fontSize: 11.5, color: C.subtext };
  const treeGroup = (title, children) => (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, padding: '3px 0' }}>{title}</div>
      <div style={{ paddingLeft: 12 }}>{children}</div>
    </div>
  );
  const blank = <div style={Object.assign({}, small, { fontStyle: 'italic' })}>Blank</div>;
  const topTabBtn = (k) => <button key={k} type="button" onClick={() => setTopTab(k)} style={{ background: 'none', border: 'none', borderBottom: topTab === k ? '2px solid var(--neel-accent, #0a6ed1)' : '2px solid transparent', color: topTab === k ? 'var(--neel-accent, #0a6ed1)' : C.ink, fontWeight: 700, fontSize: 12.5, padding: '6px 4px', cursor: 'pointer', marginRight: 16 }}>{k}</button>;
  const fld = (label, val, set, type) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <label style={{ width: 110, textAlign: 'right', fontSize: 12, color: C.subtext }}>{label}:</label>
      <input type={type || 'text'} value={val} onChange={e => set(e.target.value)} style={Object.assign({}, invInp, { width: 170 })} />
    </div>
  );
  const selLine = lines[sel] || lines[0]; const selMat = selLine ? matOf(selLine) : null;
  return (
    <InvPageFrame title="Goods Receipt Purchase Order" sub="Post stock receipts. Every posting creates a material document." setTab={setTab}
      right={<div style={{ display: 'flex', gap: 8 }}>
        {action === 'Goods Receipt' && <button type="button" style={Object.assign({}, invBtn, { opacity: canPost ? 1 : 0.5 })} onClick={post} data-testid="migo-post">Post</button>}
        {action === 'Goods Receipt' && <button type="button" style={Object.assign({}, invBtn, { background: '#fff', color: 'var(--neel-accent, #0a6ed1)', border: '1px solid var(--neel-accent, #0a6ed1)' })} onClick={hold}>Hold</button>}
        <button type="button" style={invBtnGhost} onClick={() => setTab('invhub')}>Exit</button>
      </div>}>
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={action} onChange={e => { setAction(e.target.value); setMsg(null); }} style={Object.assign({}, invInp, { fontWeight: 700 })}>{MIGO_ACTIONS.map(a => <option key={a}>{a}</option>)}</select>
          <select value={ref} onChange={e => setRef(e.target.value)} style={Object.assign({}, invInp, { fontWeight: 700 })}>{MIGO_REFS.map(a => <option key={a}>{a}</option>)}</select>
          <input value={refNo} onChange={e => setRefNo(e.target.value)} placeholder={ref + ' no.'} style={Object.assign({}, invInp, { width: 150 })} />
          <label style={small}>Plant:</label>
          <input value={plant} onChange={e => setPlant(e.target.value)} style={Object.assign({}, invInp, { width: 100 })} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginLeft: 'auto' }}>GR goods receipt <span className="font-mono" style={Object.assign({}, invInp, { display: 'inline-block', marginLeft: 6 })}>501</span></span>
        </div>
      </Card>
      {msg && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: msg.ok ? '#e8f5e9' : '#fdecea', color: msg.ok ? C.green : C.red }}>{msg.text}</div>}

      {action === 'Display' ? (
        <Card style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <label style={small}>Material document:</label>
            <input value={lookup} onChange={e => setLookup(e.target.value)} placeholder="Document number" style={Object.assign({}, invInp, { width: 200 })} />
          </div>
          {!lookup.trim() ? <div style={small}>Enter a material document number to display it.</div> : lookupDocs.length === 0 ? <div style={small}>No document found with this number.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: C.panelAlt }}>{['Material doc', 'Posting date', 'Mvt', 'Material', 'Quantity', 'SLoc', 'Reference'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
              <tbody>{lookupDocs.map(d => <tr key={d.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                <td className="font-mono" style={{ padding: '8px 12px' }}>{d.docNumber}</td><td style={{ padding: '8px 12px' }}>{formatDateTime(d.postingDate)}</td>
                <td className="font-mono" style={{ padding: '8px 12px' }}>{d.movementType}</td><td style={{ padding: '8px 12px' }}>{d.materialName}</td>
                <td className="font-mono" style={{ padding: '8px 12px' }}>{invNum(d.quantity)} {d.unit}</td><td style={{ padding: '8px 12px' }}>{d.storageLocation}</td><td style={{ padding: '8px 12px' }}>{d.refDoc || '\u2014'}</td>
              </tr>)}</tbody>
            </table>
          )}
        </Card>
      ) : action !== 'Goods Receipt' ? (
        <Card><EmptyState title={action + ' is not available yet'} sub="Use Goods Receipt to post a receipt, or Display to look up a material document." /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 210px) 1fr', gap: 12, alignItems: 'start' }}>
          <Card style={{ padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>My Documents</div>
            {treeGroup('Purchase Orders', blank)}
            {treeGroup('Orders', blank)}
            {treeGroup('SumJIC (Kanban)', blank)}
            {treeGroup('Reservations', blank)}
            {treeGroup('Material Documents', recent.length ? recent.map(d => <div key={d.id} className="font-mono" style={small}>{d.docNumber}</div>) : blank)}
            {treeGroup('Held Data', held.length ? held.map(h => <button key={h.id} type="button" onClick={() => restore(h)} style={Object.assign({}, invBtnGhost, { display: 'block', padding: '2px 0', textAlign: 'left' })}>{h.label}</button>) : blank)}
          </Card>
          <div>
            <Card style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ borderBottom: '1px solid ' + C.border, marginBottom: 10 }}>{['General', 'Vendor'].map(topTabBtn)}</div>
              {topTab === 'General' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 30px' }}>
                  <div>{fld('Document Date', docDate, setDocDate, 'date')}{fld('Posting Date', postDate, setPostDate, 'date')}</div>
                  <div>{fld('Delivery Note', delNote, setDelNote)}{fld('Bill of Lading', bol, setBol)}{fld('GR/GI Slip No.', slip, setSlip)}</div>
                  <div>{fld('Header Text', headerText, setHeaderText)}</div>
                </div>
              ) : (
                <div>{fld('Vendor', vendor, setVendor)}<div style={small}>The vendor is kept with this posting for your reference.</div></div>
              )}
            </Card>
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
                  <thead><tr style={{ background: C.panelAlt }}>{['Line', 'Mat. Short Text', 'Qty in UnE', 'EUn', 'SLoc', 'Batch', 'Valuation Type', 'Stock Type'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const m = matOf(l);
                      return (
                        <tr key={l.id} onClick={() => setSel(i)} style={{ borderTop: '1px solid ' + C.borderSoft, background: sel === i ? 'var(--neel-accent-soft, #eaf3fc)' : 'transparent' }}>
                          <td style={{ padding: '5px 10px', color: C.subtext }}>{l.line}</td>
                          <td style={{ padding: '5px 6px' }}><select value={l.matKey} onChange={e => { const mm = materials.find(x => x.key === e.target.value); setLine(i, { matKey: e.target.value, sloc: mm ? mm.sloc : INV_SLOC_RAW }); }} style={Object.assign({}, invInp, { width: 220 })}><option value="">Select material</option>{materials.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}</select></td>
                          <td style={{ padding: '5px 6px' }}><input type="number" min="0" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} style={Object.assign({}, invInp, { width: 100 })} /></td>
                          <td style={{ padding: '5px 10px', color: C.subtext }}>{m ? m.unit : ''}</td>
                          <td style={{ padding: '5px 6px' }}><input value={l.sloc} onChange={e => setLine(i, { sloc: e.target.value })} style={Object.assign({}, invInp, { width: 70 })} /></td>
                          <td style={{ padding: '5px 6px' }}><input value={l.batch} onChange={e => setLine(i, { batch: e.target.value })} style={Object.assign({}, invInp, { width: 90 })} /></td>
                          <td style={{ padding: '5px 6px' }}><input value={l.valType} onChange={e => setLine(i, { valType: e.target.value })} style={Object.assign({}, invInp, { width: 90 })} /></td>
                          <td style={{ padding: '5px 10px', color: C.subtext }}>Unrestricted</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 14, padding: '8px 12px', borderTop: '1px solid ' + C.border }}>
                <button type="button" style={invBtnGhost} onClick={() => { setLines(prev => prev.concat([migoLine(prev.length + 1)])); setSel(lines.length); }}><Plus size={13} /> Add item</button>
                <button type="button" style={Object.assign({}, invBtnGhost, { color: C.red })} onClick={() => { if (lines.length > 1) { setLines(prev => prev.filter((_, j) => j !== sel).map((l, j) => Object.assign({}, l, { line: j + 1 }))); setSel(0); } else setLines([migoLine(1)]); }}><Trash2 size={13} /> Delete</button>
              </div>
            </Card>
            <Card style={{ padding: 12 }}>
              <div style={{ borderBottom: '1px solid ' + C.border, marginBottom: 10 }}>{['Material', 'Quantity', 'Where'].map(k => <button key={k} type="button" onClick={() => setBotTab(k)} style={{ background: 'none', border: 'none', borderBottom: botTab === k ? '2px solid var(--neel-accent, #0a6ed1)' : '2px solid transparent', color: botTab === k ? 'var(--neel-accent, #0a6ed1)' : C.ink, fontWeight: 700, fontSize: 12.5, padding: '6px 4px', cursor: 'pointer', marginRight: 16 }}>{k}</button>)}</div>
              {!selMat ? <div style={small}>Select an item to see its details.</div> : botTab === 'Material' ? (
                <div style={{ fontSize: 12.5, color: C.ink }}><div style={{ fontWeight: 700 }}>{selMat.name}</div><div className="font-mono" style={small}>{selMat.number}</div><div style={small}>{selMat.group} / {selMat.type}</div></div>
              ) : botTab === 'Quantity' ? (
                <div style={{ fontSize: 12.5, color: C.ink }}>Receiving <b>{invNum(selLine.qty)} {selMat.unit}</b>. Current stock: <b>{invNum(selMat.qty)} {selMat.unit}</b>. After posting: <b>{invNum(selMat.qty + (Number(selLine.qty) || 0))} {selMat.unit}</b>.</div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.ink }}>Plant <b>{plant}</b>, storage location <b>{selLine.sloc || INV_SLOC_RAW}</b>{selLine.batch ? <span>, batch <b>{selLine.batch}</b></span> : null}.</div>
              )}
            </Card>
          </div>
        </div>
      )}
    </InvPageFrame>
  );
}

function InventoryHubTab({ setTab }) {
  const [note, setNote] = useState('');
  const sections = [
    { title: 'Stock Management', tiles: [
      { title: 'Post Goods Movement', icon: Package, tab: 'migo' },
      { title: 'Material Documents Overview', icon: FileSpreadsheet, tab: 'matdocs' },
      { title: 'Cycle Count', sub: 'Physical Inventory Audit', icon: ScanLine, tab: 'cyclecount' },
    ] },
    { title: 'Stock Monitoring', tiles: [
      { title: 'Stock', sub: 'Single Material', icon: Activity, tab: 'stocksingle' },
      { title: 'Stock', sub: 'Multiple Materials', icon: Boxes, tab: 'inventory' },
      { title: 'Analyze Stock in Date Range', icon: TrendingUp, tab: 'analyzestock' },
      { title: 'Display Inventory Analytics Job Results', icon: ListChecks },
      { title: 'Overdue Materials', sub: 'Stock in Transit', icon: Clock },
      { title: 'Slow or Non-Moving Materials', icon: Layers, tab: 'slowmoving' },
    ], links: [
      { title: 'Overdue Materials', sub: 'GR Blocked Stock' },
      { title: 'Dead Stock Analysis', tab: 'deadstock' },
      { title: 'Schedule Export of Inventory Analytics' },
    ] },
    { title: 'Reservation Management', tiles: [
      { title: 'Manage Manual Reservations', icon: ClipboardList },
      { title: 'Manage Reservation Items', icon: ClipboardList },
    ] },
  ];
  const open = (t) => { if (t.tab) { setNote(''); setTab(t.tab); } else setNote('"' + t.title + '" is not available in Neel Suite yet.'); };
  return (
    <div>
      {note && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: '#fff8e1', color: '#7a5b00' }}>{note}</div>}
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>{sec.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {sec.tiles.map(t => (
              <button key={t.title + (t.sub || '')} type="button" onClick={() => open(t)} className="hover-lift"
                style={{ width: 168, height: 128, textAlign: 'left', padding: 12, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: t.tab ? 1 : 0.6 }}>
                <div><div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{t.title}</div>{t.sub && <div style={{ fontSize: 12, color: C.subtext }}>{t.sub}</div>}</div>
                <t.icon size={22} color={'var(--neel-accent, #0a6ed1)'} />
              </button>
            ))}
          </div>
          {sec.links && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {sec.links.map(t => (
                <button key={t.title + (t.sub || '')} type="button" onClick={() => open(t)}
                  style={{ padding: '6px 14px', borderRadius: 16, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', fontSize: 12.5, color: C.ink, opacity: t.tab ? 1 : 0.6 }}>
                  <b>{t.title}</b>{t.sub ? ' ' + t.sub : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

`;

if (/`|\$\{/.test(MODULE)) { console.error('Internal error: module code contains a template literal.'); process.exit(3); }

/* ------------------------------------------------------------------ */
/* WIRING                                                              */
/* ------------------------------------------------------------------ */
replaceOnce('module anchor', 'function MaterialDocsTab(', MODULE + 'function MaterialDocsTab(');

// NAV items (only the hub shows in the sidebar; the rest are hidden pages)
replaceOnce('nav items',
  "      { key: 'matdocs', label: 'Material Documents', icon: FileSpreadsheet },\n",
  "      { key: 'matdocs', label: 'Material Documents', icon: FileSpreadsheet },\n" +
  "      { key: 'invhub', label: 'Inventory Management', icon: Boxes },\n" +
  "      { key: 'migo', label: 'Goods Receipt Purchase Order', icon: Package, hidden: true },\n" +
  "      { key: 'stocksingle', label: 'Stock - Single Material', icon: Activity, hidden: true },\n" +
  "      { key: 'deadstock', label: 'Dead Stock Analysis', icon: Layers, hidden: true },\n" +
  "      { key: 'slowmoving', label: 'Slow or Non-Moving Materials', icon: Layers, hidden: true },\n" +
  "      { key: 'analyzestock', label: 'Analyze Stock in Date Range', icon: TrendingUp, hidden: true },\n");

// sidebar must not list hidden pages
replaceOnce('sidebar filter',
  "items: g.items.filter(n => canSeeTab(user, n.key))",
  "items: g.items.filter(n => !n.hidden && canSeeTab(user, n.key))");

// space bar: Inventory Management opens the hub
replaceOnce('inventory space',
  "{ key: 'inventory', label: 'Inventory Management', match: ['inventory', 'cyclecount', 'matdocs', 'bomMrp'] },",
  "{ key: 'invhub', label: 'Inventory Management', match: ['invhub', 'inventory', 'cyclecount', 'matdocs', 'bomMrp', 'migo', 'stocksingle', 'deadstock', 'slowmoving', 'analyzestock'] },");

// page routing
{
  const re = /^( *)\{tab === 'matdocs' && <MaterialDocsTab[^\n]*\n/m;
  const m = s.match(re);
  if (!m) missing.push('matdocs render line');
  else {
    const ind = m[1];
    const add =
      ind + "{tab === 'invhub' && <InventoryHubTab setTab={setTab} />}\n" +
      ind + "{tab === 'migo' && <GoodsReceiptPoTab rawItems={rawItems} matDocs={matDocs} onAdjustRaw={adjustRaw} user={user} setTab={setTab} />}\n" +
      ind + "{tab === 'stocksingle' && <StockSingleMaterialTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} setTab={setTab} />}\n" +
      ind + "{tab === 'deadstock' && <DeadStockTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} setTab={setTab} />}\n" +
      ind + "{tab === 'slowmoving' && <SlowMovingTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} setTab={setTab} />}\n" +
      ind + "{tab === 'analyzestock' && <AnalyzeStockTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} setTab={setTab} />}\n";
    s = s.replace(m[0], m[0] + add);
  }
}

// Optional: "Post Goods Movement" home tiles open the new screen (skipped silently if not found)
s = s.replace(/(title: 'Post Goods Movement'[^\n]*?tab: )'[a-zA-Z]+'/g, "$1'migo'");

if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}

fs.copyFileSync(file, file + '.inv.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Inventory module patched  ->  ' + file);
console.log('Backup                    ->  ' + file + '.inv.bak');
