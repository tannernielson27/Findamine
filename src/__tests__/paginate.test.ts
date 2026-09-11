import { describe, it, expect } from "vitest";
import { fetchAllRows, fetchAllByIds } from "@/lib/utils/paginate";

/** A fake table that behaves like PostgREST: never returns more than `cap` rows. */
function pagedTable(rowCount: number, cap: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ i }));
  const calls: [number, number][] = [];
  return {
    calls,
    page: async (from: number, to: number) => {
      calls.push([from, to]);
      const end = Math.min(to + 1, from + cap);
      return { data: rows.slice(from, end), error: null };
    },
  };
}

describe("fetchAllRows", () => {
  it("walks past the server row cap and returns everything", async () => {
    const t = pagedTable(2740, 1000);
    const rows = await fetchAllRows<{ i: number }>(t.page);
    expect(rows).toHaveLength(2740);
    expect(rows[0].i).toBe(0);
    expect(rows[2739].i).toBe(2739);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after one request when the first page is short", async () => {
    const t = pagedTable(12, 1000);
    expect(await fetchAllRows(t.page)).toHaveLength(12);
    expect(t.calls).toHaveLength(1);
  });

  it("makes one extra request when the total is an exact multiple of the page size", async () => {
    const t = pagedTable(2000, 1000);
    expect(await fetchAllRows(t.page)).toHaveLength(2000);
    expect(t.calls).toHaveLength(3); // the third page comes back empty
  });

  it("returns nothing for an empty table", async () => {
    const t = pagedTable(0, 1000);
    expect(await fetchAllRows(t.page)).toEqual([]);
  });

  it("throws instead of silently returning a partial result", async () => {
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: "boom" } }))
    ).rejects.toThrow(/boom/);
  });
});

describe("fetchAllByIds", () => {
  it("chunks the id list and paginates within each chunk", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const seen: string[][] = [];
    const rows = await fetchAllByIds<{ id: string }>(
      ids,
      async (chunk, from) => {
        if (from === 0) seen.push(chunk);
        // Two rows per id, all returned on the first page.
        return { data: from === 0 ? chunk.flatMap((id) => [{ id }, { id }]) : [], error: null };
      },
      200
    );
    expect(seen.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(rows).toHaveLength(900);
  });

  it("does nothing when there are no ids", async () => {
    const rows = await fetchAllByIds([], async () => ({ data: [{ x: 1 }], error: null }));
    expect(rows).toEqual([]);
  });
});
