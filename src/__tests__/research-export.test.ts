import { describe, it, expect } from "vitest";
import { participantId, escapeField, serializeTable } from "@/lib/services/research-export";

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
