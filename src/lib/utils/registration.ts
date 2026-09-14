/**
 * Self-registration role rules. Pure, so the age gates are unit tested.
 *
 * - teen:  13 to 17. Under 13 is refused; 18+ becomes an adult player.
 * - adult: 18+. Under 18 is refused (register as a teen instead).
 * - parent / teacher / hunt_creator: no age gate.
 * - anything else falls back to parent (unchanged legacy behavior).
 */

export const SELF_REGISTER_ROLES = ["teen", "adult", "parent", "teacher", "hunt_creator"] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

export type RoleResolution =
  | { ok: true; role: SelfRegisterRole }
  | { ok: false; status: 400 | 403; message: string };

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function ageInYears(dateOfBirth: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(dateOfBirth).getTime()) / YEAR_MS);
}

export function resolveSelfRegisterRole(
  requested: unknown,
  dateOfBirth: string | null | undefined,
  now: number = Date.now()
): RoleResolution {
  const role: SelfRegisterRole = (SELF_REGISTER_ROLES as readonly string[]).includes(requested as string)
    ? (requested as SelfRegisterRole)
    : "parent";

  if (role !== "teen" && role !== "adult") return { ok: true, role };

  if (!dateOfBirth) {
    return { ok: false, status: 400, message: `Date of birth is required for ${role} accounts` };
  }
  const age = ageInYears(dateOfBirth, now);

  if (role === "adult") {
    return age >= 18
      ? { ok: true, role }
      : { ok: false, status: 403, message: "Adult accounts are for players 18 or older. Choose Teen instead." };
  }
  if (age < 13) {
    return {
      ok: false,
      status: 403,
      message:
        "You must be 13 or older to create your own account. Ask a parent or teacher to create an account for you.",
    };
  }
  return { ok: true, role: age >= 18 ? "adult" : "teen" };
}
