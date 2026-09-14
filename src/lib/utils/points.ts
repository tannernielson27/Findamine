/**
 * Sum the `amount` column of points_ledger rows.
 *
 * Every reader of points_ledger (gamification, referrals, research exports)
 * sums the `amount` column — this is the single shared helper so peer-facing
 * totals stay consistent with the rest of the app.
 */
export function sumLedger(rows: { amount: number | null }[]): number {
  return rows.reduce((sum, row) => sum + (row.amount || 0), 0);
}
