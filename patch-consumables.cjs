#!/usr/bin/env node
/**
 * NEEL Suite Cloud - Consumables Store, Purchase & Cost Analysis
 * Run after patch-inventory.cjs and patch-hubs.cjs.
 *
 *   node patch-consumables.cjs                 -> patches ./src/App.jsx
 *   node patch-consumables.cjs path/to/App.jsx
 *
 * Adds three pages at the top of Inventory Management > "Consumables Cost Control":
 *   1. Consumables Purchase  - purchase orders, goods receipt with invoice-rate check,
 *                              moving-average cost, price & vendor history
 *   2. Consumables Store     - reorder planner (days of cover, suggested qty, create PO),
 *                              stock health (dead stock, ABC), ISSUE TO DEPARTMENT (reason + person), adjustments & write-offs
 *   3. Consumables Cost      - cost per kg vs target, budget, trend, where the money goes,
 *                              tool-life losses, savings insights
 * BOM / MRP is hidden from the sidebar and from the Inventory Management tiles (the page and its data are kept).
 * All-or-nothing. Backup: App.jsx.con.bak
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('NEEL_CONSUMABLES_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
for (const [marker, name] of [['NEEL_INV_MODULE_V1', 'patch-inventory.cjs'], ['NEEL_HUBS_V1', 'patch-hubs.cjs']]) {
  if (!s.includes(marker)) { console.error('Run ' + name + ' first. Nothing was changed.'); process.exit(2); }
}

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

const MODULE = String.raw`/* NEEL_CONSUMABLES_V1 - consumables store, purchase and cost analysis */
const CON_USE = ['Issued for Packing', 'Issued to Dept', 'Scrapped'];
const CON_ADJ_TYPES = ['Physical count correction', 'Damaged', 'Lost / Missing', 'Expired / Obsolete', 'Returned to vendor'];
const CON_DEPTS = ['Melting', 'Milling', 'Planetary Rolling', 'Cascade', 'Spinner', 'Annealing', 'LWC Packing', 'PCC Packing', 'CTL', 'Maintenance', 'Quality Lab', 'Tool Room', 'Utilities', 'Admin / Other'];
const CON_REASONS = ['Routine use', 'Replacement', 'Breakdown / urgent', 'Trial / test', 'Other'];
const conRs = (v, dec) => '\u20B9' + (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: dec || 0 });
const conQty = (v) => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-IN');
const conR2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
function conMonthShift(ym, n) {
  const p = String(ym).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function conPeriodMonths(period) {
  const ym = todayKey().slice(0, 7);
  if (period === 'this') return [ym];
  if (period === 'last') return [conMonthShift(ym, -1)];
  if (period === 'q3') return [conMonthShift(ym, -2), conMonthShift(ym, -1), ym];
  if (period === 'year') { const out = []; for (let m = 1; m <= Number(ym.slice(5)); m++) out.push(ym.slice(0, 4) + '-' + String(m).padStart(2, '0')); return out; }
  return null;
}
function conPeriodTest(period) {
  const months = conPeriodMonths(period);
  if (!months) return () => true;
  return (key) => months.includes(String(key).slice(0, 7));
}
function conGoodKg(batches, month) {
  let total = 0;
  (batches || []).forEach(b => {
    const m = b.flow && b.flow.machine;
    const endedDay = m && m.endedAt ? isoToLocalKey(m.endedAt) : (b.startedAt ? isoToLocalKey(b.startedAt) : '');
    if (month && (!endedDay || !endedDay.startsWith(month))) return;
    const packed = Number(b.flow && b.flow.packing && b.flow.packing.packedQty) || 0;
    const coilGood = Number(m && m.coils && m.coils.acceptedKg) || 0;
    const net = Math.max(0, Number(b.qty || 0) - (b.scrapLog || []).reduce((t, r) => t + Number(r.qty || 0), 0));
    total += (packed || coilGood || (b.unit === 'kg' ? net : 0));
  });
  return total;
}
function conPoStatus(po) {
  if (!po) return 'Open';
  if (po.status === 'Cancelled') return 'Cancelled';
  const lines = po.lines || [];
  const rec = lines.reduce((t, l) => t + (Number(l.received) || 0), 0);
  if (rec <= 0) return 'Open';
  return lines.every(l => (Number(l.received) || 0) >= (Number(l.qty) || 0)) ? 'Closed' : 'Partly received';
}
const conPoOpen = (po) => { const st = conPoStatus(po); return st === 'Open' || st === 'Partly received'; };
function conNextPoNumber(pos) {
  const max = (pos || []).reduce((t, p) => Math.max(t, Number(String(p.poNumber).replace(/\D/g, '')) || 0), 0);
  return 'CP' + String(max + 1).padStart(4, '0');
}
function useConData() {
  const [master, setMaster] = useSyncedStore(KEYS.consumablesMaster, DEFAULT_CONSUMABLES_MASTER);
  const [tx, setTx] = useSyncedStore(KEYS.consumablesTx, []);
  const [instances] = useSyncedStore(KEYS.toolingInstances, DEFAULT_TOOLING_INSTANCES);
  const [pos, setPos] = useSyncedStore('ctpm:consumable_pos', []);
  const [receipts, setReceipts] = useSyncedStore('ctpm:consumable_receipts', []);
  const [plan, setPlan] = useSyncedStore('ctpm:consumable_plan', { targets: { perKg: 0, monthlyBudget: 0 }, items: {} });
  const byId = useMemo(() => Object.fromEntries((master || []).map(m => [m.id, m])), [master]);
  return { master: master || [], setMaster, tx: tx || [], setTx, instances: instances || [], pos: pos || [], setPos, receipts: receipts || [], setReceipts, plan: plan || { targets: {}, items: {} }, setPlan, byId };
}
function ConModal({ title, onClose, children, footer, width }) {
  return (
    <div role="dialog" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(' + (width || 640) + 'px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.border, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</div>
        <div style={{ padding: 16, overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '10px 18px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}
function ConTabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, borderBottom: '1px solid ' + C.border }}>
      {tabs.map(t => (
        <button key={t[0]} type="button" onClick={() => onChange(t[0])} data-testid={'con-tab-' + t[0]}
          style={{ background: 'none', border: 'none', borderBottom: value === t[0] ? '2px solid var(--neel-accent, #0a6ed1)' : '2px solid transparent', color: value === t[0] ? 'var(--neel-accent, #0a6ed1)' : C.ink, fontWeight: 700, fontSize: 13, padding: '8px 12px', cursor: 'pointer' }}>{t[1]}</button>
      ))}
    </div>
  );
}
function ConNote({ note }) {
  if (!note) return null;
  return <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: note.ok ? '#e8f5e9' : '#fdecea', color: note.ok ? C.green : C.red }}>{note.text}</div>;
}
function ConKpi({ label, value, sub, tone }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: C.subtext, textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: tone === 'red' ? C.red : tone === 'green' ? C.green : C.ink, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
function ConBar({ pct, color }) {
  return <div style={{ background: C.borderSoft, borderRadius: 4, height: 8, width: 120 }}><div style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color || 'var(--neel-accent, #0a6ed1)', height: 8, borderRadius: 4 }} /></div>;
}

/* ------------------------------ PURCHASE ------------------------------ */
function ConsumablesPurchaseTab({ user, setTab }) {
  const { master, setMaster, tx, setTx, pos, setPos, receipts, setReceipts, byId } = useConData();
  const [sub, setSub] = useState('orders');
  const [note, setNote] = useState(null);
  const canPost = !!user && canDo(user.role, 'inventory.adjust');
  const vendors = Array.from(new Set(pos.map(p => p.vendor).concat(receipts.map(r => r.vendor)).filter(Boolean)));
  const lastRate = (itemId) => { const r = receipts.filter(x => x.itemId === itemId).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]; return r ? r.rate : 0; };

  /* ---- create PO ---- */
  const [form, setForm] = useState(false);
  const [vendor, setVendor] = useState('');
  const [due, setDue] = useState(addDaysKey(todayKey(), 7));
  const [fl, setFl] = useState([{ id: uid(), itemId: '', qty: '', rate: '' }]);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);
  const setF = (i, patch) => setFl(prev => prev.map((l, j) => j === i ? Object.assign({}, l, patch) : l));
  const poTotal = fl.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const createPo = () => {
    if (!canPost) { setErr('Your role cannot create purchase orders.'); return; }
    if (!vendor.trim()) { setErr('Enter the vendor name.'); return; }
    const lines = fl.filter(l => l.itemId && Number(l.qty) > 0).map(l => ({ id: uid(), itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate) || 0, received: 0 }));
    if (!lines.length) { setErr('Add at least one item with a quantity.'); return; }
    const po = { id: uid(), poNumber: conNextPoNumber(pos), vendor: vendor.trim(), date: todayKey(), deliveryDate: due || '', createdBy: (user && user.name) || '', status: 'Open', lines };
    setPos(prev => [po].concat(prev));
    setForm(false); setErr(''); setVendor(''); setFl([{ id: uid(), itemId: '', qty: '', rate: '' }]);
    setNote({ ok: true, text: 'Purchase order ' + po.poNumber + ' created.' }); setOpenId(po.id);
  };
  const cancelPo = (po) => {
    if (conPoStatus(po) !== 'Open') { setNote({ ok: false, text: 'Only a purchase order with nothing received can be cancelled.' }); return; }
    setPos(prev => prev.map(p => p.id === po.id ? Object.assign({}, p, { status: 'Cancelled' }) : p));
    setNote({ ok: true, text: 'Purchase order ' + po.poNumber + ' cancelled.' });
  };

  /* ---- receive ---- */
  const [src, setSrc] = useState('');
  const [rVendor, setRVendor] = useState('');
  const [invNo, setInvNo] = useState('');
  const [invDate, setInvDate] = useState(todayKey());
  const [rl, setRl] = useState([{ id: uid(), itemId: '', qty: '', rate: '', poLineId: null, poRate: 0 }]);
  const openPos = pos.filter(conPoOpen);
  const po = src ? pos.find(p => p.poNumber === src) : null;
  const loadPo = (num) => {
    setSrc(num);
    const p = pos.find(x => x.poNumber === num);
    if (!p) { setRl([{ id: uid(), itemId: '', qty: '', rate: '', poLineId: null, poRate: 0 }]); return; }
    setRVendor(p.vendor);
    setRl((p.lines || []).filter(l => (Number(l.received) || 0) < Number(l.qty)).map(l => ({ id: uid(), itemId: l.itemId, qty: String(conR2(Number(l.qty) - (Number(l.received) || 0))), rate: String(l.rate || ''), poLineId: l.id, poRate: Number(l.rate) || 0 })));
  };
  const setR = (i, patch) => setRl(prev => prev.map((l, j) => j === i ? Object.assign({}, l, patch) : l));
  const rateFlag = (l) => {
    const rate = Number(l.rate) || 0; if (!rate) return null;
    if (l.poRate > 0 && rate > l.poRate * 1.02) return 'Invoice rate is ' + conR2((rate / l.poRate - 1) * 100) + '% above the PO rate';
    const last = lastRate(l.itemId);
    if (!l.poRate && last > 0 && rate > last * 1.05) return conR2((rate / last - 1) * 100) + '% above the last price paid (' + conRs(last, 2) + ')';
    return null;
  };
  const postReceipt = () => {
    if (!canPost) { setNote({ ok: false, text: 'Your role cannot post goods receipts.' }); return; }
    if (!rVendor.trim()) { setNote({ ok: false, text: 'Enter the vendor.' }); return; }
    const lines = rl.filter(l => l.itemId || l.qty);
    if (!lines.length) { setNote({ ok: false, text: 'Add at least one item.' }); return; }
    const bad = lines.find(l => !byId[l.itemId] || !(Number(l.qty) > 0) || !(Number(l.rate) >= 0) || l.rate === '');
    if (bad) { setNote({ ok: false, text: 'Every item needs a material, a quantity above zero and the invoice rate.' }); return; }
    if (po) {
      const per = {};
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const pl = (po.lines || []).find(x => x.id === l.poLineId);
        if (!pl) { setNote({ ok: false, text: byId[l.itemId].name + ' is not on purchase order ' + po.poNumber + '.' }); return; }
        per[pl.id] = (per[pl.id] || 0) + Number(l.qty);
      }
      const over = (po.lines || []).find(x => per[x.id] && (Number(x.received) || 0) + per[x.id] > Number(x.qty) * 1.1 + 1e-9);
      if (over) { setNote({ ok: false, text: byId[over.itemId].name + ': more than the open quantity (10% tolerance).' }); return; }
    }
    const nowIso = new Date().toISOString();
    const add = {};
    lines.forEach(l => { const a = add[l.itemId] || { qty: 0, value: 0 }; a.qty += Number(l.qty); a.value += Number(l.qty) * Number(l.rate); add[l.itemId] = a; });
    setMaster(prev => prev.map(m => {
      const a = add[m.id]; if (!a) return m;
      const stock = Number(m.stock_qty) || 0; const cost = Number(m.unit_cost) || 0;
      const avg = stock > 0 && cost > 0 ? (stock * cost + a.value) / (stock + a.qty) : a.value / a.qty;
      return Object.assign({}, m, { stock_qty: conR2(stock + a.qty), unit_cost: conR2(avg) });
    }));
    setReceipts(prev => lines.map(l => ({ id: uid(), at: nowIso, date: invDate || todayKey(), vendor: rVendor.trim(), invoiceNo: invNo.trim(), itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), poNumber: po ? po.poNumber : '', poRate: l.poRate || 0, by: (user && user.name) || '' })).concat(prev));
    setTx(prev => lines.map(l => ({ id: 'TX-' + uid().toUpperCase(), at: nowIso, consumable_id: l.itemId, instance_id: '', machine_id: 'Store', production_order_id: po ? po.poNumber : 'Direct purchase', action: 'Received', qty_issued: Number(l.qty), rate: Number(l.rate), vendor: rVendor.trim(), invoice_no: invNo.trim(), reason_for_removal: 'N/A', by: (user && user.name) || 'Store' })).concat(prev));
    if (po) {
      setPos(prev => prev.map(p => {
        if (p.id !== po.id) return p;
        const ls = (p.lines || []).map(pl => { const q = lines.filter(l => l.poLineId === pl.id).reduce((t, l) => t + Number(l.qty), 0); return q ? Object.assign({}, pl, { received: conR2((Number(pl.received) || 0) + q) }) : pl; });
        return Object.assign({}, p, { lines: ls });
      }));
    }
    setNote({ ok: true, text: lines.length + ' item(s) received. Stock and average cost were updated and the prices were added to the price history.' });
    setSrc(''); setRVendor(''); setInvNo(''); setRl([{ id: uid(), itemId: '', qty: '', rate: '', poLineId: null, poRate: 0 }]);
  };

  /* ---- price history ---- */
  const [openItem, setOpenItem] = useState(null);
  const hist = useMemo(() => {
    const map = {};
    receipts.forEach(r => { (map[r.itemId] = map[r.itemId] || []).push(r); });
    return Object.keys(map).map(id => {
      const list = map[id].slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const rates = list.map(x => Number(x.rate) || 0);
      const last = list[list.length - 1]; const prev = list.length > 1 ? list[list.length - 2] : null;
      const vend = {};
      list.forEach(x => { const v = vend[x.vendor] = vend[x.vendor] || { vendor: x.vendor, qty: 0, value: 0, n: 0 }; v.qty += Number(x.qty) || 0; v.value += (Number(x.qty) || 0) * (Number(x.rate) || 0); v.n += 1; });
      const vendList = Object.values(vend).map(v => Object.assign({}, v, { avg: v.qty ? v.value / v.qty : 0 })).sort((a, b) => a.avg - b.avg);
      return { id, item: byId[id], list, last, avg: rates.reduce((t, x) => t + x, 0) / rates.length, min: Math.min.apply(null, rates), max: Math.max.apply(null, rates), change: prev && prev.rate > 0 ? (last.rate / prev.rate - 1) * 100 : 0, vendors: vendList };
    }).filter(h => h.item).sort((a, b) => b.change - a.change);
  }, [receipts, byId]);
  const exportAll = () => exportToExcel('consumable-purchases.xlsx', {
    Receipts: receipts.map(r => ({ Date: r.date, Vendor: r.vendor, Invoice: r.invoiceNo, Item: (byId[r.itemId] || {}).name, Code: (byId[r.itemId] || {}).code, Qty: r.qty, Rate: r.rate, Value: r.qty * r.rate, PO: r.poNumber })),
    'Purchase orders': pos.flatMap(p => (p.lines || []).map(l => ({ PO: p.poNumber, Vendor: p.vendor, Date: p.date, Delivery: p.deliveryDate, Status: conPoStatus(p), Item: (byId[l.itemId] || {}).name, Ordered: l.qty, Received: l.received || 0, Rate: l.rate }))),
  });
  const openOrderValue = openPos.reduce((t, p) => t + (p.lines || []).reduce((x, l) => x + Math.max(0, Number(l.qty) - (Number(l.received) || 0)) * (Number(l.rate) || 0), 0), 0);
  const monthSpend = receipts.filter(r => String(r.date).slice(0, 7) === todayKey().slice(0, 7)).reduce((t, r) => t + r.qty * r.rate, 0);
  const itemSelect = (value, onChange, opts) => (
    <select value={value} onChange={onChange} style={Object.assign({}, invInp, { flex: '2 1 220px' })}>
      <option value="">Select item</option>
      {(opts || master).map(m => <option key={m.id} value={m.id}>{m.code + ' - ' + m.name}</option>)}
    </select>
  );
  return (
    <InvPageFrame title="Consumables Purchase" sub="Order, receive and compare prices for dies, plugs, packaging and other consumables." setTab={setTab}
      right={<div style={{ display: 'flex', gap: 8 }}>{(receipts.length > 0 || pos.length > 0) && <ExportButton label="Export" onExport={exportAll} />}{canPost && <button type="button" style={invBtn} onClick={() => { setForm(true); setErr(''); }} data-testid="cp-create">Create PO</button>}</div>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <ConKpi label="Open purchase orders" value={String(openPos.length)} sub={conRs(openOrderValue) + ' still to receive'} />
        <ConKpi label="Bought this month" value={conRs(monthSpend)} />
        <ConKpi label="Price hikes (last buy)" value={String(hist.filter(h => h.change > 5).length)} tone={hist.some(h => h.change > 5) ? 'red' : undefined} sub="items up more than 5%" />
      </div>
      <ConNote note={note} />
      <ConTabs value={sub} onChange={setSub} tabs={[['orders', 'Purchase Orders'], ['receive', 'Receive Goods'], ['prices', 'Price & Vendor History']]} />

      {sub === 'orders' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {pos.length === 0 ? <EmptyState title="No purchase orders yet" sub={canPost ? 'Use Create PO, or start from the Reorder Planner.' : 'Purchase orders will appear here.'} /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['PO', 'Vendor', 'Date', 'Delivery', 'Value', 'Received', 'Status'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>
                  {pos.map(p => {
                    const st = conPoStatus(p);
                    const val = (p.lines || []).reduce((t, l) => t + l.qty * (l.rate || 0), 0);
                    const ord = (p.lines || []).reduce((t, l) => t + l.qty, 0);
                    const rec = (p.lines || []).reduce((t, l) => t + Math.min(Number(l.received) || 0, l.qty), 0);
                    const late = conPoOpen(p) && p.deliveryDate && p.deliveryDate < todayKey();
                    return (
                      <React.Fragment key={p.id}>
                        <tr onClick={() => setOpenId(openId === p.id ? null : p.id)} style={{ borderTop: '1px solid ' + C.borderSoft, cursor: 'pointer' }}>
                          <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: C.copper }}>{p.poNumber}</td>
                          <td style={{ padding: '8px 12px' }}>{p.vendor}</td>
                          <td style={{ padding: '8px 12px', color: C.subtext }}>{p.date}</td>
                          <td style={{ padding: '8px 12px', color: late ? C.red : C.subtext, fontWeight: late ? 700 : 400 }}>{p.deliveryDate || '\u2014'}</td>
                          <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(val)}</td>
                          <td style={{ padding: '8px 12px' }}>{ord ? Math.round(rec / ord * 100) : 0}%</td>
                          <td style={{ padding: '8px 12px' }}><Badge tone={st === 'Closed' ? 'green' : st === 'Cancelled' ? 'default' : st === 'Partly received' ? 'blue' : 'amber'}>{st}</Badge>{late && <span style={{ marginLeft: 6 }}><Badge tone="red">Overdue</Badge></span>}</td>
                        </tr>
                        {openId === p.id && (
                          <tr style={{ background: C.panelAlt }}><td colSpan={7} style={{ padding: 12 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                              <thead><tr>{['Item', 'Ordered', 'Received', 'Rate', 'Value'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                              <tbody>{(p.lines || []).map(l => (
                                <tr key={l.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                                  <td style={{ padding: '6px 12px' }}>{(byId[l.itemId] || {}).name || 'Deleted item'}</td>
                                  <td style={{ padding: '6px 12px' }}>{conQty(l.qty)} {(byId[l.itemId] || {}).uom}</td>
                                  <td style={{ padding: '6px 12px' }}>{conQty(l.received || 0)}</td>
                                  <td style={{ padding: '6px 12px' }}>{conRs(l.rate, 2)}</td>
                                  <td style={{ padding: '6px 12px' }}>{conRs(l.qty * l.rate)}</td>
                                </tr>))}</tbody>
                            </table>
                            <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                              {conPoOpen(p) && canPost && <button type="button" style={invBtnGhost} onClick={() => { setSub('receive'); loadPo(p.poNumber); }}>Receive goods</button>}
                              {st === 'Open' && canPost && <button type="button" style={Object.assign({}, invBtnGhost, { color: C.red })} onClick={() => cancelPo(p)}>Cancel PO</button>}
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {sub === 'receive' && (
        <Card style={{ padding: 14 }}>
          {!canPost && <div style={{ marginBottom: 10, fontSize: 12.5, color: C.red }}>Your role can view but not post receipts.</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Against</label>
              <select value={src} onChange={e => loadPo(e.target.value)} data-testid="cr-source" style={invInp}>
                <option value="">Direct purchase (no PO)</option>
                {openPos.map(p => <option key={p.id} value={p.poNumber}>{p.poNumber + ' - ' + p.vendor}</option>)}
              </select></div>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Vendor *</label>
              <input list="con-vendors" value={rVendor} readOnly={!!po} onChange={e => setRVendor(e.target.value)} data-testid="cr-vendor" style={Object.assign({}, invInp, { width: 200 })} />
              <datalist id="con-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist></div>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Invoice no.</label><input value={invNo} onChange={e => setInvNo(e.target.value)} style={Object.assign({}, invInp, { width: 150 })} /></div>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Invoice date</label><input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} style={invInp} /></div>
          </div>
          {rl.map((l, i) => {
            const m = byId[l.itemId]; const flag = rateFlag(l);
            return (
              <div key={l.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {po ? <div style={{ flex: '2 1 220px', fontSize: 13, fontWeight: 600 }}>{m ? m.code + ' - ' + m.name : ''}</div> : itemSelect(l.itemId, e => { const mm = byId[e.target.value]; setR(i, { itemId: e.target.value, rate: l.rate || String(lastRate(e.target.value) || (mm ? mm.unit_cost : '') || '') }); })}
                  <input type="number" min="0" placeholder={'Qty' + (m ? ' (' + m.uom + ')' : '')} value={l.qty} onChange={e => setR(i, { qty: e.target.value })} data-testid={'cr-qty-' + i} style={Object.assign({}, invInp, { width: 110 })} />
                  <input type="number" min="0" step="0.01" placeholder="Invoice rate" value={l.rate} onChange={e => setR(i, { rate: e.target.value })} data-testid={'cr-rate-' + i} style={Object.assign({}, invInp, { width: 120 })} />
                  <span style={{ fontSize: 12, color: C.subtext, minWidth: 90 }}>{conRs((Number(l.qty) || 0) * (Number(l.rate) || 0))}</span>
                  {!po && <button type="button" aria-label="Remove item" onClick={() => setRl(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={16} /></button>}
                </div>
                {flag && <div style={{ fontSize: 12, color: C.red, marginTop: 3 }} data-testid={'cr-flag-' + i}>{'\u26A0 ' + flag}</div>}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center' }}>
            {!po && <button type="button" style={invBtnGhost} onClick={() => setRl(prev => prev.concat([{ id: uid(), itemId: '', qty: '', rate: '', poLineId: null, poRate: 0 }]))}><Plus size={13} /> Add item</button>}
            <button type="button" style={Object.assign({}, invBtn, { opacity: canPost ? 1 : 0.5 })} onClick={postReceipt} data-testid="cr-post">Post receipt</button>
          </div>
        </Card>
      )}

      {sub === 'prices' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {hist.length === 0 ? <EmptyState title="No price history yet" sub="Every goods receipt adds a price here. After a few receipts you can see price hikes and the cheapest vendor." /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['Item', 'Last rate', 'Change', 'Average', 'Lowest', 'Highest', 'Cheapest vendor', 'Buys'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>
                  {hist.map(h => (
                    <React.Fragment key={h.id}>
                      <tr onClick={() => setOpenItem(openItem === h.id ? null : h.id)} style={{ borderTop: '1px solid ' + C.borderSoft, cursor: 'pointer', background: h.change > 5 ? C.redSoft : 'transparent' }}>
                        <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 600 }}>{h.item.name}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{h.item.code}</div></td>
                        <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{conRs(h.last.rate, 2)}</td>
                        <td className="font-mono" style={{ padding: '8px 12px', color: h.change > 0 ? C.red : h.change < 0 ? C.green : C.subtext, fontWeight: 700 }}>{h.change ? (h.change > 0 ? '+' : '') + conR2(h.change) + '%' : '\u2014'}</td>
                        <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(h.avg, 2)}</td>
                        <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(h.min, 2)}</td>
                        <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(h.max, 2)}</td>
                        <td style={{ padding: '8px 12px' }}>{h.vendors[0] ? h.vendors[0].vendor + ' (' + conRs(h.vendors[0].avg, 2) + ')' : '\u2014'}</td>
                        <td style={{ padding: '8px 12px' }}>{h.list.length}</td>
                      </tr>
                      {openItem === h.id && (
                        <tr style={{ background: C.panelAlt }}><td colSpan={8} style={{ padding: 12 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                            <thead><tr>{['Date', 'Vendor', 'Invoice', 'Qty', 'Rate', 'PO'].map(x => <th key={x} style={invTh}>{x}</th>)}</tr></thead>
                            <tbody>{h.list.slice().reverse().map(r => (
                              <tr key={r.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                                <td style={{ padding: '5px 12px' }}>{r.date}</td><td style={{ padding: '5px 12px' }}>{r.vendor}</td><td style={{ padding: '5px 12px' }}>{r.invoiceNo || '\u2014'}</td>
                                <td style={{ padding: '5px 12px' }}>{conQty(r.qty)}</td><td style={{ padding: '5px 12px' }}>{conRs(r.rate, 2)}</td><td style={{ padding: '5px 12px' }}>{r.poNumber || 'Direct'}</td>
                              </tr>))}</tbody>
                          </table>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {form && (
        <ConModal title="Create Purchase Order" onClose={() => setForm(false)} width={760}
          footer={<><span style={{ marginRight: 'auto', fontSize: 12.5, color: C.red }}>{err}</span><span style={{ fontSize: 13, fontWeight: 700 }}>Total {conRs(poTotal)}</span><button type="button" style={invBtn} onClick={createPo} data-testid="cp-save">Create</button><button type="button" style={invBtnGhost} onClick={() => setForm(false)}>Cancel</button></>}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 240px' }}><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Vendor *</label>
              <input list="con-vendors" value={vendor} onChange={e => setVendor(e.target.value)} data-testid="cp-vendor" style={Object.assign({}, invInp, { width: '100%' })} /></div>
            <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Delivery date</label><input type="date" value={due} onChange={e => setDue(e.target.value)} style={invInp} /></div>
          </div>
          {fl.map((l, i) => {
            const m = byId[l.itemId]; const last = l.itemId ? lastRate(l.itemId) : 0;
            return (
              <div key={l.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {itemSelect(l.itemId, e => { const mm = byId[e.target.value]; setF(i, { itemId: e.target.value, rate: l.rate || String(lastRate(e.target.value) || (mm ? mm.unit_cost : '') || '') }); })}
                  <input type="number" min="0" placeholder={'Qty' + (m ? ' (' + m.uom + ')' : '')} value={l.qty} onChange={e => setF(i, { qty: e.target.value })} style={Object.assign({}, invInp, { width: 110 })} />
                  <input type="number" min="0" step="0.01" placeholder="Rate" value={l.rate} onChange={e => setF(i, { rate: e.target.value })} style={Object.assign({}, invInp, { width: 110 })} />
                  <button type="button" aria-label="Remove item" onClick={() => setFl(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtext }}><X size={16} /></button>
                </div>
                {m && <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 2 }}>Stock {conQty(m.stock_qty)} {m.uom}{last ? ' - last paid ' + conRs(last, 2) : ' - catalog cost ' + conRs(m.unit_cost, 2)}</div>}
              </div>
            );
          })}
          <button type="button" style={invBtnGhost} onClick={() => setFl(prev => prev.concat([{ id: uid(), itemId: '', qty: '', rate: '' }]))}><Plus size={13} /> Add item</button>
        </ConModal>
      )}
    </InvPageFrame>
  );
}

/* ------------------------------ STORE CONTROL ------------------------------ */
function conUseRates(tx, days) {
  const from = addDaysKey(todayKey(), -days); const out = {};
  tx.forEach(t => {
    if (!CON_USE.includes(t.action)) return;
    const k = isoToLocalKey(t.at); if (!k || k < from) return;
    out[t.consumable_id] = (out[t.consumable_id] || 0) + (Number(t.qty_issued) || 0);
  });
  return out;
}
function ConsumablesStoreTab({ user, setTab }) {
  const { master, setMaster, tx, setTx, pos, setPos, receipts, plan, setPlan, byId } = useConData();
  const [sub, setSub] = useState('planner');
  const [note, setNote] = useState(null);
  const canPost = !!user && canDo(user.role, 'inventory.adjust');
  const [picked, setPicked] = useState({});
  const [poForm, setPoForm] = useState(false);
  const [poVendor, setPoVendor] = useState('');
  const use60 = useMemo(() => conUseRates(tx, 60), [tx]);
  const onOrder = useMemo(() => { const o = {}; pos.filter(conPoOpen).forEach(p => (p.lines || []).forEach(l => { o[l.itemId] = (o[l.itemId] || 0) + Math.max(0, Number(l.qty) - (Number(l.received) || 0)); })); return o; }, [pos]);
  const planned = useMemo(() => master.map(m => {
    const avg = (use60[m.id] || 0) / 60;
    const stock = Number(m.stock_qty) || 0; const min = Number(m.min_stock_level) || 0;
    const lead = Number(((plan.items || {})[m.id] || {}).leadDays) || 7;
    const ord = onOrder[m.id] || 0;
    const cover = avg > 0 ? stock / avg : null;
    let status = 'OK'; let tone = 'green';
    if (stock <= 0) { status = 'Out of stock'; tone = 'red'; }
    else if (cover !== null && cover < lead) { status = 'Critical'; tone = 'red'; }
    else if (stock <= min || (cover !== null && cover < lead + 7)) { status = 'Reorder now'; tone = 'amber'; }
    else if (avg === 0) { status = 'No recent use'; tone = 'default'; }
    let sug = 0;
    if (status === 'Out of stock' || status === 'Critical' || status === 'Reorder now') {
      sug = Math.max(0, avg > 0 ? Math.ceil(avg * (lead + 14) - stock - ord) : Math.ceil(min * 2 - stock - ord));
      if (sug === 0 && ord > 0) { status = 'On order'; tone = 'blue'; }
    }
    return { m, avg, stock, min, lead, ord, cover, status, tone, sug };
  }), [master, use60, onOrder, plan]);
  const urgent = planned.filter(p => p.sug > 0).length;
  const setLead = (id, v) => setPlan(prev => ({ ...prev, items: { ...(prev.items || {}), [id]: { ...((prev.items || {})[id] || {}), leadDays: Number(v) || 0 } } }));
  const sel = planned.filter(p => picked[p.m.id] && p.sug > 0);
  const createPo = () => {
    if (!canPost) { setNote({ ok: false, text: 'Your role cannot create purchase orders.' }); return; }
    if (!poVendor.trim()) { setNote({ ok: false, text: 'Enter the vendor.' }); return; }
    const lastRate = (id) => { const r = receipts.filter(x => x.itemId === id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]; return r ? r.rate : 0; };
    const lines = sel.map(p => ({ id: uid(), itemId: p.m.id, qty: p.sug, rate: lastRate(p.m.id) || Number(p.m.unit_cost) || 0, received: 0 }));
    const maxLead = sel.reduce((t, p) => Math.max(t, p.lead), 7);
    const po = { id: uid(), poNumber: conNextPoNumber(pos), vendor: poVendor.trim(), date: todayKey(), deliveryDate: addDaysKey(todayKey(), maxLead), createdBy: (user && user.name) || '', status: 'Open', lines };
    setPos(prev => [po].concat(prev));
    setPoForm(false); setPicked({}); setPoVendor('');
    setNote({ ok: true, text: 'Purchase order ' + po.poNumber + ' created for ' + lines.length + ' item(s). Open Consumables Purchase to receive it.' });
  };

  /* stock health */
  const health = useMemo(() => {
    const today = todayKey(); const from90 = addDaysKey(today, -90); const from365 = addDaysKey(today, -365);
    const lastUse = {}; const lastAny = {}; const yearValue = {};
    tx.forEach(t => {
      const k = isoToLocalKey(t.at); if (!k) return;
      if (!lastAny[t.consumable_id] || k > lastAny[t.consumable_id]) lastAny[t.consumable_id] = k;
      if (CON_USE.includes(t.action)) {
        if (!lastUse[t.consumable_id] || k > lastUse[t.consumable_id]) lastUse[t.consumable_id] = k;
        if (k >= from365) { const m = byId[t.consumable_id]; if (m) yearValue[m.id] = (yearValue[m.id] || 0) + (Number(t.qty_issued) || 0) * (Number(m.unit_cost) || 0); }
      }
    });
    const totalValue = master.reduce((t, m) => t + (Number(m.stock_qty) || 0) * (Number(m.unit_cost) || 0), 0);
    const dead = master.filter(m => (Number(m.stock_qty) || 0) > 0 && (!lastUse[m.id] || lastUse[m.id] < from90))
      .map(m => ({ m, last: lastAny[m.id] || '', value: (Number(m.stock_qty) || 0) * (Number(m.unit_cost) || 0) })).sort((a, b) => b.value - a.value);
    const abc = master.map(m => ({ m, v: yearValue[m.id] || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const tot = abc.reduce((t, x) => t + x.v, 0); let cum = 0;
    abc.forEach(x => { cum += x.v; x.share = tot ? x.v / tot * 100 : 0; x.cum = tot ? cum / tot * 100 : 0; x.cls = x.cum - x.share < 80 ? 'A' : x.cum - x.share < 95 ? 'B' : 'C'; });
    return { totalValue, dead, deadValue: dead.reduce((t, x) => t + x.value, 0), abc, abcTotal: tot };
  }, [master, tx, byId]);

  /* adjustments */
  const [adj, setAdj] = useState({ itemId: '', type: 'Physical count correction', qty: '', note: '' });
  const [isf, setIsf] = useState({ mode: 'issue', itemId: '', qty: '', dept: CON_DEPTS[0], machine: '', reason: CON_REASONS[0], ref: '', person: '' });
  const issueItems = master.filter(m => !TOOL_CATEGORY_SET.has(m.category));
  const postIssue = () => {
    if (!canPost) { setNote({ ok: false, text: 'Your role is not allowed to issue from the Store.' }); return; }
    const m = byId[isf.itemId]; const q = Number(isf.qty) || 0;
    if (!m) { setNote({ ok: false, text: 'Choose an item.' }); return; }
    if (!(q > 0)) { setNote({ ok: false, text: 'Enter a quantity above zero.' }); return; }
    if (isf.mode === 'issue' && q > (Number(m.stock_qty) || 0)) { setNote({ ok: false, text: 'Only ' + conQty(m.stock_qty) + ' ' + m.uom + ' in stock.' }); return; }
    if (!isf.person.trim()) { setNote({ ok: false, text: isf.mode === 'issue' ? 'Enter who the material was issued to.' : 'Enter who returned it.' }); return; }
    const cc = isf.machine.trim();
    const t = { id: 'TX-' + uid().toUpperCase(), at: new Date().toISOString(), consumable_id: m.id, instance_id: '', machine_id: isf.dept + (cc ? ' / ' + cc : ''), production_order_id: isf.ref.trim(), action: isf.mode === 'issue' ? 'Issued to Dept' : 'Returned to Store', qty_issued: q, department: isf.dept, cost_centre: cc, reason_for_use: isf.reason, issued_to: isf.person.trim(), unit_cost_at_issue: Number(m.unit_cost) || 0, reason_for_removal: 'N/A', by: (user && user.name) || 'Store' };
    setMaster(prev => prev.map(x => x.id === m.id ? Object.assign({}, x, { stock_qty: conR2(Math.max(0, (Number(x.stock_qty) || 0) + (isf.mode === 'issue' ? -q : q))) }) : x));
    setTx(prev => [t].concat(prev));
    setNote({ ok: true, text: (isf.mode === 'issue' ? 'Issued ' : 'Returned ') + conQty(q) + ' ' + m.uom + ' of ' + m.name + ' (' + conRs(q * (Number(m.unit_cost) || 0)) + ').' });
    setIsf(Object.assign({}, isf, { qty: '', ref: '' }));
  };
  const deptLog = tx.filter(t => t.action === 'Issued to Dept' || t.action === 'Returned to Store').sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const deptCost = (t) => (Number(t.qty_issued) || 0) * (Number(t.unit_cost_at_issue) || (byId[t.consumable_id] || {}).unit_cost || 0) * (t.action === 'Returned to Store' ? -1 : 1);
  const deptMonth = (() => { const ym = todayKey().slice(0, 7); const mp = {}; deptLog.forEach(t => { if (isoToLocalKey(t.at).slice(0, 7) !== ym) return; const k = t.department || 'Other'; mp[k] = (mp[k] || 0) + deptCost(t); }); return Object.keys(mp).map(k => ({ k, v: mp[k] })).sort((a, b) => b.v - a.v); })();
  const adjItem = byId[adj.itemId];
  const isCount = adj.type === 'Physical count correction';
  const delta = !adjItem || adj.qty === '' ? 0 : isCount ? (Number(adj.qty) - (Number(adjItem.stock_qty) || 0)) : -Math.abs(Number(adj.qty) || 0);
  const postAdj = () => {
    if (!canPost) { setNote({ ok: false, text: 'Your role cannot adjust stock.' }); return; }
    if (!adjItem) { setNote({ ok: false, text: 'Choose an item.' }); return; }
    if (adj.qty === '' || !(Number(adj.qty) >= 0)) { setNote({ ok: false, text: isCount ? 'Enter the counted quantity.' : 'Enter the quantity.' }); return; }
    if (delta === 0) { setNote({ ok: false, text: 'The counted quantity matches the system. Nothing to adjust.' }); return; }
    if ((Number(adjItem.stock_qty) || 0) + delta < 0) { setNote({ ok: false, text: 'This would take stock below zero.' }); return; }
    if (!isCount && !adj.note.trim()) { setNote({ ok: false, text: 'Add a short note so the loss can be traced.' }); return; }
    setMaster(prev => prev.map(m => m.id === adjItem.id ? Object.assign({}, m, { stock_qty: conR2((Number(m.stock_qty) || 0) + delta) }) : m));
    setTx(prev => [{ id: 'TX-' + uid().toUpperCase(), at: new Date().toISOString(), consumable_id: adjItem.id, instance_id: '', machine_id: 'Store', production_order_id: '', action: 'Stock Adjustment', qty_issued: Math.abs(delta), delta, adjust_type: adj.type, adjust_note: adj.note.trim(), unit_cost_at: Number(adjItem.unit_cost) || 0, reason_for_removal: 'N/A', by: (user && user.name) || 'Store' }].concat(prev));
    setNote({ ok: true, text: 'Stock adjusted by ' + (delta > 0 ? '+' : '') + conQty(delta) + ' ' + adjItem.uom + ' (' + conRs(Math.abs(delta) * (Number(adjItem.unit_cost) || 0)) + ').' });
    setAdj({ itemId: '', type: 'Physical count correction', qty: '', note: '' });
  };
  const adjLog = tx.filter(t => t.action === 'Stock Adjustment').sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const monthKey = todayKey().slice(0, 7);
  const lossByType = {};
  adjLog.filter(t => isoToLocalKey(t.at).slice(0, 7) === monthKey && t.delta < 0).forEach(t => { lossByType[t.adjust_type] = (lossByType[t.adjust_type] || 0) + Math.abs(t.delta) * (Number(t.unit_cost_at) || 0); });
  const lossTotal = Object.values(lossByType).reduce((t, v) => t + v, 0);

  return (
    <InvPageFrame title="Consumables Store" sub="Know what to reorder, what is sitting idle, and where stock is being lost." setTab={setTab}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <ConKpi label="Items to reorder" value={String(urgent)} tone={urgent ? 'red' : 'green'} sub="out, critical or below reorder level" />
        <ConKpi label="Stock value" value={conRs(health.totalValue)} sub="quantity x average cost" />
        <ConKpi label="Idle stock (90 days)" value={conRs(health.deadValue)} tone={health.deadValue > 0 ? 'red' : undefined} sub={health.dead.length + ' item(s) not used'} />
        <ConKpi label="Lost / written off this month" value={conRs(lossTotal)} tone={lossTotal > 0 ? 'red' : 'green'} />
      </div>
      <ConNote note={note} />
      <ConTabs value={sub} onChange={setSub} tabs={[['planner', 'Reorder Planner'], ['health', 'Stock Health'], ['issue', 'Issue to Department'], ['adjust', 'Adjustments & Losses']]} />

      {sub === 'planner' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid ' + C.border, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: C.subtext }}>Daily use is the average of the last 60 days. Suggested quantity covers lead time plus 14 days, minus stock and what is already on order.</div>
            {canPost && <button type="button" style={Object.assign({}, invBtn, { opacity: sel.length ? 1 : 0.5 })} disabled={!sel.length} onClick={() => setPoForm(true)} data-testid="cs-create-po">Create PO for {sel.length} selected</button>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
              <thead><tr style={{ background: C.panelAlt }}>{['', 'Item', 'Stock', 'On order', 'Use / day', 'Days of cover', 'Lead time (days)', 'Status', 'Suggested qty'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
              <tbody>
                {planned.slice().sort((a, b) => (b.sug > 0) - (a.sug > 0) || a.m.name.localeCompare(b.m.name)).map(p => (
                  <tr key={p.m.id} style={{ borderTop: '1px solid ' + C.borderSoft, background: p.tone === 'red' ? C.redSoft : 'transparent' }}>
                    <td style={{ padding: '8px 12px' }}>{p.sug > 0 && <input type="checkbox" checked={!!picked[p.m.id]} onChange={e => setPicked(prev => Object.assign({}, prev, { [p.m.id]: e.target.checked }))} data-testid={'cs-pick-' + p.m.code} />}</td>
                    <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 600 }}>{p.m.name}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{p.m.code}</div></td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{conQty(p.stock)} {p.m.uom}</td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{p.ord ? conQty(p.ord) : '\u2014'}</td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{p.avg ? conR2(p.avg) : '\u2014'}</td>
                    <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: p.cover !== null && p.cover < p.lead ? C.red : C.ink }}>{p.cover === null ? '\u2014' : Math.round(p.cover) + ' d'}</td>
                    <td style={{ padding: '8px 12px' }}><input type="number" min="0" value={p.lead} onChange={e => setLead(p.m.id, e.target.value)} style={Object.assign({}, invInp, { width: 70 })} /></td>
                    <td style={{ padding: '8px 12px' }}><Badge tone={p.tone}>{p.status}</Badge></td>
                    <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{p.sug > 0 ? conQty(p.sug) + ' ' + p.m.uom : '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sub === 'health' && (
        <div>
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>Idle stock - nothing issued in 90 days</div>
            {health.dead.length === 0 ? <EmptyState title="No idle stock" sub="Everything in the store has been used in the last 90 days." /> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['Item', 'Stock', 'Last movement', 'Money tied up'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>{health.dead.map(x => (
                  <tr key={x.m.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                    <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 600 }}>{x.m.name}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{x.m.code}</div></td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{conQty(x.m.stock_qty)} {x.m.uom}</td>
                    <td style={{ padding: '8px 12px', color: C.subtext }}>{x.last || 'Never'}</td>
                    <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{conRs(x.value)}</td>
                  </tr>))}</tbody></table></div>
            )}
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>ABC analysis - consumption value, last 12 months</div>
            {health.abc.length === 0 ? <EmptyState title="Not enough usage yet" sub="Once consumables are issued or scrapped, the items that drive most of the cost appear here." /> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['Class', 'Item', 'Used value', 'Share', 'Cumulative'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>{health.abc.map(x => (
                  <tr key={x.m.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                    <td style={{ padding: '8px 12px' }}><Badge tone={x.cls === 'A' ? 'red' : x.cls === 'B' ? 'amber' : 'default'}>{x.cls}</Badge></td>
                    <td style={{ padding: '8px 12px' }}>{x.m.name}</td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(x.v)}</td>
                    <td style={{ padding: '8px 12px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ConBar pct={x.share} /><span className="font-mono">{conR2(x.share)}%</span></div></td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{conR2(x.cum)}%</td>
                  </tr>))}</tbody></table></div>
            )}
          </Card>
        </div>
      )}

      {sub === 'issue' && (
        <div>
          <Card style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: C.subtext, marginBottom: 10 }}>Issue lubricants, spares and other consumables to a department with a reason and a person, so every rupee can be traced. Tools are tracked in Tooling & Dies and packaging kits in the Packaging audit.</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[['issue', 'Issue to department'], ['return', 'Return to store']].map(mm => <button key={mm[0]} type="button" onClick={() => setIsf(Object.assign({}, isf, { mode: mm[0] }))} style={isf.mode === mm[0] ? invBtn : Object.assign({}, invBtn, { background: '#fff', color: 'var(--neel-accent, #0a6ed1)', border: '1px solid var(--neel-accent, #0a6ed1)' })}>{mm[1]}</button>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Item</label>
                <select value={isf.itemId} onChange={e => setIsf(Object.assign({}, isf, { itemId: e.target.value }))} data-testid="di-item" style={Object.assign({}, invInp, { width: '100%' })}><option value="">Select item</option>{issueItems.map(m => <option key={m.id} value={m.id}>{m.code + ' - ' + m.name}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Quantity{byId[isf.itemId] ? ' (' + byId[isf.itemId].uom + ')' : ''}</label>
                <input type="number" min="0" value={isf.qty} onChange={e => setIsf(Object.assign({}, isf, { qty: e.target.value }))} data-testid="di-qty" style={Object.assign({}, invInp, { width: '100%' })} /></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Department</label>
                <select value={isf.dept} onChange={e => setIsf(Object.assign({}, isf, { dept: e.target.value }))} data-testid="di-dept" style={Object.assign({}, invInp, { width: '100%' })}>{CON_DEPTS.map(d => <option key={d}>{d}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Machine / cost centre</label>
                <input value={isf.machine} onChange={e => setIsf(Object.assign({}, isf, { machine: e.target.value }))} placeholder="e.g. CASC-01" style={Object.assign({}, invInp, { width: '100%' })} /></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Reason</label>
                <select value={isf.reason} onChange={e => setIsf(Object.assign({}, isf, { reason: e.target.value }))} style={Object.assign({}, invInp, { width: '100%' })}>{CON_REASONS.map(d => <option key={d}>{d}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Work order / ticket</label>
                <input value={isf.ref} onChange={e => setIsf(Object.assign({}, isf, { ref: e.target.value }))} style={Object.assign({}, invInp, { width: '100%' })} /></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>{isf.mode === 'issue' ? 'Issued to (person) *' : 'Returned by *'}</label>
                <input value={isf.person} onChange={e => setIsf(Object.assign({}, isf, { person: e.target.value }))} data-testid="di-person" style={Object.assign({}, invInp, { width: '100%' })} /></div>
            </div>
            {byId[isf.itemId] && <div style={{ marginTop: 10, fontSize: 12.5, color: C.subtext }}>In stock: <strong>{conQty(byId[isf.itemId].stock_qty)} {byId[isf.itemId].uom}</strong> - rate {conRs(byId[isf.itemId].unit_cost, 2)} - this {isf.mode === 'issue' ? 'issue' : 'return'}: <strong>{conRs((Number(isf.qty) || 0) * (Number(byId[isf.itemId].unit_cost) || 0))}</strong></div>}
            <div style={{ marginTop: 12 }}><button type="button" style={Object.assign({}, invBtn, { opacity: canPost ? 1 : 0.5 })} onClick={postIssue} data-testid="di-post">{isf.mode === 'issue' ? 'Issue material' : 'Return to store'}</button></div>
          </Card>
          {deptMonth.length > 0 && (
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Cost by department this month</div>
              {deptMonth.map(r => (<div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0', color: C.ink }}><span>{r.k}</span><strong data-testid={'di-dept-' + r.k}>{conRs(r.v)}</strong></div>))}
            </Card>
          )}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {deptLog.length === 0 ? <EmptyState title="No department issues yet" sub="Issues and returns you record above appear here." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
                  <thead><tr style={{ background: C.panelAlt }}>{['Date', 'Type', 'Item', 'Qty', 'Department', 'Machine', 'Reason', 'Person', 'Cost'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                  <tbody>{deptLog.slice(0, 60).map(t => (
                    <tr key={t.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{String(t.at).slice(0, 10)}</td>
                      <td style={{ padding: '8px 12px' }}><Badge tone={t.action === 'Returned to Store' ? 'green' : 'amber'}>{t.action === 'Returned to Store' ? 'Return' : 'Issue'}</Badge></td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{(byId[t.consumable_id] || {}).name || t.consumable_id}</td>
                      <td className="font-mono" style={{ padding: '8px 12px' }}>{conQty(t.qty_issued)}</td>
                      <td style={{ padding: '8px 12px' }}>{t.department}</td>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{t.cost_centre || '\u2014'}</td>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{t.reason_for_use}</td>
                      <td style={{ padding: '8px 12px', color: C.subtext }}>{t.issued_to || '\u2014'}</td>
                      <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{conRs(deptCost(t))}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {sub === 'adjust' && (
        <div>
          <Card style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: C.subtext, marginBottom: 10 }}>Use this after a physical count, or to write off damaged, lost or expired stock. Every adjustment is logged with its value so losses stay visible.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Item</label>
                <select value={adj.itemId} onChange={e => setAdj(Object.assign({}, adj, { itemId: e.target.value }))} data-testid="adj-item" style={Object.assign({}, invInp, { width: 260 })}><option value="">Select item</option>{master.map(m => <option key={m.id} value={m.id}>{m.code + ' - ' + m.name}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Type</label>
                <select value={adj.type} onChange={e => setAdj(Object.assign({}, adj, { type: e.target.value }))} data-testid="adj-type" style={invInp}>{CON_ADJ_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>{isCount ? 'Counted quantity' : 'Quantity lost'}</label>
                <input type="number" min="0" value={adj.qty} onChange={e => setAdj(Object.assign({}, adj, { qty: e.target.value }))} data-testid="adj-qty" style={Object.assign({}, invInp, { width: 120 })} /></div>
              <div style={{ flex: '1 1 200px' }}><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Note{isCount ? '' : ' *'}</label>
                <input value={adj.note} onChange={e => setAdj(Object.assign({}, adj, { note: e.target.value }))} data-testid="adj-note" style={Object.assign({}, invInp, { width: '100%' })} /></div>
              <button type="button" style={Object.assign({}, invBtn, { opacity: canPost ? 1 : 0.5 })} onClick={postAdj} data-testid="adj-post">Post</button>
            </div>
            {adjItem && adj.qty !== '' && <div style={{ marginTop: 8, fontSize: 12.5, color: delta < 0 ? C.red : C.subtext }}>System stock {conQty(adjItem.stock_qty)} {adjItem.uom}. Change: {delta > 0 ? '+' : ''}{conQty(delta)} ({conRs(Math.abs(delta) * (Number(adjItem.unit_cost) || 0))}).</div>}
          </Card>
          {lossTotal > 0 && (
            <Card style={{ padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Losses this month: {conRs(lossTotal)}</div>
              {Object.keys(lossByType).map(k => <div key={k} style={{ fontSize: 12.5, color: C.subtext }}>{k}: <strong>{conRs(lossByType[k])}</strong></div>)}
            </Card>
          )}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>Adjustment log</div>
            {adjLog.length === 0 ? <EmptyState title="No adjustments yet" sub="Counted differences and write-offs will be listed here." /> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead><tr style={{ background: C.panelAlt }}>{['Date', 'Item', 'Type', 'Change', 'Value', 'Note', 'By'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
                <tbody>{adjLog.slice(0, 50).map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                    <td style={{ padding: '8px 12px', color: C.subtext }}>{isoToLocalKey(t.at)}</td>
                    <td style={{ padding: '8px 12px' }}>{(byId[t.consumable_id] || {}).name || 'Deleted item'}</td>
                    <td style={{ padding: '8px 12px' }}>{t.adjust_type}</td>
                    <td className="font-mono" style={{ padding: '8px 12px', color: t.delta < 0 ? C.red : C.green, fontWeight: 700 }}>{t.delta > 0 ? '+' : ''}{conQty(t.delta)}</td>
                    <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(Math.abs(t.delta) * (Number(t.unit_cost_at) || 0))}</td>
                    <td style={{ padding: '8px 12px', color: C.subtext }}>{t.adjust_note || '\u2014'}</td>
                    <td style={{ padding: '8px 12px', color: C.subtext }}>{t.by}</td>
                  </tr>))}</tbody></table></div>
            )}
          </Card>
        </div>
      )}

      {poForm && (
        <ConModal title="Create purchase order from the reorder list" onClose={() => setPoForm(false)} width={560}
          footer={<><button type="button" style={invBtn} onClick={createPo} data-testid="cs-po-save">Create PO</button><button type="button" style={invBtnGhost} onClick={() => setPoForm(false)}>Cancel</button></>}>
          <label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Vendor *</label>
          <input list="con-vendors2" value={poVendor} onChange={e => setPoVendor(e.target.value)} data-testid="cs-po-vendor" style={Object.assign({}, invInp, { width: '100%', marginBottom: 10 })} />
          <datalist id="con-vendors2">{Array.from(new Set(pos.map(p => p.vendor).concat(receipts.map(r => r.vendor)).filter(Boolean))).map(v => <option key={v} value={v} />)}</datalist>
          {sel.map(p => <div key={p.m.id} style={{ fontSize: 13, padding: '3px 0' }}>{p.m.name}: <strong>{conQty(p.sug)} {p.m.uom}</strong></div>)}
        </ConModal>
      )}
    </InvPageFrame>
  );
}

/* ------------------------------ COST ANALYSIS ------------------------------ */
function ConsumablesCostTab({ batches, user, setTab }) {
  const { master, tx, instances, receipts, plan, setPlan, byId } = useConData();
  const [period, setPeriod] = useState('this');
  const canTarget = !!user && ['Admin', 'Manager', 'Owner'].includes(user.role);
  const months = conPeriodMonths(period);
  const inP = useMemo(() => conPeriodTest(period), [period]);
  const goodKg = months ? months.reduce((t, m) => t + conGoodKg(batches, m), 0) : conGoodKg(batches, null);
  const targets = plan.targets || {};

  const rows = useMemo(() => {
    const out = [];
    tx.forEach(t => {
      const m = byId[t.consumable_id]; if (!m) return;
      const isTool = TOOL_CATEGORY_SET.has(m.category);
      let q = 0; let kind = '';
      if (t.action === 'Issued for Packing' && !isTool) { q = Number(t.qty_issued) || 0; kind = 'Packaging'; }
      else if (t.action === 'Returned' && !isTool) { q = -(Number(t.qty_issued) || 0); kind = 'Packaging'; }
      else if (t.action === 'Scrapped' && isTool) { q = Number(t.qty_issued) || 1; kind = 'Tools'; }
      else if (t.action === 'Issued to Dept' && !isTool) { q = Number(t.qty_issued) || 0; kind = 'Department issue'; }
      else if (t.action === 'Returned to Store' && !isTool) { q = -(Number(t.qty_issued) || 0); kind = 'Department issue'; }
      else return;
      const cost = Number(m.unit_cost) || 0;
      const over = t.action === 'Issued for Packing' && t.std_qty !== undefined ? Math.max(0, (Number(t.qty_issued) || 0) - (Number(t.std_qty) || 0)) * cost : 0;
      out.push({ key: isoToLocalKey(t.at), item: m, q, value: q * cost, kind, machine: t.machine_id || 'Store', over });
    });
    return out;
  }, [tx, byId]);
  const pr = rows.filter(r => inP(r.key));
  const consumed = pr.reduce((t, r) => t + r.value, 0);
  const perKg = goodKg > 0 ? consumed / goodKg : null;
  const purchases = receipts.filter(r => inP(String(r.date || isoToLocalKey(r.at)))).reduce((t, r) => t + r.qty * r.rate, 0);
  const stockValue = master.reduce((t, m) => t + (Number(m.stock_qty) || 0) * (Number(m.unit_cost) || 0), 0);
  const overIssue = pr.reduce((t, r) => t + r.over, 0);
  const losses = tx.filter(t => t.action === 'Stock Adjustment' && t.delta < 0 && inP(isoToLocalKey(t.at))).reduce((t, x) => t + Math.abs(x.delta) * (Number(x.unit_cost_at) || 0), 0);

  const group = (keyFn) => {
    const map = {}; pr.forEach(r => { const k = keyFn(r); map[k] = (map[k] || 0) + r.value; });
    return Object.keys(map).map(k => ({ k, v: map[k] })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  };
  const byCat = group(r => r.item.category); const byMachine = group(r => r.machine);
  const byItem = group(r => r.item.id).map(x => Object.assign({}, x, { item: byId[x.k] }));
  let cum = 0; byItem.forEach(x => { x.share = consumed ? x.v / consumed * 100 : 0; x.cls = cum < 80 ? 'A' : cum < 95 ? 'B' : 'C'; cum += x.share; });

  const trend = useMemo(() => {
    const ym = todayKey().slice(0, 7); const list = [];
    for (let i = 5; i >= 0; i--) {
      const m = conMonthShift(ym, -i);
      const c = rows.filter(r => r.key.slice(0, 7) === m).reduce((t, r) => t + r.value, 0);
      const kg = conGoodKg(batches, m);
      const p = receipts.filter(r => String(r.date || isoToLocalKey(r.at)).slice(0, 7) === m).reduce((t, r) => t + r.qty * r.rate, 0);
      list.push({ m, consumed: c, kg, perKg: kg > 0 ? c / kg : null, purchases: p });
    }
    return list;
  }, [rows, receipts, batches]);
  const maxConsumed = trend.reduce((t, x) => Math.max(t, x.consumed), 1);
  const thisMonthConsumed = rows.filter(r => r.key.slice(0, 7) === todayKey().slice(0, 7)).reduce((t, r) => t + r.value, 0);

  const toolLife = useMemo(() => instances.filter(i => i.status === 'Scrapped').map(i => {
    const cat = byId[i.consumable_master_id]; if (!cat) return null;
    const ev = (i.history || []).slice().reverse().find(h => String(h.action).indexOf('Scrapped') === 0);
    const date = ev ? ev.at : '';
    const reason = ev ? (String(ev.action).match(/\((.*)\)/) || [])[1] || 'N/A' : 'N/A';
    const tm = Number(cat.target_life_meters) || 0; const tk = Number(cat.target_life_kg) || 0;
    const life = tm > 0 ? (Number(i.total_meters_run) || 0) / tm : tk > 0 ? (Number(i.total_kg_run) || 0) / tk : 1;
    const premature = life < 0.8 && ['Normal Wear', 'Scheduled Changeover'].indexOf(reason) === -1;
    return { id: i.id, cat, date, reason, life, premature, loss: premature ? (1 - Math.min(1, life)) * (Number(cat.unit_cost) || 0) : 0 };
  }).filter(Boolean).filter(x => !x.date || inP(x.date)), [instances, byId, inP]);
  const toolLoss = toolLife.reduce((t, x) => t + x.loss, 0);

  const insights = [];
  if (targets.perKg > 0 && perKg !== null) {
    const gap = (perKg / targets.perKg - 1) * 100;
    insights.push({ tone: gap > 0 ? 'red' : 'green', text: 'Consumables cost ' + conRs(perKg, 2) + ' per kg against a target of ' + conRs(targets.perKg, 2) + ' (' + (gap > 0 ? conR2(gap) + '% over' : conR2(-gap) + '% under') + ').' });
  }
  if (byCat[0] && consumed > 0) insights.push({ tone: 'amber', text: byCat[0].k + ' is the biggest cost at ' + conRs(byCat[0].v) + ' (' + Math.round(byCat[0].v / consumed * 100) + '% of consumables cost).' });
  const aItems = byItem.filter(x => x.cls === 'A');
  if (aItems.length) insights.push({ tone: 'amber', text: aItems.length + ' item(s) make up about 80% of the cost: ' + aItems.slice(0, 4).map(x => x.item.name).join(', ') + '. Negotiate rates and control issues on these first.' });
  if (overIssue > 0) insights.push({ tone: 'red', text: 'Packaging was issued ' + conRs(overIssue) + ' above standard. Check the Packaging BOM variance for the lines concerned.' });
  if (toolLoss > 0) insights.push({ tone: 'red', text: toolLoss > 0 ? 'Tools scrapped before their expected life cost ' + conRs(toolLoss) + '. Look at breakage and damage causes.' : '' });
  const hikes = [];
  const recMap = {}; receipts.forEach(r => { (recMap[r.itemId] = recMap[r.itemId] || []).push(r); });
  Object.keys(recMap).forEach(id => {
    const l = recMap[id].slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (l.length > 1 && l[l.length - 2].rate > 0 && l[l.length - 1].rate > l[l.length - 2].rate * 1.05 && byId[id]) hikes.push(byId[id].name + ' ' + conRs(l[l.length - 2].rate, 2) + ' to ' + conRs(l[l.length - 1].rate, 2) + ' (' + l[l.length - 1].vendor + ')');
  });
  if (hikes.length) insights.push({ tone: 'red', text: 'Price increase on the last purchase: ' + hikes.slice(0, 3).join('; ') + '.' });
  let vendorSaving = 0;
  Object.keys(recMap).forEach(id => {
    const vend = {}; recMap[id].forEach(r => { const v = vend[r.vendor] = vend[r.vendor] || { q: 0, v: 0 }; v.q += r.qty; v.v += r.qty * r.rate; });
    const avgs = Object.values(vend).filter(v => v.q > 0).map(v => v.v / v.q);
    if (avgs.length < 2) return;
    const best = Math.min.apply(null, avgs);
    recMap[id].filter(r => inP(String(r.date || isoToLocalKey(r.at)))).forEach(r => { if (r.rate > best) vendorSaving += (r.rate - best) * r.qty; });
  });
  if (vendorSaving > 0) insights.push({ tone: 'green', text: 'Buying everything from the cheapest vendor for each item would have saved about ' + conRs(vendorSaving) + ' in this period.' });
  if (losses > 0) insights.push({ tone: 'red', text: conRs(losses) + ' of stock was lost, damaged or written off in this period.' });
  const idle = master.filter(m => (Number(m.stock_qty) || 0) > 0).reduce((t, m) => {
    const from90 = addDaysKey(todayKey(), -90);
    const used = tx.some(x => x.consumable_id === m.id && CON_USE.includes(x.action) && isoToLocalKey(x.at) >= from90);
    return used ? t : t + (Number(m.stock_qty) || 0) * (Number(m.unit_cost) || 0);
  }, 0);
  if (idle > 0) insights.push({ tone: 'amber', text: conRs(idle) + ' is tied up in consumables not used for 90 days. Stop buying these and consider returning or reusing them.' });
  if (!insights.length) insights.push({ tone: 'default', text: 'Insights will appear once consumables are bought and issued. Start by recording receipts in Consumables Purchase.' });

  const setTarget = (k, v) => setPlan(prev => ({ ...prev, targets: { ...(prev.targets || {}), [k]: Number(v) || 0 } }));
  const exportAll = () => exportToExcel('consumables-cost.xlsx', {
    'By item': byItem.map(x => ({ Class: x.cls, Code: x.item.code, Item: x.item.name, Category: x.item.category, Cost: Math.round(x.v), 'Share %': conR2(x.share) })),
    'By category': byCat.map(x => ({ Category: x.k, Cost: Math.round(x.v) })),
    Trend: trend.map(x => ({ Month: x.m, 'Good output kg': Math.round(x.kg), 'Consumed Rs': Math.round(x.consumed), 'Rs per kg': x.perKg === null ? '' : conR2(x.perKg), 'Purchases Rs': Math.round(x.purchases) })),
  });
  const labels = { this: 'This month', last: 'Last month', q3: 'Last 3 months', year: 'This year', all: 'All time' };
  return (
    <InvPageFrame title="Consumables Cost Analysis" sub="Where the consumables money goes, how it compares with your target, and where to save." setTab={setTab}
      right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={period} onChange={e => setPeriod(e.target.value)} data-testid="cc-period" style={invInp}>{Object.keys(labels).map(k => <option key={k} value={k}>{labels[k]}</option>)}</select>
        {byItem.length > 0 && <ExportButton label="Export" onExport={exportAll} />}</div>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <ConKpi label="Consumables used" value={conRs(consumed)} sub="packaging issued + tools scrapped" />
        <ConKpi label="Cost per kg good output" value={perKg === null ? '\u2014' : conRs(perKg, 2)} tone={targets.perKg > 0 && perKg !== null ? (perKg > targets.perKg ? 'red' : 'green') : undefined} sub={goodKg > 0 ? Math.round(goodKg).toLocaleString('en-IN') + ' kg produced' : 'no output recorded'} />
        <ConKpi label="Purchases" value={conRs(purchases)} sub="from goods receipts" />
        <ConKpi label="Stock value" value={conRs(stockValue)} />
        <ConKpi label="Over-issue vs standard" value={conRs(overIssue)} tone={overIssue > 0 ? 'red' : 'green'} />
      </div>

      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Targets</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Target cost per kg (Rs)</label>
            <input type="number" min="0" step="0.01" defaultValue={targets.perKg || ''} disabled={!canTarget} onBlur={e => setTarget('perKg', e.target.value)} data-testid="cc-target-kg" style={Object.assign({}, invInp, { width: 140 })} /></div>
          <div><label style={{ display: 'block', fontSize: 11.5, color: C.subtext, marginBottom: 3 }}>Monthly budget (Rs)</label>
            <input type="number" min="0" defaultValue={targets.monthlyBudget || ''} disabled={!canTarget} onBlur={e => setTarget('monthlyBudget', e.target.value)} data-testid="cc-target-budget" style={Object.assign({}, invInp, { width: 160 })} /></div>
          {targets.monthlyBudget > 0 && (
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 12, color: thisMonthConsumed > targets.monthlyBudget ? C.red : C.subtext }}>This month: {conRs(thisMonthConsumed)} of {conRs(targets.monthlyBudget)} ({Math.round(thisMonthConsumed / targets.monthlyBudget * 100)}%)</div>
              <div style={{ background: C.borderSoft, borderRadius: 4, height: 10, marginTop: 4 }}><div style={{ width: Math.min(100, thisMonthConsumed / targets.monthlyBudget * 100) + '%', background: thisMonthConsumed > targets.monthlyBudget ? C.red : thisMonthConsumed > targets.monthlyBudget * 0.85 ? C.amber : C.green, height: 10, borderRadius: 4 }} /></div>
            </div>
          )}
          {!canTarget && <div style={{ fontSize: 12, color: C.subtext }}>Only Admin, Manager or Owner can change targets.</div>}
        </div>
      </Card>

      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>What to act on</div>
        {insights.map((x, i) => (
          <div key={i} data-testid="cc-insight" style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 13, color: C.ink, borderTop: i ? '1px solid ' + C.borderSoft : 'none' }}>
            <span style={{ color: x.tone === 'red' ? C.red : x.tone === 'green' ? C.green : C.amber, fontWeight: 700 }}>{x.tone === 'green' ? '\u2713' : '\u25CF'}</span><span>{x.text}</span>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>Last 6 months</div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
          <thead><tr style={{ background: C.panelAlt }}>{['Month', 'Good output', 'Used', '', 'Cost / kg', 'Purchases'].map((h, i) => <th key={i} style={invTh}>{h}</th>)}</tr></thead>
          <tbody>{trend.map(x => (
            <tr key={x.m} style={{ borderTop: '1px solid ' + C.borderSoft }}>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{x.m}</td>
              <td className="font-mono" style={{ padding: '8px 12px' }}>{x.kg ? Math.round(x.kg).toLocaleString('en-IN') + ' kg' : '\u2014'}</td>
              <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(x.consumed)}</td>
              <td style={{ padding: '8px 12px' }}><ConBar pct={x.consumed / maxConsumed * 100} /></td>
              <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700, color: targets.perKg > 0 && x.perKg !== null ? (x.perKg > targets.perKg ? C.red : C.green) : C.ink }}>{x.perKg === null ? '\u2014' : conRs(x.perKg, 2)}</td>
              <td className="font-mono" style={{ padding: '8px 12px' }}>{conRs(x.purchases)}</td>
            </tr>))}</tbody></table></div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
        {[['By category', byCat], ['By machine / line', byMachine]].map(sec => (
          <Card key={sec[0]} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>{sec[0]}</div>
            {sec[1].length === 0 ? <EmptyState title="No cost in this period" /> : sec[1].map(x => (
              <div key={x.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid ' + C.borderSoft, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{x.k}</span><ConBar pct={consumed ? x.v / consumed * 100 : 0} /><span className="font-mono" style={{ width: 90, textAlign: 'right', fontWeight: 700 }}>{conRs(x.v)}</span>
              </div>))}
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>Cost by item (A = about 80% of the cost)</div>
        {byItem.length === 0 ? <EmptyState title="No consumption in this period" sub="Packaging issues and scrapped tools appear here." /> : (
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
            <thead><tr style={{ background: C.panelAlt }}>{['Class', 'Item', 'Category', 'Cost', 'Share'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
            <tbody>{byItem.map(x => (
              <tr key={x.k} style={{ borderTop: '1px solid ' + C.borderSoft }}>
                <td style={{ padding: '8px 12px' }}><Badge tone={x.cls === 'A' ? 'red' : x.cls === 'B' ? 'amber' : 'default'}>{x.cls}</Badge></td>
                <td style={{ padding: '8px 12px' }}>{x.item.name}</td><td style={{ padding: '8px 12px', color: C.subtext }}>{x.item.category}</td>
                <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{conRs(x.v)}</td>
                <td style={{ padding: '8px 12px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ConBar pct={x.share} /><span className="font-mono">{conR2(x.share)}%</span></div></td>
              </tr>))}</tbody></table></div>
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + C.border, fontSize: 14, fontWeight: 700 }}>Scrapped tools - life achieved{toolLoss > 0 ? ' (early scrap cost ' + conRs(toolLoss) + ')' : ''}</div>
        {toolLife.length === 0 ? <EmptyState title="No scrapped tools in this period" /> : (
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead><tr style={{ background: C.panelAlt }}>{['Tool', 'Item', 'Scrapped', 'Reason', 'Life achieved', 'Early-scrap loss'].map(h => <th key={h} style={invTh}>{h}</th>)}</tr></thead>
            <tbody>{toolLife.map(x => (
              <tr key={x.id} style={{ borderTop: '1px solid ' + C.borderSoft, background: x.premature ? C.redSoft : 'transparent' }}>
                <td className="font-mono" style={{ padding: '8px 12px', fontWeight: 700 }}>{x.id}</td><td style={{ padding: '8px 12px' }}>{x.cat.name}</td>
                <td style={{ padding: '8px 12px', color: C.subtext }}>{x.date || '\u2014'}</td><td style={{ padding: '8px 12px' }}>{x.reason}</td>
                <td className="font-mono" style={{ padding: '8px 12px', color: x.premature ? C.red : C.ink, fontWeight: 700 }}>{Math.round(x.life * 100)}%</td>
                <td className="font-mono" style={{ padding: '8px 12px' }}>{x.loss ? conRs(x.loss) : '\u2014'}</td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
    </InvPageFrame>
  );
}

`;
if (/`/.test(MODULE)) { console.error('Internal error: module contains a backtick.'); process.exit(3); }

/* ---------------- wiring ---------------- */
replaceOnce('module anchor', 'function MaterialDocsTab(', MODULE + 'function MaterialDocsTab(');

const CON_COST_ROLES = "['Admin', 'Owner', 'Manager', 'Assistant Manager', 'Store', 'RM & Supply Chain Manager', 'PPC Manager']";
replaceOnce('nav entries',
  "      { key: 'analyzestock', label: 'Analyze Stock in Date Range', icon: TrendingUp, hidden: true },\n",
  "      { key: 'analyzestock', label: 'Analyze Stock in Date Range', icon: TrendingUp, hidden: true },\n" +
  "      { key: 'conpurchase', label: 'Consumables Purchase', icon: ClipboardList, hidden: true, roles: " + CON_COST_ROLES + " },\n" +
  "      { key: 'constore', label: 'Consumables Store', icon: Boxes, hidden: true, roles: " + CON_COST_ROLES + " },\n" +
  "      { key: 'concost', label: 'Consumables Cost Analysis', icon: TrendingUp, hidden: true, roles: " + CON_COST_ROLES + " },\n");

// BOM / MRP is not needed: hide it from the sidebar and from the Inventory Management tiles
replaceOnce('hide BOM / MRP in sidebar', "{ key: 'bomMrp', label: 'BOM / MRP', icon: Layers },", "{ key: 'bomMrp', label: 'BOM / MRP', icon: Layers, hidden: true },");
replaceOnce('remove BOM tile',
  "    { title: 'Material Planning', tiles: [\n      { tab: 'bomMrp', title: 'BOM / MRP', sub: 'Bill of Materials & Requirements' },\n    ] },\n", '');
replaceOnce('consumables section first',
  "  invhub: { label: 'Inventory Management', sections: [\n",
  "  invhub: { label: 'Inventory Management', sections: [\n" +
  "    { title: 'Consumables Cost Control', tiles: [\n" +
  "      { tab: 'concost', title: 'Consumables Cost Analysis', sub: 'Cost per kg & Savings' },\n" +
  "      { tab: 'conpurchase', title: 'Consumables Purchase', sub: 'Orders, Receipts & Prices' },\n" +
  "      { tab: 'constore', title: 'Consumables Store', sub: 'Reorder, Issue & Losses' },\n" +
  "    ] },\n");

replaceOnce('inventory space match', "'deadstock', 'slowmoving', 'analyzestock'", "'deadstock', 'slowmoving', 'analyzestock', 'conpurchase', 'constore', 'concost'");

{
  const re = /^( *)\{tab === 'analyzestock' && <AnalyzeStockTab[^\n]*\n/m;
  const m = s.match(re);
  if (!m) missing.push('analyzestock route');
  else {
    const ind = m[1];
    s = s.replace(m[0], m[0] +
      ind + "{tab === 'conpurchase' && <ConsumablesPurchaseTab user={user} setTab={setTab} />}\n" +
      ind + "{tab === 'constore' && <ConsumablesStoreTab user={user} setTab={setTab} />}\n" +
      ind + "{tab === 'concost' && <ConsumablesCostTab batches={batches} user={user} setTab={setTab} />}\n");
  }
}

if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.con.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Consumables module patched  ->  ' + file);
console.log('Backup                      ->  ' + file + '.con.bak');
