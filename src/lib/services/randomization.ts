/**
 * Stratified Block Randomization Service
 *
 * Implements between-subjects treatment assignment with:
 * - Balanced allocation over the JOINT factorial cells (not per-dimension), so a
 *   3×3 design stays balanced across all 9 cells rather than only on each margin.
 * - Stratification: balance is computed within the participant's stratum
 *   (e.g. age band, school), so each stratum is independently balanced.
 * - Minimization / least-filled-cell allocation with a random tie-break. This
 *   keeps the maximum imbalance between cells within a stratum to ≤ 1 at all
 *   times — the same balance guarantee a permuted block gives, without having to
 *   persist block state (which the previous global greedy min-count did not do,
 *   and which its unused `blockSize` implied but never implemented).
 * - Per-study level subsets: a study may cross only some of a dimension's
 *   levels via treatment_study_dimensions.active_levels (migration 052).
 * - Balance checking across cells (checkBalance).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";

export interface RandomizationConfig {
  studyId: string;
  dimensionIds: string[];
  stratifyBy?: ("age_band" | "school_id")[];
  /**
   * Per-study level subset per dimension id (treatment_study_dimensions.active_levels).
   * When omitted, assignParticipant loads it from the study's link rows itself.
   */
  activeLevels?: Record<string, string[] | null | undefined>;
  /** @deprecated Superseded by least-filled-cell minimization; kept for callers. */
  blockSize?: number;
}

export interface AssignmentResult {
  userId: string;
  assignments: { dimensionId: string; level: string }[];
}

/** The subset of a treatment_dimensions row the pure helpers need. */
export interface DimensionLevels {
  id?: string;
  name?: string;
  levels: string[];
}

/** Cartesian product of each dimension's levels → one array of levels per cell. */
export function cartesianProduct(levelSets: string[][]): string[][] {
  return levelSets.reduce<string[][]>(
    (acc, levels) => acc.flatMap((prefix) => levels.map((l) => [...prefix, l])),
    [[]]
  );
}

/**
 * Resolve the level set a study randomizes over for one dimension. Pure.
 *
 * - `activeLevels` null/undefined/empty → the dimension's full `levels`.
 * - otherwise → the dimension's `levels` filtered to the active subset. The
 *   dimension's own ordering is preserved (rather than the order the admin
 *   typed the subset) so cell keys are stable regardless of how the subset was
 *   entered; duplicates in the subset are collapsed.
 * - Any active level that is not a member of `dimension.levels` is a
 *   configuration error and throws.
 */
export function resolveLevels(
  dimension: DimensionLevels,
  activeLevels: readonly string[] | null | undefined
): string[] {
  const full = dimension.levels ?? [];
  if (!activeLevels || activeLevels.length === 0) return [...full];

  const unknown = activeLevels.filter((l) => !full.includes(l));
  if (unknown.length > 0) {
    const label = dimension.name ?? dimension.id ?? "dimension";
    throw new Error(
      `Invalid active_levels for ${label}: [${unknown.join(", ")}] not in dimension levels [${full.join(", ")}]`
    );
  }
  const active = new Set(activeLevels);
  return full.filter((l) => active.has(l));
}

/** Build a stratum key from a user's variables and the configured strata. Pure. */
export function stratumKeyFor(
  stratifyBy: ("age_band" | "school_id")[] | undefined,
  band: string | null | undefined,
  schoolId: string | null | undefined
): string {
  const parts: string[] = [];
  if (stratifyBy?.includes("age_band")) parts.push(`band:${band || "unknown"}`);
  if (stratifyBy?.includes("school_id")) parts.push(`school:${schoolId || "none"}`);
  return parts.join("|") || "all";
}

/** Stable key for one joint cell. */
export function cellKey(levels: readonly string[]): string {
  return levels.join("|");
}

/**
 * Pick the least-filled cell among `cells`, breaking ties uniformly at random
 * via `random` (injectable for tests). Cells absent from `counts` are treated
 * as empty. Pure given `random`.
 */
export function pickLeastFilledCell(
  cells: readonly string[][],
  counts: ReadonlyMap<string, number>,
  random: () => number = Math.random
): string[] {
  if (cells.length === 0) throw new Error("No cells to assign");
  const countOf = (c: readonly string[]) => counts.get(cellKey(c)) ?? 0;
  const min = Math.min(...cells.map(countOf));
  const candidates = cells.filter((c) => countOf(c) === min);
  return candidates[Math.floor(random() * candidates.length)];
}

/**
 * Load the study's active_levels per dimension id from treatment_study_dimensions.
 */
async function loadActiveLevels(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  studyId: string,
  dimensionIds: string[]
): Promise<Record<string, string[] | null>> {
  const { data } = await supabase
    .from("treatment_study_dimensions")
    .select("dimension_id, active_levels")
    .eq("study_id", studyId)
    .in("dimension_id", dimensionIds);
  return Object.fromEntries(
    (data || []).map((r) => [r.dimension_id as string, (r.active_levels as string[] | null) ?? null])
  );
}

/**
 * Assign a user to treatment conditions for a study using within-stratum,
 * least-filled joint-cell allocation.
 */
export async function assignParticipant(
  userId: string,
  config: RandomizationConfig
): Promise<AssignmentResult> {
  const supabase = await createSupabaseServiceClient();

  // Get dimensions and their levels. Sort by id for a stable cell ordering so the
  // cell key is consistent across enrollments.
  const { data: dimensionsRaw } = await supabase
    .from("treatment_dimensions")
    .select("id, name, levels")
    .in("id", config.dimensionIds)
    .eq("is_active", true);

  if (!dimensionsRaw || dimensionsRaw.length === 0) {
    throw new Error("No active dimensions found");
  }
  // A linked dimension that is inactive (or missing) used to be dropped
  // silently, so the study ran with fewer factors than designed. Fail loudly
  // instead; enrollment logs it as study_enrollment_failed. To stop crossing a
  // factor, unlink it from the study rather than deactivating it.
  const activeIds = new Set(dimensionsRaw.map((d) => d.id as string));
  const inactive = [...new Set(config.dimensionIds)].filter((id) => !activeIds.has(id));
  if (inactive.length > 0) {
    throw new Error(`Linked dimensions are inactive or missing: ${inactive.join(", ")}`);
  }
  const dims = [...dimensionsRaw].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Per-study level subsets (migration 052). Validated by resolveLevels.
  const activeLevels =
    config.activeLevels ?? (await loadActiveLevels(supabase, config.studyId, dims.map((d) => d.id)));
  const levelSets = dims.map((d) =>
    resolveLevels({ id: d.id, name: d.name, levels: d.levels as string[] }, activeLevels[d.id])
  );

  // This participant's stratum.
  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", userId)
    .maybeSingle();
  // Age band comes from user_profiles.effective_band only — `users` has no
  // age_band column, and selecting one would fail this whole query.
  const { data: user } = await supabase
    .from("users")
    .select("school_id")
    .eq("id", userId)
    .single();
  const myStratum = stratumKeyFor(
    config.stratifyBy,
    userProfile?.effective_band,
    user?.school_id
  );

  // Enumerate the joint cells (one level per dimension, in dims order).
  const cells = cartesianProduct(levelSets);

  // Reconstruct existing participants' joint cells and count them WITHIN this
  // stratum, so allocation balances the actual factorial cells per stratum.
  // Participants sitting in a cell that is no longer active (a level outside
  // the study's subset) are counted under their own key, which is simply never
  // a candidate — so they neither block nor skew the active cells.
  const cellCounts = new Map<string, number>();
  for (const c of cells) cellCounts.set(cellKey(c), 0);

  // Paginated: a truncated read here would under-count filled cells and skew
  // every subsequent allocation (PostgREST caps responses at 1000 rows).
  const allAssign = await fetchAllRows<{ user_id: string; dimension_id: string; level: string }>((from, to) =>
    supabase
      .from("dimension_assignments")
      .select("user_id, dimension_id, level")
      .in("dimension_id", dims.map((d) => d.id))
      .order("user_id", { ascending: true })
      .range(from, to)
  );

  const byUser = new Map<string, Map<string, string>>();
  for (const a of allAssign) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
    byUser.get(a.user_id)!.set(a.dimension_id, a.level);
  }
  // Only fully-assigned users (a level on every dimension) occupy a cell.
  const assignedUserIds = [...byUser.entries()]
    .filter(([, m]) => dims.every((d) => m.has(d.id)))
    .map(([uid]) => uid);

  if (assignedUserIds.length > 0) {
    const [urows, uprofiles] = await Promise.all([
      fetchAllByIds<{ id: string; school_id: string | null }>(assignedUserIds, (ids, from, to) =>
        supabase.from("users").select("id, school_id").in("id", ids).order("id", { ascending: true }).range(from, to)
      ),
      fetchAllByIds<{ user_id: string; effective_band: string | null }>(assignedUserIds, (ids, from, to) =>
        supabase
          .from("user_profiles")
          .select("user_id, effective_band")
          .in("user_id", ids)
          .order("user_id", { ascending: true })
          .range(from, to)
      ),
    ]);
    const bandByUser = new Map<string, string>();
    for (const p of uprofiles) {
      if (p.effective_band) bandByUser.set(p.user_id, p.effective_band);
    }
    const rowByUser = new Map<string, { school_id: string | null }>();
    for (const r of urows) rowByUser.set(r.id, { school_id: r.school_id });

    for (const uid of assignedUserIds) {
      const row = rowByUser.get(uid);
      const stratum = stratumKeyFor(
        config.stratifyBy,
        bandByUser.get(uid),
        row?.school_id
      );
      if (stratum !== myStratum) continue;
      const levels = dims.map((d) => byUser.get(uid)!.get(d.id)!);
      const key = cellKey(levels);
      cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    }
  }

  // Choose the least-filled active cell; break ties uniformly at random.
  const chosen = pickLeastFilledCell(cells, cellCounts);

  const assignments = dims.map((d, i) => ({ dimensionId: d.id, level: chosen[i] }));

  // Write assignments to database
  for (const assignment of assignments) {
    await supabase.from("dimension_assignments").upsert(
      {
        user_id: userId,
        dimension_id: assignment.dimensionId,
        level: assignment.level,
        assigned_by: userId, // system-assigned
      },
      { onConflict: "user_id,dimension_id" }
    );
  }

  return { userId, assignments };
}

/**
 * Check balance across treatment cells for a study. Only the study's ACTIVE
 * levels (resolveLevels) are reported; assignments to inactive levels are
 * ignored so a narrowed design is not flagged as imbalanced by legacy cells.
 */
export async function checkBalance(studyId: string) {
  const supabase = await createSupabaseServiceClient();

  // Get study dimensions (+ per-study subset).
  const { data: studyDims } = await supabase
    .from("treatment_study_dimensions")
    .select("dimension_id, active_levels, treatment_dimensions(name, levels)")
    .eq("study_id", studyId);

  if (!studyDims) return { balanced: true, cells: [] };

  const cells: { dimension: string; level: string; count: number }[] = [];

  for (const sd of studyDims) {
    const dim = sd.treatment_dimensions as unknown as { name: string; levels: string[] };
    const { data: assignments } = await supabase
      .from("dimension_assignments")
      .select("level")
      .eq("dimension_id", sd.dimension_id);

    const levels = resolveLevels(
      { id: sd.dimension_id, name: dim.name, levels: dim.levels },
      sd.active_levels as string[] | null
    );
    const counts: Record<string, number> = {};
    for (const l of levels) counts[l] = 0;
    for (const a of assignments || []) {
      if (a.level in counts) counts[a.level]++;
    }

    for (const [level, count] of Object.entries(counts)) {
      cells.push({ dimension: dim.name, level, count });
    }
  }

  // Check if any cell is more than 20% off from expected
  const totalPerDim: Record<string, number> = {};
  for (const c of cells) {
    totalPerDim[c.dimension] = (totalPerDim[c.dimension] || 0) + c.count;
  }

  let balanced = true;
  for (const c of cells) {
    const total = totalPerDim[c.dimension];
    const levelsInDim = cells.filter((x) => x.dimension === c.dimension).length;
    const expected = total / levelsInDim;
    if (expected > 0 && Math.abs(c.count - expected) / expected > 0.2) {
      balanced = false;
    }
  }

  return { balanced, cells };
}
