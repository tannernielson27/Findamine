/**
 * In-memory stand-in for the `@supabase/supabase-js` service-role client
 * (build plan H8). Supports exactly the query-builder surface the research
 * services use; anything else throws with the method name so a test can never
 * pass by accident on a silently-empty result.
 *
 * Usage in a test file (the mock factory must be hoisted, so it lives there):
 *
 *   vi.mock("@/lib/supabase/server", async () => {
 *     const m = await import("@/__tests__/support/supabase-double");
 *     return {
 *       createSupabaseServiceClient: async () => m.current().client,
 *       createSupabaseServerClient: async () => m.current().client,
 *     };
 *   });
 *   const db = installDouble({ users: [...] });
 */

import { randomUUID } from "crypto";

export type Row = Record<string, unknown>;
type Tables = Map<string, Row[]>;

export interface EmbedSpec {
  /** Table the embed reads from. */
  table: string;
  /** Column on the parent row holding the foreign key. */
  localKey: string;
  /** Column on the embedded table matched against localKey (default "id"). */
  foreignKey?: string;
}

export interface DoubleOptions {
  /** Unique constraints: table → list of column tuples. Violations return error 23505. */
  unique?: Record<string, string[][]>;
  /** Embedded-relation registry: table → relation name → spec. Merged over DEFAULT_EMBEDS. */
  embeds?: Record<string, Record<string, EmbedSpec>>;
  /** rpc handlers by function name. */
  rpc?: Record<string, (args: Row) => unknown>;
  /** Bearer tokens → auth user (for getAuthUser's Bearer path). */
  authTokens?: Record<string, { id: string }>;
}

/** Relations the research code selects through `rel(cols)` syntax. */
export const DEFAULT_EMBEDS: Record<string, Record<string, EmbedSpec>> = {
  treatment_study_dimensions: {
    treatment_dimensions: { table: "treatment_dimensions", localKey: "dimension_id" },
  },
  dimension_assignments: {
    treatment_dimensions: { table: "treatment_dimensions", localKey: "dimension_id" },
  },
  survey_schedules: { surveys: { table: "surveys", localKey: "survey_id" } },
  survey_deliveries: { surveys: { table: "surveys", localKey: "survey_id" } },
  minion_links: {},
};

export const DEFAULT_UNIQUE: Record<string, string[][]> = {
  dimension_assignments: [["user_id", "dimension_id"]],
  study_enrollments: [["study_id", "user_id"]],
  minion_links: [["minion_id"]],
  referral_codes: [["user_id"], ["code"]],
  consent_records: [],
};

type Filter = (row: Row) => boolean;
type Op = "select" | "insert" | "upsert" | "update" | "delete";

interface Result<T = unknown> {
  data: T;
  error: { code?: string; message: string } | null;
  count: number | null;
}

class Unsupported extends Error {
  constructor(what: string) {
    super(`supabase-double: unsupported ${what}`);
  }
}

function getPath(row: Row, col: string): unknown {
  return row[col];
}

function eq(a: unknown, b: unknown): boolean {
  return a === b || (a == null && b == null) || String(a) === String(b);
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Split a select string on top-level commas (ignoring commas inside parens). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

class Query implements PromiseLike<Result> {
  private op: Op | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private selectCols = "*";
  private countMode: "exact" | null = null;
  private headOnly = false;
  private singleMode: "single" | "maybe" | null = null;
  private payload: Row | Row[] | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private returning = false;

  constructor(private db: SupabaseDouble, private table: string) {}

  // ── verbs ─────────────────────────────────────────────────────
  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.op === null) this.op = "select";
    else this.returning = true;
    this.selectCols = cols;
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = rows;
    this.upsertOpts = opts;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  // ── filters ───────────────────────────────────────────────────
  eq(col: string, val: unknown) {
    this.filters.push((r) => eq(getPath(r, col), val));
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => !eq(getPath(r, col), val));
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals.map(String));
    this.filters.push((r) => set.has(String(getPath(r, col))));
    return this;
  }
  is(col: string, val: null | boolean) {
    this.filters.push((r) => {
      const v = getPath(r, col);
      return val === null ? v === null || v === undefined : v === val;
    });
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => cmp(getPath(r, col), val) >= 0);
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => cmp(getPath(r, col), val) <= 0);
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push((r) => cmp(getPath(r, col), val) > 0);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => cmp(getPath(r, col), val) < 0);
    return this;
  }
  not(col: string, operator: string, val: unknown) {
    if (operator !== "is") throw new Unsupported(`not(${operator})`);
    this.filters.push((r) => {
      const v = getPath(r, col);
      return val === null ? !(v === null || v === undefined) : v !== val;
    });
    return this;
  }
  /** `a.eq.x,b.eq.y` → any clause matches. */
  or(expr: string) {
    const clauses = expr.split(",").map((c) => {
      const [col, operator, ...rest] = c.split(".");
      const val = rest.join(".");
      if (operator === "eq") return (r: Row) => eq(getPath(r, col), val);
      if (operator === "is") return (r: Row) => (val === "null" ? getPath(r, col) == null : getPath(r, col) === (val === "true"));
      throw new Unsupported(`or(${operator})`);
    });
    this.filters.push((r) => clauses.some((c) => c(r)));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  // ── execution ─────────────────────────────────────────────────
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled ?? undefined, onrejected ?? undefined) as Promise<T1 | T2>;
  }

  private rows(): Row[] {
    return this.db.table(this.table);
  }

  private matching(): Row[] {
    return this.rows().filter((r) => this.filters.every((f) => f(r)));
  }

  private project(row: Row): Row {
    if (this.selectCols.trim() === "*") return { ...row };
    const out: Row = {};
    for (const token of splitTop(this.selectCols)) {
      const paren = token.indexOf("(");
      if (paren === -1) {
        if (token === "*") Object.assign(out, row);
        else out[token] = row[token];
        continue;
      }
      const head = token.slice(0, paren);
      const inner = token.slice(paren + 1, token.lastIndexOf(")"));
      let alias = head;
      let spec: EmbedSpec | undefined;
      if (head.includes(":")) {
        // alias:fk_column(cols) → embedded table named by the alias.
        const [a, fk] = head.split(":");
        alias = a;
        spec = { table: a, localKey: fk };
      } else {
        spec = this.db.embeds[this.table]?.[head];
      }
      if (!spec) throw new Unsupported(`embed ${this.table}.${head} (register it in DoubleOptions.embeds)`);
      const fk = spec.foreignKey ?? "id";
      const target = this.db.table(spec.table).find((t) => eq(t[fk], row[spec!.localKey]));
      if (!target) {
        out[alias] = null;
        continue;
      }
      const sub: Row = {};
      for (const c of splitTop(inner)) sub[c] = c === "*" ? undefined : target[c];
      out[alias] = inner.trim() === "*" ? { ...target } : sub;
    }
    return out;
  }

  private finish(data: Row[]): Result {
    let rows = data;
    for (const o of [...this.orderBy].reverse()) {
      rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    const projected = rows.map((r) => this.project(r));
    if (this.singleMode === "single") {
      if (projected.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: `expected one row, got ${projected.length}` }, count: null };
      }
      return { data: projected[0], error: null, count: null };
    }
    if (this.singleMode === "maybe") {
      if (projected.length > 1) {
        return { data: null, error: { code: "PGRST116", message: `expected at most one row, got ${projected.length}` }, count: null };
      }
      return { data: projected[0] ?? null, error: null, count: null };
    }
    return { data: projected, error: null, count: null };
  }

  private violates(row: Row, exclude?: Row): { code: string; message: string } | null {
    for (const cols of this.db.unique[this.table] || []) {
      const clash = this.rows().find(
        (r) => r !== exclude && cols.every((c) => r[c] !== undefined && eq(r[c], row[c]))
      );
      if (clash) return { code: "23505", message: `duplicate key on ${this.table}(${cols.join(",")})` };
    }
    return null;
  }

  private stamp(row: Row): Row {
    const out = { ...row };
    if (out.id === undefined) out.id = randomUUID();
    if (out.created_at === undefined) out.created_at = new Date().toISOString();
    return out;
  }

  private execute(): Result {
    this.db.log.push({ table: this.table, op: this.op ?? "select" });
    switch (this.op) {
      case null:
      case "select": {
        const rows = this.matching();
        if (this.countMode) {
          if (this.headOnly) return { data: null, error: null, count: rows.length };
          const r = this.finish(rows);
          return { ...r, count: rows.length };
        }
        return this.finish(rows);
      }
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const stamped: Row[] = [];
        for (const r of list) {
          const s = this.stamp(r);
          const v = this.violates(s);
          if (v) return { data: null, error: v, count: null };
          stamped.push(s);
        }
        this.rows().push(...stamped);
        return this.returning ? this.finish(stamped) : { data: null, error: null, count: null };
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const cols = (this.upsertOpts.onConflict || "id").split(",").map((c) => c.trim());
        const touched: Row[] = [];
        for (const r of list) {
          const existing = this.rows().find((x) => cols.every((c) => eq(x[c], r[c])));
          if (existing) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, r);
            touched.push(existing);
          } else {
            const s = this.stamp(r);
            const v = this.violates(s);
            if (v) return { data: null, error: v, count: null };
            this.rows().push(s);
            touched.push(s);
          }
        }
        return this.returning ? this.finish(touched) : { data: null, error: null, count: null };
      }
      case "update": {
        const rows = this.matching();
        for (const r of rows) Object.assign(r, this.payload as Row);
        return this.returning ? this.finish(rows) : { data: null, error: null, count: null };
      }
      case "delete": {
        const doomed = new Set(this.matching());
        const kept = this.rows().filter((r) => !doomed.has(r));
        this.db.replace(this.table, kept);
        return this.returning ? this.finish([...doomed]) : { data: null, error: null, count: null };
      }
    }
  }
}

export class SupabaseDouble {
  readonly tables: Tables = new Map();
  readonly unique: Record<string, string[][]>;
  readonly embeds: Record<string, Record<string, EmbedSpec>>;
  readonly rpcHandlers: Record<string, (args: Row) => unknown>;
  readonly authTokens: Record<string, { id: string }>;
  /** Every executed statement, for asserting "exactly N inserts" etc. */
  readonly log: { table: string; op: Op }[] = [];

  constructor(seed: Record<string, Row[]> = {}, opts: DoubleOptions = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables.set(t, rows.map((r) => ({ ...r })));
    this.unique = { ...DEFAULT_UNIQUE, ...(opts.unique || {}) };
    this.embeds = { ...DEFAULT_EMBEDS };
    for (const [t, rels] of Object.entries(opts.embeds || {})) this.embeds[t] = { ...(this.embeds[t] || {}), ...rels };
    this.rpcHandlers = opts.rpc || {};
    this.authTokens = opts.authTokens || {};
  }

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
  replace(name: string, rows: Row[]) {
    this.tables.set(name, rows);
  }
  /** Convenience: rows of a table matching a predicate. */
  where(name: string, pred: (r: Row) => boolean): Row[] {
    return this.table(name).filter(pred);
  }

  /** The object handed to service code in place of the real client. */
  readonly client = {
    from: (table: string) => new Query(this, table),
    rpc: async (name: string, args: Row = {}) => {
      const h = this.rpcHandlers[name];
      if (!h) throw new Unsupported(`rpc ${name}`);
      try {
        return { data: h(args), error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    auth: {
      getUser: async (token?: string) => ({
        data: { user: token && this.authTokens[token] ? { id: this.authTokens[token].id } : null },
        error: null,
      }),
    },
    channel: () => {
      throw new Unsupported("realtime channel");
    },
  };
}

let active: SupabaseDouble | null = null;

/** Create a double and make it the one the mocked client factory returns. */
export function installDouble(seed: Record<string, Row[]> = {}, opts: DoubleOptions = {}): SupabaseDouble {
  active = new SupabaseDouble(seed, opts);
  return active;
}

/** The double currently installed (used by the vi.mock factory). */
export function current(): SupabaseDouble {
  if (!active) throw new Error("supabase-double: call installDouble() in the test first");
  return active;
}

/** Days ago as an ISO timestamp — handy for enrollment ages and schedules. */
export function daysAgo(n: number, from: number = Date.now()): string {
  return new Date(from - n * 86_400_000).toISOString();
}
