/**
 * Environment + shared constants for the H9 simulated-cohort dry run.
 *
 * The dry run imports the real services (enrollment, randomization, snapshots,
 * survey delivery, exports) and points them at a real database, so it needs the
 * same variables Next.js loads from .env.local. Nothing here is used by the app
 * itself; these files run only through vitest.dryrun.config.ts.
 *
 * Every row the dry run creates is tagged so teardown can find it again:
 *   users.email       ends with @DRY_RUN_EMAIL_DOMAIN
 *   users.metadata    carries dry_run: DRY_RUN_TAG
 *   the study row     has study_code = DRY_RUN_STUDY_CODE
 */

import { readFileSync } from "fs";
import { resolve } from "path";

export const DRY_RUN_TAG = "h9_dry_run";
export const DRY_RUN_STUDY_CODE = "h9_dry_run";
export const DRY_RUN_EMAIL_DOMAIN = "h9-dryrun.invalid";
export const DRY_RUN_ROSTER_PREFIX = "H9 Dry Run Section";

/** Participants to simulate, and the span of the simulated study. */
export const COHORT_SIZE = 60;
export const STUDY_DAYS = 42;

/** Load .env.local into process.env without adding a dotenv dependency. */
export function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`.env.local not found at ${path} — the dry run needs the study database credentials`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue; // never override an explicitly-set value
    process.env[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`.env.local is missing: ${missing.join(", ")}`);
}

/**
 * Guard against pointing the dry run at a database that already holds real
 * participants. The study database is expected to be clean until the pilot; if
 * it is not, the operator must decide explicitly.
 */
export function describeTarget(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)";
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? url;
  return ref;
}

/** Deterministic PRNG so a dry run is reproducible from its seed. */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/** ISO timestamp `days` before `end` (default: now), preserving time of day. */
export function daysBefore(days: number, end: Date = new Date()): string {
  return new Date(end.getTime() - days * 86_400_000).toISOString();
}

/** Pick one element using the injected PRNG. */
export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
