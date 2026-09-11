/**
 * Paginated reads for PostgREST.
 *
 * PostgREST caps every response at a server-configured maximum (1000 rows on
 * Supabase by default) and does NOT report that it truncated. An unpaginated
 * `.select()` therefore returns a silently partial result as soon as a study
 * grows: the H9 dry run stored 2,740 privacy-index snapshots and the trajectory
 * export returned 1,000 of them, computing every participant's "final" index
 * from the earliest rows instead of the latest.
 *
 * Any read whose row count grows with participants, days, or events must go
 * through these helpers.
 */

/** Rows per request. Must not exceed the server's max-rows setting. */
export const PAGE_SIZE = 1000;

/** Ids per `.in()` filter, so the request URL stays well inside limits. */
export const ID_CHUNK = 200;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Read every row of a query by walking `.range()` until a short page arrives.
 *
 *   const rows = await fetchAllRows<Snapshot>((from, to) =>
 *     supabase.from("privacy_index_snapshots").select("...").range(from, to)
 *   );
 *
 * The callback must apply the same filters and ordering on every call; an
 * unordered query can repeat or skip rows across pages.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`paginated read failed: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/**
 * Read every row matching a large id list: chunks the ids so the URL stays
 * short, and paginates within each chunk.
 *
 *   const rows = await fetchAllByIds<Find>(sessionIds, (ids, from, to) =>
 *     supabase.from("find_completions").select("...").in("play_session_id", ids).range(from, to)
 *   );
 */
export async function fetchAllByIds<T>(
  ids: readonly string[],
  page: (ids: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  idChunk: number = ID_CHUNK,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += idChunk) {
    const chunk = ids.slice(i, i + idChunk);
    const rows = await fetchAllRows<T>((from, to) => page(chunk, from, to), pageSize);
    all.push(...rows);
  }
  return all;
}
