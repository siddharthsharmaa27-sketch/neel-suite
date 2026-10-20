import fs from 'fs';
import path from 'path';

// 1. Locate App.jsx in root or ./src/App.jsx
const candidates = [
  path.resolve(process.cwd(), 'App.jsx'),
  path.resolve(process.cwd(), 'src', 'App.jsx'),
];

const targetPath = candidates.find(p => fs.existsSync(p));
if (!targetPath) {
  console.error('❌ Could not find App.jsx in the current folder or ./src/App.jsx.');
  console.error('👉 Place apply_fixes.mjs in your project root and run: node apply_fixes.mjs');
  process.exit(1);
}

let code = fs.readFileSync(targetPath, 'utf8');
const hasCRLF = code.includes('\r\n');
if (hasCRLF) code = code.replace(/\r\n/g, '\n');

// 2. Create a safe backup
const backupPath = targetPath + '.bak';
fs.writeFileSync(backupPath, hasCRLF ? code.replace(/\n/g, '\r\n') : code, 'utf8');
console.log(`📦 Backup saved to: ${path.basename(backupPath)}`);

let appliedCount = 0;

// ============================================================================
// PATCH 1: Add Storage KEYS for Consumables, Tooling Instances, Transactions & Returnables
// ============================================================================
const keysTarget = `  tooling: 'ctpm:tooling_dies',`;
const keysReplacement = `  tooling: 'ctpm:tooling_dies',
  consumablesMaster: 'ctpm:consumables_master',
  toolingInstances: 'ctpm:tooling_instances',
  consumablesTx: 'ctpm:consumables_transactions',
  returnableAssets: 'ctpm:returnable_assets',`;

if (code.includes(keysTarget) && !code.includes('consumablesMaster:')) {
  code = code.replace(keysTarget, keysReplacement);
  console.log('✅ Applied Patch 1: Added Supabase KV storage keys for Catalog, Instances, Transactions & Returnables');
  appliedCount++;
}

// ============================================================================
// PATCH 2: Inject Complete Consumables, Tooling Re-bore, Packaging BOM & Costing Engine
// ============================================================================
const toolingModuleStart = `const DEFAULT_DIES = [`;
const newConsumablesAndToolingEngine = `/* =========================================================================
   UNIFIED CONSUMABLES MASTER, SERIALIZED TOOLING & PACKAGING BOM ENGINE
   ========================================================================= */
const DEFAULT_CONSUMABLE_CATEGORIES = [
  'Carbide Die', 'Mandrel Plug', 'Drawing Ring', 'Graphite Die', 'Lubricant',
  'Wooden Bobbin', 'Wooden Pallet', 'Corrugated Ring', 'End Cap',
  'Stretch Film', 'Iron Strap', 'General Consumable',
];

const DEFAULT_APPLIES_TO = [
  'All', 'LWC', 'PCC', 'CTL', 'Melting', 'Milling', 'Planetary Rolling',
  'Cascade', 'Spinner', 'Annealing', 'PKG-01 (PCC)', 'PKG-02 (LWC)',
];

const TOOL_CATEGORY_SET = new Set(['Carbide Die', 'Mandrel Plug', 'Drawing Ring', 'Graphite Die']);
const RETURNABLE_CATEGORY_SET = new Set(['Wooden Bobbin', 'Wooden Pallet']);

const DEFAULT_CONSUMABLES_MASTER = [
  { id: 'cm-1', code: 'DIE-15.0-TCT', name: 'Tungsten Carbide Drawing Die 15.0mm', category: 'Carbide Die', applies_to: 'Cascade', target_life_meters: 5000, target_life_kg: 3500, standard_qty_per_unit: 0, unit_cost: 4200, min_stock_level: 3, stock_qty: 5, uom: 'pcs' },
  { id: 'cm-2', code: 'DIE-9.52-TCT', name: 'Tungsten Carbide Spinner Die 9.52mm', category: 'Carbide Die', applies_to: 'Spinner', target_life_meters: 8000, target_life_kg: 4500, standard_qty_per_unit: 0, unit_cost: 3800, min_stock_level: 4, stock_qty: 6, uom: 'pcs' },
  { id: 'cm-3', code: 'PLUG-12.7-FLT', name: 'Floating Mandrel Plug 12.7mm', category: 'Mandrel Plug', applies_to: 'Spinner', target_life_meters: 6000, target_life_kg: 3200, standard_qty_per_unit: 0, unit_cost: 2900, min_stock_level: 3, stock_qty: 4, uom: 'pcs' },
  { id: 'cm-4', code: 'DIE-GRAPH-90', name: 'HCC Graphite Casting Die 90mm', category: 'Graphite Die', applies_to: 'Melting', target_life_meters: 1500, target_life_kg: 25000, standard_qty_per_unit: 0, unit_cost: 18500, min_stock_level: 2, stock_qty: 3, uom: 'pcs' },
  { id: 'cm-5', code: 'PK-LWC-BOBBIN', name: 'Heavy Duty Wooden Bobbin (LWC)', category: 'Wooden Bobbin', applies_to: 'LWC', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 1, unit_cost: 1450, min_stock_level: 25, stock_qty: 60, uom: 'pcs' },
  { id: 'cm-6', code: 'PK-LWC-PALLET', name: 'Fumigated Wooden Pallet (LWC)', category: 'Wooden Pallet', applies_to: 'LWC', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 1, unit_cost: 1100, min_stock_level: 20, stock_qty: 45, uom: 'pcs' },
  { id: 'cm-7', code: 'PK-CORR-RING', name: 'Corrugated Protection Ring', category: 'Corrugated Ring', applies_to: 'LWC', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 2, unit_cost: 65, min_stock_level: 100, stock_qty: 240, uom: 'pcs' },
  { id: 'cm-8', code: 'PK-END-CAP', name: 'PE Tube End Cap', category: 'End Cap', applies_to: 'All', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 2, unit_cost: 4, min_stock_level: 500, stock_qty: 1500, uom: 'pcs' },
  { id: 'cm-9', code: 'PK-IRON-STRAP', name: 'High-Tensile Iron Packaging Strap', category: 'Iron Strap', applies_to: 'LWC', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 0.5, unit_cost: 95, min_stock_level: 100, stock_qty: 320, uom: 'kg' },
  { id: 'cm-10', code: 'PK-STRETCH-FLM', name: 'Industrial Stretch Wrap Film', category: 'Stretch Film', applies_to: 'All', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 0.05, unit_cost: 160, min_stock_level: 50, stock_qty: 120, uom: 'kg' },
  { id: 'cm-11', code: 'PK-PCC-BOX', name: '5-Ply Corrugated PCC Carton Box', category: 'General Consumable', applies_to: 'PCC', target_life_meters: 0, target_life_kg: 0, standard_qty_per_unit: 1, unit_cost: 115, min_stock_level: 150, stock_qty: 400, uom: 'pcs' },
];

const DEFAULT_TOOLING_INSTANCES = [
  { id: 'D-4091', consumable_master_id: 'cm-1', status: 'In Service', total_meters_run: 4350, total_kg_run: 2900, current_size_mm: 15.0, refurbish_count: 1, machine_id: 'CASC-01', history: [{ at: '2026-10-01', action: 'Mounted on CASC-01', size_mm: 15.0 }] },
  { id: 'D-4092', consumable_master_id: 'cm-2', status: 'In Service', total_meters_run: 3100, total_kg_run: 1650, current_size_mm: 9.52, refurbish_count: 0, machine_id: 'SPB-01', history: [{ at: '2026-10-05', action: 'Mounted on SPB-01', size_mm: 9.52 }] },
  { id: 'P-2010', consumable_master_id: 'cm-3', status: 'In Maintenance / Polishing', total_meters_run: 5750, total_kg_run: 3100, current_size_mm: 12.7, refurbish_count: 2, machine_id: '', history: [{ at: '2026-10-14', action: 'Sent for Polishing (Wear 95.8%)', size_mm: 12.7 }] },
  { id: 'G-1004', consumable_master_id: 'cm-4', status: 'New', total_meters_run: 0, total_kg_run: 0, current_size_mm: 90.0, refurbish_count: 0, machine_id: 'HCC-01', history: [] },
];

const TOOL_STATUSES = ['New', 'In Service', 'In Maintenance / Polishing', 'Scrapped'];
const TX_ACTIONS = ['Mounted', 'Issued for Packing', 'Scrapped', 'Returned'];
const REMOVAL_REASONS = ['Normal Wear', 'Breakage', 'Size Out of Spec', 'Damage', 'Scheduled Changeover', 'N/A'];

// Computes Granular Tooling & Packaging Cost per kg of Good Output
function computeGranularConsumableCosts({ masterList, instances, transactions, batches, month }) {
  const mList = masterList?.length ? masterList : DEFAULT_CONSUMABLES_MASTER;
  const iList = instances?.length ? instances : DEFAULT_TOOLING_INSTANCES;
  const txList = transactions || [];

  const masterById = Object.fromEntries(mList.map(m => [m.id, m]));

  // Good output in kg for the selected month (or all-time if no month passed)
  let totalGoodKg = 0;
  (batches || []).forEach(b => {
    const m = b.flow?.machine;
    const endedDay = m?.endedAt ? isoToLocalKey(m.endedAt) : (b.startedAt ? isoToLocalKey(b.startedAt) : '');
    if (month && (!endedDay || !endedDay.startsWith(month))) return;
    const packed = Number(b.flow?.packing?.packedQty) || 0;
    const coilGood = Number(m?.coils?.acceptedKg) || 0;
    const net = Math.max(0, Number(b.qty || 0) - (b.scrapLog || []).reduce((s, r) => s + Number(r.qty || 0), 0));
    totalGoodKg += (packed || coilGood || (b.unit === 'kg' ? net : 0));
  });
  if (totalGoodKg <= 0) totalGoodKg = 1; // guard against divide-by-zero

  // 1. Tooling Cost Amortized (based on wear fraction of active/scrapped tools + tool scrap/mount tx)
  let totalToolingAmortized = 0;
  iList.forEach(inst => {
    const cat = masterById[inst.consumable_master_id];
    if (!cat) return;
    const unitCost = Number(cat.unit_cost) || 0;
    const targetM = Number(cat.target_life_meters) || 0;
    const targetKg = Number(cat.target_life_kg) || 0;
    let wearFraction = 0;
    if (inst.status === 'Scrapped') {
      wearFraction = 1;
    } else if (targetM > 0 && Number(inst.total_meters_run) > 0) {
      wearFraction = Math.min(1, Number(inst.total_meters_run) / targetM);
    } else if (targetKg > 0 && Number(inst.total_kg_run) > 0) {
      wearFraction = Math.min(1, Number(inst.total_kg_run) / targetKg);
    }
    totalToolingAmortized += wearFraction * unitCost;
  });

  // Also include non-serialized tool issues from transactions
  txList.forEach(tx => {
    if (month && tx.at && !String(tx.at).startsWith(month)) return;
    const cat = masterById[tx.consumable_id];
    if (cat && TOOL_CATEGORY_SET.has(cat.category) && tx.action === 'Scrapped') {
      totalToolingAmortized += (Number(tx.qty_issued) || 1) * (Number(cat.unit_cost) || 0);
    }
  });

  // 2. Packaging Cost Issued (Bobbins, Pallets, Straps, Film, Caps, Boxes)
  let totalPackagingCost = 0;
  txList.forEach(tx => {
    if (month && tx.at && !String(tx.at).startsWith(month)) return;
    const cat = masterById[tx.consumable_id];
    if (!cat || TOOL_CATEGORY_SET.has(cat.category)) return;
    if (tx.action === 'Issued for Packing') {
      totalPackagingCost += (Number(tx.qty_issued) || 0) * (Number(cat.unit_cost) || 0);
    } else if (tx.action === 'Returned') {
      totalPackagingCost = Math.max(0, totalPackagingCost - (Number(tx.qty_issued) || 0) * (Number(cat.unit_cost) || 0));
    }
  });

  return {
    totalGoodKg,
    totalToolingAmortized: Math.round(totalToolingAmortized),
    totalPackagingCost: Math.round(totalPackagingCost),
    toolingCostPerKg: totalToolingAmortized / totalGoodKg,
    packagingCostPerKg: totalPackagingCost / totalGoodKg,
    combinedConsumablePerKg: (totalToolingAmortized + totalPackagingCost) / totalGoodKg,
  };
}

// Persistent local fallback hook so the new enterprise tables work seamlessly with or without parent prop wiring
function useSyncedStore(storageKey, defaultVal) {
  const [data, setData] = useState(() => {
    try {
      const local = localStorage.getItem(storageKey);
      return local ? JSON.parse(local) : defaultVal;
    } catch { return defaultVal; }
  });

  useEffect(() => {
    let mounted = true;
    loadShared(storageKey, null).then(remote => {
      if (mounted && remote !== null && remote !== undefined) {
        setData(remote);
        try { localStorage.setItem(storageKey, JSON.stringify(remote)); } catch {}
      }
    });
    return () => { mounted = false; };
  }, [storageKey]);

  const update = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      saveShared(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return [data, update];
}

const DEFAULT_DIES = [`;

if (code.includes(toolingModuleStart) && !code.includes('DEFAULT_CONSUMABLES_MASTER')) {
  code = code.replace(toolingModuleStart, newConsumablesAndToolingEngine);
  console.log('✅ Applied Patch 2: Injected Consumables Master, Tooling Instances, BOM & Costing Engine');
  appliedCount++;
}

// ============================================================================
// PATCH 3: Upgrade ToolingTab into the Unified 5-Tab Enterprise Module:
//   1. Tooling Lifecycle & Re-boring (85% Amber Warning + Re-bore Size X -> Y)
//   2. Packaging BOM & Variance Audit (Auto Kit Calculation vs Actual Issued)
//   3. Returnable Assets (Wooden Bobbins & Pallets Customer Ledger)
//   4. Master Catalog (consumables_master with custom categories & machines)
//   5. Store Transactions Log (consumables_transactions + Granular Cost/kg KPIs)
// ============================================================================
const oldToolingTabStart = `function ToolingTab({ toolingItems, onAddDie, onUpdateDieUsage, onSendForPolishing, onDeleteDie, user }) {`;
const oldToolingTabEnd = `function EnergyTrackingTab(`;

const startIdx = code.indexOf(oldToolingTabStart);
const endIdx = code.indexOf(oldToolingTabEnd);

if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
  const replacementToolingTab = `function ToolingTab({ toolingItems, onAddDie, onUpdateDieUsage, onSendForPolishing, onDeleteDie, user }) {
  const ctx = useContext(ReportCtx) || {};
  const batches = ctx.batches || [];
  const orders = ctx.orders || [];

  const [masterList, setMasterList] = useSyncedStore(KEYS.consumablesMaster, DEFAULT_CONSUMABLES_MASTER);
  const [instances, setInstances] = useSyncedStore(KEYS.toolingInstances, DEFAULT_TOOLING_INSTANCES);
  const [transactions, setTransactions] = useSyncedStore(KEYS.consumablesTx, []);
  const [returnables, setReturnables] = useSyncedStore(KEYS.returnableAssets, [
    { id: 'ret-1', customer: 'Global HVAC Corp', assetCode: 'PK-LWC-BOBBIN', assetName: 'Heavy Duty Wooden Bobbin (LWC)', sentQty: 24, returnedQty: 18, lastUpdated: todayKey() },
    { id: 'ret-2', customer: 'Global HVAC Corp', assetCode: 'PK-LWC-PALLET', assetName: 'Fumigated Wooden Pallet (LWC)', sentQty: 12, returnedQty: 10, lastUpdated: todayKey() },
  ]);

  const [subTab, setSubTab] = useState('lifecycle'); // 'lifecycle' | 'packaging' | 'returnables' | 'catalog' | 'transactions'

  // --- Sub-tab 1: Serialized Tooling & Re-boring state ---
  const [showAddInst, setShowAddInst] = useState(false);
  const [instForm, setInstForm] = useState({ id: '', consumable_master_id: 'cm-1', current_size_mm: '15.0', machine_id: 'CASC-01' });
  const [runInput, setRunInput] = useState({});
  const [reboreModal, setReboreModal] = useState(null); // { instance, newSize: '', notes: '' }

  // --- Sub-tab 2: Packaging BOM & Variance state ---
  const [packLine, setPackLine] = useState('LWC');
  const [packOutputUnits, setPackOutputUnits] = useState(20); // e.g., 20 pallets or 100 boxes
  const [packOrderRef, setPackOrderRef] = useState('');
  const [actualPackIssues, setActualPackIssues] = useState({});
  const [packAuditMsg, setPackAuditMsg] = useState('');

  // --- Sub-tab 3: Returnable Assets state ---
  const [retForm, setRetForm] = useState({ customer: '', assetCode: 'PK-LWC-BOBBIN', type: 'dispatch', qty: '', ref: '' });

  // --- Sub-tab 4: Master Catalog state ---
  const [showAddCat, setShowAddCat] = useState(false);
  const [customCategories, setCustomCategories] = useState([]);
  const [customApplies, setCustomApplies] = useState([]);
  const [newCatInput, setNewCatInput] = useState('');
  const [newAppliesInput, setNewAppliesInput] = useState('');
  const [catForm, setCatForm] = useState({
    code: '', name: '', category: 'Carbide Die', applies_to: 'LWC',
    target_life_meters: '', target_life_kg: '', standard_qty_per_unit: '',
    unit_cost: '', min_stock_level: '', stock_qty: '', uom: 'pcs',
  });

  // --- Sub-tab 5: Store Transactions state ---
  const [txForm, setTxForm] = useState({
    consumable_id: 'cm-1', instance_id: '', machine_id: 'CASC-01',
    production_order_id: '', action: 'Mounted', qty_issued: 1, reason_for_removal: 'N/A',
  });

  const allCategories = [...new Set([...DEFAULT_CONSUMABLE_CATEGORIES, ...customCategories, ...masterList.map(m => m.category).filter(Boolean)])];
  const allAppliesTo = [...new Set([...DEFAULT_APPLIES_TO, ...customApplies, ...masterList.map(m => m.applies_to).filter(Boolean)])];
  const masterById = useMemo(() => Object.fromEntries(masterList.map(m => [m.id, m])), [masterList]);

  // Granular Cost of Production KPIs
  const costSummary = useMemo(() => computeGranularConsumableCosts({
    masterList, instances, transactions, batches, month: todayKey().slice(0, 7),
  }), [masterList, instances, transactions, batches]);

  // Wear warnings (>= 85% amber, >= 100% red)
  const wearAlerts = useMemo(() => instances.filter(inst => {
    if (inst.status === 'Scrapped') return false;
    const cat = masterById[inst.consumable_master_id];
    const limit = Number(cat?.target_life_meters) || 5000;
    return limit > 0 && (Number(inst.total_meters_run) / limit) >= 0.85;
  }), [instances, masterById]);

  // Handlers: Serialized Tooling
  const handleCreateInstance = () => {
    if (!instForm.id.trim() || !instForm.consumable_master_id) return;
    const entry = {
      id: instForm.id.trim().toUpperCase(),
      consumable_master_id: instForm.consumable_master_id,
      status: instForm.machine_id ? 'In Service' : 'New',
      total_meters_run: 0,
      total_kg_run: 0,
      current_size_mm: Number(instForm.current_size_mm) || 0,
      refurbish_count: 0,
      machine_id: instForm.machine_id,
      history: [{ at: todayKey(), action: instForm.machine_id ? \`Mounted on \${instForm.machine_id}\` : 'Added to Store', size_mm: Number(instForm.current_size_mm) || 0 }],
    };
    setInstances(prev => [entry, ...prev]);
    // Also mirror to legacy toolingItems for backward compatibility
    if (onAddDie) onAddDie({ id: entry.id, type: masterById[entry.consumable_master_id]?.category || 'Die', size: \`\${entry.current_size_mm}mm\`, usageMeters: 0, limitMeters: Number(masterById[entry.consumable_master_id]?.target_life_meters) || 5000, status: 'Active' });
    setInstForm({ id: '', consumable_master_id: 'cm-1', current_size_mm: '15.0', machine_id: 'CASC-01' });
    setShowAddInst(false);
  };

  const handleAddMetersToInstance = (instId) => {
    const addM = Number(runInput[instId]?.meters) || 0;
    const addKg = Number(runInput[instId]?.kg) || 0;
    if (addM <= 0 && addKg <= 0) return;
    setInstances(prev => prev.map(inst => inst.id === instId ? {
      ...inst,
      total_meters_run: (Number(inst.total_meters_run) || 0) + addM,
      total_kg_run: (Number(inst.total_kg_run) || 0) + addKg,
      status: inst.status === 'New' ? 'In Service' : inst.status,
    } : inst));
    if (onUpdateDieUsage && addM > 0) onUpdateDieUsage(instId, addM);
    setRunInput(prev => ({ ...prev, [instId]: { meters: '', kg: '' } }));
  };

  const handleSendInstanceForPolish = (instId) => {
    setInstances(prev => prev.map(inst => inst.id === instId ? {
      ...inst,
      status: 'In Maintenance / Polishing',
      machine_id: '',
      history: [...(inst.history || []), { at: todayKey(), action: 'Sent for Polishing / Re-boring', size_mm: inst.current_size_mm }],
    } : inst));
    if (onSendForPolishing) onSendForPolishing(instId);
  };

  const handleCompleteRebore = () => {
    if (!reboreModal || !(Number(reboreModal.newSize) > 0)) return;
    const { instance, newSize, resetMeters, notes } = reboreModal;
    const expandedMm = Number(newSize);
    setInstances(prev => prev.map(inst => inst.id === instance.id ? {
      ...inst,
      status: 'In Service',
      current_size_mm: expandedMm,
      total_meters_run: resetMeters ? 0 : inst.total_meters_run,
      refurbish_count: (Number(inst.refurbish_count) || 0) + 1,
      history: [
        ...(inst.history || []),
        { at: todayKey(), action: \`Re-bored from \${instance.current_size_mm}mm → \${expandedMm}mm\${notes ? ' (' + notes + ')' : ''}\`, size_mm: expandedMm },
      ],
    } : inst));
    setReboreModal(null);
  };

  const handleScrapInstance = (inst, reason = 'Normal Wear') => {
    setInstances(prev => prev.map(x => x.id === inst.id ? {
      ...x,
      status: 'Scrapped',
      machine_id: '',
      history: [...(x.history || []), { at: todayKey(), action: \`Scrapped (\${reason})\`, size_mm: x.current_size_mm }],
    } : x));
    setTransactions(prev => [{
      id: 'TX-' + uid().toUpperCase(),
      at: new Date().toISOString(),
      consumable_id: inst.consumable_master_id,
      instance_id: inst.id,
      machine_id: inst.machine_id || 'Store',
      production_order_id: '',
      action: 'Scrapped',
      qty_issued: 1,
      reason_for_removal: reason,
      by: user?.name || 'Store',
    }, ...prev]);
  };

  // Handlers: Packaging BOM Kit Issue & Variance Check
  const bomItemsForLine = useMemo(() => masterList.filter(m =>
    !TOOL_CATEGORY_SET.has(m.category) &&
    Number(m.standard_qty_per_unit) > 0 &&
    (m.applies_to === packLine || m.applies_to === 'All' || (packLine === 'LWC' && m.applies_to === 'PKG-02 (LWC)') || (packLine === 'PCC' && m.applies_to === 'PKG-01 (PCC)'))
  ), [masterList, packLine]);

  const handlePostPackingKitIssue = () => {
    const units = Number(packOutputUnits) || 0;
    if (units <= 0) return;
    const newTxs = [];
    const updatedStock = {};
    let varianceAlerts = 0;

    bomItemsForLine.forEach(item => {
      const stdQty = +(units * Number(item.standard_qty_per_unit)).toFixed(2);
      const actRaw = actualPackIssues[item.id];
      const actQty = actRaw !== undefined && actRaw !== '' ? Number(actRaw) : stdQty;
      if (actQty > stdQty * 1.05) varianceAlerts++;
      updatedStock[item.id] = Math.max(0, (Number(item.stock_qty) || 0) - actQty);
      newTxs.push({
        id: 'TX-' + uid().toUpperCase(),
        at: new Date().toISOString(),
        consumable_id: item.id,
        instance_id: '',
        machine_id: packLine === 'LWC' ? 'PKG-02 (LWC)' : packLine === 'PCC' ? 'PKG-01 (PCC)' : 'Packing',
        production_order_id: packOrderRef || \`\${packLine}-RUN (\${units} units)\`,
        action: 'Issued for Packing',
        qty_issued: actQty,
        std_qty: stdQty,
        variance_qty: +(actQty - stdQty).toFixed(2),
        reason_for_removal: actQty > stdQty ? 'Over-consumption Variance' : 'N/A',
        by: user?.name || 'Packing / Store',
      });
    });

    setMasterList(prev => prev.map(m => updatedStock[m.id] !== undefined ? { ...m, stock_qty: updatedStock[m.id] } : m));
    setTransactions(prev => [...newTxs, ...prev]);
    setActualPackIssues({});
    setPackAuditMsg(varianceAlerts > 0
      ? \`⚠️ Posted kit issue with \${varianceAlerts} over-consumption variance alert(s) flagged for Store audit!\`
      : \`✅ Packing kit issued for \${units} \${packLine === 'LWC' ? 'pallets/coils' : 'boxes'} and deducted from Stores inventory.\`
    );
    setTimeout(() => setPackAuditMsg(''), 6000);
  };

  // Handlers: Returnable Bobbins & Pallets
  const handleRecordReturnable = () => {
    const qty = Number(retForm.qty) || 0;
    if (!retForm.customer.trim() || qty <= 0) return;
    const catItem = masterList.find(m => m.code === retForm.assetCode) || { code: retForm.assetCode, name: retForm.assetCode };
    setReturnables(prev => {
      const idx = prev.findIndex(r => r.customer.toLowerCase() === retForm.customer.trim().toLowerCase() && r.assetCode === retForm.assetCode);
      if (idx >= 0) {
        const cur = prev[idx];
        const updated = {
          ...cur,
          sentQty: retForm.type === 'dispatch' ? cur.sentQty + qty : cur.sentQty,
          returnedQty: retForm.type === 'return' ? cur.returnedQty + qty : cur.returnedQty,
          lastUpdated: todayKey(),
        };
        return prev.map((r, i) => i === idx ? updated : r);
      }
      return [{
        id: 'ret-' + uid(),
        customer: retForm.customer.trim(),
        assetCode: catItem.code,
        assetName: catItem.name,
        sentQty: retForm.type === 'dispatch' ? qty : 0,
        returnedQty: retForm.type === 'return' ? qty : 0,
        lastUpdated: todayKey(),
      }, ...prev];
    });
    // If returned by customer, add back to store stock & log return transaction
    if (retForm.type === 'return') {
      const cat = masterList.find(m => m.code === retForm.assetCode);
      if (cat) {
        setMasterList(prev => prev.map(m => m.id === cat.id ? { ...m, stock_qty: (Number(m.stock_qty) || 0) + qty } : m));
        setTransactions(prev => [{
          id: 'TX-' + uid().toUpperCase(),
          at: new Date().toISOString(),
          consumable_id: cat.id,
          instance_id: '',
          machine_id: 'Customer Return',
          production_order_id: retForm.ref || retForm.customer.trim(),
          action: 'Returned',
          qty_issued: qty,
          reason_for_removal: 'N/A',
          by: user?.name || 'Store',
        }, ...prev]);
      }
    }
    setRetForm({ ...retForm, qty: '', ref: '' });
  };

  // Handlers: Master Catalog
  const handleAddMasterCatalogItem = () => {
    if (!catForm.code.trim() || !catForm.name.trim()) return;
    const item = {
      id: 'cm-' + uid(),
      code: catForm.code.trim().toUpperCase(),
      name: catForm.name.trim(),
      category: catForm.category,
      applies_to: catForm.applies_to,
      target_life_meters: Number(catForm.target_life_meters) || 0,
      target_life_kg: Number(catForm.target_life_kg) || 0,
      standard_qty_per_unit: Number(catForm.standard_qty_per_unit) || 0,
      unit_cost: Number(catForm.unit_cost) || 0,
      min_stock_level: Number(catForm.min_stock_level) || 0,
      stock_qty: Number(catForm.stock_qty) || 0,
      uom: catForm.uom || 'pcs',
    };
    setMasterList(prev => [item, ...prev]);
    setCatForm({ code: '', name: '', category: 'Carbide Die', applies_to: 'LWC', target_life_meters: '', target_life_kg: '', standard_qty_per_unit: '', unit_cost: '', min_stock_level: '', stock_qty: '', uom: 'pcs' });
    setShowAddCat(false);
  };

  // Handlers: Manual Store Transaction
  const handleLogManualTx = () => {
    const qty = Number(txForm.qty_issued) || 0;
    if (!txForm.consumable_id || qty <= 0) return;
    const entry = {
      id: 'TX-' + uid().toUpperCase(),
      at: new Date().toISOString(),
      consumable_id: txForm.consumable_id,
      instance_id: txForm.instance_id.trim(),
      machine_id: txForm.machine_id,
      production_order_id: txForm.production_order_id.trim(),
      action: txForm.action,
      qty_issued: qty,
      reason_for_removal: txForm.reason_for_removal,
      by: user?.name || 'Store',
    };
    setTransactions(prev => [entry, ...prev]);
    // Adjust stock level
    setMasterList(prev => prev.map(m => {
      if (m.id !== txForm.consumable_id) return m;
      const sign = txForm.action === 'Returned' ? +1 : -1;
      return { ...m, stock_qty: Math.max(0, (Number(m.stock_qty) || 0) + sign * qty) };
    }));
    setTxForm({ ...txForm, instance_id: '', production_order_id: '', qty_issued: 1 });
  };

  const navBtn = (id, label, badgeCount = 0) => (
    <button
      key={id}
      type="button"
      onClick={() => setSubTab(id)}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        border: \`1px solid \${subTab === id ? C.copper : C.border}\`,
        background: subTab === id ? C.copper : C.panel,
        color: subTab === id ? '#fff' : C.ink,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      {badgeCount > 0 && (
        <span style={{ background: subTab === id ? '#fff' : C.amber, color: subTab === id ? C.copperDark : '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
          {badgeCount}
        </span>
      )}
    </button>
  );

  return (
    <div>
      {/* Header & Granular Cost of Production Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <SectionTitle sub="Unified Consumables Catalog, Serialized Die Lifecycle & Re-boring, Packaging BOM Variance & Returnable Bobbin/Pallet Tracking.">
          Tooling, Packaging & Consumables Hub
        </SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ExportButton label="Export Consumables & Tooling Pack" onExport={() => exportToExcel(\`neelsuite-consumables-tooling-\${todayKey()}.xlsx\`, {
            'Master Catalog': masterList,
            'Tooling Instances': instances.map(i => ({ ...i, history: JSON.stringify(i.history || []) })),
            'Transactions': transactions,
            'Returnable Assets': returnables,
          })} />
        </div>
      </div>

      {/* Granular Cost of Production Integration Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card style={{ padding: 14, borderLeft: \`4px solid \${C.copper}\` }}>
          <div style={{ fontSize: 11, color: C.subtext, fontWeight: 700, textTransform: 'uppercase' }}>Tooling Cost per kg (Amortized)</div>
          <div className="font-mono" style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 4 }}>
            ₹{costSummary.toolingCostPerKg.toFixed(2)}<span style={{ fontSize: 13, color: C.subtext }}>/kg</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 4 }}>
            ₹{costSummary.totalToolingAmortized.toLocaleString('en-IN')} dies, plugs & rings ÷ {Math.round(costSummary.totalGoodKg).toLocaleString()} kg good output
          </div>
        </Card>

        <Card style={{ padding: 14, borderLeft: \`4px solid \${C.green}\` }}>
          <div style={{ fontSize: 11, color: C.subtext, fontWeight: 700, textTransform: 'uppercase' }}>Packaging Cost per kg (Issued)</div>
          <div className="font-mono" style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 4 }}>
            ₹{costSummary.packagingCostPerKg.toFixed(2)}<span style={{ fontSize: 13, color: C.subtext }}>/kg</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 4 }}>
            ₹{costSummary.totalPackagingCost.toLocaleString('en-IN')} bobbins, pallets, straps & film ÷ {Math.round(costSummary.totalGoodKg).toLocaleString()} kg
          </div>
        </Card>

        <Card style={{ padding: 14, borderLeft: \`4px solid \${wearAlerts.length ? C.amber : C.steel}\` }}>
          <div style={{ fontSize: 11, color: C.subtext, fontWeight: 700, textTransform: 'uppercase' }}>Active Wear Alerts (≥ 85% Life)</div>
          <div className="font-mono" style={{ fontSize: 24, fontWeight: 700, color: wearAlerts.length ? C.amber : C.green, marginTop: 4 }}>
            {wearAlerts.length} <span style={{ fontSize: 13, color: C.subtext }}>tools near limit</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 4 }}>
            {wearAlerts.length ? wearAlerts.map(w => w.id).join(', ') + ' — prep replacement in Stores' : 'All active dies below 85% wear threshold'}
          </div>
        </Card>

        <Card style={{ padding: 14, borderLeft: \`4px solid \${C.red}\` }}>
          <div style={{ fontSize: 11, color: C.subtext, fontWeight: 700, textTransform: 'uppercase' }}>Catalog Reorder Alerts</div>
          <div className="font-mono" style={{ fontSize: 24, fontWeight: 700, color: masterList.filter(m => Number(m.stock_qty) <= Number(m.min_stock_level)).length ? C.red : C.green, marginTop: 4 }}>
            {masterList.filter(m => Number(m.stock_qty) <= Number(m.min_stock_level)).length} <span style={{ fontSize: 13, color: C.subtext }}>items low</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.subtext, marginTop: 4 }}>
            Triggered when Store stock ≤ min_stock_level
          </div>
        </Card>
      </div>

      {/* Sub-navigation bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {navBtn('lifecycle', '⚙️ B. Tooling Lifecycle & Re-boring', wearAlerts.length)}
        {navBtn('packaging', '📦 A1. Packaging BOM & Variance Audit')}
        {navBtn('returnables', '🔄 A2. Returnable Bobbins & Pallets')}
        {navBtn('catalog', '📋 A. Master Catalog (consumables_master)', masterList.filter(m => Number(m.stock_qty) <= Number(m.min_stock_level)).length)}
        {navBtn('transactions', '🧾 C. Store Consumption Logs')}
      </div>

      {/* =====================================================================
          TAB 1: SERIALIZED TOOLING LIFECYCLE, 85% WEAR GAUGE & RE-BORING
         ===================================================================== */}
      {subTab === 'lifecycle' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.subtext }}>
              Every serialized die/plug (<code className="font-mono">tooling_instances</code>) is tracked individually. Progress bars turn <strong style={{ color: C.amber }}>Amber at 85%</strong> to warn Stores before surface defects occur.
            </div>
            <Button icon={Plus} onClick={() => setShowAddInst(v => !v)}>{showAddInst ? 'Close' : 'Register Serialized Tool (D-xxxx)'}</Button>
          </div>

          {showAddInst && (
            <Card style={{ marginBottom: 16, background: C.panelAlt }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <TextField label="Serial / Etched ID (e.g. D-4095)" value={instForm.id} onChange={e => setInstForm({ ...instForm, id: e.target.value })} placeholder="D-4095" />
                <SelectField
                  label="Catalog Master Item"
                  options={masterList.filter(m => TOOL_CATEGORY_SET.has(m.category)).map(m => ({ value: m.id, label: \`\${m.code} — \${m.name}\` }))}
                  value={instForm.consumable_master_id}
                  onChange={e => setInstForm({ ...instForm, consumable_master_id: e.target.value })}
                />
                <TextField label="Current Bore Size (mm)" type="number" step="0.01" value={instForm.current_size_mm} onChange={e => setInstForm({ ...instForm, current_size_mm: e.target.value })} />
                <SelectField label="Mounted Machine (or Store)" options={['', ...allAppliesTo.filter(a => a !== 'All')]} value={instForm.machine_id} onChange={e => setInstForm({ ...instForm, machine_id: e.target.value })} />
              </div>
              <div style={{ marginTop: 12 }}>
                <Button onClick={handleCreateInstance}>Save Serialized Tool Instance</Button>
              </div>
            </Card>
          )}

          {/* Re-boring Modal */}
          {reboreModal && (
            <Card style={{ marginBottom: 16, border: \`2px solid \${C.copper}\`, background: C.copperFaint }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.copperDark, marginBottom: 8 }}>
                🔧 Re-boring / Polishing Return — Tool {reboreModal.instance.id} (Current Bore: {reboreModal.instance.current_size_mm} mm)
              </div>
              <p style={{ fontSize: 12.5, color: C.subtext, margin: '0 0 12px' }}>
                When a worn die of size X is re-bored to expanded size Y, record its new bore diameter below to return it to active service.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
                <TextField label="New Expanded Bore Size Y (mm)" type="number" step="0.01" value={reboreModal.newSize} onChange={e => setReboreModal({ ...reboreModal, newSize: e.target.value })} placeholder="e.g. 15.80" />
                <TextField label="Polishing / Re-bore Notes" value={reboreModal.notes} onChange={e => setReboreModal({ ...reboreModal, notes: e.target.value })} placeholder="Re-bored +0.8mm & mirror polished" />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ink, paddingBottom: 10 }}>
                  <input type="checkbox" checked={reboreModal.resetMeters} onChange={e => setReboreModal({ ...reboreModal, resetMeters: e.target.checked })} />
                  Reset run meters for new bore cycle
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button onClick={handleCompleteRebore}>Confirm Re-bore & Return to Service</Button>
                <Button variant="secondary" onClick={() => setReboreModal(null)}>Cancel</Button>
              </div>
            </Card>
          )}

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 880 }}>
                <thead>
                  <tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                    <th style={thStyle}>Serial ID</th>
                    <th style={thStyle}>Catalog Item / Type</th>
                    <th style={thStyle}>Current Bore</th>
                    <th style={thStyle}>Machine</th>
                    <th style={thStyle}>Wear Life Gauge (Meters & kg)</th>
                    <th style={thStyle}>Refurbishes</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Lifecycle Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map(inst => {
                    const cat = masterById[inst.consumable_master_id] || {};
                    const limitM = Number(cat.target_life_meters) || 5000;
                    const wearPct = limitM > 0 ? Math.min(100, (Number(inst.total_meters_run) / limitM) * 100) : 0;
                    const isCritical = wearPct >= 100;
                    const isWarning = wearPct >= 85 && wearPct < 100;
                    const barColor = isCritical ? C.red : isWarning ? C.amber : C.green;

                    return (
                      <tr key={inst.id} style={{ borderTop: \`1px solid \${C.borderSoft}\`, background: isWarning ? C.amberSoft : isCritical ? C.redSoft : 'transparent' }}>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700, color: C.copperDark }}>{inst.id}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, color: C.ink }}>{cat.code || '—'}</div>
                          <div style={{ fontSize: 11.5, color: C.subtext }}>{cat.category || 'Tool'} · ₹{Number(cat.unit_cost || 0).toLocaleString('en-IN')}</div>
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700 }}>{Number(inst.current_size_mm).toFixed(2)} mm</td>
                        <td style={{ padding: '10px 14px', color: C.subtext }}>{inst.machine_id || 'In Store'}</td>
                        <td style={{ padding: '10px 14px', minWidth: 210 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                            <span className="font-mono">{Number(inst.total_meters_run).toLocaleString()} / {limitM.toLocaleString()} m</span>
                            <strong style={{ color: barColor }}>{wearPct.toFixed(1)}%</strong>
                          </div>
                          <div style={{ width: '100%', height: 8, background: C.borderSoft, borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: \`\${wearPct}%\`, height: '100%', background: barColor, transition: 'width 0.3s' }} />
                          </div>
                          {isWarning && <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginTop: 3 }}>⚠️ ≥85% wear — prep replacement die</div>}
                          {isCritical && <div style={{ fontSize: 11, color: C.red, fontWeight: 700, marginTop: 3 }}>🛑 Target life exceeded — polish or re-bore</div>}
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px', textAlign: 'center' }}>{inst.refurbish_count || 0}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <Badge tone={inst.status === 'Scrapped' ? 'red' : inst.status === 'In Maintenance / Polishing' ? 'amber' : isWarning ? 'amber' : 'green'}>
                            {inst.status}
                          </Badge>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {inst.status !== 'Scrapped' && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                type="number"
                                placeholder="+ meters"
                                value={runInput[inst.id]?.meters || ''}
                                onChange={e => setRunInput({ ...runInput, [inst.id]: { ...(runInput[inst.id] || {}), meters: e.target.value } })}
                                style={{ width: 76, padding: '4px 7px', borderRadius: 6, border: \`1px solid \${C.border}\`, fontSize: 12 }}
                              />
                              <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => handleAddMetersToInstance(inst.id)}>+Log</Button>
                              {inst.status !== 'In Maintenance / Polishing' ? (
                                <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => handleSendInstanceForPolish(inst.id)}>
                                  Send to Polish
                                </Button>
                              ) : (
                                <Button style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setReboreModal({ instance: inst, newSize: String(inst.current_size_mm), resetMeters: true, notes: '' })}>
                                  Re-bore / Return
                                </Button>
                              )}
                              <Button variant="danger" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => handleScrapInstance(inst, 'Normal Wear')}>
                                Scrap
                              </Button>
                            </div>
                          )}
                          {(inst.history || []).length > 0 && (
                            <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>
                              Last: {inst.history[inst.history.length - 1].action} ({inst.history[inst.history.length - 1].at})
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 2: PACKAGING INVENTORY, LINE-SPECIFIC BOM KITS & VARIANCE AUDIT
         ===================================================================== */}
      {subTab === 'packaging' && (
        <div>
          <Card style={{ marginBottom: 16, borderLeft: \`4px solid \${C.copper}\` }}>
            <SectionTitle sub="Automatically calculates expected packaging consumption from standard BOM ratios and flags Store variance alerts if actual issues exceed standard.">
              Line-Specific Packing Kit & Store Variance Calculator
            </SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <SelectField label="Finishing / Packing Line" options={['LWC', 'PCC', 'CTL']} value={packLine} onChange={e => setPackLine(e.target.value)} />
              <TextField
                label={\`Finished Output Packed (\${packLine === 'LWC' ? 'Coils / Pallets' : 'Boxes / Bundles'})\`}
                type="number"
                min="1"
                value={packOutputUnits}
                onChange={e => setPackOutputUnits(e.target.value)}
              />
              <TextField label="Production Order / Batch Ref" value={packOrderRef} onChange={e => setPackOrderRef(e.target.value)} placeholder="e.g. 100000042" />
            </div>

            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                    <th style={thStyle}>Item Code</th>
                    <th style={thStyle}>Packaging Material</th>
                    <th style={thStyle}>Std BOM / Unit</th>
                    <th style={thStyle}>Expected Std Consumption</th>
                    <th style={thStyle}>Actual Store Issue</th>
                    <th style={thStyle}>Std Cost vs Actual Cost</th>
                    <th style={thStyle}>Variance Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItemsForLine.map(item => {
                    const units = Number(packOutputUnits) || 0;
                    const stdQty = +(units * Number(item.standard_qty_per_unit)).toFixed(2);
                    const actRaw = actualPackIssues[item.id];
                    const actQty = actRaw !== undefined && actRaw !== '' ? Number(actRaw) : stdQty;
                    const variance = +(actQty - stdQty).toFixed(2);
                    const stdCost = stdQty * (Number(item.unit_cost) || 0);
                    const actCost = actQty * (Number(item.unit_cost) || 0);
                    const overAlert = actQty > stdQty * 1.05;

                    return (
                      <tr key={item.id} style={{ borderTop: \`1px solid \${C.borderSoft}\`, background: overAlert ? C.redSoft : 'transparent' }}>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700 }}>{item.code}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: C.subtext }}>Store Stock: {item.stock_qty} {item.uom}</div>
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px' }}>{item.standard_qty_per_unit} {item.uom}</td>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700 }}>{stdQty} {item.uom}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <input
                            type="number"
                            step="0.01"
                            value={actRaw !== undefined ? actRaw : stdQty}
                            onChange={e => setActualPackIssues({ ...actualPackIssues, [item.id]: e.target.value })}
                            style={{ width: 95, padding: '6px 8px', borderRadius: 6, border: \`1px solid \${overAlert ? C.red : C.border}\`, fontWeight: 600 }}
                          />
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px' }}>
                          ₹{Math.round(stdCost).toLocaleString('en-IN')} → <strong>₹{Math.round(actCost).toLocaleString('en-IN')}</strong>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {variance === 0 ? (
                            <Badge tone="green">On Standard</Badge>
                          ) : variance > 0 ? (
                            <Badge tone="red">+{variance} {item.uom} OVER (Audit Alert)</Badge>
                          ) : (
                            <Badge tone="blue">{variance} {item.uom} Saved</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button onClick={handlePostPackingKitIssue}>Issue Packing Kit & Record Variance</Button>
              {packAuditMsg && <span style={{ fontSize: 13, fontWeight: 600, color: packAuditMsg.includes('⚠️') ? C.red : C.green }}>{packAuditMsg}</span>}
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 3: RETURNABLE ASSETS TRACKING (WOODEN BOBBINS & PALLETS)
         ===================================================================== */}
      {subTab === 'returnables' && (
        <div>
          <Card style={{ marginBottom: 16, background: C.panelAlt }}>
            <SectionTitle sub="Wooden bobbins and heavy pallets are expensive returnable assets. Track customer dispatches and returns for reuse.">
              Record Returnable Bobbin / Pallet Movement
            </SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
              <TextField label="Customer Name" value={retForm.customer} onChange={e => setRetForm({ ...retForm, customer: e.target.value })} placeholder="e.g. Global HVAC Corp" />
              <SelectField
                label="Returnable Asset"
                options={masterList.filter(m => RETURNABLE_CATEGORY_SET.has(m.category)).map(m => ({ value: m.code, label: \`\${m.code} — \${m.name}\` }))}
                value={retForm.assetCode}
                onChange={e => setRetForm({ ...retForm, assetCode: e.target.value })}
              />
              <SelectField
                label="Movement Type"
                options={[{ value: 'dispatch', label: 'Sent Out with Customer Dispatch' }, { value: 'return', label: 'Returned by Customer for Reuse (+Store Stock)' }]}
                value={retForm.type}
                onChange={e => setRetForm({ ...retForm, type: e.target.value })}
              />
              <TextField label="Quantity (pcs)" type="number" min="1" value={retForm.qty} onChange={e => setRetForm({ ...retForm, qty: e.target.value })} />
              <TextField label="Challan / Delivery Ref" value={retForm.ref} onChange={e => setRetForm({ ...retForm, ref: e.target.value })} placeholder="e.g. 600000012" />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={handleRecordReturnable}>Save Returnable Asset Movement</Button>
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Asset Code</th>
                  <th style={thStyle}>Asset Description</th>
                  <th style={thStyle}>Sent Out</th>
                  <th style={thStyle}>Returned for Reuse</th>
                  <th style={thStyle}>Pending with Customer</th>
                  <th style={thStyle}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {returnables.map(r => {
                  const pending = Math.max(0, (Number(r.sentQty) || 0) - (Number(r.returnedQty) || 0));
                  return (
                    <tr key={r.id} style={{ borderTop: \`1px solid \${C.borderSoft}\` }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.customer}</td>
                      <td className="font-mono" style={{ padding: '10px 14px', color: C.copperDark, fontWeight: 700 }}>{r.assetCode}</td>
                      <td style={{ padding: '10px 14px', color: C.subtext }}>{r.assetName}</td>
                      <td className="font-mono" style={{ padding: '10px 14px' }}>{r.sentQty}</td>
                      <td className="font-mono" style={{ padding: '10px 14px', color: C.green, fontWeight: 600 }}>{r.returnedQty}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <Badge tone={pending > 10 ? 'amber' : pending > 0 ? 'blue' : 'green'}>{pending} pcs pending</Badge>
                      </td>
                      <td style={{ padding: '10px 14px', color: C.faint }}>{r.lastUpdated}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 4: UNIFIED MASTER CATALOG (consumables_master)
         ===================================================================== */}
      {subTab === 'catalog' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.subtext }}>
              Unified catalog (<code className="font-mono">consumables_master</code>) for plant tooling, graphite dies, lubricants, and packaging materials.
            </div>
            <Button icon={Plus} onClick={() => setShowAddCat(v => !v)}>{showAddCat ? 'Close' : 'Add Catalog Item'}</Button>
          </div>

          {showAddCat && (
            <Card style={{ marginBottom: 16, background: C.panelAlt }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12 }}>
                <TextField label="Item Code (e.g. DIE-15.0-TCT)" value={catForm.code} onChange={e => setCatForm({ ...catForm, code: e.target.value })} placeholder="DIE-15.0-TCT" />
                <TextField label="Item Description" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} placeholder="Carbide Die 15mm" />
                <SelectField label="Category" options={allCategories} value={catForm.category} onChange={e => setCatForm({ ...catForm, category: e.target.value })} />
                <SelectField label="Applies To (Line / Machine / Packing)" options={allAppliesTo} value={catForm.applies_to} onChange={e => setCatForm({ ...catForm, applies_to: e.target.value })} />
                <TextField label="Target Life Meters (Tools)" type="number" value={catForm.target_life_meters} onChange={e => setCatForm({ ...catForm, target_life_meters: e.target.value })} placeholder="5000" />
                <TextField label="Target Life kg (Tools)" type="number" value={catForm.target_life_kg} onChange={e => setCatForm({ ...catForm, target_life_kg: e.target.value })} placeholder="3500" />
                <TextField label="Std Qty per Output Unit (Packaging)" type="number" step="0.01" value={catForm.standard_qty_per_unit} onChange={e => setCatForm({ ...catForm, standard_qty_per_unit: e.target.value })} placeholder="1 or 0.05" />
                <TextField label="Unit Cost (₹)" type="number" value={catForm.unit_cost} onChange={e => setCatForm({ ...catForm, unit_cost: e.target.value })} placeholder="1450" />
                <TextField label="Min Stock Level (Reorder)" type="number" value={catForm.min_stock_level} onChange={e => setCatForm({ ...catForm, min_stock_level: e.target.value })} placeholder="20" />
                <TextField label="Opening Store Stock" type="number" value={catForm.stock_qty} onChange={e => setCatForm({ ...catForm, stock_qty: e.target.value })} placeholder="50" />
                <SelectField label="UOM" options={['pcs', 'kg', 'liters', 'rolls', 'sets']} value={catForm.uom} onChange={e => setCatForm({ ...catForm, uom: e.target.value })} />
              </div>

              {/* Add custom Category or Applies-To Machine/Packing unit on the fly */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: \`1px solid \${C.borderSoft}\` }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={newCatInput} onChange={e => setNewCatInput(e.target.value)} placeholder="Add custom category…" style={{ padding: '6px 10px', borderRadius: 6, border: \`1px solid \${C.border}\`, fontSize: 12.5 }} />
                  <Button variant="secondary" onClick={() => { if (newCatInput.trim()) { setCustomCategories(p => [...p, newCatInput.trim()]); setCatForm(f => ({ ...f, category: newCatInput.trim() })); setNewCatInput(''); } }}>+ Category</Button>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={newAppliesInput} onChange={e => setNewAppliesInput(e.target.value)} placeholder="Add machine / packing unit…" style={{ padding: '6px 10px', borderRadius: 6, border: \`1px solid \${C.border}\`, fontSize: 12.5 }} />
                  <Button variant="secondary" onClick={() => { if (newAppliesInput.trim()) { setCustomApplies(p => [...p, newAppliesInput.trim()]); setCatForm(f => ({ ...f, applies_to: newAppliesInput.trim() })); setNewAppliesInput(''); } }}>+ Applies To</Button>
                </div>
                <Button onClick={handleAddMasterCatalogItem}>Save Item to Master Catalog</Button>
              </div>
            </Card>
          )}

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 920 }}>
                <thead>
                  <tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                    <th style={thStyle}>Code</th>
                    <th style={thStyle}>Description</th>
                    <th style={thStyle}>Category</th>
                    <th style={thStyle}>Applies To</th>
                    <th style={thStyle}>Target Life (Tools)</th>
                    <th style={thStyle}>Std BOM Qty (Pack)</th>
                    <th style={thStyle}>Unit Cost</th>
                    <th style={thStyle}>Store Stock</th>
                    <th style={thStyle}>Min Reorder</th>
                  </tr>
                </thead>
                <tbody>
                  {masterList.map(item => {
                    const low = Number(item.stock_qty) <= Number(item.min_stock_level);
                    return (
                      <tr key={item.id} style={{ borderTop: \`1px solid \${C.borderSoft}\`, background: low ? C.redSoft : 'transparent' }}>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700, color: C.copperDark }}>{item.code}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{item.name}</td>
                        <td style={{ padding: '10px 14px' }}><Badge tone={TOOL_CATEGORY_SET.has(item.category) ? 'copper' : 'default'}>{item.category}</Badge></td>
                        <td style={{ padding: '10px 14px', color: C.subtext }}>{item.applies_to}</td>
                        <td className="font-mono" style={{ padding: '10px 14px' }}>
                          {item.target_life_meters ? \`\${Number(item.target_life_meters).toLocaleString()} m\` : '—'}
                          {item.target_life_kg ? \` / \${Number(item.target_life_kg).toLocaleString()} kg\` : ''}
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px' }}>
                          {item.standard_qty_per_unit ? \`\${item.standard_qty_per_unit} \${item.uom}/unit\` : '—'}
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 600 }}>₹{Number(item.unit_cost).toLocaleString('en-IN')}</td>
                        <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700, color: low ? C.red : C.green }}>
                          {item.stock_qty} {item.uom} {low && '⚠️'}
                        </td>
                        <td className="font-mono" style={{ padding: '10px 14px', color: C.subtext }}>{item.min_stock_level} {item.uom}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 5: CONSUMPTION & TRANSACTION LOGS (consumables_transactions)
         ===================================================================== */}
      {subTab === 'transactions' && (
        <div>
          <Card style={{ marginBottom: 16, background: C.panelAlt }}>
            <SectionTitle sub="Issue consumables or tools from Stores to a machine or packing station (Mounted, Issued for Packing, Scrapped, Returned).">
              Log Store Consumption / Tool Transaction
            </SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
              <SelectField
                label="Catalog Item"
                options={masterList.map(m => ({ value: m.id, label: \`\${m.code} — \${m.name}\` }))}
                value={txForm.consumable_id}
                onChange={e => setTxForm({ ...txForm, consumable_id: e.target.value })}
              />
              <TextField label="Tool Serial ID (if applicable)" value={txForm.instance_id} onChange={e => setTxForm({ ...txForm, instance_id: e.target.value })} placeholder="e.g. D-4091" />
              <SelectField label="Machine / Packing Station" options={allAppliesTo.filter(a => a !== 'All')} value={txForm.machine_id} onChange={e => setTxForm({ ...txForm, machine_id: e.target.value })} />
              <TextField label="Production Order / Batch ID" value={txForm.production_order_id} onChange={e => setTxForm({ ...txForm, production_order_id: e.target.value })} placeholder="e.g. 100000045" />
              <SelectField label="Action" options={TX_ACTIONS} value={txForm.action} onChange={e => setTxForm({ ...txForm, action: e.target.value })} />
              <TextField label="Qty Issued / Returned" type="number" step="0.01" value={txForm.qty_issued} onChange={e => setTxForm({ ...txForm, qty_issued: e.target.value })} />
              <SelectField label="Reason for Removal" options={REMOVAL_REASONS} value={txForm.reason_for_removal} onChange={e => setTxForm({ ...txForm, reason_for_removal: e.target.value })} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={handleLogManualTx}>Post Store Transaction</Button>
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {transactions.length === 0 ? (
              <EmptyState title="No store transactions logged yet." sub="Issue a packing kit or post a tool transaction above." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                  <thead>
                    <tr style={{ background: C.panelAlt, textAlign: 'left' }}>
                      <th style={thStyle}>Tx ID / Time</th>
                      <th style={thStyle}>Item / Tool ID</th>
                      <th style={thStyle}>Machine / Station</th>
                      <th style={thStyle}>Prod. Order</th>
                      <th style={thStyle}>Action</th>
                      <th style={thStyle}>Qty</th>
                      <th style={thStyle}>Removal / Variance Reason</th>
                      <th style={thStyle}>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => {
                      const cat = masterById[tx.consumable_id] || {};
                      return (
                        <tr key={tx.id} style={{ borderTop: \`1px solid \${C.borderSoft}\` }}>
                          <td className="font-mono" style={{ padding: '10px 14px', fontSize: 12 }}>
                            <strong>{tx.id}</strong>
                            <div style={{ color: C.faint }}>{formatDateTime(tx.at)}</div>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontWeight: 600 }}>{cat.code || tx.consumable_id} — {cat.name || ''}</div>
                            {tx.instance_id && <div className="font-mono" style={{ fontSize: 11.5, color: C.copperDark }}>Serial: {tx.instance_id}</div>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>{tx.machine_id}</td>
                          <td className="font-mono" style={{ padding: '10px 14px' }}>{tx.production_order_id || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <Badge tone={tx.action === 'Scrapped' ? 'red' : tx.action === 'Returned' ? 'green' : 'copper'}>{tx.action}</Badge>
                          </td>
                          <td className="font-mono" style={{ padding: '10px 14px', fontWeight: 700 }}>{tx.qty_issued} {cat.uom || ''}</td>
                          <td style={{ padding: '10px 14px', color: C.subtext }}>{tx.reason_for_removal || '—'}</td>
                          <td style={{ padding: '10px 14px', color: C.subtext }}>{tx.by || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

`;

  code = code.slice(0, startIdx) + replacementToolingTab + code.slice(endIdx);
  console.log('✅ Applied Patch 3: Upgraded ToolingTab with Master Catalog, Serialized Lifecycle, 85% Wear Gauge, Re-boring, Packaging BOM & Returnables');
  appliedCount++;
}

// ============================================================================
// PATCH 4: Extend Cost of Production (BatchCostingCard) to show explicit
//          Tooling Cost per kg & Packaging Cost per kg sub-headings
// ============================================================================
const costCardTarget = `<span>Conversion: <strong className="font-mono">{ratePerHr ? \`₹\${ratePerHr.toLocaleString('en-IN')}/hour\` : 'not set'}</strong></span>`;
const costCardReplacement = `<span>Conversion: <strong className="font-mono">{ratePerHr ? \`₹\${ratePerHr.toLocaleString('en-IN')}/hour\` : 'not set'}</strong></span>
        {(() => {
          const gran = computeGranularConsumableCosts({ batches, month });
          return (
            <>
              <span style={{ padding: '4px 10px', borderRadius: 6, background: C.copperFaint, color: C.copperDark, fontWeight: 600 }}>
                Tooling Cost/kg (Dies, Plugs & Rings Amortized): <strong className="font-mono">₹{gran.toolingCostPerKg.toFixed(2)}/kg</strong>
              </span>
              <span style={{ padding: '4px 10px', borderRadius: 6, background: C.greenSoft, color: C.green, fontWeight: 600 }}>
                Packaging Cost/kg (Bobbins, Pallets, Straps, Film & Caps): <strong className="font-mono">₹{gran.packagingCostPerKg.toFixed(2)}/kg</strong>
              </span>
            </>
          );
        })()}`;

if (code.includes(costCardTarget) && !code.includes('Tooling Cost/kg (Dies, Plugs & Rings Amortized)')) {
  code = code.replace(costCardTarget, costCardReplacement);
  console.log('✅ Applied Patch 4: Added Granular Tooling Cost/kg & Packaging Cost/kg sub-headings to Cost of Production');
  appliedCount++;
}

// Write final updated file
fs.writeFileSync(targetPath, hasCRLF ? code.replace(/\n/g, '\r\n') : code, 'utf8');
console.log(`\n🎉 Successfully applied ${appliedCount} patches to ${targetPath} in 1 second!`);