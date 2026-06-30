import { describe, it, expect } from "vitest";
import {
  canView,
  canViewField,
  visibleFields,
  filterProfileForViewer,
  PROFILE_FIELD_KEYS,
  type ViewerRelationship,
} from "@/lib/utils/privacy";

const RELATIONSHIPS: ViewerRelationship[] = ["self", "team", "class", "public"];

describe("canView (ordinal scale nobody<team<class<everyone)", () => {
  it("self sees everything", () => {
    for (const level of ["nobody", "team", "class", "everyone"] as const) {
      expect(canView("self", level)).toBe(true);
    }
  });

  it("public only sees 'everyone'", () => {
    expect(canView("public", "everyone")).toBe(true);
    expect(canView("public", "class")).toBe(false);
    expect(canView("public", "team")).toBe(false);
    expect(canView("public", "nobody")).toBe(false);
  });

  it("class sees class + everyone, not team/nobody", () => {
    expect(canView("class", "everyone")).toBe(true);
    expect(canView("class", "class")).toBe(true);
    expect(canView("class", "team")).toBe(false);
    expect(canView("class", "nobody")).toBe(false);
  });

  it("team sees team + class + everyone, not nobody", () => {
    expect(canView("team", "everyone")).toBe(true);
    expect(canView("team", "class")).toBe(true);
    expect(canView("team", "team")).toBe(true);
    expect(canView("team", "nobody")).toBe(false);
  });

  it("nobody is never visible except to self", () => {
    for (const rel of ["team", "class", "public"] as const) {
      expect(canView(rel, "nobody")).toBe(false);
    }
  });
});

describe("canViewField", () => {
  it("self always true regardless of settings", () => {
    expect(canViewField({ real_name: "nobody" }, "self", "real_name")).toBe(true);
  });

  it("respects the field's level for non-self viewers", () => {
    const vis = { real_name: "team", total_score: "everyone" };
    expect(canViewField(vis, "public", "real_name")).toBe(false);
    expect(canViewField(vis, "team", "real_name")).toBe(true);
    expect(canViewField(vis, "public", "total_score")).toBe(true);
  });

  it("defaults unset fields to 'everyone'", () => {
    expect(canViewField({}, "public", "badges")).toBe(true);
    expect(canViewField(undefined, "public", "badges")).toBe(true);
  });
});

describe("visibleFields", () => {
  it("self sees all 8 fields", () => {
    expect(visibleFields({}, "self").sort()).toEqual([...PROFILE_FIELD_KEYS].sort());
    expect(PROFILE_FIELD_KEYS.length).toBe(8);
  });

  it("all-nobody hides every field from non-self", () => {
    const allNobody = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "nobody"]));
    for (const rel of ["team", "class", "public"] as const) {
      expect(visibleFields(allNobody, rel)).toEqual([]);
    }
  });

  it("all-everyone shows every field to the public", () => {
    const allPublic = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "everyone"]));
    expect(visibleFields(allPublic, "public").sort()).toEqual([...PROFILE_FIELD_KEYS].sort());
  });

  it("mixed settings expose exactly the allowed fields", () => {
    const vis = {
      display_name: "everyone",
      real_name: "nobody",
      total_score: "class",
      badges: "team",
    };
    expect(visibleFields(vis, "public")).toContain("display_name");
    expect(visibleFields(vis, "public")).not.toContain("real_name");
    expect(visibleFields(vis, "public")).not.toContain("total_score");
    expect(visibleFields(vis, "class")).toContain("total_score");
    expect(visibleFields(vis, "class")).not.toContain("badges");
    expect(visibleFields(vis, "team")).toContain("badges");
  });
});

describe("filterProfileForViewer (unchanged behavior, regression guard)", () => {
  const profile = {
    display_name: "Alex",
    avatar_url: "http://x/a.png",
    profile_visibility: { display_name: "class", avatar: "team" },
  };

  it("self sees name + avatar", () => {
    expect(filterProfileForViewer(profile, "self")).toEqual({
      display_name: "Alex",
      avatar_url: "http://x/a.png",
    });
  });

  it("public sees neither (class name, team avatar both hidden)", () => {
    expect(filterProfileForViewer(profile, "public")).toEqual({
      display_name: null,
      avatar_url: null,
    });
  });

  it("class viewer sees name but not team-only avatar", () => {
    expect(filterProfileForViewer(profile, "class")).toEqual({
      display_name: "Alex",
      avatar_url: null,
    });
  });
});

describe("matrix sanity: every relationship resolves a boolean for every field", () => {
  it("no field/relationship combination throws", () => {
    const vis = Object.fromEntries(PROFILE_FIELD_KEYS.map((k, i) => [k, ["nobody", "team", "class", "everyone"][i % 4]]));
    for (const rel of RELATIONSHIPS) {
      for (const key of PROFILE_FIELD_KEYS) {
        expect(typeof canViewField(vis, rel, key)).toBe("boolean");
      }
    }
  });
});
