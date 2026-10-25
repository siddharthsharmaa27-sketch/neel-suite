#!/usr/bin/env node
/**
 * NEEL Suite Cloud - merge duplicate screens into one
 * Run AFTER patch-consumables.cjs (and all earlier patches).
 *
 *   node patch-unify.cjs                 -> patches ./src/App.jsx
 *   node patch-unify.cjs path/to/App.jsx
 *
 * PURCHASING: "Purchase & Goods Receipt" is now the ONE place to create purchase orders and receive goods,
 *   for consumables, raw materials AND imported finished goods.
 *   Replaces: Manage Purchase Orders, Goods Receipt Purchase Order, Overdue Materials and the separate
 *   consumables receive screen. Old routes/links still open the new screen. Old purchase orders can be moved
 *   in with one click. A "Recent goods receipts" panel replaces the always-blank "My Documents" tree.
 * STOCK ANALYSIS: "Slow or Non-Moving Materials" is now the ONE dead / slow stock report and includes
 *   consumables (with last movement and days idle). Dead Stock Analysis and Stock Health are removed.
 *   ABC analysis stays on Consumables Cost Analysis.
 * All-or-nothing. Backup: App.jsx.unify.bak
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('NEEL_UNIFY_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
for (const [marker, name] of [['NEEL_INV_MODULE_V1', 'patch-inventory.cjs'], ['NEEL_HUBS_V1', 'patch-hubs.cjs'], ['NEEL_PHASE3_V1', 'patch-phase3.cjs'], ['function ConsumablesPurchaseTab(', 'patch-consumables.cjs']]) {
  if (!s.includes(marker)) { console.error('Run ' + name + ' first. Nothing was changed.'); process.exit(2); }
}

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}
function editSegment(label, startMarker, endMarker, fn) {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a + 1);
  if (a === -1 || b === -1) { missing.push(label + ' (region)'); return; }
  const box = { t: s.slice(a, b) };
  const rep = (what, find, repl) => { const i = box.t.indexOf(find); if (i === -1) { missing.push(label + ': ' + what); return; } box.t = box.t.slice(0, i) + repl + box.t.slice(i + find.length); };
  fn(box, rep);
  s = s.slice(0, a) + box.t + s.slice(b);
}

/* ================================================================== */
/* 1. PURCHASE & GOODS RECEIPT = one screen for every material type    */
/* ================================================================== */
// PO numbers: only count CP-numbers (moved-in old POs keep their own numbers)
replaceOnce('PO numbering',
  "const max = (pos || []).reduce((t, p) => Math.max(t, Number(String(p.poNumber).replace(/\\D/g, '')) || 0), 0);",
  "const max = (pos || []).reduce((t, p) => Math.max(t, String(p.poNumber).indexOf('CP') === 0 ? (Number(String(p.poNumber).replace(/\\D/g, '')) || 0) : 0), 0);");

editSegment('purchase screen', 'function ConsumablesPurchaseTab(', 'function conUseRates(', (box, rep) => {
  box.t = box.t.replace(/\bbyId\b/g, 'itemById');
  rep('header',
    "function ConsumablesPurchaseTab({ user, setTab }) {\n  const { master, setMaster, tx, setTx, pos, setPos, receipts, setReceipts, itemById } = useConData();\n  const [sub, setSub] = useState('orders');\n",
    String.raw`function ConsumablesPurchaseTab({ user, setTab, initialSub, initialLate, rawItems, finishedItems, onAdjustRaw, onAdjustFinished, onSetPrice, oldPurchaseOrders }) {
  const { master, setMaster, tx, setTx, pos, setPos, receipts, setReceipts, byId: consById } = useConData();
  const [sub, setSub] = useState(initialSub || 'orders');
  const [onlyLate, setOnlyLate] = useState(!!initialLate);
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);
  // one item list for every type of material that is bought
  const allItems = useMemo(() => {
    const cons = master.map(m => Object.assign({}, m, { source: 'cons' }));
    const rawList = (rawItems || []).map(r => ({ id: 'raw:' + r.id, rawId: r.id, source: 'raw', code: materialNumberForRaw(r.name), name: r.name, category: r.kind || 'Raw material', uom: r.unit || 'kg', unit_cost: Number(r.price || r.rate || 0), stock_qty: Number(r.qty) || 0 }));
    const finList = (finishedItems || []).filter(isImportedItem).map(f => ({ id: 'fin:' + f.id, finId: f.id, source: 'fin', code: materialNumberForSpec(f.spec), name: f.spec, category: f.category, uom: f.unit || 'kg', unit_cost: Number(f.price || f.rate || 0), stock_qty: Number(f.qty) || 0 }));
    return cons.concat(rawList, finList);
  }, [master, rawItems, finishedItems]);
  const itemById = useMemo(() => Object.fromEntries(allItems.map(m => [m.id, m])), [allItems]);
  const [migrated, setMigrated] = useState(() => { try { return localStorage.getItem('neel_old_po_moved') === '1'; } catch (e) { return false; } });
  const showMigrate = !migrated && (oldPurchaseOrders || []).length > 0;
  const migrateOld = () => {
    const have = new Set(pos.map(p => String(p.poNumber)));
    const conv = (oldPurchaseOrders || []).filter(p => !have.has(String(p.poNumber))).map(p => ({
      id: p.id, poNumber: String(p.poNumber), vendor: p.vendor, date: p.date, deliveryDate: p.deliveryDate || '', createdBy: p.createdBy || '',
      status: p.status === 'Cancelled' ? 'Cancelled' : 'Open',
      lines: (p.lines || []).map(l => ({ id: l.id, itemId: (l.kind === 'fin' ? 'fin:' : 'raw:') + l.itemId, qty: Number(l.qty), rate: Number(l.price) || 0, received: Number(l.received) || 0 })),
    }));
    setPos(prev => conv.concat(prev));
    try { localStorage.setItem('neel_old_po_moved', '1'); } catch (e) { /* ignore */ }
    setMigrated(true);
    setNote({ ok: true, text: conv.length + ' purchase order(s) moved here from the old screen. Receive the open ones from the Goods Receipt tab.' });
  };
`);
  rep('screen title', 'title="Consumables Purchase" sub="Order, receive and compare prices for dies, plugs, packaging and other consumables."',
    'title="Purchase & Goods Receipt" sub="One place to order, receive and compare prices - consumables, raw materials and imported finished goods."');
  rep('tabs', "tabs={[['orders', 'Purchase Orders'], ['receive', 'Receive Goods'], ['prices', 'Price & Vendor History']]} />\n",
    "tabs={[['orders', 'Purchase Orders'], ['receive', 'Goods Receipt'], ['prices', 'Price & Vendor History']]} />\n" +
    "      {sub === 'orders' && pos.length > 0 && <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: C.subtext, margin: '0 0 10px' }}><input type=\"checkbox\" checked={onlyLate} onChange={e => setOnlyLate(e.target.checked)} data-testid=\"po-late\" /> Show only overdue orders</label>}\n");
  rep('migration banner', "      <ConNote note={note} />\n",
    "      <ConNote note={note} />\n" +
    "      {showMigrate && canPost && (\n        <Card style={{ padding: 12, marginBottom: 12, borderLeft: '4px solid var(--neel-accent, #0a6ed1)' }}>\n          <div style={{ fontSize: 13, color: C.ink }}>{(oldPurchaseOrders || []).length} purchase order(s) were created on the old Manage Purchase Orders screen. Move them here so there is only one list.</div>\n          <button type=\"button\" style={Object.assign({}, invBtn, { marginTop: 8 })} onClick={migrateOld} data-testid=\"po-migrate\">Move them here</button>\n        </Card>\n      )}\n");
  rep('overdue count', "  const monthSpend = receipts.filter(",
    "  const lateCount = pos.filter(p => conPoOpen(p) && p.deliveryDate && p.deliveryDate < todayKey()).length;\n  const monthSpend = receipts.filter(");
  rep('overdue kpi', 'sub="items up more than 5%" />\n',
    'sub="items up more than 5%" />\n        <ConKpi label="Overdue deliveries" value={String(lateCount)} tone={lateCount ? \'red\' : undefined} sub="open orders past the delivery date" />\n');
  rep('overdue filter', "                  {pos.map(p => {\n                    const st = conPoStatus(p);",
    "                  {pos.filter(p => !onlyLate || (conPoOpen(p) && p.deliveryDate && p.deliveryDate < todayKey())).map(p => {\n                    const st = conPoStatus(p);");
  rep('item select',
    "      <option value=\"\">Select item</option>\n      {(opts || master).map(m => <option key={m.id} value={m.id}>{m.code + ' - ' + m.name}</option>)}\n    </select>\n  );",
    "      <option value=\"\">Select item</option>\n      {[['cons', 'Consumables'], ['raw', 'Raw materials'], ['fin', 'Imported finished goods']].map(g => { const part = (opts || allItems).filter(m => m.source === g[0]); return part.length ? <optgroup key={g[0]} label={g[1]}>{part.map(m => <option key={m.id} value={m.id}>{m.code + ' - ' + m.name}</option>)}</optgroup> : null; })}\n    </select>\n  );");
  // posting: raw materials and imported finished goods go through the stock handlers (material documents)
  rep('post non-consumables', "    setReceipts(prev => lines.map(l => ({ id: uid(), at: nowIso,",
    String.raw`    lines.filter(l => itemById[l.itemId].source !== 'cons').forEach(l => {
      const it = itemById[l.itemId]; const q = Number(l.qty); const rt = Number(l.rate);
      const np = it.unit_cost > 0 && it.stock_qty > 0 ? conR2((it.stock_qty * it.unit_cost + q * rt) / (it.stock_qty + q)) : rt;
      if (rt > 0 && onSetPrice) onSetPrice(it.source, it.source === 'raw' ? it.rawId : it.finId, np);
      const opts = { movementType: po ? '101' : '501', refDoc: po ? 'PO ' + po.poNumber : (invNo.trim() ? 'Inv ' + invNo.trim() : 'Direct purchase') };
      if (it.source === 'raw') { if (onAdjustRaw) onAdjustRaw(it.rawId, q, opts); } else if (onAdjustFinished) onAdjustFinished(it.finId, q, opts);
    });
    setReceipts(prev => lines.map(l => ({ id: uid(), at: nowIso,`);
  rep('consumable log only', "    setTx(prev => lines.map(l => ({ id: 'TX-' + uid().toUpperCase(), at: nowIso, consumable_id: l.itemId,",
    "    setTx(prev => lines.filter(l => itemById[l.itemId].source === 'cons').map(l => ({ id: 'TX-' + uid().toUpperCase(), at: nowIso, consumable_id: l.itemId,");
  // live replacement for the blank "My Documents" tree
  rep('recent receipts', "      {sub === 'prices' && (",
    String.raw`      {sub === 'receive' && (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700, color: C.ink }}>Recent goods receipts</div>
          {receipts.length === 0 ? <EmptyState title="No receipts yet" sub="Goods you receive appear here, newest first." /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['Date', 'Item', 'Qty', 'Rate', 'Vendor', 'Invoice', 'Order'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>{receipts.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map(r => {
                  const it = itemById[r.itemId] || {};
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{r.date}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{it.name || 'Deleted item'}</td>
                      <td className="font-mono" style={{ padding: '8px 12px' }}>{conQty(r.qty)} {it.uom}</td>
                      <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(r.rate, 2)}</td>
                      <td style={{ padding: '8px 12px' }}>{r.vendor}</td>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{r.invoiceNo || '\u2014'}</td>
                      <td className="font-mono" style={{ padding: '8px 12px', color: C.subtext }}>{r.poNumber || 'Direct'}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {sub === 'prices' && (`);
});

/* ================================================================== */
/* 2. ONE dead / slow stock report, including consumables              */
/* ================================================================== */
const STOCK_HELPERS = String.raw`/* NEEL_UNIFY_V1 - consumables as materials for the stock analyses */
function neelConsMaterials(master) {
  return (master || []).map(m => ({ key: 'c' + m.id, number: m.code, name: m.name, group: m.category || 'Consumable', type: 'Consumable', plant: PLANT_CODE, sloc: 'STORE', qty: Number(m.stock_qty) || 0, unit: m.uom || 'pcs', price: Number(m.unit_cost) || 0 }));
}
function neelConsDocs(tx, master) {
  const code = {}; (master || []).forEach(m => { code[m.id] = m.code; });
  const out = [];
  (tx || []).forEach(t => {
    const c = code[t.consumable_id]; if (!c || !t.at) return;
    const q = Math.abs(Number(t.qty_issued) || 0); let mvt = '';
    if (t.action === 'Issued for Packing' || t.action === 'Issued to Dept' || t.action === 'Mounted') mvt = '261';
    else if (t.action === 'Scrapped') mvt = '551';
    else if (t.action === 'Received' || t.action === 'Returned' || t.action === 'Returned to Store') mvt = '501';
    else if (t.action === 'Stock Adjustment') mvt = Number(t.delta) >= 0 ? '701' : '702';
    if (!mvt || !q) return;
    out.push({ id: t.id, materialNumber: c, movementType: mvt, quantity: q, postingDate: t.at });
  });
  return out;
}
`;
replaceOnce('stock helpers', 'function DeadStockTab(', STOCK_HELPERS + 'function DeadStockTab(');

const NEW_HEAD = (name) => "function " + name + "({ rawItems, finishedItems, matDocs: matDocsIn, setTab }) {\n" +
  "  const cons = useConData();\n" +
  "  const materials = useMemo(() => invMaterials(rawItems, finishedItems).concat(neelConsMaterials(cons.master)), [rawItems, finishedItems, cons.master]);\n" +
  "  const matDocs = useMemo(() => (matDocsIn || []).concat(neelConsDocs(cons.tx, cons.master)), [matDocsIn, cons.tx, cons.master]);\n";
const OLD_HEAD = (name) => "function " + name + "({ rawItems, finishedItems, matDocs, setTab }) {\n  const materials = useMemo(() => invMaterials(rawItems, finishedItems), [rawItems, finishedItems]);\n";
replaceOnce('slow head', OLD_HEAD('SlowMovingTab'), NEW_HEAD('SlowMovingTab'));
replaceOnce('analyze head', OLD_HEAD('AnalyzeStockTab'), NEW_HEAD('AnalyzeStockTab'));
replaceOnce('slow columns',
  "    { key: 'cons', label: 'Consumption in Period', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },\n  ];",
  "    { key: 'cons', label: 'Consumption in Period', num: true, fmt: (v, r) => invNum(v) + ' ' + r.unit },\n    { key: 'last', label: 'Last movement', fmt: (v) => v || 'Never' },\n    { key: 'idle', label: 'Days idle', num: true, fmt: (v) => (v === null || v === undefined ? '\\u2014' : v + ' d') },\n  ];");
replaceOnce('slow row',
  "qty: m.qty, val: m.qty * m.price, cons };",
  "qty: m.qty, val: m.qty * m.price, cons, last: invLastMove(ctx.matDocs, m.number), idle: invLastMove(ctx.matDocs, m.number) ? Math.round((new Date(v.ref + 'T00:00:00Z') - new Date(invLastMove(ctx.matDocs, m.number) + 'T00:00:00Z')) / 86400000) : null };");
replaceOnce('slow subtitle',
  'sub="Stock with no or very low consumption over the last N days."',
  'sub="Dead stock and slow-moving stock across consumables, raw materials and finished goods. Non-moving means nothing was used in the last N days."');

// Consumables Store: Stock Health is replaced by the single report above (and ABC lives on the Cost Analysis page)
editSegment('store tab', 'function ConsumablesStoreTab(', 'function ConsumablesCostTab(', (box, rep) => {
  rep('tabs', "['planner', 'Reorder Planner'], ['health', 'Stock Health'], ['issue',", "['planner', 'Reorder Planner'], ['issue',");
  rep('hint', "      <ConTabs value={sub} onChange={setSub} tabs={[['planner'",
    "      <div style={{ fontSize: 12.5, color: C.subtext, margin: '0 0 10px' }}>Idle and slow stock: open <button type=\"button\" onClick={() => setTab('slowmoving')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--neel-accent, #0a6ed1)', fontWeight: 700, cursor: 'pointer' }} data-testid=\"store-slow-link\">Slow or Non-Moving Materials</button> (it now includes consumables). Cost drivers (A / B / C) are on Consumables Cost Analysis.</div>\n      <ConTabs value={sub} onChange={setSub} tabs={[['planner'");
  const a = box.t.indexOf("      {sub === 'health' && (\n"); const b = box.t.indexOf("      {sub === 'issue' && (\n");
  if (a === -1 || b === -1 || b < a) missing.push('store tab: health block');
  else box.t = box.t.slice(0, a) + box.t.slice(b);
});

/* ================================================================== */
/* 3. ROUTES, TILES AND LINKS                                          */
/* ================================================================== */
const CP_PROPS = 'user={user} setTab={setTab} rawItems={rawItems} finishedItems={finishedItems} onAdjustRaw={adjustRaw} onAdjustFinished={adjustFinished} onSetPrice={setMaterialPrice} oldPurchaseOrders={purchaseOrders}';
replaceOnce('conpurchase route', "{tab === 'conpurchase' && <ConsumablesPurchaseTab user={user} setTab={setTab} />}", "{tab === 'conpurchase' && <ConsumablesPurchaseTab " + CP_PROPS + " />}");
function reroute(label, tabKey, newJsx) {
  const re = new RegExp("^( *)\\{tab === '" + tabKey + "' && <[A-Za-z]+Tab [^\\n]*\\n", 'm');
  const m = s.match(re);
  if (!m) { missing.push('route ' + label); return; }
  s = s.replace(m[0], m[1] + "{tab === '" + tabKey + "' && " + newJsx + "}\n");
}
reroute('migo', 'migo', '<ConsumablesPurchaseTab ' + CP_PROPS + ' initialSub="receive" />');
reroute('purchaseorders', 'purchaseorders', '<ConsumablesPurchaseTab ' + CP_PROPS + ' initialSub="orders" />');
reroute('overduepo', 'overduepo', '<ConsumablesPurchaseTab ' + CP_PROPS + ' initialSub="orders" initialLate />');
reroute('deadstock', 'deadstock', '<SlowMovingTab rawItems={rawItems} finishedItems={finishedItems} matDocs={matDocs} setTab={setTab} />');

replaceOnce('tile: migo', "      { tab: 'migo', title: 'Post Goods Movement', sub: 'Goods Receipt' },\n", '');
replaceOnce('tile: purchase orders', "      { tab: 'purchaseorders', title: 'Manage Purchase Orders', sub: 'Vendor Orders & Receipts' },\n", '');
replaceOnce('tile: overdue', "      { tab: 'overduepo', title: 'Overdue Materials', sub: 'Stock in Transit' },\n", '');
replaceOnce('tile: dead stock link', "    ], links: [\n      { tab: 'deadstock', title: 'Dead Stock Analysis' },\n    ] },\n", "    ] },\n");
replaceOnce('tile: rename purchase', "{ tab: 'conpurchase', title: 'Consumables Purchase', sub: 'Orders, Receipts & Prices' },", "{ tab: 'conpurchase', title: 'Purchase & Goods Receipt', sub: 'Orders, Receiving & Prices' },");
replaceOnce('nav: rename purchase', "{ key: 'conpurchase', label: 'Consumables Purchase',", "{ key: 'conpurchase', label: 'Purchase & Goods Receipt',");
replaceOnce('home tile', "{ title: 'Post Goods Movement', subtitle: 'Material Documents', icon: FileSpreadsheet, tab: 'migo',", "{ title: 'Purchase & Goods Receipt', subtitle: 'Orders & Receiving', icon: FileSpreadsheet, tab: 'conpurchase',");
{
  const a = s.indexOf('const NEEL_ROLE_FAVS = {');
  const b = s.indexOf('function neelExtraApps(', a);
  if (a === -1 || b === -1) missing.push('role favourites');
  else s = s.slice(0, a) + s.slice(a, b).replace(/'migo'/g, "'conpurchase'").replace(/, 'overduepo'/g, '').replace(/, 'purchaseorders'/g, '').replace(/'purchaseorders', /g, '').replace(/, 'deadstock'/g, '') + s.slice(b);
}

/* ================================================================== */
/* 4. ALERTS read the single purchase-order list                       */
/* ================================================================== */
replaceOnce('alerts: old PO loop',
  "    (purchaseOrders || []).forEach(p => {\n      const key = 'po:' + p.poNumber + ':' + today;\n      if (poIsOverdue(p) && !sent[key]) fresh.push({ key, type: 'po_overdue', data: { po: p.poNumber, vendor: p.vendor, deliveryDate: p.deliveryDate } });\n    });\n", '');
replaceOnce('alerts: new PO effect',
  "  }, [rawItems, purchaseOrders, dataLoading]);\n",
  String.raw`  }, [rawItems, purchaseOrders, dataLoading]);
  useEffect(() => {
    if (dataLoading || !user || !NEEL_ALERT_WEBHOOK_URL || !canSeeTab(user, 'inventory')) return undefined;
    let dead = false;
    loadShared('ctpm:consumable_pos', []).then(list => {
      if (dead) return;
      const today = new Date().toISOString().slice(0, 10);
      const sent = alertsSentRef.current || {};
      const fresh = (list || []).filter(p => p.status !== 'Cancelled' && p.deliveryDate && p.deliveryDate < today && (p.lines || []).some(l => (Number(l.received) || 0) < Number(l.qty)) && !sent['po:' + p.poNumber + ':' + today]);
      if (!fresh.length) return;
      const next = {};
      Object.keys(sent).forEach(k2 => { if (sent[k2] === today) next[k2] = today; });
      fresh.forEach(p => { next['po:' + p.poNumber + ':' + today] = today; });
      alertsSentRef.current = next; saveShared(KEYS.alertsSent, next);
      fresh.forEach(p => triggerAutomatedAlert('po_overdue', { po: p.poNumber, vendor: p.vendor, deliveryDate: p.deliveryDate }));
    }).catch(() => {});
    return () => { dead = true; };
  }, [dataLoading]);
`);

if (/`/.test(STOCK_HELPERS)) { console.error('Internal error: helper code contains a backtick.'); process.exit(3); }
if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.unify.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Screens merged  ->  ' + file);
console.log('Backup          ->  ' + file + '.unify.bak');
