/**
 * Static audit: every `.from("table").select("cols")` in src/ checked against
 * the real database schema.
 *
 * Why this exists: PostgREST rejects the WHOLE query when one column does not
 * exist, and most call sites treat a failed read as "no row" — so a renamed or
 * imagined column degrades silently instead of throwing. That is how
 * users.age_band went unnoticed across five call sites, including /auth/me,
 * which the privacy page depends on, and the research export, which emitted a
 * blank role for every participant as a result.
 *
 * Usage:
 *   psql "$DATABASE_URL" -t -A -c "<columns query>" > schema.json
 *   psql "$DATABASE_URL" -t -A -c "<fk query>"      > fks.json
 *   node scripts/dry-run/schema-audit.mjs schema.json fks.json
 *
 * PostgREST syntax handled:
 *   plain columns            id, created_at
 *   aliases                  alias:column
 *   casts                    column::text
 *   embeds                   related_table(cols)
 *   aliased embeds           alias:related_table(cols)
 *   FK-hinted embeds         users!requester_id(cols)
 *   join modifiers           related_table!inner(cols)
 *   FK-column embeds         student_id(cols)   -- embeds via that FK column
 *   nested embeds            a(b(cols))
 *
 * Exit code 1 if anything is unknown.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const [schemaPath, fkPath] = process.argv.slice(2);
if (!schemaPath || !fkPath) {
  console.error("usage: node scripts/dry-run/schema-audit.mjs <schema.json> <fks.json>");
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const fks = JSON.parse(readFileSync(fkPath, "utf8"));
const JOIN_MODIFIERS = new Set(["inner", "left", "right", "full"]);
const SRC = "src";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Split a select string on commas that sit outside parentheses. */
function splitTopLevel(select) {
  const items = [];
  let depth = 0;
  let cur = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Resolve an embed head (`alias:table!hint`) to the relation it names. */
function relationName(head) {
  let name = head.trim();
  if (name.includes(":")) name = name.split(":").pop().trim();
  if (name.includes("!")) {
    const [table, hint] = name.split("!").map((s) => s.trim());
    // `users!fk(...)` → users. `table!inner(...)` → table.
    name = JOIN_MODIFIERS.has(hint) ? table : table;
  }
  return name;
}

/** Check one select string against `table`, recursing into embeds. */
function checkSelect(table, select, report) {
  const known = schema[table];
  if (!known) {
    report(`table "${table}" does not exist`);
    return;
  }
  for (const item of splitTopLevel(select)) {
    const open = item.indexOf("(");
    if (open !== -1 && item.endsWith(")")) {
      const head = relationName(item.slice(0, open));
      const inner = item.slice(open + 1, -1);
      // Valid if it names a table, or embeds through one of this table's FK columns.
      const viaTable = !!schema[head];
      const viaFk = (fks[table] ?? []).includes(head);
      if (!viaTable && !viaFk) {
        report(`embedded relation "${head}" is neither a table nor a foreign key on ${table}`);
        continue;
      }
      if (viaTable) checkSelect(head, inner, report);
      continue;
    }
    let col = item.split("::")[0].trim();
    if (col.includes(":")) col = col.split(":").pop().trim();
    if (!col || col === "*" || col === "count") continue;
    if (!/^[a-z_][a-z0-9_]*$/i.test(col)) continue;
    if (!known.includes(col)) report(`column "${col}" does not exist on ${table}`);
  }
}

const findings = [];
let checked = 0;

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const re = /\.from\(\s*["'`](\w+)["'`]\s*\)([\s\S]{0,400}?)\.select\(\s*["'`]([^"'`]*)["'`]/g;
  for (const m of text.matchAll(re)) {
    const [, table, between, select] = m;
    if (between.includes(".from(")) continue; // the select belongs to another statement
    const line = text.slice(0, m.index).split("\n").length;
    const where = `${relative(process.cwd(), file).replace(/\\/g, "/")}:${line}`;
    checked++;
    checkSelect(table, select, (problem) => findings.push({ where, problem }));
  }
}

console.log(`checked ${checked} select() call sites against ${Object.keys(schema).length} tables\n`);
if (findings.length === 0) {
  console.log("no unknown tables or columns");
  process.exit(0);
}
for (const f of findings) console.log(`  ${f.where}\n    ${f.problem}`);
console.log(`\n${findings.length} problem(s)`);
process.exit(1);
