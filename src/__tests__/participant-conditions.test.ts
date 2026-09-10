import { describe, it, expect } from "vitest";
import {
  humanizeDimensionName,
  buildConditionDimensions,
  type LinkedDimensionRow,
} from "@/lib/services/participant-conditions";

describe("humanizeDimensionName", () => {
  it("replaces underscores and title-cases", () => {
    expect(humanizeDimensionName("privacy_control_complexity")).toBe("Privacy Control Complexity");
    expect(humanizeDimensionName("privacy_default")).toBe("Privacy Default");
    expect(humanizeDimensionName("privacy_friction")).toBe("Privacy Friction");
  });

  it("tolerates odd spacing and empties", () => {
    expect(humanizeDimensionName("__a__b")).toBe("A B");
    expect(humanizeDimensionName("")).toBe("");
  });
});

describe("buildConditionDimensions", () => {
  const linked: LinkedDimensionRow[] = [
    {
      dimension_id: "d-friction",
      sort_order: 1,
      treatment_dimensions: { name: "privacy_friction", description: "How hard to change", levels: ["low", "high"] },
    },
    {
      dimension_id: "d-default",
      sort_order: 0,
      treatment_dimensions: [{ name: "privacy_default", description: null, levels: ["private", "neutral", "public"] }],
    },
  ];

  it("joins assignments, orders by sort_order, and humanizes names", () => {
    const out = buildConditionDimensions(linked, [
      { dimension_id: "d-default", level: "neutral" },
      { dimension_id: "d-friction", level: "high" },
    ]);
    expect(out.map((d) => d.name)).toEqual(["privacy_default", "privacy_friction"]);
    expect(out[0]).toEqual({
      name: "privacy_default",
      label: "Privacy Default",
      description: null,
      levels: ["private", "neutral", "public"],
      assigned_level: "neutral",
    });
    expect(out[1].assigned_level).toBe("high");
    expect(out[1].description).toBe("How hard to change");
  });

  it("reports null assigned_level when the user has no assignment on a dimension", () => {
    const out = buildConditionDimensions(linked, [{ dimension_id: "d-default", level: "public" }]);
    expect(out.find((d) => d.name === "privacy_friction")?.assigned_level).toBeNull();
  });

  it("ignores assignments for dimensions not linked to the study", () => {
    const out = buildConditionDimensions(linked, [{ dimension_id: "d-unlinked", level: "x" }]);
    expect(out.every((d) => d.assigned_level === null)).toBe(true);
  });

  it("skips rows with a missing joined dimension and does not mutate input order", () => {
    const rows: LinkedDimensionRow[] = [...linked, { dimension_id: "d-gone", treatment_dimensions: null }];
    const out = buildConditionDimensions(rows, []);
    expect(out).toHaveLength(2);
    expect(rows[0].dimension_id).toBe("d-friction");
  });
});
