/**
 * H9 simulated-cohort dry run (build plan H9 / prospectus pilot checklist).
 *
 *   npx vitest run --config vitest.dryrun.config.ts scripts/dry-run/seed.dryrun.ts
 *   npx vitest run --config vitest.dryrun.config.ts scripts/dry-run/teardown.dryrun.ts
 *
 * What it does, against a REAL database:
 *   1. creates a dry-run study crossing complexity x default (6 cells)
 *   2. creates 60 participants in 3 class sections and enrolls each one through
 *      the real enrollParticipant(), so randomization, condition metadata, the
 *      t0 snapshot and survey scheduling are exercised, not mocked
 *   3. simulates 42 days of privacy behavior whose size depends on the assigned
 *      condition, plus referral earnings and forfeits
 *   4. delivers and answers T1/T2/T3 with condition-correlated responses
 *   5. runs all four exports and checks their shape, de-identification, and
 *      that the seeded effect is recoverable from the participant export
 *
 * Everything it writes is tagged for teardown.dryrun.ts. It refuses to run if
 * dry-run rows already exist, so a half-finished run is cleaned up first.
 *
 * NOTE ON FIDELITY: privacy saves are written the way the profile PUT writes
 * them (same columns, same metadata shape) rather than by calling the route,
 * which would need real auth sessions. Route behaviour itself is covered by
 * src/__tests__/integration/privacy-change-logging.int.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  COHORT_SIZE,
  DRY_RUN_EMAIL_DOMAIN,
  DRY_RUN_ROSTER_PREFIX,
  DRY_RUN_STUDY_CODE,
  DRY_RUN_TAG,
  STUDY_DAYS,
  daysBefore,
  describeTarget,
  loadEnvLocal,
  makeRandom,
} from "./env";
import { enrollParticipant } from "@/lib/services/enrollment";
import { checkBalance } from "@/lib/services/randomization";
import {
  generateResearchExport,
  generateTrajectoryExport,
  generateEventsExport,
} from "@/lib/services/research-export";
import { generateStorylineEventsExport } from "@/lib/services/storyline-events-export";
import { computePrivacyIndex } from "@/lib/utils/privacy-index";
import { diffVisibility, classifyChange } from "@/lib/utils/privacy-tracking";
import { PROFILE_FIELDS, type VisibilityLevel } from "@/lib/utils/privacy";
import { conditionsFromMetadata } from "@/lib/utils/conditions";

const FIELD_KEYS = PROFILE_FIELDS.map((f) => f.key);
const PILOT_STUDY = "privacy_pilot_2026";
const SECTIONS = 3;

type Row = Record<string, unknown>;
type Participant = {
  id: string;
  complexity: string;
  privacyDefault: string;
  metadata: Record<string, unknown>;
  visibility: Record<string, VisibilityLevel>;
};

let db: SupabaseClient;
let studyId: string;
let teacherId: string;
let rosterIds: string[] = [];
let participants: Participant[] = [];
let outDir: string;
const random = makeRandom(20260911);

/** Insert in chunks so a large simulated cohort stays under payload limits. */
async function insertAll(table: string, rows: Row[], chunk = 400): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}

function uniform(min: number, max: number): number {
  return min + random() * (max - min);
}

function likert(center: number): number {
  return Math.max(1, Math.min(7, Math.round(center + uniform(-1, 1))));
}

/** Starting visibility for a default condition, matching getDefaults(). */
function startingVisibility(privacyDefault: string): Record<string, VisibilityLevel> {
  const level: VisibilityLevel = privacyDefault === "public" ? "everyone" : "nobody";
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, level]));
}

/**
 * How many saves a participant makes, and how protective they end up.
 *
 * The seeded story is the replication's prediction: under an open default,
 * moderate controls are used most effectively; simple cannot express what the
 * participant wants and complex is abandoned part-way (feature fatigue). Under
 * a closed default there is little to do, so behaviour barely differs.
 */
function behaviourFor(complexity: string, privacyDefault: string) {
  if (privacyDefault === "private") {
    return { saves: complexity === "complex" ? 2 : 1, protectedShare: 0.9, abandonChance: 0.15 };
  }
  const byComplexity: Record<string, { saves: number; protectedShare: number; abandonChance: number }> = {
    simple: { saves: 1, protectedShare: 0.3, abandonChance: 0.2 },
    moderate: { saves: 2, protectedShare: 0.62, abandonChance: 0.25 },
    complex: { saves: 4, protectedShare: 0.42, abandonChance: 0.5 },
  };
  return byComplexity[complexity] ?? byComplexity.moderate;
}

/**
 * Move a visibility map toward an exact share of hidden fields, in whichever
 * direction is needed: participants under an open default tighten, and those
 * under a closed default loosen a little to stay findable (which is what the
 * referral economy rewards). Deterministic, so the cohort's cell means reflect
 * the seeded design rather than the number of saves a participant happened to
 * make.
 */
function visibilityWithProtection(
  current: Record<string, VisibilityLevel>,
  protectedShare: number
): Record<string, VisibilityLevel> {
  const next = { ...current };
  const target = Math.round(FIELD_KEYS.length * protectedShare);
  let hidden = FIELD_KEYS.filter((k) => next[k] === "nobody").length;
  for (const key of FIELD_KEYS) {
    if (hidden === target) break;
    if (hidden < target && next[key] !== "nobody") {
      next[key] = "nobody";
      hidden++;
    } else if (hidden > target && next[key] === "nobody") {
      next[key] = "everyone";
      hidden--;
    }
  }
  return next;
}

describe("H9 simulated-cohort dry run", () => {
  beforeAll(async () => {
    loadEnvLocal();
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    outDir = join(process.cwd(), "backups", `dry-run-${new Date().toISOString().slice(0, 10)}`);
    mkdirSync(outDir, { recursive: true });
    console.log(`\n  target project: ${describeTarget()}`);
    console.log(`  exports will be written to: ${outDir}\n`);
  });

  afterAll(async () => {
    // Defensive: never leave the pilot study switched off.
    if (db) {
      await db.from("treatment_studies").update({ auto_enroll: true }).eq("study_code", PILOT_STUDY);
      await db.from("treatment_studies").update({ auto_enroll: false }).eq("study_code", DRY_RUN_STUDY_CODE);
    }
  });

  it("refuses to start if a previous dry run was not torn down", async () => {
    const { data: leftovers } = await db
      .from("users")
      .select("id")
      .like("email", `%@${DRY_RUN_EMAIL_DOMAIN}`);
    expect(
      leftovers ?? [],
      "dry-run rows already exist — run teardown.dryrun.ts first"
    ).toHaveLength(0);

    const { data: pilot } = await db
      .from("treatment_studies")
      .select("status, auto_enroll")
      .eq("study_code", PILOT_STUDY)
      .maybeSingle();
    expect(pilot, "the pilot study row is missing").toBeTruthy();
  });

  it("creates the study, its two crossed dimensions, sections and participants", async () => {
    const { data: study, error: studyError } = await db
      .from("treatment_studies")
      .insert({
        study_code: DRY_RUN_STUDY_CODE,
        name: "H9 dry run (simulated cohort)",
        status: "active",
        auto_enroll: false,
        target_sample_size: COHORT_SIZE,
        current_sample_size: 0,
      })
      .select("id")
      .single();
    if (studyError) throw new Error(`study insert failed: ${studyError.message}`);
    studyId = study.id as string;

    const { data: dims } = await db
      .from("treatment_dimensions")
      .select("id, name")
      .in("name", ["privacy_control_complexity", "privacy_default"]);
    expect(dims ?? []).toHaveLength(2);
    const idOf = (name: string) => (dims ?? []).find((d) => d.name === name)!.id as string;

    await insertAll("treatment_study_dimensions", [
      { study_id: studyId, dimension_id: idOf("privacy_control_complexity"), sort_order: 0, active_levels: null },
      // The replication crosses public vs private only (design section 4).
      { study_id: studyId, dimension_id: idOf("privacy_default"), sort_order: 1, active_levels: ["public", "private"] },
    ]);

    const { data: teacher } = await db
      .from("users")
      .insert({
        email: `teacher@${DRY_RUN_EMAIL_DOMAIN}`,
        display_name: "H9 Section Lead",
        role: "teacher",
        metadata: { dry_run: DRY_RUN_TAG },
      })
      .select("id")
      .single();
    teacherId = teacher!.id as string;

    const { data: rosters } = await db
      .from("rosters")
      .insert(
        Array.from({ length: SECTIONS }, (_, i) => ({
          name: `${DRY_RUN_ROSTER_PREFIX} ${i + 1}`,
          teacher_id: teacherId,
        }))
      )
      .select("id");
    rosterIds = (rosters ?? []).map((r) => r.id as string);
    expect(rosterIds).toHaveLength(SECTIONS);

    // users.role is COPPA-era: child / teen / parent / teacher / hunt_creator /
    // admin / researcher. There is NO adult-participant role, and registration
    // only ever assigns child or teen — so an adult undergraduate enrolls as
    // "teen" and their adulthood is carried by user_profiles.age_band instead.
    // Worth a decision before the pilot; see the dry-run notes in the build plan.
    const userRows = Array.from({ length: COHORT_SIZE }, (_, i) => ({
      email: `p${String(i + 1).padStart(3, "0")}@${DRY_RUN_EMAIL_DOMAIN}`,
      display_name: `Dry Run Participant ${i + 1}`,
      role: "teen",
      metadata: { dry_run: DRY_RUN_TAG },
      created_at: daysBefore(STUDY_DAYS + 1),
    }));
    const { data: inserted, error: userError } = await db.from("users").insert(userRows).select("id");
    if (userError) throw new Error(`user insert failed: ${userError.message}`);
    const ids = (inserted ?? []).map((u) => u.id as string);
    expect(ids).toHaveLength(COHORT_SIZE);

    // effective_band is a generated column: insert age_band only.
    await insertAll(
      "user_profiles",
      ids.map((id) => ({ user_id: id, age_band: "adult" }))
    );
    await insertAll(
      "consent_records",
      ids.map((id) => ({ user_id: id, consent_type: "research", granted: true }))
    );
    await insertAll(
      "roster_entries",
      ids.map((id, i) => ({ roster_id: rosterIds[i % SECTIONS], student_id: id }))
    );

    participants = ids.map((id) => ({
      id,
      complexity: "",
      privacyDefault: "",
      metadata: {},
      visibility: {},
    }));
    console.log(`  created ${ids.length} participants across ${SECTIONS} sections`);
  });

  it("enrolls every participant through the real enrollment service, balanced across six cells", async () => {
    // enrollParticipant picks the active auto-enroll study, so the dry-run
    // study takes that role for the duration of the loop and the pilot is
    // restored immediately afterwards (afterAll repeats this defensively).
    try {
      await db.from("treatment_studies").update({ auto_enroll: false }).eq("study_code", PILOT_STUDY);
      await db.from("treatment_studies").update({ auto_enroll: true }).eq("id", studyId);

      for (const p of participants) {
        const result = await enrollParticipant(p.id);
        expect(result.enrolled, `enrollment failed: ${result.error ?? "unknown"}`).toBe(true);
      }
    } finally {
      await db.from("treatment_studies").update({ auto_enroll: false }).eq("id", studyId);
      await db.from("treatment_studies").update({ auto_enroll: true }).eq("study_code", PILOT_STUDY);
    }

    const { data: rows } = await db
      .from("users")
      .select("id, metadata, profile_visibility")
      .in("id", participants.map((p) => p.id));
    for (const p of participants) {
      const row = (rows ?? []).find((r) => r.id === p.id)!;
      p.metadata = (row.metadata ?? {}) as Record<string, unknown>;
      p.visibility = (row.profile_visibility ?? {}) as Record<string, VisibilityLevel>;
      p.complexity = String(p.metadata.privacy_treatment ?? "");
      p.privacyDefault = String(p.metadata.privacy_default ?? "");
      // Enrollment must preserve metadata it did not write (the age_band bug
      // this dry run surfaced discarded it).
      expect(p.metadata.dry_run).toBe(DRY_RUN_TAG);
    }

    const cells = new Map<string, number>();
    for (const p of participants) {
      expect(["simple", "moderate", "complex"]).toContain(p.complexity);
      expect(["public", "private"]).toContain(p.privacyDefault);
      const key = `${p.complexity}|${p.privacyDefault}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    console.log("  cell sizes:", Object.fromEntries([...cells].sort()));
    expect(cells.size).toBe(6);
    const counts = [...cells.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    // Backdate enrollment so the simulated timeline starts 42 days ago.
    await db
      .from("study_enrollments")
      .update({ enrolled_at: daysBefore(STUDY_DAYS) })
      .eq("study_id", studyId);
    await db
      .from("privacy_index_snapshots")
      .update({ created_at: daysBefore(STUDY_DAYS) })
      .eq("source", "enrollment")
      .in("user_id", participants.map((p) => p.id));

    const balance = await checkBalance(studyId);
    expect(balance.cells.length).toBeGreaterThan(0);
  });

  it("simulates 42 days of privacy behaviour, snapshots, and referral earnings", async () => {
    const events: Row[] = [];
    const snapshots: Row[] = [];
    const ledger: Row[] = [];
    const links: Row[] = [];

    for (const [index, p] of participants.entries()) {
      const conditions = conditionsFromMetadata(p.metadata);
      const legacy = {
        treatment: p.complexity,
        privacy_default: p.privacyDefault,
        conditions,
      };
      const plan = behaviourFor(p.complexity, p.privacyDefault);
      let visibility = { ...startingVisibility(p.privacyDefault) };
      const timeline: { day: number; visibility: Record<string, VisibilityLevel> }[] = [];

      // First view of the controls, on day 0 or 1.
      const firstViewDay = Math.floor(uniform(0, 2));
      events.push({
        user_id: p.id,
        event_type: "privacy_view",
        page: "settings_privacy",
        session_id: `dry-${index}-view`,
        ...legacy,
        metadata: { treatment: p.complexity, scheme: p.complexity, index: computePrivacyIndex(visibility) },
        created_at: daysBefore(STUDY_DAYS - firstViewDay),
      });

      for (let save = 0; save < plan.saves; save++) {
        // Complex participants front-load then stop: the fatigue story.
        const spread = p.complexity === "complex" ? 0.55 : 1;
        const day = Math.min(
          STUDY_DAYS - 1,
          Math.round(firstViewDay + 1 + (save / Math.max(1, plan.saves)) * STUDY_DAYS * spread)
        );
        const share = (plan.protectedShare * (save + 1)) / plan.saves;
        const next = visibilityWithProtection(visibility, share);
        const deltas = diffVisibility(visibility, next);
        if (deltas.length === 0) continue;

        events.push({
          user_id: p.id,
          event_type: "privacy_change",
          page: "settings_privacy",
          old_value: visibility,
          new_value: next,
          duration_ms: Math.round(uniform(8_000, 90_000)),
          click_count: deltas.length + Math.round(uniform(1, 6)),
          session_id: `dry-${index}-save-${save}`,
          ...legacy,
          metadata: {
            deltas,
            direction: classifyChange(deltas),
            index_before: computePrivacyIndex(visibility),
            index_after: computePrivacyIndex(next),
            source: "server",
          },
          created_at: daysBefore(STUDY_DAYS - day),
        });
        snapshots.push({
          user_id: p.id,
          index_value: computePrivacyIndex(next),
          source: "change",
          visibility: next,
          ...legacy,
          created_at: daysBefore(STUDY_DAYS - day),
        });
        timeline.push({ day, visibility: { ...next } });
        visibility = next;
      }

      if (random() < plan.abandonChance) {
        const day = Math.round(uniform(STUDY_DAYS * 0.5, STUDY_DAYS - 1));
        events.push({
          user_id: p.id,
          event_type: "privacy_abandon",
          page: "settings_privacy",
          old_value: visibility,
          new_value: visibility,
          duration_ms: Math.round(uniform(4_000, 40_000)),
          click_count: Math.round(uniform(1, 5)),
          session_id: `dry-${index}-abandon`,
          ...legacy,
          metadata: { deltas: [], direction: "none", reversed: true },
          created_at: daysBefore(STUDY_DAYS - day),
        });
      }

      // Daily scheduled snapshots, using whatever was in force that day.
      for (let day = 0; day <= STUDY_DAYS; day++) {
        const inForce = timeline.filter((t) => t.day <= day).at(-1)?.visibility
          ?? startingVisibility(p.privacyDefault);
        snapshots.push({
          user_id: p.id,
          index_value: computePrivacyIndex(inForce),
          source: "scheduled",
          visibility: inForce,
          ...legacy,
          created_at: daysBefore(STUDY_DAYS - day),
        });
      }

      p.visibility = visibility;
    }

    // Referral economy: every fourth participant recruits the next one.
    for (let i = 0; i + 1 < participants.length; i += 4) {
      const recruiter = participants[i];
      const minion = participants[i + 1];
      links.push({ recruiter_id: recruiter.id, minion_id: minion.id, referral_code: `H9${String(i).padStart(4, "0")}` });
      const earns = recruiter.visibility.total_score !== "nobody" && recruiter.visibility.display_name !== "nobody";
      if (earns) {
        ledger.push({
          user_id: recruiter.id,
          amount: Math.round(uniform(6, 40)),
          source_type: "referral",
          description: "Dry-run referral bonus",
          created_at: daysBefore(Math.round(uniform(1, STUDY_DAYS - 1))),
        });
      }
      ledger.push({
        user_id: minion.id,
        amount: Math.round(uniform(40, 300)),
        source_type: "challenge",
        description: "Dry-run challenge points",
        created_at: daysBefore(Math.round(uniform(1, STUDY_DAYS - 1))),
      });
    }

    await insertAll("privacy_events", events);
    await insertAll("privacy_index_snapshots", snapshots);
    await insertAll("minion_links", links);
    await insertAll("points_ledger", ledger);

    // Final settings, as the profile PUT would have left them.
    for (const p of participants) {
      await db.from("users").update({ profile_visibility: p.visibility }).eq("id", p.id);
    }

    console.log(
      `  wrote ${events.length} privacy events, ${snapshots.length} snapshots, ${links.length} referral links`
    );
    expect(events.length).toBeGreaterThan(COHORT_SIZE);
  });

  it("delivers and answers T1, T2 and T3 with condition-correlated responses", async () => {
    const { data: schedules } = await db
      .from("survey_schedules")
      .select("survey_id, trigger_config");
    const timepointOf = new Map<string, string>();
    for (const s of schedules ?? []) {
      const tp = (s.trigger_config as { timepoint?: string } | null)?.timepoint;
      if (tp && !timepointOf.has(s.survey_id as string)) timepointOf.set(s.survey_id as string, tp);
    }
    expect([...new Set(timepointOf.values())].sort()).toEqual(["T1", "T2", "T3"]);

    const { data: questions } = await db
      .from("survey_questions")
      .select("survey_id, item_code, question_type, subscale, reverse_coded");
    const bySurvey = new Map<string, Row[]>();
    for (const q of questions ?? []) {
      const list = bySurvey.get(q.survey_id as string) ?? [];
      list.push(q as Row);
      bySurvey.set(q.survey_id as string, list);
    }

    const dayOf: Record<string, number> = { T1: 1, T2: 21, T3: STUDY_DAYS };
    /** Latent response centre per subscale, per condition and timepoint. */
    const centre = (subscale: string, p: Participant, tp: string): number => {
      const late = tp === "T3" ? 1 : tp === "T2" ? 0.5 : 0;
      switch (subscale) {
        case "privacy_fatigue":
          return { simple: 3, moderate: 3.4, complex: 4.6 }[p.complexity]! + late;
        case "ease_of_use":
          // Inverted U: moderate easiest, complex hardest (the 2014 finding).
          return { simple: 4.6, moderate: 5.4, complex: 3.4 }[p.complexity]! - late * 0.3;
        case "control_complexity":
          return { simple: 2.2, moderate: 3.8, complex: 5.8 }[p.complexity]!;
        case "control_capability":
          return { simple: 2.8, moderate: 5.2, complex: 5.0 }[p.complexity]!;
        default:
          return 4;
      }
    };

    const deliveries: Row[] = [];
    for (const [surveyId, tp] of timepointOf) {
      for (const p of participants) {
        // A little attrition, heaviest at T3 — 2014 lost 22% to incomplete data.
        const dropped = tp === "T3" ? random() < 0.15 : tp === "T2" ? random() < 0.08 : false;
        deliveries.push({
          survey_id: surveyId,
          user_id: p.id,
          status: dropped ? "expired" : "submitted",
          created_at: daysBefore(STUDY_DAYS - dayOf[tp]),
          expires_at: daysBefore(STUDY_DAYS - dayOf[tp] - 7),
        });
      }
    }
    const { data: insertedDeliveries, error: deliveryError } = await db
      .from("survey_deliveries")
      .insert(deliveries)
      .select("id, survey_id, user_id, status");
    if (deliveryError) throw new Error(`survey_deliveries insert failed: ${deliveryError.message}`);

    const responses: Row[] = [];
    for (const d of insertedDeliveries ?? []) {
      if (d.status !== "submitted") continue;
      const p = participants.find((x) => x.id === d.user_id)!;
      const tp = timepointOf.get(d.survey_id as string)!;
      const answers: Record<string, number | string> = {};
      for (const q of bySurvey.get(d.survey_id as string) ?? []) {
        const code = q.item_code as string;
        if (q.question_type === "multiple_choice") {
          // Ideal audience: participants want less exposure than a public
          // default gives them, which is what settings error measures.
          answers[code] = p.privacyDefault === "public" ? (random() < 0.6 ? "class" : "team") : "nobody";
          continue;
        }
        const intended = likert(centre(String(q.subscale ?? ""), p, tp));
        answers[code] = q.reverse_coded ? 8 - intended : intended;
      }
      responses.push({
        delivery_id: d.id,
        survey_id: d.survey_id,
        user_id: d.user_id,
        answers,
        created_at: daysBefore(STUDY_DAYS - dayOf[tp] - 0.2),
      });
    }
    await insertAll("survey_responses", responses);
    console.log(`  ${insertedDeliveries?.length ?? 0} deliveries, ${responses.length} responses`);
    expect(responses.length).toBeGreaterThan(COHORT_SIZE * 2);
  });

  it("produces four exports that are complete, de-identified and analysable", async () => {
    const participantsCsv = await generateResearchExport({ studyId, format: "csv" });
    const trajectoryCsv = await generateTrajectoryExport({ studyId, format: "csv" });
    const eventsCsv = await generateEventsExport({ studyId, format: "csv" });
    const storylinesCsv = await generateStorylineEventsExport({ studyId, format: "csv" });

    writeFileSync(join(outDir, "participants.csv"), participantsCsv);
    writeFileSync(join(outDir, "trajectory.csv"), trajectoryCsv);
    writeFileSync(join(outDir, "events.csv"), eventsCsv);
    if (storylinesCsv) writeFileSync(join(outDir, "storylines.csv"), storylinesCsv);

    const rows = JSON.parse(await generateResearchExport({ studyId, format: "json" })) as Record<string, string>[];
    expect(rows).toHaveLength(COHORT_SIZE);

    const header = participantsCsv.split("\n")[0];
    for (const column of [
      "participant_id", "age_band", "role",
      "treatment_privacy_control_complexity", "treatment_privacy_default",
      "privacy_index_t0", "privacy_index_final", "privacy_changes_count",
      "survey_T1_privacy_fatigue", "survey_T3_privacy_fatigue", "survey_T3_ease_of_use",
      "settings_error_T1",
    ]) {
      expect(header, `missing export column: ${column}`).toContain(column);
    }

    // Demographics must be populated — they were blank before the age_band fix.
    expect(rows.every((r) => r.age_band === "adult")).toBe(true);
    expect(rows.every((r) => r.role === "teen")).toBe(true);

    // De-identification: no email, display name, or marker domain anywhere.
    for (const csv of [participantsCsv, trajectoryCsv, eventsCsv, storylinesCsv]) {
      const text = csv.toLowerCase();
      expect(text).not.toContain(DRY_RUN_EMAIL_DOMAIN);
      expect(text).not.toContain("dry run participant");
    }

    expect(trajectoryCsv.split("\n").length).toBeGreaterThan(COHORT_SIZE * STUDY_DAYS * 0.5);
    expect(eventsCsv.split("\n").length).toBeGreaterThan(COHORT_SIZE);
    console.log(
      `  participants ${rows.length} rows, trajectory ${trajectoryCsv.split("\n").length - 1}, events ${eventsCsv.split("\n").length - 1}`
    );
  });

  it("recovers the seeded complexity x default pattern from the export", async () => {
    const rows = JSON.parse(await generateResearchExport({ studyId, format: "json" })) as Record<string, string>[];
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const cell = (complexity: string, dflt: string, column: string) =>
      mean(
        rows
          .filter(
            (r) =>
              r.treatment_privacy_control_complexity === complexity && r.treatment_privacy_default === dflt
          )
          .map((r) => Number(r[column]))
          .filter((n) => Number.isFinite(n))
      );

    const finalIndex = {
      simple: cell("simple", "public", "privacy_index_final"),
      moderate: cell("moderate", "public", "privacy_index_final"),
      complex: cell("complex", "public", "privacy_index_final"),
    };
    const fatigueT3 = {
      simple: cell("simple", "public", "survey_T3_privacy_fatigue"),
      moderate: cell("moderate", "public", "survey_T3_privacy_fatigue"),
      complex: cell("complex", "public", "survey_T3_privacy_fatigue"),
    };
    console.log("  final privacy index by complexity (public default):", finalIndex);
    console.log("  T3 fatigue by complexity (public default):", fatigueT3);

    // The seeded story, as the analysis should read it back.
    expect(finalIndex.moderate).toBeGreaterThan(finalIndex.simple);
    expect(finalIndex.moderate).toBeGreaterThan(finalIndex.complex);
    expect(fatigueT3.complex).toBeGreaterThan(fatigueT3.simple);

    // The closed default leaves little room to act, so it should sit high.
    expect(cell("moderate", "private", "privacy_index_final")).toBeGreaterThan(finalIndex.moderate);
  });
});
