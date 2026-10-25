#!/usr/bin/env node
/**
 * NEEL Suite Cloud - Home for every login + professional Customer master
 * Run AFTER patch-neel, patch-hubs and patch-phase3.
 *
 *   node patch-home-customers.cjs                 -> patches ./src/App.jsx
 *   node patch-home-customers.cjs path/to/App.jsx
 *
 * 1. Home page for EVERY role (Quality, PPC Manager, Store, ...): To-Dos, Apps (Favorites / Most Used /
 *    Recently Used / Recommended), Recap and My Home Settings. Everyone lands on Home after login.
 *    (The Customer role keeps its own restricted view.)
 * 2. Recap is now a real, person-specific summary: what needs your attention and what changed since you
 *    last opened Home - only for the areas your role can see.
 * 3. Master > Customers: a proper table layout (Customer | Delivery locations | GSTIN | Actions),
 *    GSTIN shown with its state, GSTIN can be edited, and the bug that dropped the GSTIN when adding a
 *    customer is fixed.
 * All-or-nothing. Backup: App.jsx.home.bak
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('NEEL_HOME_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
for (const [marker, name] of [['neel_home_fav_titles', 'patch-neel.cjs'], ['NEEL_HUBS_V1', 'patch-hubs.cjs'], ['NEEL_PHASE3_V1', 'patch-phase3.cjs']]) {
  if (!s.includes(marker)) { console.error('Run ' + name + ' first. Nothing was changed.'); process.exit(2); }
}

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

/* ================================================================== */
/* 1. HOME FOR EVERY ROLE                                              */
/* ================================================================== */
// Home is visible to every signed-in person except the restricted Customer role
replaceOnce('canSeeTab: home for all',
  "  return canDo(user.role, `tab.${key}`);\n}\nfunction visibleTabs(user)",
  "  if (key === 'launchpad') return user.role !== 'Customer';   // NEEL_HOME_V1: Home is for everyone\n  return canDo(user.role, `tab.${key}`);\n}\nfunction visibleTabs(user)");
// ...so it is no longer a switch in Team & Roles, and not a second sidebar entry next to "My Home"
replaceOnce('FEATURES without home', "...NAV.filter(n => !SPACE_HUBS[n.key]).map(", "...NAV.filter(n => !SPACE_HUBS[n.key] && n.key !== 'launchpad').map(");
replaceOnce('hide duplicate sidebar entry', "{ key: 'launchpad', label: 'Executive Dashboard', icon: LayoutGrid },", "{ key: 'launchpad', label: 'Executive Dashboard', icon: LayoutGrid, hidden: true },");
// everyone lands on Home right after signing in
replaceOnce('land on home',
  "  useEffect(() => { if (user && !canSeeTab(user, tab)) setTab(firstVisibleTab(user)); });\n",
  "  useEffect(() => { if (user && !canSeeTab(user, tab)) setTab(firstVisibleTab(user)); });\n  useEffect(() => { if (user && canSeeTab(user, 'launchpad')) setTab('launchpad'); }, [user && user.name]);\n");

/* ================================================================== */
/* 2. RECAP                                                            */
/* ================================================================== */
replaceOnce('recap session store',
  "function HorizonMyHome({",
  "const NEEL_SESSION_PREV = {};\nconst NEEL_SESSION_SAVED = {};\nfunction HorizonMyHome({");
replaceOnce('home props', "batches, maintenanceLogs, pullRequests, onOpenSettings,", "batches, maintenanceLogs, pullRequests, onOpenSettings, orders, rawItems,");
replaceOnce('recap state',
  "  const [addOpen, setAddOpen] = useState(false);\n",
  "  const [addOpen, setAddOpen] = useState(false);\n  const [recapOpen, setRecapOpen] = useState(false);\n");

const RECAP_LOGIC = String.raw`  // ---- Recap: what needs this person's attention and what changed since they last opened Home ----
  const sessKey = String((user && user.name) || '').toLowerCase();
  if (!(sessKey in NEEL_SESSION_PREV)) NEEL_SESSION_PREV[sessKey] = (prefs && prefs.lastSeen) || null;
  const prevSeen = NEEL_SESSION_PREV[sessKey];
  const sinceIso = prevSeen || new Date(Date.now() - 86400000).toISOString();
  useEffect(() => {
    if (onSavePref && sessKey && !NEEL_SESSION_SAVED[sessKey]) { NEEL_SESSION_SAVED[sessKey] = true; onSavePref({ lastSeen: new Date().toISOString() }); }
  }, []);
  const recapItems = [];
  const recapAdd = (tabKey, text, tone) => { if (canSeeTab(user, tabKey)) recapItems.push({ tab: tabKey, text, tone: tone || 'default' }); };
  const sinceDay = sinceIso.slice(0, 10);
  const packedSince = (batches || []).filter(b => b && b.flow && b.flow.packing && b.flow.packing.packedAt && b.flow.packing.packedAt >= sinceIso);
  if (packedSince.length) recapAdd('quality', packedSince.length + ' lot' + (packedSince.length > 1 ? 's' : '') + ' packed (' + Math.round(packedSince.reduce((t, b) => t + (Number(b.flow.packing.packedQty) || 0), 0)).toLocaleString('en-IN') + ' kg)', 'blue');
  const runsDone = (batches || []).filter(b => b && b.flow && b.flow.machine && b.flow.machine.endedAt && b.flow.machine.endedAt >= sinceIso);
  if (runsDone.length) recapAdd('stages', runsDone.length + ' machine run' + (runsDone.length > 1 ? 's' : '') + ' finished', 'blue');
  const raised = (maintenanceLogs || []).filter(m => m.occurredAt && m.occurredAt >= sinceIso);
  if (raised.length) recapAdd('maintenance', raised.length + ' breakdown' + (raised.length > 1 ? 's' : '') + ' reported', 'red');
  const resolved = (maintenanceLogs || []).filter(m => m.resolvedAt && m.resolvedAt >= sinceIso);
  if (resolved.length) recapAdd('maintenance', resolved.length + ' breakdown' + (resolved.length > 1 ? 's' : '') + ' resolved', 'green');
  const newOrders = (orders || []).filter(o => String(o.orderDate || '') >= sinceDay);
  if (newOrders.length) recapAdd('orders', newOrders.length + ' new order' + (newOrders.length > 1 ? 's' : '') + ' booked', 'blue');
  const lowRaw = (rawItems || []).filter(r => Number(r.qty) <= Number(r.reorderLevel));
  if (lowRaw.length) recapAdd('inventory', lowRaw.length + ' raw material' + (lowRaw.length > 1 ? 's' : '') + ' at or below the reorder level', 'amber');
  const recapToneColor = { red: C.red, amber: C.amber, green: C.green, blue: C.blue, copper: C.copper, default: C.subtext };
`;
replaceOnce('recap logic', "  const allAppsBase = [", RECAP_LOGIC + "\n  const allAppsBase = [");

// the Recap button opens the recap instead of jumping to the production report
{
  const a = s.indexOf('function HorizonMyHome({');
  const b = s.indexOf('function HomePage(', a);
  if (a === -1 || b === -1) missing.push('HorizonMyHome region');
  else {
    const seg = s.slice(a, b);
    if (!seg.includes("onClick={() => setTab('dpr')}")) missing.push('recap button');
    else s = s.slice(0, a) + seg.replace("onClick={() => setTab('dpr')}", "onClick={() => setRecapOpen(true)}") + s.slice(b);
  }
}
const RECAP_MODAL = String.raw`      {recapOpen && (
        <div role="dialog" aria-label="Recap" onClick={() => setRecapOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(560px, 100%)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Your recap, {displayFirst}</div>
              <div style={{ fontSize: 12, color: C.subtext, marginTop: 2 }}>{user && user.role ? user.role + ' - ' : ''}since {prevSeen ? new Date(prevSeen).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'yesterday'}</div>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.subtext, textTransform: 'uppercase', marginBottom: 6 }}>Needs your attention</div>
              {todos.length === 0 ? <div style={{ fontSize: 13, color: C.green, marginBottom: 14 }}>Nothing is waiting for you.</div> : (
                <div style={{ marginBottom: 14 }}>{todos.map(t => (
                  <button key={t.id} type="button" onClick={() => { setRecapOpen(false); setTab(t.tab); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid ' + C.border, borderLeft: '4px solid ' + (recapToneColor[t.tone] || C.subtext), borderRadius: 8, padding: '8px 12px', marginBottom: 8, cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: C.subtext }}>{t.sub}</div>
                  </button>))}</div>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: C.subtext, textTransform: 'uppercase', marginBottom: 6 }}>What changed</div>
              {recapItems.length === 0 ? <div style={{ fontSize: 13, color: C.subtext }}>Nothing new in your areas since then.</div> : recapItems.map((r, i) => (
                <button key={i} type="button" onClick={() => { setRecapOpen(false); setTab(r.tab); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid ' + C.borderSoft, padding: '9px 2px', cursor: 'pointer', fontSize: 13, color: C.ink }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: recapToneColor[r.tone] || C.subtext, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{r.text}</span>
                  <ChevronRight size={14} color={C.faint} />
                </button>))}
            </div>
            <div style={{ padding: '10px 18px', borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRecapOpen(false)} style={{ background: 'var(--neel-accent, #0a6ed1)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
`;
replaceOnce('recap modal', "      {addOpen && (\n", RECAP_MODAL + "      {addOpen && (\n");

/* ================================================================== */
/* 3. CUSTOMER MASTER                                                  */
/* ================================================================== */
// fix: the GSTIN typed in the form (or imported) was thrown away by customerAdd
replaceOnce('customerAdd signature', "function customerAdd(customers, { name, locations = [] }, newId = uid) {", "function customerAdd(customers, { name, locations = [], gstin = '' }, newId = uid) {");
replaceOnce('customerAdd store gstin',
  "  if (existing) { existing.active = true; existing.locations = mdCleanLocations([...existing.locations, ...locs]); return { customers: list, id: existing.id, reactivated: true }; }\n  const c = { id: newId(), name: n, locations: locs, active: true };",
  "  const g = mdName(gstin).toUpperCase();\n  if (existing) { existing.active = true; existing.locations = mdCleanLocations([...existing.locations, ...locs]); if (g) existing.gstin = g; return { customers: list, id: existing.id, reactivated: true }; }\n  const c = { id: newId(), name: n, locations: locs, gstin: g, active: true };");

const CUSTOMER_ROW = String.raw`const GST_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
(function neelCustomerCss() {
  if (typeof document === 'undefined' || document.getElementById('neel-cust-css')) return;
  const el = document.createElement('style');
  el.id = 'neel-cust-css';
  el.textContent = '.neel-cust-grid{display:grid;grid-template-columns:minmax(200px,1.1fr) minmax(260px,2fr) minmax(200px,1fr) auto;gap:18px;align-items:start}' +
    '@media (max-width: 900px){.neel-cust-grid{grid-template-columns:1fr}.neel-cust-head{display:none!important}}';
  document.head.appendChild(el);
})();
function CustomerListHead() {
  const h = { fontSize: 11, fontWeight: 700, color: C.subtext, textTransform: 'uppercase', letterSpacing: 0.4 };
  return (
    <div className="neel-cust-grid neel-cust-head" style={{ padding: '10px 16px', background: C.panelAlt, borderBottom: '1px solid ' + C.borderSoft }}>
      <div style={h}>Customer</div><div style={h}>Delivery locations</div><div style={h}>GSTIN</div><div style={Object.assign({}, h, { textAlign: 'right' })}>Actions</div>
    </div>
  );
}
function MasterCustomerRow({ c, used, linked, customers, commit, setMsg }) {
  const [editing, setEditing] = useState(false), [nm, setNm] = useState(c.name), [loc, setLoc] = useState('');
  const [editG, setEditG] = useState(false), [gs, setGs] = useState(c.gstin || '');
  const off = c.active === false;
  const gOk = !!c.gstin && GSTIN_RE.test(String(c.gstin).toUpperCase());
  const stateName = c.gstin ? GST_STATES[String(c.gstin).slice(0, 2)] : '';
  const initials = String(c.name || '?').split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
  const doRename = () => {
    if (commit(customerRename(customers, c.id, nm), { field: c.name, from: c.name, to: mdName(nm) })) {
      setEditing(false);
      setMsg(linked ? 'Renamed. ' + linked + ' Customer login' + (linked === 1 ? ' is' : 's are') + ' linked to the old name - update ' + (linked === 1 ? 'it' : 'them') + ' in Team & Roles. Old orders keep the old name.' : 'Renamed. Old orders keep the old name.');
    }
  };
  const saveG = () => {
    const g = mdName(gs).toUpperCase();
    const next = (customers || []).map(x => x.id === c.id ? Object.assign({}, x, { gstin: g }) : x);
    if (commit({ customers: next }, { field: c.name, from: c.gstin ? 'GSTIN ' + c.gstin : 'no GSTIN', to: g ? 'GSTIN ' + g : 'no GSTIN' })) { setEditG(false); setMsg(g ? 'GSTIN saved.' : 'GSTIN removed.'); }
  };
  const link = { background: 'none', border: 'none', color: C.steel, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 };
  const label = { fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 };
  return (
    <div data-testid={'md-customer-' + c.name} className="neel-cust-grid" style={{ padding: '14px 16px', borderTop: '1px solid ' + C.borderSoft, opacity: off ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 19, background: 'var(--neel-accent-soft, #eaf3fc)', color: 'var(--neel-accent, #0a6ed1)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input aria-label={'Rename ' + c.name} autoFocus value={nm} onChange={e => setNm(e.target.value)} style={Object.assign({}, miniInput, { width: 190 })} onKeyDown={e => { if (e.key === 'Enter') doRename(); }} />
              <Button onClick={doRename}>Save</Button>
              <button type="button" onClick={() => { setEditing(false); setNm(c.name); }} style={Object.assign({}, link, { color: C.subtext })}>Cancel</button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 14, color: C.ink }}>{c.name}</strong>{off && <Badge tone="default">Inactive</Badge>}</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3 }}>{used} order{used === 1 ? '' : 's'}{linked ? ' - ' + linked + ' login' + (linked === 1 ? '' : 's') : ''}</div>
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="neel-cust-label" style={label}>{(c.locations || []).length} location{(c.locations || []).length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(c.locations || []).length === 0 && <span style={{ fontSize: 12, color: C.faint }}>No locations yet</span>}
          {(c.locations || []).map(l => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: C.steelSoft, color: C.steel, fontSize: 12, fontWeight: 600 }}>{l}
              <button type="button" aria-label={'Remove location ' + l + ' of ' + c.name} onClick={() => commit(customerRemoveLocation(customers, c.id, l), { field: c.name, from: 'location ' + l, to: 'removed' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.steel, display: 'flex' }}><X size={11} /></button>
            </span>
          ))}
          <input aria-label={'Add location to ' + c.name} placeholder="Add location..." value={loc} onChange={e => setLoc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && commit(customerAddLocation(customers, c.id, loc), { field: c.name, from: '', to: 'location ' + mdName(loc) })) setLoc(''); }} style={Object.assign({}, miniInput, { width: 130 })} />
        </div>
      </div>
      <div>
        {editG ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input aria-label={'GSTIN of ' + c.name} autoFocus value={gs} maxLength={15} onChange={e => setGs(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') saveG(); }} placeholder="27ABCDE1234F1Z5" className="font-mono" style={Object.assign({}, miniInput, { width: 165 })} />
            <Button onClick={saveG}>Save</Button>
            <button type="button" onClick={() => { setEditG(false); setGs(c.gstin || ''); }} style={Object.assign({}, link, { color: C.subtext })}>Cancel</button>
          </div>
        ) : c.gstin ? (
          <div>
            <div className="font-mono" style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>{c.gstin}</div>
            <div style={{ fontSize: 11.5, color: gOk ? C.subtext : C.amber, marginTop: 2 }}>{gOk ? (stateName ? stateName + ' (' + String(c.gstin).slice(0, 2) + ')' : 'GSTIN') : 'Check the format: 15 characters'}</div>
            <button type="button" onClick={() => { setEditG(true); setGs(c.gstin || ''); }} style={Object.assign({}, link, { marginTop: 4 })}>Edit GSTIN</button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: C.faint }}>Not added</div>
            <button type="button" aria-label={'Add GSTIN to ' + c.name} onClick={() => { setEditG(true); setGs(''); }} style={Object.assign({}, link, { marginTop: 4 })}>Add GSTIN</button>
          </div>
        )}
      </div>
      <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
        {!editing && <button type="button" aria-label={'Rename customer ' + c.name} onClick={() => { setEditing(true); setNm(c.name); }} style={link}>Rename</button>}
        <button type="button" aria-label={(off ? 'Reactivate ' : 'Deactivate ') + c.name} onClick={() => commit(customerSetActive(customers, c.id, off), { field: c.name, from: off ? 'inactive' : 'active', to: off ? 'active' : 'inactive' })} style={link}>{off ? 'Reactivate' : 'Deactivate'}</button>
        <ConfirmIconButton title={'Remove ' + c.name} onConfirm={() => commit(customerRemove(customers, c.id), { field: c.name, from: 'in Master', to: 'removed' })} />
      </div>
    </div>
  );
}
`;
{
  const a = s.indexOf('function MasterCustomerRow(');
  const b = s.indexOf('function MasterSizes(');
  if (a === -1 || b === -1 || b < a) missing.push('MasterCustomerRow block');
  else s = s.slice(0, a) + CUSTOMER_ROW + s.slice(b);
}
replaceOnce('customer list head',
  '        {shown.length === 0 ? <EmptyState title="No customers yet."',
  '        <CustomerListHead />\n        {shown.length === 0 ? <EmptyState title="No customers yet."');

if (/`/.test(RECAP_LOGIC + RECAP_MODAL + CUSTOMER_ROW)) { console.error('Internal error: inserted code contains a backtick.'); process.exit(3); }
if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.home.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Home + customers patched  ->  ' + file);
console.log('Backup                    ->  ' + file + '.home.bak');
