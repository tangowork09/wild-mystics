// Validates the generated roster (src/data/lines.ts + src/data/forms.ts + docs/v3/creature-art.json)
// against the rules in the task. Checks against the FROZEN baseline snapshot of the original 160
// species (_existing-registry.tsv) rather than the live species.ts, because species.ts is being
// concurrently rewritten by another agent (the "lead") to merge LINES/NEW_FORMS in — by the time this
// runs, species.ts may already legitimately contain all of NEW_FORMS, which is not an error.
// Run with: npx tsx tools/roster/validate.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINES } from '../../src/data/lines';
import { NEW_FORMS } from '../../src/data/forms';
import { SKILLS } from '../../src/data/skills';
import { ABILITIES } from '../../src/data/traits';

const ROOT = '/Users/tango/expedition-wilds';
let errors: string[] = [];
let warnings: string[] = [];
const err = (s: string) => errors.push(s);
const warn = (s: string) => warnings.push(s);

const STONE_ITEMS = new Set(['fire_stone', 'water_stone', 'leaf_stone', 'earth_stone', 'thunder_stone', 'wind_stone', 'void_stone']);
const ELEMENTS = new Set(['fire', 'water', 'nature', 'earth', 'storm', 'wind', 'void']);
const skillIds = new Set(Object.keys(SKILLS));
const abilityIds = new Set(Object.keys(ABILITIES));

// ── Frozen baseline: the original 160 species (before any roster-pass edits) ────────────────────
interface Base { id: string; name: string; element: string; rarity: string; boss: boolean }
const registryRaw = readFileSync(join(ROOT, 'tools/roster/_existing-registry.tsv'), 'utf8').trim().split('\n');
const baseline: Base[] = registryRaw
  .map((line) => line.split('\t'))
  .filter((cols) => cols.length >= 4)
  .map(([id, name, element, rarity, boss]) => ({ id, name, element, rarity, boss: boss === 'BOSS' }));
console.log(`Baseline (frozen) existing species: ${baseline.length}`);

// ── Build merged map (baseline + new forms) for stage-existence / stat-cap checks ────────────────
type Mini = { id: string; name: string; element: string; hp: number; atk: number; def: number; spd: number; height: number; model: string; rarity: string };
const merged = new Map<string, Mini>();
for (const b of baseline) merged.set(b.id, { id: b.id, name: b.name, element: b.element, hp: 0, atk: 0, def: 0, spd: 0, height: 0, model: '', rarity: b.rarity });

const newIds = new Set<string>();
const idDupes: string[] = [];
for (const [row, lore] of NEW_FORMS) {
  const [id, name, element, hp, atk, def, spd, height, model, learnset, extra] = row as any;
  if (merged.has(id) && baseline.some((b) => b.id === id)) idDupes.push(`${id} (collides with existing baseline species)`);
  if (newIds.has(id)) idDupes.push(`${id} (duplicate within NEW_FORMS)`);
  newIds.add(id);
  merged.set(id, { id, name, element, hp, atk, def, spd, height, model, rarity: extra?.rarity ?? 'common' });
  if (!lore || typeof lore !== 'string' || lore.length < 5) err(`NEW_FORMS ${id}: missing/short lore`);
}
if (idDupes.length) err(`Id problems in NEW_FORMS: ${idDupes.join(', ')}`);

// ── id / name uniqueness (global: baseline ∪ new) ────────────────────────────────────────────────
const nameOwners = new Map<string, string[]>();
for (const b of baseline) nameOwners.set(b.name.trim().toLowerCase(), [...(nameOwners.get(b.name.trim().toLowerCase()) ?? []), b.id]);
for (const [row] of NEW_FORMS) {
  const [id, name] = row as any;
  const key = String(name).trim().toLowerCase();
  nameOwners.set(key, [...(nameOwners.get(key) ?? []), id]);
}
for (const [name, ids] of nameOwners) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 1) err(`Duplicate name "${name}": ids ${uniqueIds.join(', ')}`);
}

// ── LINES structural checks ──────────────────────────────────────────────────────────────────────
const mainLines = LINES.filter((l) => !l.branch);
const branchLines = LINES.filter((l) => l.branch);
console.log(`LINES total: ${LINES.length} (main ${mainLines.length}, branch ${branchLines.length})`);
if (mainLines.length !== 95) err(`Expected 95 main lines, got ${mainLines.length}`);
if (branchLines.length !== 9) err(`Expected 9 branch lines, got ${branchLines.length}`);

const legendaryIds = new Set(baseline.filter((b) => b.rarity === 'legendary' || b.boss).map((b) => b.id));
console.log(`Legendary/boss species (baseline): ${legendaryIds.size}`);

const lineIdSet = new Set<string>();
let totalNewFormsViaLines = 0;
for (const l of LINES) {
  if (lineIdSet.has(l.id)) err(`Duplicate LINE id: ${l.id}`);
  lineIdSet.add(l.id);
  if (!Array.isArray(l.stages) || l.stages.length !== 5) { err(`Line ${l.id}: stages length !== 5`); continue; }
  const seen = new Set<string>();
  for (const stageId of l.stages) {
    if (seen.has(stageId)) err(`Line ${l.id}: duplicate stage id ${stageId} within the line`);
    seen.add(stageId);
    if (!merged.has(stageId)) err(`Line ${l.id}: stage id "${stageId}" does not exist (not in baseline or NEW_FORMS)`);
    else if (newIds.has(stageId)) totalNewFormsViaLines++;
    if (legendaryIds.has(stageId)) err(`Line ${l.id}: stage id "${stageId}" is legendary/boss — must be excluded`);
  }
  if (l.branch) {
    if (!merged.has(l.branch.from)) err(`Line ${l.id}: branch.from "${l.branch.from}" does not exist`);
    if (!STONE_ITEMS.has(l.branch.item)) err(`Line ${l.id}: branch.item "${l.branch.item}" is not a valid stone item`);
    if (l.stages[0] !== l.branch.from) warn(`Line ${l.id}: stages[0] "${l.stages[0]}" !== branch.from "${l.branch.from}"`);
    const expectedId = `${l.branch.from}__${l.stages[1]}`;
    if (l.id !== expectedId) warn(`Branch line id "${l.id}" does not match convention "${expectedId}"`);
  }
  const s1 = merged.get(l.stages[0]);
  if (s1 && s1.rarity === 'legendary') err(`Line ${l.id}: stage 1 "${l.stages[0]}" is legendary — should be excluded`);
}
console.log(`NEW_FORMS: ${NEW_FORMS.length} rows; referenced from LINES stages: ${totalNewFormsViaLines}`);
if (NEW_FORMS.length !== totalNewFormsViaLines) warn(`NEW_FORMS.length (${NEW_FORMS.length}) != new stage-slots referenced by LINES (${totalNewFormsViaLines})`);

const stageIdSet = new Set(LINES.flatMap((l) => l.stages));
for (const id of newIds) if (!stageIdSet.has(id)) warn(`NEW_FORMS "${id}" is not referenced by any LINE stage`);

// ── skill & ability id validity + stat caps + height cap ─────────────────────────────────────────
for (const [row] of NEW_FORMS) {
  const [id, name, element, hp, atk, def, spd, height, model, learnset, extra] = row as any;
  if (!ELEMENTS.has(element)) err(`${id}: invalid element "${element}"`);
  if (!model || typeof model !== 'string') err(`${id}: missing model`);
  if (height > 3.4) err(`${id}: height ${height} exceeds 3.4m cap`);
  for (const [lvl, skillId] of learnset as [number, string][]) {
    if (!skillIds.has(skillId)) err(`${id}: learnset has invalid skill id "${skillId}" (level ${lvl})`);
  }
  const abilities: string[] = extra?.abilities ?? [];
  if (abilities.length !== 2) err(`${id}: abilities should have exactly 2 entries, got ${abilities.length}`);
  for (const a of abilities) if (!abilityIds.has(a)) err(`${id}: invalid ability id "${a}"`);
  if (!['common', 'rare', 'epic', 'exotic', 'legendary'].includes(extra?.rarity)) err(`${id}: invalid rarity "${extra?.rarity}"`);
}

// stat caps at stage 5 specifically (hp<=112, atk/def/spd<=30) — only checkable for NEW stage-5s
// (existing/baseline stage-5s are out of scope: we don't edit them, and the baseline snapshot has no stats).
for (const l of LINES) {
  const finalId = l.stages[4];
  if (!newIds.has(finalId)) continue; // baseline species: not ours to validate/cap
  const s = merged.get(finalId)!;
  if (s.hp > 112) err(`Line ${l.id} stage5 "${finalId}": hp ${s.hp} > 112 cap`);
  if (s.atk > 30) err(`Line ${l.id} stage5 "${finalId}": atk ${s.atk} > 30 cap`);
  if (s.def > 30) err(`Line ${l.id} stage5 "${finalId}": def ${s.def} > 30 cap`);
  if (s.spd > 30) err(`Line ${l.id} stage5 "${finalId}": spd ${s.spd} > 30 cap`);
}

// ── art prompts coverage ──────────────────────────────────────────────────────────────────────────
const artRaw = readFileSync(join(ROOT, 'docs/v3/creature-art.json'), 'utf8');
const art: { id: string; name: string; line: string; stage: number; element: string; prompt: string }[] = JSON.parse(artRaw);
console.log(`creature-art.json entries: ${art.length}`);

const artKey = (line: string, stage: number) => `${line}#${stage}`;
const artByKey = new Map<string, typeof art[number]>();
for (const a of art) {
  const k = artKey(a.line, a.stage);
  if (artByKey.has(k)) warn(`Duplicate prompt entry for line "${a.line}" stage ${a.stage}`);
  artByKey.set(k, a);
  if (!a.prompt || a.prompt.length < 15) err(`Prompt for ${a.id} (${a.line}#${a.stage}) is missing or too short`);
}
let missingPrompts = 0;
for (const l of LINES) {
  for (let stage = 1; stage <= 5; stage++) {
    const k = artKey(l.id, stage);
    const a = artByKey.get(k);
    if (!a) { err(`Missing art prompt for line "${l.id}" stage ${stage} (species "${l.stages[stage - 1]}")`); missingPrompts++; continue; }
    if (a.id !== l.stages[stage - 1]) warn(`Prompt for line "${l.id}" stage ${stage}: id "${a.id}" != expected stage species "${l.stages[stage - 1]}"`);
  }
}
for (const legId of legendaryIds) {
  const found = art.find((a) => a.id === legId);
  if (!found) err(`Missing art prompt for legendary/boss "${legId}"`);
}
console.log(`Missing line-stage prompts: ${missingPrompts}`);

// ── summary ────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`ERRORS: ${errors.length}`);
for (const e of errors) console.log('  ERROR: ' + e);
console.log(`WARNINGS: ${warnings.length}`);
for (const w of warnings.slice(0, 60)) console.log('  warn: ' + w);
if (warnings.length > 60) console.log(`  ...and ${warnings.length - 60} more warnings`);

if (errors.length) { console.log('\nFAIL'); process.exit(1); }
console.log('\nPASS');
