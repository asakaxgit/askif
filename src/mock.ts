import type { Answer, Backend, BackendLimits, Question, State } from "./types.js";

export type MockCall = {
  readonly state: State;
  readonly questions: Readonly<Record<string, Question>>;
};

export type MockBackend = Backend & {
  /** Every call made to this backend, oldest first. */
  readonly calls: readonly MockCall[];
};

/**
 * A backend for tests: `answer` decides each question locally.
 *
 *   const backend = mock((q) => q.kind === "yesno" ? { kind: "yesno", probability: 0.9 } : ...);
 */
export const mock = (
  answer: (question: Question, state: State) => Answer | Promise<Answer>,
  limits?: BackendLimits,
): MockBackend => {
  const calls: MockCall[] = [];
  return {
    name: "mock",
    calls,
    ...(limits === undefined ? {} : { limits }),
    decide: async (state, questions) => {
      calls.push({ state, questions });
      const entries = await Promise.all(
        Object.entries(questions).map(async ([id, q]) => [id, await answer(q, state)] as const),
      );
      return Object.fromEntries(entries);
    },
  };
};
