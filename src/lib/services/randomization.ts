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
 * - Balance checking across cells (checkBalance).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface RandomizationConfig {
  studyId: string;
  dimensionIds: string[];
  stratifyBy?: ("age_band" | "school_id")[];
  /** @deprecated Superseded by least-filled-cell minimization; kept for callers. */
  blockSize?: number;
}

export interface AssignmentResult {
  userId: string;
  assignments: { dimensionId: string; level: string }[];
}

/** Cartesian product of each dimension's levels → one array of levels per cell. */
export function cartesianProduct(levelSets: string[][]): string[][] {
  return levelSets.reduce<string[][]>(
    (acc, levels) => acc.flatMap((prefix) => levels.map((l) => [...prefix, l])),
    [[]]
  );
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
  const dims = [...dimensionsRaw].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // This participant's stratum.
  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: user } = await supabase
    .from("users")
    .select("school_id, age_band")
    .eq("id", userId)
    .single();
  const myStratum = stratumKeyFor(
    config.stratifyBy,
    userProfile?.effective_band || user?.age_band,
    user?.school_id
  );

  // Enumerate the joint cells (one level per dimension, in dims order).
  const cells = cartesianProduct(dims.map((d) => d.levels as string[]));
  const cellKey = (levels: string[]) => levels.join("|");

  // Reconstruct existing participants' joint cells and count them WITHIN this
  // stratum, so allocation balances the actual factorial cells per stratum.
  const cellCounts = new Map<string, number>();
  for (const c of cells) cellCounts.set(cellKey(c), 0);

  const { data: allAssign } = await supabase
    .from("dimension_assignments")
    .select("user_id, dimension_id, level")
    .in("dimension_id", dims.map((d) => d.id));

  const byUser = new Map<string, Map<string, string>>();
  for (const a of allAssign || []) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
    byUser.get(a.user_id)!.set(a.dimension_id, a.level);
  }
  // Only fully-assigned users (a level on every dimension) occupy a cell.
  const assignedUserIds = [...byUser.entries()]
    .filter(([, m]) => dims.every((d) => m.has(d.id)))
    .map(([uid]) => uid);

  if (assignedUserIds.length > 0) {
    const [{ data: urows }, { data: uprofiles }] = await Promise.all([
      supabase.from("users").select("id, school_id, age_band").in("id", assignedUserIds),
      supabase.from("user_profiles").select("user_id, effective_band").in("user_id", assignedUserIds),
    ]);
    const bandByUser = new Map<string, string>();
    for (const p of uprofiles || []) {
      if (p.effective_band) bandByUser.set(p.user_id, p.effective_band);
    }
    const rowByUser = new Map<string, { school_id: string | null; age_band: string | null }>();
    for (const r of urows || []) rowByUser.set(r.id, { school_id: r.school_id, age_band: r.age_band });

    for (const uid of assignedUserIds) {
      const row = rowByUser.get(uid);
      const stratum = stratumKeyFor(
        config.stratifyBy,
        bandByUser.get(uid) || row?.age_band,
        row?.school_id
      );
      if (stratum !== myStratum) continue;
      const levels = dims.map((d) => byUser.get(uid)!.get(d.id)!);
      const key = cellKey(levels);
      cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    }
  }

  // Choose the least-filled cell; break ties uniformly at random.
  const counts = cells.map((c) => cellCounts.get(cellKey(c)) ?? 0);
  const min = Math.min(...counts);
  const candidates = cells.filter((c) => (cellCounts.get(cellKey(c)) ?? 0) === min);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

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
 * Check balance across treatment cells for a study.
 */
export async function checkBalance(studyId: string) {
  const supabase = await createSupabaseServiceClient();

  // Get study dimensions
  const { data: studyDims } = await supabase
    .from("treatment_study_dimensions")
    .select("dimension_id, treatment_dimensions(name, levels)")
    .eq("study_id", studyId);

  if (!studyDims) return { balanced: true, cells: [] };

  const cells: { dimension: string; level: string; count: number }[] = [];

  for (const sd of studyDims) {
    const dim = sd.treatment_dimensions as unknown as { name: string; levels: string[] };
    const { data: assignments } = await supabase
      .from("dimension_assignments")
      .select("level")
      .eq("dimension_id", sd.dimension_id);

    const levels = dim.levels;
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
