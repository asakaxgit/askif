// Compares tokens and latency across the live backends under the same conditions: same host, same
// scenarios, and the backends interleaved run by run, so network and load changes hit them equally.
// Text only, since only @askif/clef accepts images (see packages/clef/examples/bench.ts for those).
// Costs a few cents per provider. Needs TYPESAFE_API_KEY, OPENAI_API_KEY, CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN, and BENCH_RUNS sets the sample size (default 5). BENCH_BACKENDS (comma-separated
// labels, e.g. "clef,jev") limits which backends run, e.g. to skip one that is rate-limited.
//
// Run from the repo root: node --env-file=.env.local --import tsx bench/compare.ts
import type { Backend, Json, Question } from "../packages/askif/src/index.js";
import { clef } from "../packages/clef/src/index.js";
import { jev } from "../packages/jev/src/index.js";
import { openai } from "../packages/openai/src/index.js";

const RUNS = Number(process.env["BENCH_RUNS"] ?? 5);

type Usage = { requests: number; inputTokens: number; outputTokens: number };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A fetch that adds up the token usage of every request one `decide` call makes. Each provider names it differently. */
const counting = (usage: Usage): typeof fetch => async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  usage.requests += 1;
  try {
    const body: unknown = JSON.parse(text);
    const result = isRecord(body) && isRecord(body["result"]) ? body["result"] : body; // Cloudflare wraps in { result }
    const u = isRecord(result) ? result["usage"] : undefined;
    if (isRecord(u)) {
      usage.inputTokens += num(u["input_tokens"]) + num(u["prompt_tokens"]);
      usage.outputTokens += num(u["output_tokens"]) + num(u["completion_tokens"]);
    }
  } catch {
    // Not JSON (an error page); the call will fail on its own.
  }
  return new Response(text, { status: response.status, headers: response.headers });
};

/** Each backend counts its own requests, so a slow or retrying one can't leak into another's numbers. */
const track = (make: (fetch: typeof globalThis.fetch) => Backend): { backend: Backend; usage: Usage } => {
  const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  return { backend: make(counting(usage)), usage };
};
const only = process.env["BENCH_BACKENDS"]?.split(",").map((label) => label.trim());
const all: readonly (readonly [string, ReturnType<typeof track>])[] = [
  ["clef", track((fetch) => clef({ fetch }))],
  ["clef-flash", track((fetch) => clef({ model: "clef-flash", fetch }))],
  ["jev", track((fetch) => jev({ fetch }))],
  ["openai", track((fetch) => openai({ fetch }))],
];
const backends = all.filter(([label]) => only === undefined || only.includes(label));

const questions = (count: number): Record<string, Question> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i): [string, Question] => [
      `q${i}`,
      i % 4 === 2
        ? {
            kind: "choice",
            instructions: "Which team should handle this?",
            options: [
              { key: "returns", description: "Exchanges" },
              { key: "billing", description: "Charges" },
              { key: "shipping", description: "Delivery" },
            ],
          }
        : i % 4 === 3
          ? { kind: "scale", instructions: "How severe is it?", levels: ["minor", "major", "blocking"] }
          : { kind: "yesno", instructions: `Is this about shipping? (variant ${i})` },
    ]),
  );

const ticket = "Shoes arrived in the wrong size. Also I was charged twice and the parcel was left in the rain.";
const longText = Array.from(
  { length: 150 },
  (_, i) => `Ticket ${i}: the customer reports an issue with order ${1000 + i} and asks for an update.`,
).join("\n");

const scenarios: readonly (readonly [string, Json, number])[] = [
  ["short text, 1 question", ticket, 1],
  ["short text, 4 questions", ticket, 4],
  ["short text, 16 questions", ticket, 16],
  ["short text, 64 questions", ticket, 64],
  ["long text (~3.6k tokens), 1 question", longText, 1],
];

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN;

console.log(
  "| request | backend | HTTP requests | median ms | min-max ms | input tokens | output tokens | ok |\n| --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const [name, state, count] of scenarios) {
  const results = new Map<string, { ms: number[]; usage: Usage[]; failures: string[] }>(
    backends.map(([label]) => [label, { ms: [], usage: [], failures: [] }]),
  );
  for (let run = 0; run < RUNS; run++) {
    for (const [label, { backend, usage }] of backends) {
      Object.assign(usage, { requests: 0, inputTokens: 0, outputTokens: 0 });
      const start = performance.now();
      const bucket = results.get(label);
      try {
        await backend.decide(state, questions(count));
        bucket?.ms.push(performance.now() - start);
        bucket?.usage.push({ ...usage });
      } catch (error) {
        bucket?.failures.push(String(error).slice(0, 160));
      }
    }
  }
  for (const [label, { ms, usage: u, failures }] of results) {
    const range = ms.length === 0 ? "-" : `${Math.round(Math.min(...ms))}-${Math.round(Math.max(...ms))}`;
    console.log(
      `| ${name} | ${label} | ${median(u.map((x) => x.requests))} | ${ms.length === 0 ? "-" : Math.round(median(ms))} | ${range} | ${median(u.map((x) => x.inputTokens))} | ${median(u.map((x) => x.outputTokens))} | ${ms.length}/${RUNS} |`,
    );
    if (failures[0] !== undefined) console.error(`  ${label} / ${name}: ${failures[0]}`);
  }
}
