/**
 * Nightly class-norm cron for storyline S5 (build plan D3, migration 062).
 *
 * Computes, per class, the share of players whose score is hidden from
 * Everyone, so the privacy page can show the descriptive norm line. Runs
 * before the snapshot cron. CRON_SECRET auth, same pattern as the other crons.
 */

import { NextRequest } from "next/server";
import { computeAndStoreClassNorms } from "@/lib/services/class-norms";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const computedOn = new Date().toISOString().slice(0, 10);
    const result = await computeAndStoreClassNorms(computedOn);
    return Response.json({ computed_on: computedOn, ...result });
  } catch (error) {
    console.error("[cron/class-norms] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Class norm computation failed" }, { status: 500 });
  }
}
