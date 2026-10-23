#!/usr/bin/env node
/**
 * NEEL Suite Cloud - tile hubs for every space + back links
 * Run AFTER patch-inventory.cjs.
 *
 *   node patch-hubs.cjs                 -> patches ./src/App.jsx
 *   node patch-hubs.cjs path/to/App.jsx
 *
 *   - Neel : QM Apps, Neel : SD Apps, Shipping, Inventory Management, Production & Shop Floor,
 *     Maintenance & Tooling, Administration each open a tile page (like Inventory Management)
 *   - Tiles are shown per role: a tile appears only if the role can see that page in Team & Roles
 *   - A "< <space name>" back link appears at the top of every page opened from a space
 *   - The greyed-out "not available" tiles are removed from Inventory Management
 *   - BOM / MRP gets its own tile in Inventory Management
 * All-or-nothing. Backup: App.jsx.hubs.bak
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');

if (s.includes('NEEL_HUBS_V1')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
if (!s.includes('NEEL_INV_MODULE_V1')) {
  console.error('Run patch-inventory.cjs first (the inventory module is not in this file). Nothing was changed.');
  process.exit(2);
}

const missing = [];
function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) { missing.push(label); return; }
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

/* ---------------- 1. hub configuration (placed before NAV_GROUPS) ---------------- */
const HUB_CONFIG = String.raw`/* NEEL_HUBS_V1 - tile pages for each space. Add a page here to give it a tile. */
const SPACE_HUBS = {
  hub_qm: { label: 'Neel : QM Apps', sections: [
    { title: 'Quality Management', tiles: [
      { tab: 'quality', title: 'Quality Release', sub: 'Inspection Usage Decision' },
      { tab: 'qchold', title: 'QC Hold Section', sub: 'Held LWC Baskets' },
      { tab: 'qmlots', title: 'Process Inspection Lots', sub: 'Worklist' },
      { tab: 'lab', title: 'Lab & Mechanical', sub: 'Spectro & Tensile Tests' },
      { tab: 'spc', title: 'SPC', sub: 'Statistical Process Control' },
      { tab: 'capa', title: 'CAPA', sub: 'Corrective & Preventive Actions' },
    ] },
  ] },
  hub_sd: { label: 'Neel : SD Apps', sections: [
    { title: 'Sales & Distribution', tiles: [
      { tab: 'orders', title: 'Orders', sub: 'Sales Orders & Status' },
    ] },
  ] },
  hub_ship: { label: 'Shipping', sections: [
    { title: 'Shipping', tiles: [
      { tab: 'dispatch', title: 'Dispatch', sub: 'Deliveries & Released Stock' },
    ] },
  ] },
  invhub: { label: 'Inventory Management', sections: [
    { title: 'Stock Management', tiles: [
      { tab: 'migo', title: 'Post Goods Movement', sub: 'Goods Receipt' },
      { tab: 'matdocs', title: 'Material Documents Overview' },
      { tab: 'cyclecount', title: 'Cycle Count', sub: 'Physical Inventory Audit' },
    ] },
    { title: 'Stock Monitoring', tiles: [
      { tab: 'stocksingle', title: 'Stock', sub: 'Single Material' },
      { tab: 'inventory', title: 'Stock', sub: 'Multiple Materials' },
      { tab: 'analyzestock', title: 'Analyze Stock in Date Range' },
      { tab: 'slowmoving', title: 'Slow or Non-Moving Materials' },
    ], links: [
      { tab: 'deadstock', title: 'Dead Stock Analysis' },
    ] },
    { title: 'Material Planning', tiles: [
      { tab: 'bomMrp', title: 'BOM / MRP', sub: 'Bill of Materials & Requirements' },
    ] },
  ] },
  hub_prod: { label: 'Production & Shop Floor', sections: [
    { title: 'Planning', tiles: [
      { tab: 'plan', title: 'Production Plan (DPP)', sub: 'Daily Process Plan' },
      { tab: 'schedule', title: 'Schedule', sub: 'Order Schedule' },
    ] },
    { title: 'Execution', tiles: [
      { tab: 'stages', title: 'Stage Tracking', sub: 'Production Orders' },
      { tab: 'floor', title: 'Shop Floor Workbench', sub: 'Pull Operations' },
    ] },
    { title: 'Reporting', tiles: [
      { tab: 'dpr', title: 'Daily Report', sub: 'Daily Production Report' },
    ] },
  ] },
  hub_maint: { label: 'Maintenance & Tooling', sections: [
    { title: 'Maintenance & Tooling', tiles: [
      { tab: 'maintenance', title: 'Maintenance', sub: 'Breakdowns & Preventive Tasks' },
      { tab: 'tooling', title: 'Tooling & Dies', sub: 'Die Usage & Polishing' },
      { tab: 'energy', title: 'Machine Energy', sub: 'Energy Tracking' },
    ] },
  ] },
  hub_admin: { label: 'Administration', sections: [
    { title: 'Organization', tiles: [
      { tab: 'master', title: 'Master', sub: 'Master Data & Settings' },
      { tab: 'team', title: 'Team & Roles', sub: 'Users & Access' },
      { tab: 'skills', title: 'Skill Matrix', sub: 'Training & Skills' },
    ] },
    { title: 'Business', tiles: [
      { tab: 'cost', title: 'Cost of Production' },
      { tab: 'trends', title: 'Trends' },
      { tab: 'reports', title: 'Reports & Downloads' },
    ] },
    { title: 'Governance & Improvement', tiles: [
      { tab: 'audit', title: 'Audit Trail' },
      { tab: 'kaizen', title: 'Kaizen', sub: 'Improvement Ideas' },
    ] },
  ] },
};
const SPACE_HUB_TABS = Object.fromEntries(Object.entries(SPACE_HUBS).map(([k, h]) => [k, h.sections.flatMap(sec => sec.tiles.concat(sec.links || []).map(t => t.tab))]));
`;
replaceOnce('NAV_GROUPS anchor', 'const NAV_GROUPS = [', HUB_CONFIG + 'const NAV_GROUPS = [');

/* ---------------- 2. NAV / permissions ---------------- */
replaceOnce('invhub nav entry (sidebar)', "      { key: 'invhub', label: 'Inventory Management', icon: Boxes },\n", '');
replaceOnce('NAV definition',
  'const NAV = NAV_GROUPS.flatMap(g => g.items);',
  "const NAV = NAV_GROUPS.flatMap(g => g.items).concat(Object.entries(SPACE_HUBS).map(([key, h]) => ({ key, label: h.label, icon: LayoutGrid, hidden: true })));");
replaceOnce('FEATURES from NAV',
  '...NAV.map(n => ({ key: `tab.${n.key}`',
  '...NAV.filter(n => !SPACE_HUBS[n.key]).map(n => ({ key: `tab.${n.key}`');
// a hub is visible when the person can see at least one of its tiles
replaceOnce('canSeeTab',
  'function canSeeTab(user, key) { return !!user && canDo(user.role, `tab.${key}`); }',
  'function canSeeTab(user, key) {\n  if (!user) return false;\n  if (SPACE_HUB_TABS[key]) return SPACE_HUB_TABS[key].some(k => canSeeTab(user, k));\n  return canDo(user.role, `tab.${key}`);\n}');

/* ---------------- 3. space bar ---------------- */
replaceOnce('space QM', "{ key: 'quality', label: 'Neel : QM Apps', match: ['quality',", "{ key: 'hub_qm', label: 'Neel : QM Apps', match: ['hub_qm', 'quality',");
replaceOnce('space SD', "{ key: 'orders', label: 'Neel : SD Apps', match: ['orders'] }", "{ key: 'hub_sd', label: 'Neel : SD Apps', match: ['hub_sd', 'orders'] }");
replaceOnce('space shipping', "{ key: 'dispatch', label: 'Shipping', match: ['dispatch'] }", "{ key: 'hub_ship', label: 'Shipping', match: ['hub_ship', 'dispatch'] }");
replaceOnce('space production', "{ key: 'plan', label: 'Production & Shop Floor', match: ['plan',", "{ key: 'hub_prod', label: 'Production & Shop Floor', match: ['hub_prod', 'plan',");
replaceOnce('space maintenance', "{ key: 'maintenance', label: 'Maintenance & Tooling', match: ['maintenance',", "{ key: 'hub_maint', label: 'Maintenance & Tooling', match: ['hub_maint', 'maintenance',");
replaceOnce('space admin', "{ key: 'master', label: 'Administration', match: ['master',", "{ key: 'hub_admin', label: 'Administration', match: ['hub_admin', 'master',");

/* ---------------- 4. components ---------------- */
const COMPONENTS = String.raw`function SpaceHubTab({ hubKey, setTab, user }) {
  const hub = SPACE_HUBS[hubKey];
  if (!hub) return null;
  const sections = hub.sections.map(sec => ({
    title: sec.title,
    tiles: sec.tiles.filter(t => canSeeTab(user, t.tab)),
    links: (sec.links || []).filter(t => canSeeTab(user, t.tab)),
  })).filter(sec => sec.tiles.length || sec.links.length);
  if (!sections.length) {
    return <Card><EmptyState title="Nothing to show here yet" sub="Ask your administrator for access to the apps in this area." /></Card>;
  }
  const navOf = (tab) => NAV.find(n => n.key === tab);
  return (
    <div>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>{sec.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {sec.tiles.map(t => {
              const nav = navOf(t.tab); const Icon = (nav && nav.icon) || LayoutGrid;
              return (
                <button key={t.tab + (t.sub || '')} type="button" onClick={() => setTab(t.tab)} className="hover-lift" data-testid={'tile-' + t.tab}
                  style={{ width: 168, height: 128, textAlign: 'left', padding: 12, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{t.title || (nav && nav.label) || t.tab}</div>
                    {t.sub && <div style={{ fontSize: 12, color: C.subtext }}>{t.sub}</div>}
                  </div>
                  <Icon size={22} color={'var(--neel-accent, #0a6ed1)'} />
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

function SpaceBackBar({ tab, setTab }) {
  let hub = null;
  Object.keys(SPACE_HUB_TABS).forEach(h => { if (!hub && SPACE_HUB_TABS[h].includes(tab)) hub = h; });
  if (!hub) return null;
  return (
    <div className="no-print" style={{ marginBottom: 10 }}>
      <button type="button" data-testid="space-back" onClick={() => setTab(hub)}
        style={{ background: 'none', border: 'none', color: 'var(--neel-accent, #0a6ed1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, padding: 0 }}>
        <ChevronLeft size={15} /> {SPACE_HUBS[hub].label}
      </button>
    </div>
  );
}

`;
{
  const a = s.indexOf('function InventoryHubTab({ setTab }) {');
  const b = s.indexOf('function MaterialDocsTab(');
  if (a === -1 || b === -1 || b < a) missing.push('old InventoryHubTab block');
  else s = s.slice(0, a) + COMPONENTS + s.slice(b);
}

// the Inventory pages had their own back button; the shared back bar replaces it
{
  const re = /[ \t]*<button type="button" onClick=\{\(\) => setTab\('invhub'\)\} style=\{Object\.assign\(\{\}, invBtnGhost, \{ display: 'inline-flex', alignItems: 'center', gap: 2 \}\)\}><ChevronLeft size=\{15\} \/> Inventory Management<\/button>\n/;
  if (!re.test(s)) missing.push('InvPageFrame back button');
  else s = s.replace(re, '');
}

/* ---------------- 5. routing ---------------- */
replaceOnce('hub route',
  "{tab === 'invhub' && <InventoryHubTab setTab={setTab} />}",
  "{SPACE_HUBS[tab] && <SpaceHubTab hubKey={tab} setTab={setTab} user={user} />}");
{
  const re = /^( *)\{isCustomer && <CustomerBanner user=\{user\} link=\{customerLink\} \/>\}\n/m;
  const m = s.match(re);
  if (!m) missing.push('CustomerBanner line');
  else s = s.replace(m[0], m[0] + m[1] + '<SpaceBackBar tab={tab} setTab={setTab} />\n');
}

if (missing.length) {
  console.error('\nPatch NOT applied. Could not find these parts in your file:\n - ' + missing.join('\n - '));
  console.error('\nNothing was changed.');
  process.exit(2);
}
fs.copyFileSync(file, file + '.hubs.bak');
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('Hubs patched  ->  ' + file);
console.log('Backup        ->  ' + file + '.hubs.bak');
