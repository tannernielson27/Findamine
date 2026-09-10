import { describe, it, expect } from "vitest";
import {
  participantId,
  escapeField,
  serializeTable,
  tableToJSON,
  serialize,
  countReversals,
} from "@/lib/services/research-export";

describe("countReversals (change-then-undo across saves)", () => {
  it("returns 0 with no changes or no undo", () => {
    expect(countReversals([])).toBe(0);
    expect(countReversals([[{ field: "total_score", from: "everyone", to: "nobody" }]])).toBe(0);
    expect(
      countReversals([
        [{ field: "total_score", from: "everyone", to: "team" }],
        [{ field: "total_score", from: "team", to: "nobody" }], // further, not undone
      ])
    ).toBe(0);
  });

  it("counts an exact undo of a prior transition", () => {
    expect(
      countReversals([
        [{ field: "total_score", from: "everyone", to: "nobody" }],
        [{ field: "total_score", from: "nobody", to: "everyone" }],
      ])
    ).toBe(1);
  });

  it("tracks reversals per field independently", () => {
    expect(
      countReversals([
        [
          { field: "total_score", from: "everyone", to: "nobody" },
          { field: "badges", from: "everyone", to: "team" },
        ],
        [
          { field: "total_score", from: "nobody", to: "everyone" }, // undo
          { field: "badges", from: "team", to: "nobody" }, // further
        ],
      ])
    ).toBe(1);
  });

  it("counts repeated flip-flops each time", () => {
    expect(
      countReversals([
        [{ field: "real_name", from: "class", to: "nobody" }],
        [{ field: "real_name", from: "nobody", to: "class" }], // undo #1
        [{ field: "real_name", from: "class", to: "nobody" }], // undo of the undo
      ])
    ).toBe(2);
  });
});

describe("participantId", () => {
  it("produces zero-padded, 1-based, de-identified ids", () => {
    expect(participantId(0)).toBe("P0001");
    expect(participantId(41)).toBe("P0042");
    expect(participantId(9999)).toBe("P10000");
  });
});

describe("escapeField", () => {
  it("leaves plain values untouched", () => {
    expect(escapeField("simple", ",")).toBe("simple");
    expect(escapeField("P0001", ",")).toBe("P0001");
  });

  it("quotes values containing the separator", () => {
    expect(escapeField("a,b", ",")).toBe('"a,b"');
    // ...but not when the separator is a tab
    expect(escapeField("a,b", "\t")).toBe("a,b");
  });

  it("escapes embedded quotes by doubling", () => {
    expect(escapeField('he said "hi"', ",")).toBe('"he said ""hi"""');
  });

  it("quotes values with newlines", () => {
    expect(escapeField("line1\nline2", ",")).toBe('"line1\nline2"');
  });
});

describe("serializeTable", () => {
  it("joins headers and rows with the separator", () => {
    const out = serializeTable(["a", "b"], [["1", "2"], ["3", "4"]], ",");
    expect(out).toBe("a,b\n1,2\n3,4");
  });

  it("supports TSV", () => {
    const out = serializeTable(["a", "b"], [["1", "2"]], "\t");
    expect(out).toBe("a\tb\n1\t2");
  });

  it("escapes fields per-cell so separators inside values don't corrupt columns", () => {
    const out = serializeTable(["name", "val"], [["a,b", "x"]], ",");
    expect(out).toBe('name,val\n"a,b",x');
    // round-trips to the right column count
    expect(out.split("\n")[1].match(/(^|,)("([^"]|"")*"|[^,]*)/g)?.length).toBeGreaterThan(0);
  });

  it("handles an empty row set (header only)", () => {
    expect(serializeTable(["a", "b"], [], ",")).toBe("a,b");
  });
});

describe("tableToJSON", () => {
  it("maps each row to an object keyed by header", () => {
    const out = tableToJSON(["a", "b"], [["1", "2"], ["3", "4"]]);
    expect(JSON.parse(out)).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("fills missing cells with empty strings", () => {
    const out = tableToJSON(["a", "b", "c"], [["1", "2"]]);
    expect(JSON.parse(out)).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("produces an empty array for no rows", () => {
    expect(JSON.parse(tableToJSON(["a"], []))).toEqual([]);
  });
});

describe("serialize", () => {
  const headers = ["a", "b"];
  const rows = [["1", "2"]];

  it("dispatches to CSV / TSV / JSON by format", () => {
    expect(serialize(headers, rows, "csv")).toBe("a,b\n1,2");
    expect(serialize(headers, rows, "tsv")).toBe("a\tb\n1\t2");
    expect(JSON.parse(serialize(headers, rows, "json"))).toEqual([{ a: "1", b: "2" }]);
  });
});
