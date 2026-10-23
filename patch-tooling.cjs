#!/usr/bin/env node
/**
 * NEEL Suite Cloud - Tooling & Dies patch
 *
 *   node patch-tooling.cjs                 -> patches ./src/App.jsx
 *   node patch-tooling.cjs path/to/App.jsx
 *
 * 1. Tooling Lifecycle: "Delete" button on every serialized tool (with a confirmation box)
 * 2. Master Catalog (consumables_master): Edit + Delete on every item (bobbins, pallets, dies...)
 *    Returnable Bobbins & Pallets: Edit (everything) + Delete on every record
 * 3. Packaging BOM & Variance Audit: now calculated automatically from the LWC / PCC / CTL
 *    packing records (pallets / boxes), with pending kit issue, one-click issue and an item-wise audit.
 *    The old manual calculator stays below as "Manual Kit Issue".
 * All-or-nothing. Backup: App.jsx.tool.bak
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('NEEL_TOOLING_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

/* ------------------------------------------------------------------ */
/* module-level helpers (before ToolingTab)                            */
/* ------------------------------------------------------------------ */
const HELPERS = String.raw`/* NEEL_TOOLING_V1 */
function TlModal({ title, onClose, children, footer, width }) {
  return (
    <div role="dialog" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(' + (width || 560) + 'px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.border, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</div>
        <div style={{ padding: 16, overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '10px 18px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}
function tlShiftKey(key, n) {
  const p = String(key).split('-').map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2] - n);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
const tlNum = (v) => Math.round((Number(v) || 0) * 100) / 100;
const tlRupee = (v) => '\u20B9' + Math.round(Number(v) || 0).toLocaleString('en-IN');

`;

/* ------------------------------------------------------------------ */
/* state, handlers and automatic packaging logic                       */
/* ------------------------------------------------------------------ */
const LOGIC = String.raw`  // ---- Tooling & packaging additions: delete / edit, automatic packing consumption ----
  const handleDeleteInstance = (inst) => {
    setInstances(prev => prev.filter(x => x.id !== inst.id));
    if (onDeleteDie) onDeleteDie(inst.id);
    setDelInst(null);
  };

  const openEditCat = (item) => setEditCat({
    id: item.id, oldCode: item.code, code: item.code, name: item.name, category: item.category, applies_to: item.applies_to,
    target_life_meters: String(item.target_life_meters || ''), target_life_kg: String(item.target_life_kg || ''),
    standard_qty_per_unit: String(item.standard_qty_per_unit || ''), unit_cost: String(item.unit_cost || ''),
    min_stock_level: String(item.min_stock_level || ''), stock_qty: String(item.stock_qty === undefined ? '' : item.stock_qty),
    uom: item.uom || 'pcs', err: '',
  });
  const saveEditCat = () => {
    const f = editCat; if (!f) return;
    const code = f.code.trim().toUpperCase();
    if (!code || !f.name.trim()) { setEditCat({ ...f, err: 'Code and description are required.' }); return; }
    if (masterList.some(m => m.id !== f.id && String(m.code).toUpperCase() === code)) { setEditCat({ ...f, err: 'Another catalog item already uses the code ' + code + '.' }); return; }
    setMasterList(prev => prev.map(m => m.id === f.id ? {
      ...m, code, name: f.name.trim(), category: f.category, applies_to: f.applies_to,
      target_life_meters: Number(f.target_life_meters) || 0, target_life_kg: Number(f.target_life_kg) || 0,
      standard_qty_per_unit: Number(f.standard_qty_per_unit) || 0, unit_cost: Number(f.unit_cost) || 0,
      min_stock_level: Number(f.min_stock_level) || 0, stock_qty: Number(f.stock_qty) || 0, uom: f.uom || 'pcs',
    } : m));
    // returnable records keep pointing at the item when its code or name changes
    setReturnables(prev => prev.map(r => r.assetCode === f.oldCode ? { ...r, assetCode: code, assetName: f.name.trim() } : r));
    setEditCat(null);
  };
  const catUsage = (item) => ({
    tools: instances.filter(i => i.consumable_master_id === item.id).length,
    returnables: returnables.filter(r => r.assetCode === item.code).length,
    txs: transactions.filter(t => t.consumable_id === item.id).length,
  });
  const confirmDeleteCat = () => {
    if (!delCat) return;
    if (catUsage(delCat).tools > 0) return;
    setMasterList(prev => prev.filter(m => m.id !== delCat.id));
    setDelCat(null);
  };

  const openEditRet = (r) => setEditRet({
    id: r.id, customer: r.customer, assetCode: r.assetCode, origCode: r.assetCode,
    sentQty: String(r.sentQty), returnedQty: String(r.returnedQty), origReturned: Number(r.returnedQty) || 0,
    lastUpdated: r.lastUpdated || todayKey(), adjustStock: true, err: '',
  });
  const saveEditRet = () => {
    const f = editRet; if (!f) return;
    const sent = Number(f.sentQty); const ret = Number(f.returnedQty);
    if (!f.customer.trim()) { setEditRet({ ...f, err: 'Enter the customer name.' }); return; }
    if (!(sent >= 0) || !(ret >= 0)) { setEditRet({ ...f, err: 'Quantities must be zero or more.' }); return; }
    if (ret > sent) { setEditRet({ ...f, err: 'Returned quantity cannot be more than the quantity sent out.' }); return; }
    if (returnables.some(r => r.id !== f.id && String(r.customer).toLowerCase() === f.customer.trim().toLowerCase() && r.assetCode === f.assetCode)) {
      setEditRet({ ...f, err: 'A record for this customer and asset already exists. Edit that one instead.' }); return;
    }
    const cat = masterList.find(m => m.code === f.assetCode);
    setReturnables(prev => prev.map(r => r.id === f.id ? {
      ...r, customer: f.customer.trim(), assetCode: f.assetCode, assetName: cat ? cat.name : r.assetName,
      sentQty: sent, returnedQty: ret, lastUpdated: f.lastUpdated || todayKey(),
    } : r));
    const delta = ret - f.origReturned;
    if (f.adjustStock && delta !== 0 && cat && f.assetCode === f.origCode) {
      setMasterList(prev => prev.map(m => m.id === cat.id ? { ...m, stock_qty: Math.max(0, (Number(m.stock_qty) || 0) + delta) } : m));
      setTransactions(prev => [{
        id: 'TX-' + uid().toUpperCase(), at: new Date().toISOString(), consumable_id: cat.id, instance_id: '',
        machine_id: 'Customer Return', production_order_id: f.customer.trim(), action: delta > 0 ? 'Returned' : 'Return Corrected',
        qty_issued: Math.abs(delta), reason_for_removal: 'N/A', by: (user && user.name) || 'Store',
      }, ...prev]);
    }
    setEditRet(null);
  };
  const confirmDeleteRet = () => {
    if (!delRet) return;
    setReturnables(prev => prev.filter(r => r.id !== delRet.id));
    setDelRet(null);
  };

  // --- Automatic packing consumption: packing records x standard BOM ---
  const bomFor = (line) => masterList.filter(m =>
    !TOOL_CATEGORY_SET.has(m.category) &&
    Number(m.standard_qty_per_unit) > 0 &&
    (m.applies_to === line || m.applies_to === 'All' || (line === 'LWC' && m.applies_to === 'PKG-02 (LWC)') || (line === 'PCC' && m.applies_to === 'PKG-01 (PCC)'))
  );
  const pkInPeriod = (key) => {
    const t = todayKey();
    if (pkPeriod === 'all') return true;
    if (pkPeriod === 'today') return key === t;
    if (pkPeriod === 'week') return key >= tlShiftKey(t, 6) && key <= t;
    return String(key).slice(0, 7) === t.slice(0, 7);
  };
  const pkSkipped = packSettings.skipped || [];
  const issuedBatchIds = useMemo(() => new Set(transactions.filter(t => t.action === 'Issued for Packing' && t.batch_id).map(t => t.batch_id)), [transactions]);
  const packedBatches = useMemo(() => batches
    .filter(b => b && b.flow && b.flow.packing && b.flow.packing.packedAt && ['LWC', 'PCC', 'CTL'].includes(b.route))
    .map(b => {
      const pk = b.flow.packing;
      return {
        b, line: b.route, at: pk.packedAt, key: isoToLocalKey(pk.packedAt), units: Number(pk.packUnits) || 0, kg: Number(pk.packedQty) || 0,
        station: pk.station || '', label: pk.packUnitLabel || (b.route === 'LWC' ? 'pallets' : 'boxes'), orderNo: b.productionOrderNo || b.batchCode || b.id,
      };
    })
    .sort((a, c) => String(c.at).localeCompare(String(a.at))), [batches]);
  const pkAll = packedBatches.map(p => {
    const kit = bomFor(p.line).map(item => ({ item, std: tlNum(p.units * Number(item.standard_qty_per_unit)) }));
    return { ...p, kit, issued: issuedBatchIds.has(p.b.id), skipped: pkSkipped.includes(p.b.id), stdCost: kit.reduce((t, k) => t + k.std * (Number(k.item.unit_cost) || 0), 0) };
  });
  const pkReady = (p) => !p.issued && !p.skipped && p.units > 0 && p.kit.length > 0;
  const pkRows = pkAll.filter(p => pkInPeriod(p.key));
  const pkPendingRows = pkRows.filter(pkReady);
  const pkLines = ['LWC', 'PCC', 'CTL'].map(line => {
    const rows = pkRows.filter(p => p.line === line && !p.skipped);
    return {
      line, batches: rows.length, units: rows.reduce((t, p) => t + p.units, 0), kg: rows.reduce((t, p) => t + p.kg, 0),
      cost: rows.reduce((t, p) => t + p.stdCost, 0), pending: rows.filter(pkReady).length, label: line === 'LWC' ? 'pallets' : 'boxes',
    };
  }).filter(l => l.line !== 'CTL' || l.batches > 0);
  const pkAudit = (() => {
    const map = {};
    const ens = (item) => { if (!map[item.id]) map[item.id] = { item, expected: 0, pending: 0, issued: 0, issuedStd: 0 }; return map[item.id]; };
    pkRows.filter(p => !p.skipped).forEach(p => p.kit.forEach(k => { const r = ens(k.item); r.expected += k.std; if (!p.issued) r.pending += k.std; }));
    transactions.forEach(t => {
      if (t.action !== 'Issued for Packing' || !pkInPeriod(isoToLocalKey(t.at))) return;
      const item = masterById[t.consumable_id]; if (!item) return;
      const r = ens(item); const q = Number(t.qty_issued) || 0;
      r.issued += q; r.issuedStd += t.std_qty !== undefined ? (Number(t.std_qty) || 0) : q;
    });
    return Object.values(map).map(r => {
      const variance = tlNum(r.issued - r.issuedStd);
      return { ...r, expected: tlNum(r.expected), pending: tlNum(r.pending), issued: tlNum(r.issued), variance, pct: r.issuedStd > 0 ? variance / r.issuedStd * 100 : 0, costImpact: variance * (Number(r.item.unit_cost) || 0) };
    }).sort((a, b) => b.costImpact - a.costImpact);
  })();
  const pkTotalImpact = pkAudit.reduce((t, r) => t + r.costImpact, 0);

  const buildKitIssue = (p, actuals) => {
    const txs = []; const deduct = {}; let alerts = 0;
    p.kit.forEach(k => {
      const rawV = actuals ? actuals[k.item.id] : undefined;
      const act = rawV !== undefined && rawV !== '' ? Number(rawV) : k.std;
      if (!(act >= 0)) return;
      if (act > k.std * 1.05) alerts++;
      deduct[k.item.id] = (deduct[k.item.id] || 0) + act;
      txs.push({
        id: 'TX-' + uid().toUpperCase(), at: new Date().toISOString(), consumable_id: k.item.id, instance_id: '',
        machine_id: p.line === 'LWC' ? 'PKG-02 (LWC)' : p.line === 'PCC' ? 'PKG-01 (PCC)' : 'Packing',
        production_order_id: String(p.orderNo), batch_id: p.b.id, line: p.line, packed_units: p.units,
        action: 'Issued for Packing', qty_issued: act, std_qty: k.std, variance_qty: tlNum(act - k.std),
        reason_for_removal: act > k.std ? 'Over-consumption Variance' : 'N/A', by: (user && user.name) || 'Packing / Store',
      });
    });
    return { txs, deduct, alerts };
  };
  const issueKits = (list, actualsByBatch) => {
    let allTxs = []; const deduct = {}; let alerts = 0;
    list.forEach(p => {
      const r = buildKitIssue(p, actualsByBatch ? actualsByBatch[p.b.id] : null);
      allTxs = allTxs.concat(r.txs); alerts += r.alerts;
      Object.keys(r.deduct).forEach(id => { deduct[id] = (deduct[id] || 0) + r.deduct[id]; });
    });
    if (!allTxs.length) return;
    setMasterList(prev => prev.map(m => deduct[m.id] !== undefined ? { ...m, stock_qty: Math.max(0, (Number(m.stock_qty) || 0) - deduct[m.id]) } : m));
    setTransactions(prev => allTxs.concat(prev));
    setPackActuals({}); setOpenPack(null);
    setPackAuditMsg(alerts > 0
      ? '\u26A0\uFE0F Kit issued for ' + list.length + ' packing record(s) with ' + alerts + ' over-consumption alert(s).'
      : '\u2705 Kit issued for ' + list.length + ' packing record(s) and deducted from Stores.');
    setTimeout(() => setPackAuditMsg(''), 6000);
  };
  const skipPacking = (ids) => setPackSettings(prev => ({ ...prev, skipped: Array.from(new Set((prev.skipped || []).concat(ids))) }));
  const unskipPacking = (id) => setPackSettings(prev => ({ ...prev, skipped: (prev.skipped || []).filter(x => x !== id) }));

`;

/* ------------------------------------------------------------------ */
/* JSX                                                                 */
/* ------------------------------------------------------------------ */
const AUTO_JSX = String.raw`          {/* NEEL_TOOLING_V1: automatic packing consumption */}
          <Card style={{ marginBottom: 16, borderLeft: '4px solid ' + C.green }}>
            <SectionTitle sub="Worked out automatically from the pallets / boxes that Packing records when a batch is finished. Nothing to type.">
              Automatic Packing Consumption (LWC, PCC and Straight Tube)
            </SectionTitle>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <SelectField label="Period" options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'This month' }, { value: 'all', label: 'All time' }]} value={pkPeriod} onChange={e => setPkPeriod(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
              {pkLines.map(l => (
                <div key={l.line} data-testid={'pk-line-' + l.line} style={{ border: '1px solid ' + C.border, borderRadius: 10, padding: 12, background: C.panel }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.subtext, textTransform: 'uppercase' }}>{l.line === 'CTL' ? 'Straight Tube (CTL)' : l.line} packing</div>
                  <div className="font-mono" style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 4 }}>{l.units} {l.label}</div>
                  <div style={{ fontSize: 12, color: C.subtext }}>{l.batches} batch(es) - {Math.round(l.kg).toLocaleString('en-IN')} kg</div>
                  <div style={{ fontSize: 12.5, color: C.ink, marginTop: 6 }}>Expected packaging cost: <strong>{tlRupee(l.cost)}</strong></div>
                  <div style={{ fontSize: 12, color: l.pending ? C.amber : C.green, fontWeight: 600, marginTop: 2 }}>{l.pending ? l.pending + ' kit(s) not issued yet' : 'All kits issued'}</div>
                </div>
              ))}
              {pkLines.every(l => l.batches === 0) && <div style={{ fontSize: 13, color: C.subtext, padding: 8 }}>No packing records in this period yet.</div>}
            </div>
            <details style={{ fontSize: 13, color: C.subtext }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: C.ink }}>How this works</summary>
              <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
                <li>Packing finishes a batch and enters the number of pallets (LWC) or boxes (PCC, Straight Tube).</li>
                <li>Each material in the Master Catalog has a standard quantity per pallet / box (Std BOM Qty). Units packed x Std BOM = what the kit should use.</li>
                <li>The kit shows below as "not issued yet". The Store confirms the real quantity (pre-filled with the standard) and issues it. Stores stock goes down.</li>
                <li>The audit compares what Store actually issued with the standard. More than 5% over is flagged as an over-consumption alert.</li>
                <li>Bobbins and pallets are returnable: when the customer sends them back, record it under A2 and Stores stock goes up again.</li>
              </ol>
            </details>
          </Card>

          <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid ' + C.border }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Packed batches ({pkRows.length})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button disabled={pkPendingRows.length === 0} onClick={() => issueKits(pkPendingRows, null)} style={{ padding: '6px 12px', fontSize: 12.5 }}>Issue all {pkPendingRows.length} pending kit(s) at standard</Button>
                <Button variant="secondary" disabled={pkRows.filter(p => !p.issued && !p.skipped && p.key < todayKey()).length === 0} onClick={() => skipPacking(pkRows.filter(p => !p.issued && !p.skipped && p.key < todayKey()).map(p => p.b.id))} style={{ padding: '6px 12px', fontSize: 12.5 }}>Skip pending before today</Button>
              </div>
            </div>
            {packAuditMsg && <div style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, color: packAuditMsg.includes('\u26A0') ? C.red : C.green }}>{packAuditMsg}</div>}
            {pkRows.length === 0 ? <EmptyState title="No packed batches in this period" sub="Batches appear here as soon as Packing finishes them." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                  <thead><tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                    {['Packed on', 'Line', 'Order / Batch', 'Packed', 'Expected kit cost', 'Kit status', 'Action'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {pkRows.map(p => {
                      const open = openPack === p.b.id;
                      const status = p.skipped ? ['Skipped', 'default'] : p.issued ? ['Issued', 'green'] : p.units <= 0 ? ['No pallet / box count', 'red'] : p.kit.length === 0 ? ['No BOM for this line', 'default'] : ['Not issued yet', 'amber'];
                      return (
                        <React.Fragment key={p.b.id}>
                          <tr style={{ borderTop: '1px solid ' + C.borderSoft }}>
                            <td style={{ padding: '10px 14px', color: C.subtext }}>{p.key}</td>
                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.line}</td>
                            <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700, color: C.copperDark }}>{p.orderNo}{p.station ? <div style={{ fontSize: 11, color: C.faint, fontWeight: 400 }}>{p.station}</div> : null}</td>
                            <td className="font-mono" style={{ padding: '10px 14px' }}>{p.units} {p.label}<div style={{ fontSize: 11, color: C.faint }}>{Math.round(p.kg).toLocaleString('en-IN')} kg</div></td>
                            <td className="font-mono" style={{ padding: '10px 14px' }}>{tlRupee(p.stdCost)}</td>
                            <td style={{ padding: '10px 14px' }}><Badge tone={status[1]}>{status[0]}</Badge></td>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {pkReady(p) && <Button style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => issueKits([p], null)}>Issue at standard</Button>}
                                {pkReady(p) && <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setOpenPack(open ? null : p.b.id)}>{open ? 'Close' : 'Enter actual'}</Button>}
                                {pkReady(p) && <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => skipPacking([p.b.id])}>Skip</Button>}
                                {p.skipped && <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => unskipPacking(p.b.id)}>Undo skip</Button>}
                              </div>
                            </td>
                          </tr>
                          {open && pkReady(p) && (
                            <tr style={{ background: C.panelAlt }}>
                              <td colSpan={7} style={{ padding: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                                  {p.kit.map(k => {
                                    const v = packActuals[p.b.id] && packActuals[p.b.id][k.item.id];
                                    const over = v !== undefined && v !== '' && Number(v) > k.std * 1.05;
                                    return (
                                      <div key={k.item.id} style={{ border: '1px solid ' + (over ? C.red : C.border), borderRadius: 8, padding: 10, background: '#fff' }}>
                                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{k.item.name}</div>
                                        <div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{k.item.code} - Store stock {k.item.stock_qty} {k.item.uom}</div>
                                        <div style={{ fontSize: 12, color: C.subtext, margin: '4px 0' }}>Standard: <strong>{k.std} {k.item.uom}</strong></div>
                                        <input type="number" step="0.01" min="0" value={v !== undefined ? v : k.std} onChange={e => setPackActuals(prev => ({ ...prev, [p.b.id]: { ...(prev[p.b.id] || {}), [k.item.id]: e.target.value } }))}
                                          style={{ width: 110, padding: '6px 8px', borderRadius: 6, border: '1px solid ' + (over ? C.red : C.border), fontWeight: 600 }} />
                                      </div>
                                    );
                                  })}
                                </div>
                                <div style={{ marginTop: 10 }}><Button onClick={() => issueKits([p], packActuals)}>Issue kit with these quantities</Button></div>
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

          <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid ' + C.border }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Item-wise variance audit</div>
              <div style={{ fontSize: 13, color: pkTotalImpact > 0 ? C.red : C.green, fontWeight: 700 }}>
                {pkTotalImpact > 0 ? 'Over standard by ' + tlRupee(pkTotalImpact) : pkTotalImpact < 0 ? 'Under standard by ' + tlRupee(-pkTotalImpact) : 'On standard'}
              </div>
            </div>
            {pkAudit.length === 0 ? <EmptyState title="Nothing to audit yet" sub="The audit fills in once Packing finishes batches and Store issues kits." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                  <thead><tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                    {['Item', 'Expected from packing', 'Issued by Store', 'Not issued yet', 'Variance', 'Cost impact', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {pkAudit.map(r => {
                      const st = r.issued === 0 ? (r.pending > 0 ? ['Not issued yet', 'amber'] : ['No activity', 'default']) : Math.abs(r.pct) <= 5 ? ['On standard', 'green'] : r.pct > 0 ? ['Over +' + tlNum(r.pct) + '%', 'red'] : ['Under ' + tlNum(r.pct) + '%', 'blue'];
                      return (
                        <tr key={r.item.id} style={{ borderTop: '1px solid ' + C.borderSoft, background: st[1] === 'red' ? C.redSoft : 'transparent' }}>
                          <td style={{ padding: '10px 14px' }}><div style={{ fontWeight: 600 }}>{r.item.name}{RETURNABLE_CATEGORY_SET.has(r.item.category) ? <span style={{ marginLeft: 6 }}><Badge tone="blue">Returnable</Badge></span> : null}</div><div className="font-mono" style={{ fontSize: 11, color: C.faint }}>{r.item.code}</div></td>
                          <td className="font-mono" style={{ padding: '10px 14px' }}>{r.expected} {r.item.uom}</td>
                          <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700 }}>{r.issued} {r.item.uom}</td>
                          <td className="font-mono" style={{ padding: '10px 14px', color: r.pending ? C.amber : C.subtext }}>{r.pending} {r.item.uom}</td>
                          <td className="font-mono" style={{ padding: '10px 14px', color: r.variance > 0 ? C.red : r.variance < 0 ? C.blue : C.subtext }}>{r.variance > 0 ? '+' : ''}{r.variance} {r.item.uom}</td>
                          <td className="font-mono" style={{ padding: '10px 14px' }}>{r.costImpact === 0 ? '\u2014' : (r.costImpact > 0 ? '+' : '-') + tlRupee(Math.abs(r.costImpact))}</td>
                          <td style={{ padding: '10px 14px' }}><Badge tone={st[1]}>{st[0]}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

`;

const MODALS_JSX = String.raw`
      {delInst && (
        <TlModal title={'Delete tool ' + delInst.id + '?'} onClose={() => setDelInst(null)}
          footer={<><Button variant="secondary" onClick={() => setDelInst(null)}>Cancel</Button><Button variant="danger" onClick={() => handleDeleteInstance(delInst)} data-testid="tool-delete-confirm">Delete tool</Button></>}>
          <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6 }}>
            This removes <strong>{delInst.id}</strong> ({(masterById[delInst.consumable_master_id] || {}).code || 'tool'}, {delInst.status}) and its wear history from the register.
            Past store transactions stay in the log. This cannot be undone.
          </div>
        </TlModal>
      )}
      {editCat && (
        <TlModal title={'Edit catalog item ' + editCat.oldCode} onClose={() => setEditCat(null)} width={720}
          footer={<><span style={{ marginRight: 'auto', fontSize: 12.5, color: C.red }}>{editCat.err}</span><Button variant="secondary" onClick={() => setEditCat(null)}>Cancel</Button><Button onClick={saveEditCat} data-testid="cat-save">Save changes</Button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <TextField label="Item Code" value={editCat.code} onChange={e => setEditCat({ ...editCat, code: e.target.value })} />
            <TextField label="Item Description" value={editCat.name} onChange={e => setEditCat({ ...editCat, name: e.target.value })} />
            <SelectField label="Category" options={allCategories} value={editCat.category} onChange={e => setEditCat({ ...editCat, category: e.target.value })} />
            <SelectField label="Applies To" options={allAppliesTo} value={editCat.applies_to} onChange={e => setEditCat({ ...editCat, applies_to: e.target.value })} />
            <TextField label="Target Life Meters (Tools)" type="number" value={editCat.target_life_meters} onChange={e => setEditCat({ ...editCat, target_life_meters: e.target.value })} />
            <TextField label="Target Life kg (Tools)" type="number" value={editCat.target_life_kg} onChange={e => setEditCat({ ...editCat, target_life_kg: e.target.value })} />
            <TextField label="Std Qty per Pallet / Box (Packaging)" type="number" step="0.01" value={editCat.standard_qty_per_unit} onChange={e => setEditCat({ ...editCat, standard_qty_per_unit: e.target.value })} />
            <TextField label="Unit Cost (INR)" type="number" value={editCat.unit_cost} onChange={e => setEditCat({ ...editCat, unit_cost: e.target.value })} />
            <TextField label="Min Stock Level (Reorder)" type="number" value={editCat.min_stock_level} onChange={e => setEditCat({ ...editCat, min_stock_level: e.target.value })} />
            <TextField label="Store Stock" type="number" value={editCat.stock_qty} onChange={e => setEditCat({ ...editCat, stock_qty: e.target.value })} />
            <SelectField label="UOM" options={['pcs', 'kg', 'liters', 'rolls', 'sets']} value={editCat.uom} onChange={e => setEditCat({ ...editCat, uom: e.target.value })} />
          </div>
        </TlModal>
      )}
      {delCat && (() => {
        const u = catUsage(delCat);
        return (
          <TlModal title={'Delete ' + delCat.code + '?'} onClose={() => setDelCat(null)}
            footer={<><Button variant="secondary" onClick={() => setDelCat(null)}>{u.tools > 0 ? 'Close' : 'Cancel'}</Button>{u.tools === 0 && <Button variant="danger" onClick={confirmDeleteCat} data-testid="cat-delete-confirm">Delete item</Button>}</>}>
            <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6 }}>
              {u.tools > 0 ? (
                <span><strong>{delCat.code}</strong> cannot be deleted: {u.tools} serialized tool(s) use it. Delete or re-assign those tools first.</span>
              ) : (
                <span>
                  Remove <strong>{delCat.code}</strong> - {delCat.name} from the Master Catalog?
                  {u.returnables > 0 ? ' ' + u.returnables + ' returnable record(s) mention it and will keep their text.' : ''}
                  {u.txs > 0 ? ' ' + u.txs + ' past store transaction(s) stay in the log.' : ''} This cannot be undone.
                </span>
              )}
            </div>
          </TlModal>
        );
      })()}
      {editRet && (
        <TlModal title="Edit returnable record" onClose={() => setEditRet(null)} width={640}
          footer={<><span style={{ marginRight: 'auto', fontSize: 12.5, color: C.red }}>{editRet.err}</span><Button variant="secondary" onClick={() => setEditRet(null)}>Cancel</Button><Button onClick={saveEditRet} data-testid="ret-save">Save changes</Button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <TextField label="Customer Name" value={editRet.customer} onChange={e => setEditRet({ ...editRet, customer: e.target.value })} />
            <SelectField label="Returnable Asset"
              options={masterList.filter(m => RETURNABLE_CATEGORY_SET.has(m.category) || m.code === editRet.assetCode).map(m => ({ value: m.code, label: m.code + ' - ' + m.name }))}
              value={editRet.assetCode} onChange={e => setEditRet({ ...editRet, assetCode: e.target.value })} />
            <TextField label="Sent Out (pcs)" type="number" min="0" value={editRet.sentQty} onChange={e => setEditRet({ ...editRet, sentQty: e.target.value })} />
            <TextField label="Returned for Reuse (pcs)" type="number" min="0" value={editRet.returnedQty} onChange={e => setEditRet({ ...editRet, returnedQty: e.target.value })} />
            <TextField label="Last Updated" type="date" value={editRet.lastUpdated} onChange={e => setEditRet({ ...editRet, lastUpdated: e.target.value })} />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13, color: C.ink }}>
            <input type="checkbox" checked={editRet.adjustStock} onChange={e => setEditRet({ ...editRet, adjustStock: e.target.checked })} />
            Also change Store stock by the difference in returned quantity ({(Number(editRet.returnedQty) || 0) - editRet.origReturned >= 0 ? '+' : ''}{(Number(editRet.returnedQty) || 0) - editRet.origReturned})
          </label>
        </TlModal>
      )}
      {delRet && (
        <TlModal title="Delete returnable record?" onClose={() => setDelRet(null)}
          footer={<><Button variant="secondary" onClick={() => setDelRet(null)}>Cancel</Button><Button variant="danger" onClick={confirmDeleteRet} data-testid="ret-delete-confirm">Delete record</Button></>}>
          <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6 }}>
            Remove the record for <strong>{delRet.customer}</strong> - {delRet.assetCode} (sent {delRet.sentQty}, returned {delRet.returnedQty})? Store stock is not changed. This cannot be undone.
          </div>
        </TlModal>
      )}
`;

/* ------------------------------------------------------------------ */
/* WIRING                                                              */
/* ------------------------------------------------------------------ */
replaceOnce('ToolingTab anchor', 'function ToolingTab({', HELPERS + 'function ToolingTab({');

replaceOnce('state: delInst',
  "  const [reboreModal, setReboreModal] = useState(null); // { instance, newSize: '', notes: '' }\n",
  "  const [reboreModal, setReboreModal] = useState(null); // { instance, newSize: '', notes: '' }\n  const [delInst, setDelInst] = useState(null);\n");
replaceOnce('state: packaging',
  "  const [packAuditMsg, setPackAuditMsg] = useState('');\n",
  "  const [packAuditMsg, setPackAuditMsg] = useState('');\n  const [pkPeriod, setPkPeriod] = useState('month');\n  const [openPack, setOpenPack] = useState(null);\n  const [packActuals, setPackActuals] = useState({});\n  const [packSettings, setPackSettings] = useSyncedStore('ctpm:packaging_settings', { skipped: [] });\n");
replaceOnce('state: returnables',
  "  const [retForm, setRetForm] = useState({ customer: '', assetCode: 'PK-LWC-BOBBIN', type: 'dispatch', qty: '', ref: '' });\n",
  "  const [retForm, setRetForm] = useState({ customer: '', assetCode: 'PK-LWC-BOBBIN', type: 'dispatch', qty: '', ref: '' });\n  const [editRet, setEditRet] = useState(null);\n  const [delRet, setDelRet] = useState(null);\n");
replaceOnce('state: catalog',
  "  const [newAppliesInput, setNewAppliesInput] = useState('');\n",
  "  const [newAppliesInput, setNewAppliesInput] = useState('');\n  const [editCat, setEditCat] = useState(null);\n  const [delCat, setDelCat] = useState(null);\n");

replaceOnce('logic anchor', '  // Handlers: Returnable Bobbins & Pallets\n', LOGIC + '  // Handlers: Returnable Bobbins & Pallets\n');

// 1. delete tool
replaceOnce('delete tool button',
  "                                Scrap\n                              </Button>\n                            </div>\n                          )}\n",
  "                                Scrap\n                              </Button>\n                              <Button variant=\"secondary\" data-testid={'tool-delete-' + inst.id} style={{ padding: '5px 10px', fontSize: 12, color: C.red }} onClick={() => setDelInst(inst)}>Delete</Button>\n                            </div>\n                          )}\n                          {inst.status === 'Scrapped' && (\n                            <Button variant=\"secondary\" data-testid={'tool-delete-' + inst.id} style={{ padding: '5px 10px', fontSize: 12, color: C.red }} onClick={() => setDelInst(inst)}>Delete</Button>\n                          )}\n");

// 2. returnable rows
replaceOnce('returnables header',
  "                  <th style={thStyle}>Last Updated</th>\n                </tr>",
  "                  <th style={thStyle}>Last Updated</th>\n                  <th style={thStyle}>Actions</th>\n                </tr>");
replaceOnce('returnables row',
  "                      <td style={{ padding: '10px 14px', color: C.faint }}>{r.lastUpdated}</td>\n                    </tr>",
  "                      <td style={{ padding: '10px 14px', color: C.faint }}>{r.lastUpdated}</td>\n" +
  "                      <td style={{ padding: '10px 14px' }}>\n" +
  "                        <div style={{ display: 'flex', gap: 6 }}>\n" +
  "                          <Button variant=\"secondary\" data-testid={'ret-edit-' + r.id} style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => openEditRet(r)}>Edit</Button>\n" +
  "                          <Button variant=\"secondary\" data-testid={'ret-delete-' + r.id} style={{ padding: '5px 10px', fontSize: 12, color: C.red }} onClick={() => setDelRet(r)}>Delete</Button>\n" +
  "                        </div>\n" +
  "                      </td>\n                    </tr>");

// 3. catalog rows
replaceOnce('catalog header',
  "                    <th style={thStyle}>Min Reorder</th>\n                  </tr>",
  "                    <th style={thStyle}>Min Reorder</th>\n                    <th style={thStyle}>Actions</th>\n                  </tr>");
replaceOnce('catalog row',
  "                        <td className=\"font-mono\" style={{ padding: '10px 14px', color: C.subtext }}>{item.min_stock_level} {item.uom}</td>\n                      </tr>",
  "                        <td className=\"font-mono\" style={{ padding: '10px 14px', color: C.subtext }}>{item.min_stock_level} {item.uom}</td>\n" +
  "                        <td style={{ padding: '10px 14px' }}>\n" +
  "                          <div style={{ display: 'flex', gap: 6 }}>\n" +
  "                            <Button variant=\"secondary\" data-testid={'cat-edit-' + item.code} style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => openEditCat(item)}>Edit</Button>\n" +
  "                            <Button variant=\"secondary\" data-testid={'cat-delete-' + item.code} style={{ padding: '5px 10px', fontSize: 12, color: C.red }} onClick={() => setDelCat(item)}>Delete</Button>\n" +
  "                          </div>\n" +
  "                        </td>\n                      </tr>");

// 4. packaging tab
replaceOnce('packaging tab open',
  "      {subTab === 'packaging' && (\n        <div>\n          <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.copper}` }}>",
  "      {subTab === 'packaging' && (\n        <div>\n" + AUTO_JSX + "          <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.copper}` }}>");
replaceOnce('manual calculator title',
  "              Line-Specific Packing Kit & Store Variance Calculator\n",
  "              Manual Kit Issue (only for packing that has no record above)\n");
replaceOnce('manual calculator sub',
  'sub="Automatically calculates expected packaging consumption from standard BOM ratios and flags Store variance alerts if actual issues exceed standard."',
  'sub="Use this for rework, samples or packing that was not recorded on the shop floor. Enter the units packed and the real issue."');

// 5. modals at the end of ToolingTab
{
  const start = s.indexOf('function ToolingTab({');
  const end = s.indexOf('\n    </div>\n  );\n}\n', start);
  const nextFn = s.indexOf('\nfunction ', start + 20);
  if (start === -1 || end === -1 || (nextFn !== -1 && end > nextFn)) missing.push('end of ToolingTab');
  else s = s.slice(0, end) + '\n' + MODALS_JSX.replace(/\n$/, '') + s.slice(end);
}

if (/`/.test(HELPERS + LOGIC + AUTO_JSX + MODALS_JSX)) { console.error('Internal error: inserted code contains a backtick.'); process.exit(3); }

if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.tool.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Tooling patched  ->  ' + file);
console.log('Backup           ->  ' + file + '.tool.bak');
