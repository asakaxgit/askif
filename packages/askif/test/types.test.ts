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
      .if(
        "",
        "",
        (r) => {
          expectType<Equal<typeof r.branch, "then">>();
          expectType<Equal<typeof r.index, 0>>();
          expectType<Equal<typeof r.condition, string>>();
          void r;
        },
      )
      .elseif("", (r) => {
        expectType<Equal<typeof r.branch, "elseif">>();
        expectType<Equal<typeof r.condition, string>>();
        void r;
      })
      .unsure(
        (r) => {
          expectType<Equal<typeof r.branch, "unsure">>();
          void r;
        },
        { mode: "skip" },
      )
      .else((r) => {
        expectType<Equal<typeof r.branch, "else">>();
        // @ts-expect-error: else has no deciding condition
        void r.condition;
      });
    expectType<Equal<typeof result.branch, "then" | "elseif" | "else" | "unsure">>();
    expectType<Equal<typeof result.unsureIndexes, readonly number[]>>();
    expectType<Equal<typeof result.probabilities, readonly number[]>>();

    if (result.branch === "elseif") expectType<Equal<typeof result.condition, string>>();

    // @ts-expect-error: "sometimes" is not a mode
    void ask.if("", "").elseif("").unsure(() => {}, { mode: "sometimes" });
    // @ts-expect-error: a mode only means something once there is an .elseif()
    void ask.if("", "").unsure(() => {}, { mode: "skip" });
  };
  void typeOnly;
});
