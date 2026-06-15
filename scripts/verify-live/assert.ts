/** One verification check's outcome for the report. */
export type CheckResult = {
  id: string;
  owedPr: string;
  title: string;
  status: "pass" | "fail" | "diverge" | "skip";
  detail: string; // human note + the actual response snippet (the evidence)
};

const results: CheckResult[] = [];

/** Returns all collected results (for the report writer). */
export function allResults(): CheckResult[] {
  return results;
}

/** Throws when the condition is false — caught by runCheck and recorded as a FAIL. */
export function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Truncates a value to a short evidence snippet for the report. */
export function snippet(value: unknown, max = 600): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Metadata identifying a single check. */
export type CheckMeta = { id: string; owedPr: string; title: string };

/** Runs one check; records pass/fail/diverge and never throws out of the suite. */
export async function runCheck(meta: CheckMeta, body: () => Promise<string>): Promise<void> {
  try {
    const detail = await body();
    results.push({ ...meta, status: "pass", detail });
    process.stdout.write(`  ✓ ${meta.id} ${meta.title}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("DIVERGE:") ? "diverge" : "fail";
    results.push({ ...meta, status, detail: message });
    process.stdout.write(`  ✗ ${meta.id} ${meta.title} — ${message}\n`);
  }
}

/** Records a deliberately skipped check (e.g. no SMTP) with a reason. */
export function recordSkip(meta: CheckMeta, reason: string): void {
  results.push({ ...meta, status: "skip", detail: reason });
  process.stdout.write(`  — ${meta.id} ${meta.title} (skip: ${reason})\n`);
}
