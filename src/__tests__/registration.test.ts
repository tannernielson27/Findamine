import { describe, it, expect } from "vitest";
import { resolveSelfRegisterRole, ageInYears } from "@/lib/utils/registration";

const NOW = new Date("2026-09-14T12:00:00Z").getTime();

describe("resolveSelfRegisterRole", () => {
  it("accepts an adult 18 or older", () => {
    expect(resolveSelfRegisterRole("adult", "2005-01-01", NOW)).toEqual({ ok: true, role: "adult" });
  });

  it("refuses an adult account under 18", () => {
    const r = resolveSelfRegisterRole("adult", "2010-01-01", NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(403);
  });

  it("requires a date of birth for teen and adult", () => {
    expect(resolveSelfRegisterRole("adult", undefined, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(resolveSelfRegisterRole("teen", "", NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps 13-17 as teen, refuses under 13, and makes an 18+ 'teen' an adult", () => {
    expect(resolveSelfRegisterRole("teen", "2011-01-01", NOW)).toEqual({ ok: true, role: "teen" });
    expect(resolveSelfRegisterRole("teen", "2016-01-01", NOW)).toMatchObject({ ok: false, status: 403 });
    expect(resolveSelfRegisterRole("teen", "2000-01-01", NOW)).toEqual({ ok: true, role: "adult" });
  });

  it("passes staff-style roles through without an age gate and falls back to parent", () => {
    expect(resolveSelfRegisterRole("teacher", undefined, NOW)).toEqual({ ok: true, role: "teacher" });
    expect(resolveSelfRegisterRole("admin", undefined, NOW)).toEqual({ ok: true, role: "parent" });
    expect(resolveSelfRegisterRole(undefined, undefined, NOW)).toEqual({ ok: true, role: "parent" });
  });
});

describe("ageInYears", () => {
  it("floors to whole years", () => {
    expect(ageInYears("2008-09-15", NOW)).toBe(17);
    expect(ageInYears("2008-09-13", NOW)).toBe(18);
  });
});
