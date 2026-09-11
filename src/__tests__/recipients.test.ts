import { describe, it, expect } from "vitest";
import { buildKudosRecipients } from "@/lib/social/recipients";

describe("buildKudosRecipients", () => {
  it("merges friends, minions, and recruiter into one labeled list", () => {
    const list = buildKudosRecipients({
      friends: [{ friend: { id: "f1", display_name: "Ada" } }],
      minions: [{ user: { id: "m1", display_name: "Bo" } }],
      recruiter: { user: { id: "r1", display_name: "Cy" } },
    });
    expect(list).toEqual([
      { id: "f1", label: "Ada", group: "friend" },
      { id: "m1", label: "Bo", group: "minion" },
      { id: "r1", label: "Cy", group: "recruiter" },
    ]);
  });

  it("excludes self", () => {
    const list = buildKudosRecipients({
      friends: [{ friend: { id: "me", display_name: "Me" } }, { friend: { id: "f1", display_name: "Ada" } }],
      selfId: "me",
    });
    expect(list.map((r) => r.id)).toEqual(["f1"]);
  });

  it("de-dupes a person across relationships, keeping the closest tie", () => {
    const list = buildKudosRecipients({
      friends: [{ friend: { id: "x", display_name: "Dual" } }],
      minions: [{ user: { id: "x", display_name: "Dual" } }],
    });
    expect(list).toHaveLength(1);
    expect(list[0].group).toBe("friend");
  });

  it("uses group fallbacks when a name is privacy-hidden (null)", () => {
    const list = buildKudosRecipients({
      minions: [{ user: { id: "m1", display_name: null } }],
      recruiter: { user: { id: "r1", display_name: "  " } },
    });
    expect(list.find((r) => r.id === "m1")?.label).toBe("Your minion");
    expect(list.find((r) => r.id === "r1")?.label).toBe("Your recruiter");
  });

  it("skips entries with no id (fully hidden / missing counterparts)", () => {
    const list = buildKudosRecipients({
      minions: [{ user: null }],
      recruiter: { user: null },
      friends: [{ friend: null }],
    });
    expect(list).toEqual([]);
  });

  it("handles empty/absent sources", () => {
    expect(buildKudosRecipients({})).toEqual([]);
  });
});
