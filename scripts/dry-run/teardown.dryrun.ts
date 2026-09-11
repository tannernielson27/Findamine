/**
 * H9 dry-run teardown: removes every row the dry run created, so the study
 * database returns to the clean state the real pilot needs.
 *
 *   npx vitest run --config vitest.dryrun.config.ts scripts/dry-run/teardown.dryrun.ts
 *
 * Safety: this only ever deletes rows reachable from users whose email ends in
 * the dry-run domain, plus the dry-run study and its rosters. It refuses to
 * touch a user without that marker, so it cannot remove a real participant.
 * Deletion order follows the foreign keys inward-out.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DRY_RUN_EMAIL_DOMAIN,
  DRY_RUN_ROSTER_PREFIX,
  DRY_RUN_STUDY_CODE,
  describeTarget,
  loadEnvLocal,
} from "./env";

/** Tables keyed by user_id that the dry run writes into. */
const USER_TABLES = [
  "privacy_events",
  "privacy_index_snapshots",
  "norm_exposures",
  "notice_events",
  "privacy_checkin_events",
  "scheme_selections",
  "survey_responses",
  "survey_deliveries",
  "behavioral_events",
  "points_ledger",
  "consent_records",
  "dimension_assignments",
  "study_enrollments",
  "notifications",
  "notification_preferences",
  "roster_entries",
] as const;

let supabase: SupabaseClient;
let userIds: string[] = [];

async function deleteWhereIn(table: string, column: string, values: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { data, error } = await supabase.from(table).delete().in(column, chunk).select("*");
    if (error) throw new Error(`delete from ${table} failed: ${error.message}`);
    removed += (data ?? []).length;
  }
  return removed;
}

describe("H9 dry-run teardown", () => {
  beforeAll(() => {
    loadEnvLocal();
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    console.log(`\n  target project: ${describeTarget()}`);
  });

  it("finds the dry-run participants by their marker", async () => {
    const { data, error } = await supabase
      .from("users")
      .select("id, email")
      .like("email", `%@${DRY_RUN_EMAIL_DOMAIN}`);
    expect(error).toBeNull();
    userIds = (data ?? []).map((u) => u.id as string);
    // Belt and braces: never delete a user missing the marker domain.
    for (const u of data ?? []) {
      expect(String(u.email)).toMatch(new RegExp(`@${DRY_RUN_EMAIL_DOMAIN.replace(".", "\\.")}$`));
    }
    console.log(`  dry-run participants found: ${userIds.length}`);
  });

  it("removes their rows from every table the dry run writes", async () => {
    if (userIds.length === 0) {
      console.log("  nothing to remove");
      return;
    }
    // Referral links reference the user from either side.
    await deleteWhereIn("minion_links", "recruiter_id", userIds);
    await deleteWhereIn("minion_links", "minion_id", userIds);
    await deleteWhereIn("referral_codes", "user_id", userIds);

    for (const table of USER_TABLES) {
      // roster_entries keys the participant as student_id, everything else as user_id.
      const column = table === "roster_entries" ? "student_id" : "user_id";
      const removed = await deleteWhereIn(table, column, userIds);
      console.log(`  ${table}: ${removed}`);
    }
  });

  it("removes the dry-run rosters, class statistics and study", async () => {
    const { data: rosters } = await supabase
      .from("rosters")
      .select("id")
      .like("name", `${DRY_RUN_ROSTER_PREFIX}%`);
    const rosterIds = (rosters ?? []).map((r) => r.id as string);
    if (rosterIds.length) {
      await deleteWhereIn("class_norm_stats", "roster_id", rosterIds);
      await deleteWhereIn("roster_entries", "roster_id", rosterIds);
      await deleteWhereIn("rosters", "id", rosterIds);
    }
    console.log(`  rosters removed: ${rosterIds.length}`);

    const { data: study } = await supabase
      .from("treatment_studies")
      .select("id")
      .eq("study_code", DRY_RUN_STUDY_CODE)
      .maybeSingle();
    if (study?.id) {
      await supabase.from("treatment_study_dimensions").delete().eq("study_id", study.id);
      await supabase.from("study_enrollments").delete().eq("study_id", study.id);
      await supabase.from("treatment_studies").delete().eq("id", study.id);
    }

    await deleteWhereIn("users", "id", userIds);
  });

  it("leaves the database with no dry-run trace and the real study intact", async () => {
    const { data: leftoverUsers } = await supabase
      .from("users")
      .select("id")
      .like("email", `%@${DRY_RUN_EMAIL_DOMAIN}`);
    expect(leftoverUsers ?? []).toHaveLength(0);

    const { data: leftoverStudy } = await supabase
      .from("treatment_studies")
      .select("id")
      .eq("study_code", DRY_RUN_STUDY_CODE);
    expect(leftoverStudy ?? []).toHaveLength(0);

    // The pilot study must still be exactly as it was, and auto-enrolling.
    const { data: pilot } = await supabase
      .from("treatment_studies")
      .select("study_code, status, auto_enroll")
      .eq("study_code", "privacy_pilot_2026")
      .maybeSingle();
    expect(pilot).toMatchObject({ status: "active", auto_enroll: true });

    const { count } = await supabase
      .from("study_enrollments")
      .select("*", { count: "exact", head: true });
    console.log(`  enrollments remaining in the database: ${count ?? 0}`);
  });
});
