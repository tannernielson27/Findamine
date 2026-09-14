/**
 * Server-side validation of submitted survey answers. Pure helpers, kept out of
 * the route file so they are unit-testable and so the route exports only HTTP
 * handlers (a Next.js route module must not export anything else).
 */

export type ChoiceQuestion = { item_code: string; options: unknown };

/** Option values a `multiple_choice` item accepts (`{value,label}` objects or bare strings). */
export function optionValues(options: unknown): Set<string> {
  const values = new Set<string>();
  if (!Array.isArray(options)) return values;
  for (const o of options) {
    if (o && typeof o === "object" && "value" in o) values.add(String((o as { value: unknown }).value));
    else values.add(String(o));
  }
  return values;
}

/** Item codes whose submitted answer is not one of the configured options. */
export function findInvalidChoiceAnswers(
  questions: ChoiceQuestion[],
  answers: Record<string, unknown>
): string[] {
  const invalid: string[] = [];
  for (const q of questions) {
    const a = answers[q.item_code];
    if (a === undefined || a === null || a === "") continue;
    if (!optionValues(q.options).has(String(a))) invalid.push(q.item_code);
  }
  return invalid;
}
