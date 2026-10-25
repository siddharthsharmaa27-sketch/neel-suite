#!/usr/bin/env node
/**
 * Shows which NEEL patches are already inside your App.jsx and what to run next.
 *   node check-patches.cjs                 -> checks ./src/App.jsx
 *   node check-patches.cjs path/to/App.jsx
 * It only reads the file. It never changes anything.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'src/App.jsx');
if (!fs.existsSync(file)) { console.error('File not found: ' + file + '\nRun this from the folder that contains the src folder.'); process.exit(1); }
const s = fs.readFileSync(file, 'utf8');

// order matters: each patch needs the ones listed in "needs"
const PATCHES = [
  { file: 'patch-neel.cjs', marker: 'neel_home_fav_titles', what: 'Home: Deselect / Add Apps, themes, sidebar', needs: [] },
  { file: 'patch-inventory.cjs', marker: 'NEEL_INV_MODULE_V1', what: 'Inventory screens: Slow/Non-Moving, Stock Single, Analyze Stock', needs: [] },
  { file: 'patch-hubs.cjs', marker: 'NEEL_HUBS_V1', what: 'Tile pages for every space + back links', needs: ['patch-inventory.cjs'] },
  { file: 'patch-phase3.cjs', marker: 'NEEL_PHASE3_V1', what: 'Purchase orders, prices, tile counts, search, favourites per user', needs: ['patch-neel.cjs', 'patch-inventory.cjs', 'patch-hubs.cjs'] },
  { file: 'patch-tooling.cjs', marker: 'NEEL_TOOLING_V1', what: 'Tooling: delete tool, edit catalog, auto packaging', needs: [] },
  { file: 'patch-consumables.cjs', marker: 'function ConsumablesPurchaseTab(', what: 'Consumables purchase, store and cost analysis', needs: ['patch-inventory.cjs', 'patch-hubs.cjs'] },
  { file: 'patch-home-customers.cjs', marker: 'NEEL_HOME_V1', what: 'Home for every login, Recap, new Customer master', needs: ['patch-neel.cjs', 'patch-hubs.cjs', 'patch-phase3.cjs'] },
  { file: 'patch-unify.cjs', marker: 'NEEL_UNIFY_V1', what: 'One Purchase & Goods Receipt screen, one dead/slow stock report', needs: ['patch-inventory.cjs', 'patch-hubs.cjs', 'patch-phase3.cjs', 'patch-consumables.cjs'] },
];
const done = {};
PATCHES.forEach(p => { done[p.file] = s.includes(p.marker); });

console.log('\nChecking ' + file + '\n');
PATCHES.forEach(p => console.log((done[p.file] ? '  [x] ' : '  [ ] ') + p.file.padEnd(28) + p.what));

const todo = PATCHES.filter(p => !done[p.file]);
console.log('');
if (!todo.length) { console.log('Everything is applied. Nothing to run.\n'); process.exit(0); }

// walk the list in order and only suggest patches whose requirements will be met
const willHave = Object.assign({}, done);
const order = [];
let progressed = true;
while (progressed) {
  progressed = false;
  for (const p of PATCHES) {
    if (willHave[p.file]) continue;
    if (p.needs.every(n => willHave[n])) { order.push(p); willHave[p.file] = true; progressed = true; }
  }
}
console.log('Run these, in this order, from the folder that contains the src folder:\n');
order.forEach(p => console.log('  node ' + p.file));
const stuck = PATCHES.filter(p => !willHave[p.file]);
if (stuck.length) console.log('\nCould not order: ' + stuck.map(p => p.file).join(', '));
console.log('\nIf a patch prints "Nothing was changed", read its message: it names the patch to run first.\n');
