// Measures tokens and latency per request against the live Cloudflare API and prints a
// markdown table (the numbers in the README's "Cost and latency" section come from this).
// Costs a few cents. Requests run one after another; set BENCH_RUNS to change the sample size (default 5).
//
// Run with: node --env-file=../../.env.local --import tsx examples/bench.ts
import { readFileSync } from "node:fs";
import type { Json, Question } from "askif";
import { clef } from "../src/index.js";
import type { ClefModel } from "../src/index.js";

const RUNS = Number(process.env["BENCH_RUNS"] ?? 5);

type Sample = { readonly ms: number; readonly inputTokens: number };
const samples: Sample[] = [];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Times each request and records the `usage.input_tokens` Cloudflare reports. */
const timedFetch: typeof fetch = async (url, init) => {
  const start = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  const ms = performance.now() - start;
  const body: unknown = JSON.parse(text);
  const usage = isRecord(body) && isRecord(body["result"]) ? body["result"]["usage"] : undefined;
  const inputTokens = isRecord(usage) && typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : NaN;
  samples.push({ ms, inputTokens });
  return new Response(text, { status: response.status, headers: response.headers });
};

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN;

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
const longText = Array.from({ length: 150 }, (_, i) => `Ticket ${i}: the customer reports an issue with order ${1000 + i} and asks for an update.`).join("\n");

const image = (dir: string, file: string, type: string): string =>
  `data:${type};base64,${readFileSync(new URL(`../test/fixtures/${dir}/${file}`, import.meta.url)).toString("base64")}`;
const circle = image("images", "red-circle.png", "image/png");
const cat = image("public-domain", "cat.jpg", "image/jpeg");
const earth = image("public-domain", "earthrise.jpg", "image/jpeg");
const apple = image("public-domain", "apple.png", "image/png");

const scenarios: readonly (readonly [string, Json, number])[] = [
  ["short text, 1 question", ticket, 1],
  ["short text, 4 questions", ticket, 4],
  ["short text, 16 questions", ticket, 16],
  ["short text, 64 questions", ticket, 64],
  ["long text (~3.6k tokens), 1 question", longText, 1],
  ["1 image, 128x128 PNG, 1 question", { photo: circle }, 1],
  ["1 image, 960x653 JPEG, 1 question", { photo: cat }, 1],
  ["1 image, 960x960 JPEG, 1 question", { photo: earth }, 1],
  ["4 images (960 px), 1 question", { photos: [circle, cat, earth, apple] }, 1],
];

console.log(`| model | request | questions | median ms | min-max ms | input tokens |\n| --- | --- | --- | --- | --- | --- |`);
for (const model of ["clef", "clef-flash"] satisfies ClefModel[]) {
  const backend = clef({ model, fetch: timedFetch });
  for (const [name, state, count] of scenarios) {
    samples.length = 0;
    for (let i = 0; i < RUNS; i++) await backend.decide(state, questions(count));
    const ms = samples.map((s) => s.ms);
    const range = `${Math.round(Math.min(...ms))}-${Math.round(Math.max(...ms))}`;
    console.log(`| ${model} | ${name} | ${count} | ${Math.round(median(ms))} | ${range} | ${median(samples.map((s) => s.inputTokens))} |`);
  }
}
