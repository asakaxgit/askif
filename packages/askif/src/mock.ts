import type { Answer, Backend, BackendLimits, DecisionItem, ItemResult, Question, State } from "./types.js";

export type MockCall = {
  readonly state: State;
  readonly questions: Readonly<Record<string, Question>>;
};

export type MockOptions = {
  /** When true, different states from one tick share a `decideMany` call. Default: off. */
  readonly multiState?: boolean;
};

export type MockBackend = Backend & {
  /** Every `decide` call, oldest first. */
  readonly calls: readonly MockCall[];
  /** Every `decideMany` call, oldest first. Stays empty when `multiState` is off. */
  readonly manyCalls: readonly (readonly DecisionItem[])[];
};

/**
 * A backend for tests: `answer` decides each question locally.
 *
 *   const backend = mock((q) => q.kind === "yesno" ? { kind: "yesno", probability: 0.9 } : ...);
 *
 * Pass `{ multiState: true }` to record cross-state batches on `manyCalls`.
 * A throw from `answer` fails that one item there; in `decide` it still fails the whole call.
 */
export const mock = (
  answer: (question: Question, state: State) => Answer | Promise<Answer>,
  limits?: BackendLimits,
  options?: MockOptions,
): MockBackend => {
  const calls: MockCall[] = [];
  const manyCalls: DecisionItem[][] = [];
  const decideMany = async (items: readonly DecisionItem[]): Promise<readonly ItemResult[]> => {
    manyCalls.push([...items]);
    return Promise.all(
      items.map(async (item): Promise<ItemResult> => {
        try {
          return { id: item.id, answer: await answer(item.question, item.state) };
        } catch (error) {
          return { id: item.id, error };
        }
      }),
    );
  };
  return {
    name: "mock",
    calls,
    manyCalls,
    ...(limits === undefined ? {} : { limits }),
    ...(options?.multiState === true ? { multiState: true as const, decideMany } : {}),
    decide: async (state, questions) => {
      calls.push({ state, questions });
      const entries = await Promise.all(
        Object.entries(questions).map(async ([id, q]) => [id, await answer(q, state)] as const),
      );
      return Object.fromEntries(entries);
    },
  };
};
