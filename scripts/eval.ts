/**
 * Accuracy check for the extraction pipeline against hand-labeled syllabi.
 *
 *   eval/<name>.pdf|docx|txt          the syllabus
 *   eval/<name>.expected.json         [{ "date": "2026-10-14", "title": "Midterm" }, ...]
 *
 * Run:  npm run eval            (needs at least one AI key in .env or .env.local)
 *       AI_PROVIDER_ORDER=groq npm run eval   to test one provider
 *
 * An expected item counts as found if some extracted event has the same date (and, when the
 * expected title is given, shares at least one meaningful word with it).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractWithFallback } from "../lib/ai/fallback";
import { getProviders } from "../lib/ai/provider";
import { extractText } from "../lib/parse/extractText";
import { CourseContextSchema, type SyllabusEvent } from "../lib/schema";
import { buildEvents, normalizeForMatch } from "../lib/validate";

const DIR = path.resolve(process.argv[2] ?? "eval");
const STOP = new Set(["due", "the", "and", "of", "for", "a", "in", "on", "class", "no"]);

interface Expected {
  date: string;
  title?: string;
}

const words = (s: string) => new Set(normalizeForMatch(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

function matches(exp: Expected, ev: SyllabusEvent) {
  if (ev.date !== exp.date && !(ev.endDate && exp.date >= ev.date && exp.date <= ev.endDate)) return false;
  if (!exp.title) return true;
  const ew = words(ev.title);
  return [...words(exp.title)].some((w) => ew.has(w));
}

async function main() {
  const files = (await readdir(DIR)).filter((f) => /\.(pdf|docx|html?|md|rtf|txt|png|jpe?g|webp)$/i.test(f));
  if (!files.length) {
    console.log(`No syllabi found in ${DIR}. See the comment at the top of scripts/eval.ts.`);
    return;
  }
  const providers = await getProviders();
  console.log(`Providers (in order): ${providers.map((p) => p.id).join(", ")}\n`);

  let totalExp = 0, totalFound = 0, totalPred = 0, totalCorrect = 0, totalFlagged = 0, flaggedWrong = 0;

  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, "");
    const expPath = path.join(DIR, `${base}.expected.json`);
    const expected: Expected[] = JSON.parse(await readFile(expPath, "utf8").catch(() => "null")) ?? [];
    if (!expected.length) {
      console.log(`- ${f}: skipped (no ${base}.expected.json)`);
      continue;
    }
    // Same as the app: only the syllabus goes in; course name and term dates come from it.
    const ctx = CourseContextSchema.parse({ timezone: "UTC" });

    const buf = await readFile(path.join(DIR, f));
    const input = await extractText(new File([buf], f));
    const { raw, provider } = await extractWithFallback(
      providers,
      input.kind === "file" ? { context: ctx, file: { mime: input.mime, data: input.data } } : { context: ctx, text: input.text },
    );
    const { events } = buildEvents(raw, input.kind === "file" ? "" : input.text, ctx);
    const singles = events.filter((e) => !e.recurring);

    const found = expected.filter((x) => singles.some((e) => matches(x, e)));
    const correct = singles.filter((e) => expected.some((x) => matches(x, e)));
    const wrong = singles.filter((e) => !correct.includes(e));
    const flagged = singles.filter((e) => e.flags.length);

    totalExp += expected.length;
    totalFound += found.length;
    totalPred += singles.length;
    totalCorrect += correct.length;
    totalFlagged += flagged.length;
    flaggedWrong += wrong.filter((e) => e.flags.length).length;

    console.log(
      `- ${f} [${provider}]: recall ${found.length}/${expected.length}, precision ${correct.length}/${singles.length}, flagged ${flagged.length}`,
    );
    for (const x of expected.filter((x) => !found.includes(x))) console.log(`    missed: ${x.date} ${x.title ?? ""}`);
    for (const e of wrong) console.log(`    extra:  ${e.date} ${e.title}${e.flags.length ? "  [flagged]" : ""}`);
  }

  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
  console.log(`\nRecall    ${pct(totalFound, totalExp)}  (${totalFound}/${totalExp})`);
  console.log(`Precision ${pct(totalCorrect, totalPred)}  (${totalCorrect}/${totalPred})`);
  console.log(`Wrong items that were flagged for review: ${flaggedWrong}/${totalPred - totalCorrect}`);
  console.log(`Total flagged: ${totalFlagged}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
