/**
 * Condition context helpers (B5).
 *
 * A participant's assigned experimental conditions live in `users.metadata`
 * under a handful of legacy keys plus a generic `dim_<dimension>` convention.
 * This maps that metadata into a `{ <dimension name>: <level> }` object, which
 * is what gets stamped onto every privacy_events / privacy_index_snapshots row
 * (the `conditions` JSONB column, migration 053) and read back by the exports.
 *
 * Pure — no I/O — so it is unit tested directly.
 */

/** Legacy metadata key → treatment dimension name. */
export const LEGACY_CONDITION_KEYS: Readonly<Record<string, string>> = {
  privacy_treatment: "privacy_control_complexity",
  privacy_default: "privacy_default",
  privacy_friction: "privacy_friction",
};

/** Prefix for generic per-dimension metadata keys: `dim_<dimension name>`. */
export const DIMENSION_META_PREFIX = "dim_";

/**
 * Map `users.metadata` → `{ dimensionName: level }`.
 *
 * - Legacy keys are renamed (`privacy_treatment` → `privacy_control_complexity`).
 * - Any key starting with `dim_` is passed through with the prefix stripped,
 *   so a newly linked dimension needs no code change here.
 * - Only non-empty string levels are kept; null/undefined/non-string values
 *   (e.g. `privacy_default: null` when the factor is not crossed) are dropped.
 * - When both a legacy key and a `dim_` key name the same dimension, the
 *   `dim_` key wins (it is the more explicit, newer convention).
 */
export function conditionsFromMetadata(
  meta: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!meta) return {};

  const legacy = Object.entries(LEGACY_CONDITION_KEYS).flatMap(([metaKey, dimension]) => {
    const level = meta[metaKey];
    return isLevel(level) ? [[dimension, level] as const] : [];
  });

  const generic = Object.entries(meta).flatMap(([key, level]) => {
    if (!key.startsWith(DIMENSION_META_PREFIX)) return [];
    const dimension = key.slice(DIMENSION_META_PREFIX.length);
    return dimension && isLevel(level) ? [[dimension, level] as const] : [];
  });

  return Object.fromEntries([...legacy, ...generic]);
}

function isLevel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
