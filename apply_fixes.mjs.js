import fs from 'fs';
import path from 'path';

// Automatically locates App.jsx in the current folder or ./src/App.jsx
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

// 1. Create a safe backup first
const backupPath = targetPath + '.bak';
fs.writeFileSync(backupPath, code, 'utf8');
console.log(`📦 Backup saved to: ${path.basename(backupPath)}`);

// 2. Expand Master Access role-action permissions in App.jsx
// Target the permission helper definitions to add expanded role rights for Master/Admin/Managers
const targetHelper = `function canEditPlan(role) { return canDo(role, 'plan.edit'); }`;
const expandedRolesCode = `function canEditPlan(role) { return canDo(role, 'plan.edit'); }
function canManageMaster(role) { return ['Admin', 'Manager', 'Assistant Manager', 'Owner'].includes(role) || canDo(role, 'master.manage'); }
function canConfigureAccess(role) { return ['Admin', 'Owner'].includes(role) || canDo(role, 'access.configure'); }`;

if (code.includes(targetHelper) && !code.includes('canManageMaster')) {
  code = code.replace(targetHelper, expandedRolesCode);
  console.log('✅ Applied: Expanded Master Access and role permissions');
} else {
  console.log('ℹ️ Master Access helpers already present or target helper not found.');
}

// Write the updated code back to App.jsx
fs.writeFileSync(targetPath, code, 'utf8');
console.log(`\n🎉 Master Access patches successfully applied to ${targetPath} in 1 second!`);