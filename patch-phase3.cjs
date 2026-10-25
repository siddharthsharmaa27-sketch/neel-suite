#!/usr/bin/env node
/**
 * NEEL Suite Cloud - phase 3 patch
 * Run AFTER patch-neel, patch-inventory and patch-hubs.
 *
 *   node patch-phase3.cjs                                   -> patches ./src/App.jsx
 *   node patch-phase3.cjs path/to/App.jsx
 *   node patch-phase3.cjs --webhook=https://hooks.zapier.com/hooks/catch/XXXX/YYYY/   (optional: turns on email/WhatsApp alerts)
 *
 * Adds (all-or-nothing, backup App.jsx.p3.bak):
 *   - Purchase orders (Manage Purchase Orders) + Overdue Materials / Stock in Transit
 *   - Goods Receipt: receives against a real PO, also receives IMPORTED finished goods, updates prices (moving average), camera scan
 *   - Material Prices page (stock value for Dead Stock / Slow-moving / Single Material)
 *   - Live counts on hub tiles
 *   - Home: Most Used / Recently Used fill automatically, favourites saved per user on the server,
 *     role-based default favourites, every page can be added through "Add Apps"
 *   - Search (top bar) finds every page and tile by name and sub-title
 *   - Camera scanning on Stock - Single Material
 *   - Alert webhook (low stock, overdue purchase orders) - only if --webhook is given
 *   - Phone / tablet layout for the tile pages and the goods receipt screen
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const webhookArg = (args.find(a => a.startsWith('--webhook=')) || '').slice('--webhook='.length).trim();
const fileArg = args.find(a => !a.startsWith('--'));
const file = path.resolve(fileArg || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');

if (s.includes('NEEL_PHASE3_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
for (const [marker, name] of [['NEEL_INV_MODULE_V1', 'patch-inventory.cjs'], ['NEEL_HUBS_V1', 'patch-hubs.cjs'], ['neel_home_fav_titles', 'patch-neel.cjs']]) {
  if (!s.includes(marker)) { console.error('Run ' + name + ' first. Nothing was changed.'); process.exit(2); }
}

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

/* ================================================================== */
/* NEW MODULE CODE (replaces Goods Receipt + hub components)           */
/* ================================================================== */
const MODULE = String.raw`const MIGO_ACTIONS = ['Goods Receipt', 'Cancellation', 'Change', 'Display', 'Goods Issue', 'Place in Storage', 'Release GR Blocked Stock', 'Remove from Storage', 'Return Delivery', 'Subsequent Adjustment', 'Subsequent Delivery', 'Transfer Posting'];
const MIGO_REFS = ['Inbound Delivery', 'Material Document', 'Order', 'Other', 'Outbound Delivery', 'Purchase Order', 'Reservation', 'Summarized JIT Call (Kanban)', 'Transport', 'Transport ID Code'];
function migoLine(n) { return { id: uid(), line: n, matKey: '', qty: '', alt: '', sloc: INV_SLOC_RAW, batch: '', valType: '', price: '', poLineId: null }; }

function poStatusOf(po) {
  if (!po) return 'Open';
  if (po.status === 'Cancelled') return 'Cancelled';
  const lines = po.lines || [];
  const rec = lines.reduce((t, l) => t + (Number(l.received) || 0), 0);
  if (rec <= 0) return 'Open';
  return lines.every(l => (Number(l.received) || 0) >= (Number(l.qty) || 0)) ? 'Closed' : 'Partly received';
}
function poLineKey(l) { return (l.kind === 'fin' ? 'f' : 'r') + l.itemId; }
function poIsOpen(po) { const st = poStatusOf(po); return st === 'Open' || st === 'Partly received'; }
function poIsOverdue(po) { return poIsOpen(po) && !!po.deliveryDate && po.deliveryDate < invToday(); }

function GoodsReceiptPoTab({ rawItems, finishedItems, matDocs, purchaseOrders, onAdjustRaw, onAdjustFinished, onSetPrice, onReceivePO, user, setTab }) {
  const importedFin = useMemo(() => (finishedItems || []).filter(isImportedItem), [finishedItems]);
  const materials = useMemo(() => invMaterials(rawItems, importedFin), [rawItems, importedFin]);
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
  const [scanOpen, setScanOpen] = useState(false);
  const scanForRef = useRef(null);
  const canPost = !!user && canDo(user.role, 'inventory.adjust');
  const isPo = ref === 'Purchase Order';
  const po = isPo && refNo.trim() ? (purchaseOrders || []).find(p => String(p.poNumber) === refNo.trim()) || null : null;
  const poOpenLines = po ? (po.lines || []).filter(l => (Number(l.received) || 0) < Number(l.qty)) : [];
  const optMats = po ? materials.filter(m => (po.lines || []).some(x => poLineKey(x) === m.key)) : materials;
  const setLine = (i, patch) => setLines(prev => prev.map((l, j) => j === i ? Object.assign({}, l, patch) : l));
  const matOf = (l) => materials.find(m => m.key === l.matKey) || null;
  const recent = (matDocs || []).slice(0, 5);
  const reset = () => { setLines([migoLine(1)]); setSel(0); setRefNo(''); setDelNote(''); setBol(''); setSlip(''); setHeaderText(''); setVendor(''); };
  const onScanned = useCallback((t) => {
    const code = String(t).trim().toLowerCase();
    const m = materials.find(x => x.number.toLowerCase() === code || String(x.name).toLowerCase() === code);
    const idx = scanForRef.current;
    setScanOpen(false);
    if (idx === null) return;
    if (m) setLines(ls => ls.map((l, j) => j === idx ? Object.assign({}, l, { matKey: m.key, sloc: m.sloc, price: l.price || (m.price ? String(m.price) : '') }) : l));
    else setMsg({ ok: false, text: 'No material matches the scanned code "' + t + '".' });
  }, [materials]);

  const loadPo = () => {
    if (!po) { setMsg({ ok: false, text: 'Purchase order ' + refNo.trim() + ' was not found. Create it under Manage Purchase Orders first.' }); return; }
    if (poStatusOf(po) === 'Cancelled') { setMsg({ ok: false, text: 'This purchase order was cancelled.' }); return; }
    if (!poOpenLines.length) { setMsg({ ok: false, text: 'This purchase order is already fully received.' }); return; }
    setVendor(po.vendor || '');
    setLines(poOpenLines.map((l, i) => ({
      id: uid(), line: i + 1, matKey: poLineKey(l), qty: String(round3(Number(l.qty) - (Number(l.received) || 0))), alt: '',
      sloc: l.kind === 'fin' ? INV_SLOC_FIN : INV_SLOC_RAW, batch: '', valType: '', price: l.price ? String(l.price) : '', poLineId: l.id,
    })));
    setSel(0);
    setMsg({ ok: true, text: 'Loaded ' + poOpenLines.length + ' open item(s) from purchase order ' + po.poNumber + '.' });
  };

  const post = () => {
    if (!canPost) { setMsg({ ok: false, text: 'Your role is not allowed to post goods movements.' }); return; }
    if (isPo) {
      if (!refNo.trim()) { setMsg({ ok: false, text: 'Enter the purchase order number.' }); return; }
      if (!po) { setMsg({ ok: false, text: 'Purchase order ' + refNo.trim() + ' was not found. Create it under Manage Purchase Orders, or choose "Other" for a receipt without a purchase order.' }); return; }
      if (!poIsOpen(po)) { setMsg({ ok: false, text: 'Purchase order ' + po.poNumber + ' is ' + poStatusOf(po).toLowerCase() + ' and cannot be received.' }); return; }
    }
    const filled = lines.filter(l => l.matKey || l.qty);
    if (!filled.length) { setMsg({ ok: false, text: 'Add at least one item.' }); return; }
    const bad = filled.find(l => !matOf(l) || !(Number(l.qty) > 0));
    if (bad) { setMsg({ ok: false, text: 'Item ' + bad.line + ': choose a material and enter a quantity above zero.' }); return; }
    const receipts = [];
    if (isPo) {
      const perLine = {};
      for (let i = 0; i < filled.length; i++) {
        const l = filled[i]; const m = matOf(l);
        const pl = (po.lines || []).find(x => x.id === l.poLineId) || (po.lines || []).find(x => poLineKey(x) === l.matKey && (Number(x.received) || 0) < Number(x.qty));
        if (!pl) { setMsg({ ok: false, text: 'Item ' + l.line + ' (' + m.name + ') is not on purchase order ' + po.poNumber + '.' }); return; }
        perLine[pl.id] = (perLine[pl.id] || 0) + Number(l.qty);
        receipts.push({ lineId: pl.id, qty: Number(l.qty) });
      }
      const over = (po.lines || []).find(x => perLine[x.id] && (Number(x.received) || 0) + perLine[x.id] > Number(x.qty) * 1.1 + 1e-9);
      if (over) { setMsg({ ok: false, text: over.name + ': receiving more than the open quantity (' + invNum(Number(over.qty) - (Number(over.received) || 0)) + ' ' + over.unit + ' open, 10% tolerance).' }); return; }
    }
    const mvt = isPo ? '101' : '501';
    const refDoc = isPo ? 'PO ' + po.poNumber : (refNo.trim() || null);
    filled.forEach(l => {
      const m = matOf(l); const id = m.key.slice(1); const qty = Number(l.qty); const price = Number(l.price) || 0;
      if (price > 0 && onSetPrice) {
        const oldP = Number(m.price) || 0;
        const np = oldP > 0 && m.qty > 0 ? round3((m.qty * oldP + qty * price) / (m.qty + qty)) : price;
        onSetPrice(m.key[0] === 'f' ? 'fin' : 'raw', id, np);
      }
      if (m.key[0] === 'f') {
        onAdjustFinished(id, qty, { movementType: mvt, refDoc });
        if (Number(l.alt) > 0) onAdjustFinished(id, Number(l.alt), { alt: true });
      } else onAdjustRaw(id, qty, { movementType: mvt, refDoc });
    });
    if (isPo && onReceivePO) onReceivePO(po.poNumber, receipts);
    setMsg({ ok: true, text: filled.length + ' item(s) posted' + (isPo ? ' against purchase order ' + po.poNumber : '') + '. Material documents were created and the stock was updated.' });
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
    <InvPageFrame title="Goods Receipt Purchase Order" sub="Receive bought-in material: raw materials and imported finished goods. Every posting creates a material document." setTab={setTab}
      right={<div style={{ display: 'flex', gap: 8 }}>
        {action === 'Goods Receipt' && <button type="button" style={Object.assign({}, invBtn, { opacity: canPost ? 1 : 0.5 })} onClick={post} data-testid="migo-post">Post</button>}
        {action === 'Goods Receipt' && <button type="button" style={Object.assign({}, invBtn, { background: '#fff', color: 'var(--neel-accent, #0a6ed1)', border: '1px solid var(--neel-accent, #0a6ed1)' })} onClick={hold}>Hold</button>}
        <button type="button" style={invBtnGhost} onClick={() => setTab('invhub')}>Exit</button>
      </div>}>
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={action} onChange={e => { setAction(e.target.value); setMsg(null); }} style={Object.assign({}, invInp, { fontWeight: 700 })}>{MIGO_ACTIONS.map(a => <option key={a}>{a}</option>)}</select>
          <select value={ref} onChange={e => setRef(e.target.value)} style={Object.assign({}, invInp, { fontWeight: 700 })}>{MIGO_REFS.map(a => <option key={a}>{a}</option>)}</select>
          <input value={refNo} onChange={e => setRefNo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && isPo) loadPo(); }} placeholder={ref + ' no.'} data-testid="migo-refno" style={Object.assign({}, invInp, { width: 150 })} />
          {isPo && po && poOpenLines.length > 0 && <button type="button" style={invBtn} onClick={loadPo} data-testid="migo-load-po">Load PO items</button>}
          <label style={small}>Plant:</label>
          <input value={plant} onChange={e => setPlant(e.target.value)} style={Object.assign({}, invInp, { width: 100 })} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginLeft: 'auto' }}>GR goods receipt <span className="font-mono" style={Object.assign({}, invInp, { display: 'inline-block', marginLeft: 6 })}>{isPo ? '101' : '501'}</span></span>
        </div>
        {isPo && refNo.trim() && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: po ? C.subtext : C.red }}>
            {po ? 'PO ' + po.poNumber + ' - ' + po.vendor + ' - ' + poStatusOf(po) + ' - ' + poOpenLines.length + ' open item(s)' : 'No purchase order with this number. Create it under Manage Purchase Orders, or choose "Other" as reference for a receipt without a purchase order.'}
          </div>
        )}
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
        <div className="neel-gr-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 210px) 1fr', gap: 12, alignItems: 'start' }}>
          <Card style={{ padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>My Documents</div>
            {treeGroup('Purchase Orders', (purchaseOrders || []).filter(poIsOpen).slice(0, 6).length ? (purchaseOrders || []).filter(poIsOpen).slice(0, 6).map(p => <button key={p.id} type="button" onClick={() => { setRef('Purchase Order'); setRefNo(String(p.poNumber)); }} className="font-mono" style={Object.assign({}, invBtnGhost, { display: 'block', padding: '2px 0', textAlign: 'left', fontSize: 11.5 })}>{p.poNumber}</button>) : blank)}
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
                <div>{fld('Vendor', vendor, setVendor)}<div style={small}>Filled in automatically when you load a purchase order.</div></div>
              )}
            </Card>
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                  <thead><tr style={{ background: C.panelAlt }}>{['Line', 'Mat. Short Text', 'Qty in UnE', 'EUn', 'Pallets / Boxes', 'Price / unit', 'SLoc', 'Batch', 'Valuation Type', 'Stock Type'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const m = matOf(l);
                      return (
                        <tr key={l.id} onClick={() => setSel(i)} style={{ borderTop: '1px solid ' + C.borderSoft, background: sel === i ? 'var(--neel-accent-soft, #eaf3fc)' : 'transparent' }}>
                          <td style={{ padding: '5px 10px', color: C.subtext }}>{l.line}</td>
                          <td style={{ padding: '5px 6px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <select value={l.matKey} onChange={e => { const mm = materials.find(x => x.key === e.target.value); setLine(i, { matKey: e.target.value, sloc: mm ? mm.sloc : INV_SLOC_RAW, price: l.price || (mm && mm.price ? String(mm.price) : '') }); }} style={Object.assign({}, invInp, { width: 210 })}>
                                <option value="">Select material</option>
                                {optMats.map(x => <option key={x.key} value={x.key}>{x.name + (x.key[0] === 'f' ? ' (' + (x.category || 'Finished') + ')' : '')}</option>)}
                              </select>
                              <button type="button" aria-label="Scan material" title="Scan material" onClick={() => { scanForRef.current = i; setScanOpen(true); }} style={Object.assign({}, invInp, { cursor: 'pointer', padding: '0 8px' })}><ScanLine size={14} /></button>
                            </div>
                          </td>
                          <td style={{ padding: '5px 6px' }}><input type="number" min="0" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} style={Object.assign({}, invInp, { width: 90 })} /></td>
                          <td style={{ padding: '5px 10px', color: C.subtext }}>{m ? m.unit : ''}</td>
                          <td style={{ padding: '5px 6px' }}>{m && m.key[0] === 'f' ? <input type="number" min="0" placeholder={fgAltUnit(m.category)} value={l.alt} onChange={e => setLine(i, { alt: e.target.value })} style={Object.assign({}, invInp, { width: 90 })} /> : <span style={{ color: C.faint }}>{'\u2014'}</span>}</td>
                          <td style={{ padding: '5px 6px' }}><input type="number" min="0" value={l.price} onChange={e => setLine(i, { price: e.target.value })} style={Object.assign({}, invInp, { width: 90 })} /></td>
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
                <div style={{ fontSize: 12.5, color: C.ink }}><div style={{ fontWeight: 700 }}>{selMat.name}</div><div className="font-mono" style={small}>{selMat.number}</div><div style={small}>{selMat.group} / {selMat.type}{selMat.price ? ' / current price ' + invMoney(selMat.price, 'INR') + ' per ' + selMat.unit : ''}</div></div>
              ) : botTab === 'Quantity' ? (
                <div style={{ fontSize: 12.5, color: C.ink }}>Receiving <b>{invNum(selLine.qty)} {selMat.unit}</b>. Current stock: <b>{invNum(selMat.qty)} {selMat.unit}</b>. After posting: <b>{invNum(selMat.qty + (Number(selLine.qty) || 0))} {selMat.unit}</b>.</div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.ink }}>Plant <b>{plant}</b>, storage location <b>{selLine.sloc || INV_SLOC_RAW}</b>{selLine.batch ? <span>, batch <b>{selLine.batch}</b></span> : null}.</div>
              )}
            </Card>
          </div>
        </div>
      )}
      {scanOpen && <BarcodeScanner onScan={onScanned} onClose={() => setScanOpen(false)} />}
    </InvPageFrame>
  );
}

function PurchaseOrdersTab({ purchaseOrders, rawItems, finishedItems, onCreate, onCancel, user, setTab }) {
  const importedFin = useMemo(() => (finishedItems || []).filter(isImportedItem), [finishedItems]);
  const materials = useMemo(() => invMaterials(rawItems, importedFin), [rawItems, importedFin]);
  const [status, setStatus] = useState('All');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(false);
  const [vendor, setVendor] = useState('');
  const [due, setDue] = useState(invShiftDay(invToday(), 7));
  const [fl, setFl] = useState([{ id: uid(), matKey: '', qty: '', price: '' }]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState(null);
  const canEdit = !!user && canDo(user.role, 'inventory.adjust');
  const rows = (purchaseOrders || []).map(p => ({ p, st: poStatusOf(p) }))
    .filter(r => (status === 'All' || r.st === status) && (!q.trim() || (r.p.poNumber + ' ' + r.p.vendor + ' ' + (r.p.lines || []).map(l => l.name).join(' ')).toLowerCase().includes(q.trim().toLowerCase())));
  const tone = (st) => st === 'Closed' ? 'green' : st === 'Cancelled' ? 'default' : st === 'Partly received' ? 'blue' : 'amber';
  const setF = (i, patch) => setFl(prev => prev.map((l, j) => j === i ? Object.assign({}, l, patch) : l));
  const submit = () => {
    const lines = fl.map(l => { const m = materials.find(x => x.key === l.matKey); return m ? { kind: m.key[0] === 'f' ? 'fin' : 'raw', itemId: m.key.slice(1), name: m.name, unit: m.unit, qty: l.qty, price: l.price } : null; }).filter(Boolean);
    const res = onCreate({ vendor, deliveryDate: due, lines });
    if (res && res.error) { setErr(res.error); return; }
    setForm(false); setErr(''); setVendor(''); setFl([{ id: uid(), matKey: '', qty: '', price: '' }]);
    setNote({ ok: true, text: 'Purchase order ' + res.po.poNumber + ' created.' }); setOpenId(res.po.id);
  };
  const flat = () => (purchaseOrders || []).flatMap(p => (p.lines || []).map(l => ({ 'PO': p.poNumber, Vendor: p.vendor, 'PO date': p.date, 'Delivery date': p.deliveryDate, Status: poStatusOf(p), Material: l.name, Ordered: l.qty, Received: l.received || 0, Unit: l.unit, Price: l.price || 0 })));
  return (
    <InvPageFrame title="Manage Purchase Orders" sub="Orders placed with vendors. Goods Receipt posts against these." setTab={setTab}
      right={<div style={{ display: 'flex', gap: 8 }}>
        {rows.length > 0 && <ExportButton label="Export" onExport={() => exportToExcel('purchase-orders.xlsx', { 'Purchase orders': flat() })} />}
        {canEdit && <button type="button" style={invBtn} onClick={() => { setForm(true); setErr(''); }} data-testid="po-create">Create PO</button>}
      </div>}>
      {note && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: note.ok ? '#e8f5e9' : '#fdecea', color: note.ok ? C.green : C.red }}>{note.text}</div>}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO, vendor or material" style={Object.assign({}, invInp, { flex: '1 1 240px' })} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={invInp}>{['All', 'Open', 'Partly received', 'Closed', 'Cancelled'].map(x => <option key={x}>{x}</option>)}</select>
        </div>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <EmptyState title="No purchase orders" sub={canEdit ? 'Use Create PO to place your first order.' : 'Purchase orders will appear here.'} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
              <thead><tr style={{ background: C.panelAlt }}>{['PO no.', 'Vendor', 'PO date', 'Delivery date', 'Items', 'Received', 'Status'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(({ p, st }) => {
                  const ordered = (p.lines || []).reduce((t, l) => t + (Number(l.qty) || 0), 0);
                  const rec = (p.lines || []).reduce((t, l) => t + Math.min(Number(l.received) || 0, Number(l.qty) || 0), 0);
                  const od = poIsOverdue(p);
                  return (
                    <React.Fragment key={p.id}>
                      <tr onClick={() => setOpenId(openId === p.id ? null : p.id)} style={{ borderTop: '1px solid ' + C.borderSoft, cursor: 'pointer' }}>
                        <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: C.copper }}>{p.poNumber}</td>
                        <td style={{ padding: '8px 12px' }}>{p.vendor}</td>
                        <td style={{ padding: '8px 12px', color: C.subtext }}>{p.date}</td>
                        <td style={{ padding: '8px 12px', color: od ? C.red : C.subtext, fontWeight: od ? 700 : 400 }}>{p.deliveryDate || '\u2014'}</td>
                        <td style={{ padding: '8px 12px' }}>{(p.lines || []).length}</td>
                        <td style={{ padding: '8px 12px' }}>{ordered ? Math.round(rec / ordered * 100) : 0}%</td>
                        <td style={{ padding: '8px 12px' }}><Badge tone={tone(st)}>{st}</Badge>{od && <span style={{ marginLeft: 6 }}><Badge tone="red">Overdue</Badge></span>}</td>
                      </tr>
                      {openId === p.id && (
                        <tr style={{ background: C.panelAlt }}>
                          <td colSpan={7} style={{ padding: 12 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                              <thead><tr>{['Material', 'Ordered', 'Received', 'Open', 'Price / unit'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                              <tbody>{(p.lines || []).map(l => (
                                <tr key={l.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                                  <td style={{ padding: '6px 12px' }}>{l.name}</td>
                                  <td style={{ padding: '6px 12px' }}>{invNum(l.qty)} {l.unit}</td>
                                  <td style={{ padding: '6px 12px' }}>{invNum(l.received || 0)} {l.unit}</td>
                                  <td style={{ padding: '6px 12px' }}>{invNum(Math.max(0, Number(l.qty) - (Number(l.received) || 0)))} {l.unit}</td>
                                  <td style={{ padding: '6px 12px' }}>{invMoney(l.price, 'INR')}</td>
                                </tr>))}</tbody>
                            </table>
                            <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                              {poIsOpen(p) && <button type="button" style={invBtnGhost} onClick={() => setTab('migo')}>Receive goods</button>}
                              {canEdit && st === 'Open' && <button type="button" style={Object.assign({}, invBtnGhost, { color: C.red })} onClick={() => { const r = onCancel(p.poNumber); setNote(r && r.error ? { ok: false, text: r.error } : { ok: true, text: 'Purchase order ' + p.poNumber + ' cancelled.' }); }}>Cancel PO</button>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {form && (
        <InvModal title="Create Purchase Order" onClose={() => setForm(false)} width={760}
          footer={<><span style={{ marginRight: 'auto', fontSize: 12.5, color: C.red }}>{err}</span><button type="button" style={invBtn} onClick={submit} data-testid="po-save">Create</button><button type="button" style={invBtnGhost} onClick={() => setForm(false)}>Cancel</button></>}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 240px' }}><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Vendor *</label><input value={vendor} onChange={e => setVendor(e.target.value)} data-testid="po-vendor" style={Object.assign({}, invInp, { width: '100%' })} /></div>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Delivery date</label><input type="date" value={due} onChange={e => setDue(e.target.value)} style={invInp} /></div>
          </div>
          {fl.map((l, i) => {
            const m = materials.find(x => x.key === l.matKey);
            return (
              <div key={l.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={l.matKey} onChange={e => { const mm = materials.find(x => x.key === e.target.value); setF(i, { matKey: e.target.value, price: l.price || (mm && mm.price ? String(mm.price) : '') }); }} style={Object.assign({}, invInp, { flex: '2 1 220px' })}>
                  <option value="">Select material</option>
                  {materials.map(x => <option key={x.key} value={x.key}>{x.name + (x.key[0] === 'f' ? ' (' + (x.category || 'Finished') + ')' : '')}</option>)}
                </select>
                <input type="number" min="0" placeholder={'Qty' + (m ? ' (' + m.unit + ')' : '')} value={l.qty} onChange={e => setF(i, { qty: e.target.value })} style={Object.assign({}, invInp, { width: 110 })} />
                <input type="number" min="0" placeholder="Price / unit" value={l.price} onChange={e => setF(i, { price: e.target.value })} style={Object.assign({}, invInp, { width: 110 })} />
                <button type="button" aria-label="Remove item" onClick={() => setFl(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={16} /></button>
              </div>
            );
          })}
          <button type="button" style={invBtnGhost} onClick={() => setFl(prev => prev.concat([{ id: uid(), matKey: '', qty: '', price: '' }]))}><Plus size={13} /> Add item</button>
        </InvModal>
      )}
    </InvPageFrame>
  );
}

function MaterialPricesTab({ rawItems, finishedItems, onSetPrice, user, setTab }) {
  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({});
  const [note, setNote] = useState(null);
  const canEdit = !!user && canDo(user.role, 'inventory.adjust');
  const shown = materials.filter(m => !q.trim() || (m.name + ' ' + m.number + ' ' + m.group).toLowerCase().includes(q.trim().toLowerCase()));
  const total = materials.reduce((t, m) => t + m.qty * m.price, 0);
  const missing = materials.filter(m => !(m.price > 0)).length;
  const save = (m) => {
    const v = draft[m.key];
    if (v === undefined) return;
    const n = Number(v);
    if (!(n >= 0)) { setNote({ ok: false, text: 'Enter a price of zero or more.' }); return; }
    onSetPrice(m.key[0] === 'f' ? 'fin' : 'raw', m.key.slice(1), n);
    setDraft(prev => { const c = Object.assign({}, prev); delete c[m.key]; return c; });
    setNote({ ok: true, text: 'Price saved for ' + m.name + '.' });
  };
  return (
    <InvPageFrame title="Material Prices" sub="Price per unit (INR). Used for stock value in Dead Stock, Slow-Moving and Single Material." setTab={setTab}
      right={materials.length > 0 && <ExportButton label="Export" onExport={() => exportToExcel('material-prices.xlsx', { Prices: materials.map(m => ({ Material: m.name, Number: m.number, Type: m.type, Group: m.group, Unit: m.unit, 'Stock qty': m.qty, 'Price / unit (INR)': m.price, 'Stock value (INR)': m.qty * m.price })) })} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        {[['Total stock value', invMoney(total, 'INR')], ['Materials', String(materials.length)], ['Without a price', String(missing)]].map(kv => (
          <Card key={kv[0]} style={{ padding: 12 }}><div style={{ fontSize: 11, color: C.subtext, textTransform: 'uppercase', fontWeight: 700 }}>{kv[0]}</div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 2 }}>{kv[1]}</div></Card>
        ))}
      </div>
      {note && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: note.ok ? '#e8f5e9' : '#fdecea', color: note.ok ? C.green : C.red }}>{note.text}</div>}
      <Card style={{ padding: 12, marginBottom: 12 }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search material" style={Object.assign({}, invInp, { width: '100%' })} /></Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {shown.length === 0 ? <EmptyState title="No materials" sub="Add stock items under Inventory first." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
              <thead><tr style={{ background: C.panelAlt }}>{['Material', 'Type', 'Stock', 'Price / unit (INR)', 'Stock value'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
              <tbody>{shown.map(m => (
                <tr key={m.key} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                  <td style={{ padding: '6px 12px' }}><div style={{ fontWeight: 600, color: C.ink }}>{m.name}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{m.number}</div></td>
                  <td style={{ padding: '6px 12px', color: C.subtext }}>{m.type}</td>
                  <td style={{ padding: '6px 12px' }}>{invNum(m.qty)} {m.unit}</td>
                  <td style={{ padding: '6px 12px' }}>
                    {canEdit ? <input type="number" min="0" value={draft[m.key] !== undefined ? draft[m.key] : (m.price || '')} placeholder="0" data-testid={'price-' + m.key}
                      onChange={e => setDraft(prev => Object.assign({}, prev, { [m.key]: e.target.value }))} onBlur={() => save(m)} onKeyDown={e => { if (e.key === 'Enter') save(m); }} style={Object.assign({}, invInp, { width: 120 })} /> : <span>{invMoney(m.price, 'INR')}</span>}
                  </td>
                  <td style={{ padding: '6px 12px', fontWeight: 600 }}>{invMoney(m.qty * m.price, 'INR')}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </InvPageFrame>
  );
}

function OverdueMaterialsTab({ purchaseOrders, setTab }) {
  const today = invToday();
  const soon = invShiftDay(today, 7);
  const rows = [];
  (purchaseOrders || []).filter(poIsOpen).forEach(p => (p.lines || []).forEach(l => {
    const open = Number(l.qty) - (Number(l.received) || 0);
    if (open > 0) rows.push({ po: p.poNumber, vendor: p.vendor, name: l.name, unit: l.unit, open, ordered: l.qty, due: p.deliveryDate || '' });
  }));
  const cls = (r) => !r.due ? 'No date' : r.due < today ? 'Overdue' : r.due <= soon ? 'Due in 7 days' : 'Later';
  const order = ['Overdue', 'Due in 7 days', 'Later', 'No date'];
  rows.sort((a, b) => order.indexOf(cls(a)) - order.indexOf(cls(b)) || String(a.due).localeCompare(String(b.due)));
  const days = (r) => r.due && r.due < today ? Math.round((new Date(today + 'T00:00:00Z') - new Date(r.due + 'T00:00:00Z')) / 86400000) : 0;
  return (
    <InvPageFrame title="Overdue Materials - Stock in Transit" sub="Ordered material that has not arrived yet, from open purchase orders." setTab={setTab}
      right={<button type="button" style={invBtn} onClick={() => setTab('migo')}>Receive goods</button>}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <EmptyState title="Nothing in transit" sub="Open purchase orders with material still to arrive will be listed here." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
              <thead><tr style={{ background: C.panelAlt }}>{['Status', 'PO no.', 'Vendor', 'Material', 'Still to arrive', 'Delivery date', 'Days late'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                  <td style={{ padding: '8px 12px' }}><Badge tone={cls(r) === 'Overdue' ? 'red' : cls(r) === 'Due in 7 days' ? 'amber' : 'default'}>{cls(r)}</Badge></td>
                  <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: C.copper }}>{r.po}</td>
                  <td style={{ padding: '8px 12px' }}>{r.vendor}</td>
                  <td style={{ padding: '8px 12px' }}>{r.name}</td>
                  <td style={{ padding: '8px 12px' }}>{invNum(r.open)} {r.unit}</td>
                  <td style={{ padding: '8px 12px', color: C.subtext }}>{r.due || '\u2014'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: days(r) ? C.red : C.subtext }}>{days(r) || '\u2014'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </InvPageFrame>
  );
}

const NEEL_ROLE_FAVS = {
  Store: ['migo', 'inventory', 'stocksingle', 'purchaseorders', 'cyclecount', 'matdocs', 'slowmoving', 'deadstock'],
  'RM & Supply Chain Manager': ['purchaseorders', 'migo', 'inventory', 'overduepo', 'matprices', 'bomMrp', 'slowmoving', 'deadstock'],
  Quality: ['qmlots', 'quality', 'qchold', 'lab', 'spc', 'capa'],
  Dispatch: ['dispatch', 'orders', 'inventory'],
  Sales: ['orders', 'dispatch'],
  Production: ['plan', 'stages', 'floor', 'dpr', 'schedule', 'quality'],
  'PPC Manager': ['plan', 'schedule', 'stages', 'dpr', 'bomMrp', 'orders'],
  'Melting Supervisor': ['floor', 'stages', 'dpr'],
  'Cascade Operator': ['floor', 'stages', 'dpr'],
  'Spinner Supervisor': ['floor', 'stages', 'dpr'],
  'Machine Supervisor': ['floor', 'stages', 'dpr'],
  Annealing: ['floor', 'stages'],
  Packing: ['floor', 'stages'],
  'Maintenance - Electrical': ['maintenance', 'energy', 'tooling'],
  'Maintenance - Mechanical': ['maintenance', 'tooling', 'energy'],
  'Tool Room': ['tooling', 'maintenance'],
  Manager: ['dpr', 'cost', 'reports', 'quality', 'inventory', 'orders'],
  'Assistant Manager': ['dpr', 'cost', 'reports', 'quality', 'inventory', 'orders'],
  Owner: ['dpr', 'cost', 'reports', 'trends', 'inventory', 'orders'],
};
function neelExtraApps(base, user) {
  const have = new Set(base.map(a => a.tab));
  const out = [];
  Object.keys(SPACE_HUBS).forEach(h => SPACE_HUBS[h].sections.forEach(sec => sec.tiles.concat(sec.links || []).forEach(t => {
    if (have.has(t.tab) || !canSeeTab(user, t.tab)) return;
    have.add(t.tab);
    const nav = NAV.find(n => n.key === t.tab);
    out.push({ title: t.title + (t.sub ? ' \u2013 ' + t.sub : ''), subtitle: SPACE_HUBS[h].label, icon: (nav && nav.icon) || LayoutGrid, tab: t.tab, cat: 'Other', color: '#0a6ed1' });
  })));
  return out;
}
function neelKeywords(key) {
  let out = '';
  Object.keys(SPACE_HUBS).forEach(h => SPACE_HUBS[h].sections.forEach(sec => sec.tiles.concat(sec.links || []).forEach(t => {
    if (t.tab === key) out += ' ' + (t.title || '') + ' ' + (t.sub || '') + ' ' + SPACE_HUBS[h].label;
  })));
  return out;
}
function neelTileBadge(tab, d) {
  const n = (arr, fn) => (arr || []).filter(fn).length;
  let c = 0; let label = ''; let tone = 'amber';
  switch (tab) {
    case 'quality': c = n(d.batches, b => isPullBatch(b) && ['AWAIT_QC', 'QC_HOLD'].includes(batchFlowState(b))); label = 'awaiting'; break;
    case 'qchold': c = n(d.batches, b => isPullBatch(b) && batchFlowState(b) === 'LWC_HOLD'); label = 'held'; tone = 'red'; break;
    case 'maintenance': c = n(d.maintenanceLogs, m => m.status !== 'Resolved'); label = 'open'; tone = 'red'; break;
    case 'floor': c = n(d.pullRequests, isRequestOpen); label = 'open'; break;
    case 'inventory': c = n(d.rawItems, r => Number(r.qty) <= Number(r.reorderLevel)); label = 'low stock'; tone = 'red'; break;
    case 'capa': c = n(d.capaRecords, x => x.status !== 'Closed'); label = 'open'; break;
    case 'cyclecount': c = n(d.cycleCounts, x => x.status === 'Open' || x.status === 'Review'); label = 'in progress'; break;
    case 'orders': c = n(d.orders, o => !isOrderClosed(o)); label = 'open'; break;
    case 'purchaseorders': c = n(d.purchaseOrders, poIsOpen); label = 'open'; break;
    case 'overduepo': c = n(d.purchaseOrders, poIsOverdue); label = 'overdue'; tone = 'red'; break;
    default: return null;
  }
  return c > 0 ? { text: c + ' ' + label, tone } : null;
}
(function neelMobileCss() {
  if (typeof document === 'undefined' || document.getElementById('neel-mobile-css')) return;
  const el = document.createElement('style');
  el.id = 'neel-mobile-css';
  el.textContent = '@media (max-width: 820px){' +
    '.neel-tile{width:calc(50% - 6px)!important;min-height:112px}' +
    '.neel-gr-grid{grid-template-columns:1fr!important}' +
    '.neel-root button,.neel-root select{min-height:36px}' +
    '.neel-root input,.neel-root select,.neel-root textarea{min-height:36px;font-size:16px}' +
    '.neel-home-banner{padding:14px!important}}';
  document.head.appendChild(el);
})();

function SpaceHubTab({ hubKey, setTab, user, data }) {
  const hub = SPACE_HUBS[hubKey];
  if (!hub) return null;
  const d = data || {};
  const sections = hub.sections.map(sec => ({
    title: sec.title,
    tiles: sec.tiles.filter(t => canSeeTab(user, t.tab)),
    links: (sec.links || []).filter(t => canSeeTab(user, t.tab)),
  })).filter(sec => sec.tiles.length || sec.links.length);
  if (!sections.length) {
    return <Card><EmptyState title="Nothing to show here yet" sub="Ask your administrator for access to the apps in this area." /></Card>;
  }
  const navOf = (tab) => NAV.find(n => n.key === tab);
  const toneBg = { red: '#bb0000', amber: '#c77700' };
  return (
    <div>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>{sec.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {sec.tiles.map(t => {
              const nav = navOf(t.tab); const Icon = (nav && nav.icon) || LayoutGrid;
              const badge = neelTileBadge(t.tab, d);
              return (
                <button key={t.tab + (t.sub || '')} type="button" onClick={() => setTab(t.tab)} className="hover-lift neel-tile" data-testid={'tile-' + t.tab}
                  style={{ position: 'relative', width: 168, height: 128, textAlign: 'left', padding: 12, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, paddingRight: badge ? 4 : 0 }}>{t.title || (nav && nav.label) || t.tab}</div>
                    {t.sub && <div style={{ fontSize: 12, color: C.subtext }}>{t.sub}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <Icon size={22} color={'var(--neel-accent, #0a6ed1)'} />
                    {badge && <span data-testid={'badge-' + t.tab} style={{ background: toneBg[badge.tone] || toneBg.amber, color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 10, padding: '2px 8px' }}>{badge.text}</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {sec.links.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {sec.links.map(t => {
                const nav = navOf(t.tab);
                return (
                  <button key={t.tab} type="button" onClick={() => setTab(t.tab)} data-testid={'tile-' + t.tab}
                    style={{ padding: '6px 14px', borderRadius: 16, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', fontSize: 12.5, color: C.ink }}>
                    <b>{t.title || (nav && nav.label) || t.tab}</b>{t.sub ? ' ' + t.sub : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

`;
if (/`|\$\{/.test(MODULE)) { console.error('Internal error: module code contains a template literal.'); process.exit(3); }

/* ================================================================== */
/* APP-LEVEL STATE / HANDLERS (inserted after the dataLoading state)   */
/* ================================================================== */
const APP_BLOCK = String.raw`
  /* NEEL_PHASE3_V1 - purchase orders, per-user preferences, alerts */
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [userPrefsAll, setUserPrefsAll] = useState({});
  const poRef = useRef([]); poRef.current = purchaseOrders;
  const prefsRef = useRef({}); prefsRef.current = userPrefsAll;
  const alertsSentRef = useRef({});
  const prefsTimer = useRef(null);
  const saveUserPref = (patch, delayMs) => {
    if (!user) return;
    const k = String(user.name || '').toLowerCase(); if (!k) return;
    const mine = Object.assign({}, prefsRef.current[k] || {}, patch);
    const nextAll = Object.assign({}, prefsRef.current, { [k]: mine });
    prefsRef.current = nextAll; setUserPrefsAll(nextAll);
    if (delayMs) {
      clearTimeout(prefsTimer.current);
      prefsTimer.current = setTimeout(() => saveShared(NEEL_PREFS_PREFIX + k, prefsRef.current[k]), delayMs);
    } else saveShared(NEEL_PREFS_PREFIX + k, mine);
  };
  useEffect(() => {
    if (dataLoading || !user || !tab || tab === 'launchpad' || SPACE_HUBS[tab]) return;
    const k = String(user.name || '').toLowerCase(); if (!k) return;
    const usage = (prefsRef.current[k] || {}).usage || { counts: {}, recent: [] };
    saveUserPref({ usage: { counts: Object.assign({}, usage.counts, { [tab]: ((usage.counts || {})[tab] || 0) + 1 }), recent: [tab].concat((usage.recent || []).filter(t => t !== tab)).slice(0, 12) } }, 5000);
  }, [tab, dataLoading, user && user.name]);
  useEffect(() => {
    if (dataLoading || !user || !NEEL_ALERT_WEBHOOK_URL || !canSeeTab(user, 'inventory')) return;
    const today = new Date().toISOString().slice(0, 10);
    const sent = alertsSentRef.current || {};
    const fresh = [];
    (rawItems || []).forEach(r => {
      const key = 'low:' + r.id + ':' + today;
      if (Number(r.reorderLevel) >= 0 && Number(r.qty) <= Number(r.reorderLevel) && !sent[key]) fresh.push({ key, type: 'low_stock', data: { material: r.name, onHand: r.qty, unit: r.unit, reorderLevel: r.reorderLevel } });
    });
    (purchaseOrders || []).forEach(p => {
      const key = 'po:' + p.poNumber + ':' + today;
      if (poIsOverdue(p) && !sent[key]) fresh.push({ key, type: 'po_overdue', data: { po: p.poNumber, vendor: p.vendor, deliveryDate: p.deliveryDate } });
    });
    if (!fresh.length) return;
    const next = {};
    Object.keys(sent).forEach(k2 => { if (sent[k2] === today) next[k2] = today; });
    fresh.forEach(f => { next[f.key] = today; });
    alertsSentRef.current = next; saveShared(KEYS.alertsSent, next);
    fresh.forEach(f => triggerAutomatedAlert(f.type, f.data));
  }, [rawItems, purchaseOrders, dataLoading]);
`;

const HANDLERS = String.raw`  const setMaterialPrice = (kind, id, price) => {
    const p = Math.max(0, Number(price) || 0);
    if (kind === 'fin') { const next = finishedRef.current.map(r => r.id === id ? Object.assign({}, r, { price: p }) : r); finishedRef.current = next; setFinishedItems(next); saveShared(KEYS.finished, next); }
    else { const next = rawItemsRef.current.map(r => r.id === id ? Object.assign({}, r, { price: p }) : r); rawItemsRef.current = next; setRawItems(next); saveShared(KEYS.raw, next); }
  };
  const commitPOs = (next) => { poRef.current = next; setPurchaseOrders(next); saveShared(KEYS.purchaseOrders, next); };
  const createPurchaseOrder = ({ vendor, deliveryDate, lines }) => {
    if (!user || !canDo(user.role, 'inventory.adjust')) return { error: 'Your role cannot create purchase orders.' };
    if (!String(vendor || '').trim()) return { error: 'Enter the vendor name.' };
    const clean = (lines || []).filter(l => l.itemId && Number(l.qty) > 0);
    if (!clean.length) return { error: 'Add at least one item with a quantity.' };
    const num = String(Math.max.apply(null, [4500000000].concat(poRef.current.map(p => Number(p.poNumber) || 0))) + 1);
    const po = {
      id: uid(), poNumber: num, vendor: String(vendor).trim(), date: new Date().toISOString().slice(0, 10), deliveryDate: deliveryDate || '', createdBy: user.name, status: 'Open',
      lines: clean.map(l => ({ id: uid(), kind: l.kind, itemId: l.itemId, name: l.name, unit: l.unit, qty: Number(l.qty), price: Number(l.price) || 0, received: 0 })),
    };
    commitPOs([po].concat(poRef.current));
    return { po };
  };
  const cancelPurchaseOrder = (poNumber) => {
    if (!user || !canDo(user.role, 'inventory.adjust')) return { error: 'Your role cannot cancel purchase orders.' };
    const po = poRef.current.find(p => String(p.poNumber) === String(poNumber));
    if (!po) return { error: 'Purchase order not found.' };
    if (poStatusOf(po) !== 'Open') return { error: 'Only a purchase order with nothing received can be cancelled.' };
    commitPOs(poRef.current.map(p => p.id === po.id ? Object.assign({}, p, { status: 'Cancelled' }) : p));
    return { ok: true };
  };
  const receivePurchaseOrder = (poNumber, receipts) => {
    const po = poRef.current.find(p => String(p.poNumber) === String(poNumber));
    if (!po) return;
    const lines = (po.lines || []).map(l => {
      const add = (receipts || []).filter(r => r.lineId === l.id).reduce((t, r) => t + (Number(r.qty) || 0), 0);
      return add ? Object.assign({}, l, { received: round3((Number(l.received) || 0) + add) }) : l;
    });
    const upd = Object.assign({}, po, { lines });
    upd.status = poStatusOf(Object.assign({}, upd, { status: 'Open' }));
    commitPOs(poRef.current.map(p => p.id === po.id ? upd : p));
  };
`;

/* ================================================================== */
/* WIRING                                                              */
/* ================================================================== */
// keys
replaceOnce('KEYS.matDocs', "  matDocs: 'ctpm:material_documents',\n", "  matDocs: 'ctpm:material_documents',\n  purchaseOrders: 'ctpm:purchase_orders',\n  alertsSent: 'ctpm:alerts_sent',\n");

// movement types: 101 now covers purchase-order receipts too
replaceOnce('MVT 101', "'101': { text: 'GR for production order', sign: +1, stock: 'finished' },", "'101': { text: 'Goods receipt (purchase / production order)', sign: +1, stock: 'any' },");
replaceOnce('MVT 102', "'102': { text: 'GR for production order - reversal', sign: -1, stock: 'finished' },", "'102': { text: 'Goods receipt - reversal', sign: -1, stock: 'any' },");

// module constants placed before the (replaced) goods receipt block
replaceOnce('module constants anchor', 'const MIGO_ACTIONS = [',
  "/* NEEL_PHASE3_V1 - constants */\nconst NEEL_PREFS_PREFIX = 'ctpm:user_prefs:';\nconst NEEL_ALERT_WEBHOOK_URL = " + JSON.stringify(webhookArg) + ";\nconst MIGO_ACTIONS = [");
{
  const a = s.indexOf('const MIGO_ACTIONS = [');
  const b = s.indexOf('function SpaceBackBar(');
  if (a === -1 || b === -1 || b < a) missing.push('goods receipt / hub block');
  else s = s.slice(0, a) + MODULE + s.slice(b);
}

// invMaterials: finished goods carry their category (for pallets / boxes)
replaceOnce('invMaterials category',
  "type: 'Finished goods', plant: PLANT_CODE, sloc: INV_SLOC_FIN, qty: Number(f.qty) || 0, unit: f.unit || 'kg',",
  "type: 'Finished goods', category: f.category || null, plant: PLANT_CODE, sloc: INV_SLOC_FIN, qty: Number(f.qty) || 0, unit: f.unit || 'kg',");

// App state, handlers, effects
replaceOnce('dataLoading state', "  const [dataLoading, setDataLoading] = useState(true);\n", "  const [dataLoading, setDataLoading] = useState(true);\n" + APP_BLOCK);
replaceOnce('handlers anchor', "  const addFinished = (item) =>", HANDLERS + "  const addFinished = (item) =>");

// load
replaceOnce('load picks', "    const md = pick(KEYS.matDocs, []);\n",
  "    const md = pick(KEYS.matDocs, []);\n    const poList = pick(KEYS.purchaseOrders, []);\n    const alsent = pick(KEYS.alertsSent, {});\n    const upAll = {};\n    Object.keys(bulk).forEach(k => { if (k.indexOf(NEEL_PREFS_PREFIX) === 0) upAll[k.slice(NEEL_PREFS_PREFIX.length)] = bulk[k]; });\n");
replaceOnce('load sets', "    if (!shouldSkipLoad(KEYS.matDocs)) setMatDocs(md);\n",
  "    if (!shouldSkipLoad(KEYS.matDocs)) setMatDocs(md);\n    if (!shouldSkipLoad(KEYS.purchaseOrders)) setPurchaseOrders(poList);\n    alertsSentRef.current = alsent;\n    setUserPrefsAll(upAll);\n");
replaceOnce('wipe list', "[KEYS.matDocs, [], setMatDocs],", "[KEYS.matDocs, [], setMatDocs], [KEYS.purchaseOrders, [], setPurchaseOrders],");

// nav + hubs + spaces
replaceOnce('nav entries',
  "      { key: 'analyzestock', label: 'Analyze Stock in Date Range', icon: TrendingUp, hidden: true },\n",
  "      { key: 'analyzestock', label: 'Analyze Stock in Date Range', icon: TrendingUp, hidden: true },\n" +
  "      { key: 'purchaseorders', label: 'Manage Purchase Orders', icon: ClipboardList, hidden: true },\n" +
  "      { key: 'matprices', label: 'Material Prices', icon: Scale, hidden: true },\n" +
  "      { key: 'overduepo', label: 'Overdue Materials - Stock in Transit', icon: Clock, hidden: true },\n");
replaceOnce('hub tiles stock mgmt',
  "      { tab: 'cyclecount', title: 'Cycle Count', sub: 'Physical Inventory Audit' },\n",
  "      { tab: 'cyclecount', title: 'Cycle Count', sub: 'Physical Inventory Audit' },\n" +
  "      { tab: 'purchaseorders', title: 'Manage Purchase Orders', sub: 'Vendor Orders & Receipts' },\n" +
  "      { tab: 'matprices', title: 'Material Prices', sub: 'Stock Valuation' },\n");
replaceOnce('hub tile overdue',
  "      { tab: 'slowmoving', title: 'Slow or Non-Moving Materials' },\n",
  "      { tab: 'slowmoving', title: 'Slow or Non-Moving Materials' },\n      { tab: 'overduepo', title: 'Overdue Materials', sub: 'Stock in Transit' },\n");
replaceOnce('inventory space match', "'deadstock', 'slowmoving', 'analyzestock'", "'deadstock', 'slowmoving', 'analyzestock', 'purchaseorders', 'matprices', 'overduepo'");

// routing
replaceOnce('migo route',
  "{tab === 'migo' && <GoodsReceiptPoTab rawItems={rawItems} matDocs={matDocs} onAdjustRaw={adjustRaw} user={user} setTab={setTab} />}",
  "{tab === 'migo' && <GoodsReceiptPoTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} purchaseOrders={purchaseOrders} onAdjustRaw={adjustRaw} onAdjustFinished={adjustFinished} onSetPrice={setMaterialPrice} onReceivePO={receivePurchaseOrder} user={user} setTab={setTab} />}\n" +
  "          {tab === 'purchaseorders' && <PurchaseOrdersTab purchaseOrders={purchaseOrders} rawItems={rawItems} finishedItems={finishedItems} onCreate={createPurchaseOrder} onCancel={cancelPurchaseOrder} user={user} setTab={setTab} />}\n" +
  "          {tab === 'matprices' && <MaterialPricesTab rawItems={rawItems} finishedItems={finishedItems} onSetPrice={setMaterialPrice} user={user} setTab={setTab} />}\n" +
  "          {tab === 'overduepo' && <OverdueMaterialsTab purchaseOrders={purchaseOrders} setTab={setTab} />}");
replaceOnce('hub route',
  "{SPACE_HUBS[tab] && <SpaceHubTab hubKey={tab} setTab={setTab} user={user} />}",
  "{SPACE_HUBS[tab] && <SpaceHubTab hubKey={tab} setTab={setTab} user={user} data={{ batches, maintenanceLogs, pullRequests, rawItems, capaRecords, cycleCounts, orders, purchaseOrders }} />}");
replaceOnce('home props',
  "<HomePage setTab={setTab} orders={orders}",
  "<HomePage setTab={setTab} prefs={userPrefsAll[String((user && user.name) || '').toLowerCase()]} onSavePref={saveUserPref} orders={orders}");

// Stock - Single Material: camera scan
replaceOnce('single: state', "  const [vhOpen, setVhOpen] = useState(false);\n  const inputRef = useRef(null);\n", "  const [vhOpen, setVhOpen] = useState(false);\n  const [scanOpen, setScanOpen] = useState(false);\n  const inputRef = useRef(null);\n");
replaceOnce('single: scan handler',
  "  const rowsFor = number ? materials.filter(m => m.number === number) : [];\n",
  "  const onScanned = useCallback((t) => { setScanOpen(false); setText(String(t)); setTimeout(() => submit(String(t)), 0); }, [materials]);\n  const rowsFor = number ? materials.filter(m => m.number === number) : [];\n");
replaceOnce('single: scan button',
  "onClick={() => { if (text.trim()) submit(); else { setMsg('Ready to scan - point your barcode scanner at the label.'); if (inputRef.current) inputRef.current.focus(); } }}",
  "onClick={() => setScanOpen(true)}");
replaceOnce('single: scanner render',
  "      {vhOpen && <MaterialValueHelp single materials={materials}",
  "      {scanOpen && <BarcodeScanner onScan={onScanned} onClose={() => setScanOpen(false)} />}\n      {vhOpen && <MaterialValueHelp single materials={materials}");

// Home: per-user favourites, usage lists, role defaults
replaceOnce('home destructure', "  setTab, user, batches, maintenanceLogs, pullRequests, onOpenSettings,\n}) {", "  setTab, user, batches, maintenanceLogs, pullRequests, onOpenSettings, prefs, onSavePref,\n}) {");
replaceOnce('home apps rename', "  const allApps = [\n    { title: 'Process Inspection Lots'", "  const allAppsBase = [\n    { title: 'Process Inspection Lots'");
replaceOnce('home apps end', "  ].filter(a => canSeeTab(user, a.tab));\n", "  ].filter(a => canSeeTab(user, a.tab));\n  const allApps = allAppsBase.concat(neelExtraApps(allAppsBase, user));\n");
replaceOnce('home fav sync',
  "    try { const v = JSON.parse(localStorage.getItem('neel_home_fav_titles')); return Array.isArray(v) ? v : null; } catch { return null; }\n  });\n",
  "    try { const v = JSON.parse(localStorage.getItem('neel_home_fav_titles')); return Array.isArray(v) ? v : null; } catch { return null; }\n  });\n  useEffect(() => { if (prefs && Array.isArray(prefs.favTitles)) setFavTitles(prefs.favTitles); }, [prefs && prefs.favTitles]);\n");
replaceOnce('home isFav',
  "const isFav = (a) => (favTitles ? favTitles.includes(a.title) : a.cat === 'Favorites');",
  "const roleTabs = (NEEL_ROLE_FAVS[user && user.role] || []).filter(t => allApps.some(a => a.tab === t));\n  const isFav = (a) => (favTitles ? favTitles.includes(a.title) : (roleTabs.length ? roleTabs.includes(a.tab) : a.cat === 'Favorites'));");
replaceOnce('home saveFavs',
  "    setFavTitles(list);\n    try { localStorage.setItem('neel_home_fav_titles', JSON.stringify(list)); } catch {}\n",
  "    setFavTitles(list);\n    try { localStorage.setItem('neel_home_fav_titles', JSON.stringify(list)); } catch {}\n    if (onSavePref) onSavePref({ favTitles: list });\n");
replaceOnce('home visibleApps',
  "  const visibleApps = appFilter === 'Favorites'\n    ? allApps.filter(isFav)\n    : allApps.filter(a => a.cat === appFilter);\n",
  "  const usage = (prefs && prefs.usage) || { counts: {}, recent: [] };\n" +
  "  const byTab = (t) => allApps.find(a => a.tab === t);\n" +
  "  const mostUsed = Object.keys(usage.counts || {}).sort((x, y) => usage.counts[y] - usage.counts[x]).map(byTab).filter(Boolean).slice(0, 10);\n" +
  "  const recentUsed = (usage.recent || []).map(byTab).filter(Boolean).slice(0, 10);\n" +
  "  const recommended = roleTabs.concat(allApps.map(a => a.tab)).filter((t, i, arr) => arr.indexOf(t) === i).filter(t => !(usage.counts || {})[t]).map(byTab).filter(Boolean).slice(0, 10);\n" +
  "  const visibleApps = appFilter === 'Favorites' ? allApps.filter(isFav)\n    : appFilter === 'Most Used' ? mostUsed\n    : appFilter === 'Recently Used' ? recentUsed\n    : appFilter === 'Recommended' ? recommended\n    : allApps.filter(a => a.cat === appFilter);\n");
replaceOnce('home empty message',
  "          {visibleApps.map(app => (",
  "          {visibleApps.length === 0 && <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', fontSize: 13, color: C.subtext }}>{appFilter === 'Favorites' ? 'No favorites yet. Use Add Apps to pin the apps you use most.' : 'Nothing here yet. The apps you open will show up here.'}</div>}\n          {visibleApps.map(app => (");

// search: every page and tile is findable
replaceOnce('palette items',
  "const navItems = navGroups.flatMap(g => g.items);",
  "const navItems = NAV.filter(n => canSeeTab(user, n.key)).map(n => Object.assign({}, n, { keywords: neelKeywords(n.key) }));");
replaceOnce('palette match',
  "navItems.filter(n => n.label.toLowerCase().includes(q))",
  "navItems.filter(n => (n.label + ' ' + (n.keywords || '')).toLowerCase().includes(q))");

// alerts webhook
replaceOnce('webhook url', "  const WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/your_webhook_id';\n  try {\n    await fetch(WEBHOOK_URL, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },",
  "  const WEBHOOK_URL = NEEL_ALERT_WEBHOOK_URL;\n  if (!WEBHOOK_URL) return;\n  try {\n    await fetch(WEBHOOK_URL, {\n      method: 'POST',\n      mode: 'no-cors',\n      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },");

if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.p3.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Phase 3 patched  ->  ' + file);
console.log('Backup           ->  ' + file + '.p3.bak');
console.log(webhookArg ? 'Alert webhook    ->  ON' : 'Alert webhook    ->  off (re-run with --webhook=URL on a fresh copy, or edit NEEL_ALERT_WEBHOOK_URL in App.jsx)');
