#!/usr/bin/env node
/**
 * Extracts all data from the MOG bundled.js into clean JSON files.
 * These are then converted to TypeScript modules in data/.
 */

const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '..', 'bundled.js');
const outDir = path.join(__dirname, '..', 'data', '_extracted');

fs.mkdirSync(outDir, { recursive: true });

const src = fs.readFileSync(bundlePath, 'utf8');
const lines = src.split('\n');

// --- Helper: extract a JS object literal from the source between line ranges ---
function extractBetweenLines(startLine, endLine) {
  // Lines are 1-indexed in the file
  return lines.slice(startLine - 1, endLine).join('\n');
}

// --- 1. Tags (Ie): lines 176-447 ---
console.log('Extracting tags...');
let tagsChunk = extractBetweenLines(176, 447);
// It starts with "const Ie = {" — extract just the object
tagsChunk = tagsChunk.replace(/^const Ie = /, '');
if (tagsChunk.endsWith('}')) tagsChunk = tagsChunk; // already clean
// Evaluate it
const tags = eval('(' + tagsChunk + ')');
fs.writeFileSync(path.join(outDir, 'tags.json'), JSON.stringify(tags, null, 2));
console.log(`  Tags: ${Object.keys(tags).length} entries`);

// --- 2. Entities (x): lines 448-8223 ---
console.log('Extracting entities...');
let entitiesChunk = extractBetweenLines(448, 8223);
// Starts with "    , x = {" — clean it
entitiesChunk = entitiesChunk.replace(/^\s*,\s*x\s*=\s*/, '');
// Handle void 0 → null
entitiesChunk = entitiesChunk.replace(/void 0/g, 'null');
const entities = eval('(' + entitiesChunk + ')');
fs.writeFileSync(path.join(outDir, 'entities.json'), JSON.stringify(entities, null, 2));
console.log(`  Entities: ${Object.keys(entities).length} entries`);

// --- 3. Colours (wt): lines 8261-8338 ---
console.log('Extracting colours...');
let coloursChunk = extractBetweenLines(8261, 8338);
coloursChunk = coloursChunk.replace(/^const wt = /, '');
// Remove trailing semicolon
coloursChunk = coloursChunk.replace(/;\s*$/, '');
const colours = eval('(' + coloursChunk + ')');
fs.writeFileSync(path.join(outDir, 'colours.json'), JSON.stringify(colours, null, 2));
console.log(`  Colours: ${Object.keys(colours).length} categories`);

// --- 4. Jurisdictions (je): lines 10203-10249 ---
console.log('Extracting jurisdictions...');
let jurChunk = extractBetweenLines(10203, 10249);
jurChunk = jurChunk.replace(/^const je = /, '');
jurChunk = jurChunk.replace(/;\s*$/, '');
const jurisdictions = eval('(' + jurChunk + ')');
fs.writeFileSync(path.join(outDir, 'jurisdictions.json'), JSON.stringify(jurisdictions, null, 2));
console.log(`  Jurisdictions: ${Object.keys(jurisdictions).length} entries`);

// --- 5. Jurisdiction hierarchy (Rt): lines 10250-10260 ---
console.log('Extracting jurisdiction hierarchy...');
let jurHierChunk = extractBetweenLines(10250, 10260);
jurHierChunk = jurHierChunk.replace(/^\s*,\s*Rt\s*=\s*/, '');
jurHierChunk = jurHierChunk.replace(/;\s*$/, '');
const jurHierarchy = eval('(' + jurHierChunk + ')');
fs.writeFileSync(path.join(outDir, 'jurisdiction-hierarchy.json'), JSON.stringify(jurHierarchy, null, 2));
console.log(`  Jurisdiction hierarchy: ${Object.keys(jurHierarchy).length} entries`);

// --- 6. Powers (Dt): lines 10267-14350 ---
console.log('Extracting powers...');
let powersChunk = extractBetweenLines(10267, 14350);
powersChunk = powersChunk.replace(/^const Dt = /, '');
// Handle void 0 → null
powersChunk = powersChunk.replace(/void 0/g, 'null');
const powers = eval('(' + powersChunk + ')');
fs.writeFileSync(path.join(outDir, 'powers.json'), JSON.stringify(powers, null, 2));
console.log(`  Powers: ${Object.keys(powers).length} officials`);

// --- 7. Budget data (mn): lines 14351-17655 ---
// This is complex — individual vars (Et, Lt, Ot, etc.) are defined first,
// then mn aggregates them. We need to eval the whole block.
console.log('Extracting budgets...');
let budgetBlock = extractBetweenLines(14351, 17655);
// Clean up: the block starts with ", Et = {" and ends with "}"
// We need to define all the individual vars, then mn
budgetBlock = budgetBlock.replace(/^\s*,\s*/, 'var ');
// Fix all subsequent ", VarName = {" patterns to ";\nvar VarName = {"
budgetBlock = budgetBlock.replace(/\n\s*,\s*(mn|[A-Z][a-z])\s*=/g, ';\nvar $1 =');
// Also fix the pattern where inline objects appear in mn
budgetBlock += ';\n';
// Eval the whole block and extract mn
const budgetFn = new Function(budgetBlock + 'return mn;');
const budgets = budgetFn();
fs.writeFileSync(path.join(outDir, 'budgets.json'), JSON.stringify(budgets, null, 2));
console.log(`  Budgets: ${Object.keys(budgets).length} departments`);

// --- 8. Staff data (Re): lines 17657 onwards ---
console.log('Extracting staff data...');
// Find where Re ends — look for the next top-level variable assignment or function
// Re starts at 17657 with ", Re = {"
// We need to find where this object ends.
// Search for the closing pattern
let reStartLine = 17657;
let braceCount = 0;
let reEndLine = reStartLine;
let started = false;
for (let i = reStartLine - 1; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '{') { braceCount++; started = true; }
    if (ch === '}') braceCount--;
  }
  if (started && braceCount <= 0) {
    reEndLine = i + 1;
    break;
  }
}
console.log(`  Staff data ends at line ${reEndLine}`);
let staffChunk = extractBetweenLines(reStartLine, reEndLine);
staffChunk = staffChunk.replace(/^\s*,\s*Re\s*=\s*/, '');
// Clean trailing
staffChunk = staffChunk.replace(/;\s*$/, '').trim();
// Make sure it ends with just }
if (!staffChunk.endsWith('}')) {
  // Find last }
  const lastBrace = staffChunk.lastIndexOf('}');
  staffChunk = staffChunk.substring(0, lastBrace + 1);
}
const staff = eval('(' + staffChunk + ')');
fs.writeFileSync(path.join(outDir, 'staff.json'), JSON.stringify(staff, null, 2));
console.log(`  Staff: ${Object.keys(staff).length} departments`);

// --- Summary ---
console.log('\nExtraction complete! Files written to:', outDir);
console.log('  tags.json');
console.log('  entities.json');
console.log('  colours.json');
console.log('  jurisdictions.json');
console.log('  jurisdiction-hierarchy.json');
console.log('  powers.json');
console.log('  budgets.json');
console.log('  staff.json');
