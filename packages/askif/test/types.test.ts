// Compile-time checks: `npm run typecheck` fails if these types regress.
import { test } from "node:test";
import { createAsk, mock } from "../src/index.js";

const ask = createAsk({ backend: mock(() => ({ kind: "yesno", probability: 1 })) });

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(): T | undefined => undefined;

test("result types are narrowed to the declared keys", () => {
  const typeOnly = async () => {
    const team = await ask.switch("", "").case("returns").case("billing").other();
    expectType<Equal<typeof team.choice, "returns" | "billing" | "other">>();

    const severity = await ask.score("", "").level("low").level("mid").level("high");
    expectType<Equal<typeof severity.level, "low" | "mid" | "high">>();

    void ask.switch("", "").case("a", (r) => r.choice satisfies "a");
    void ask.score("", "").level("x", (r) => r.level satisfies "x");
    void team;

    // @ts-expect-error: "nope" is not a declared level
    severity.level satisfies "nope";
  };
  void typeOnly;
});

test("elseif chains stay typed", () => {
  const typeOnly = async () => {
    const result = await ask
      .if("", "", (r) => r.index satisfies number)
      .elseif("", (r) => r.condition satisfies string | undefined, { threshold: 0.7 })
      .unsure(() => {}, { on: "skip" })
      .else(() => {});
    expectType<Equal<typeof result.index, number>>();
    expectType<Equal<typeof result.unsureIndexes, readonly number[]>>();
    void result;
    // @ts-expect-error: "sometimes" is not a policy
    void ask.if("", "").unsure(() => {}, { on: "sometimes" });
  };
  void typeOnly;
});
