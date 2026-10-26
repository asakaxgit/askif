import type {
  Answer,
  Backend,
  BackendLimits,
  DecisionContext,
  DecisionItem,
  ItemResult,
  Question,
  State,
} from "./types.js";

export type MockCall = {
  readonly state: State;
  readonly questions: Readonly<Record<string, Question>>;
  readonly context?: DecisionContext;
};

export type MockManyCall = {
  readonly items: readonly DecisionItem[];
  readonly context?: DecisionContext;
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
  /** `context` for each `decideMany` call, in the same order as `manyCalls`. */
  readonly manyContexts: readonly (DecisionContext | undefined)[];
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
  const manyContexts: (DecisionContext | undefined)[] = [];
  const decideMany = async (
    items: readonly DecisionItem[],
    context?: DecisionContext,
  ): Promise<readonly ItemResult[]> => {
    manyCalls.push([...items]);
    manyContexts.push(context);
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
    manyContexts,
    ...(limits === undefined ? {} : { limits }),
    ...(options?.multiState === true ? { multiState: true as const, decideMany } : {}),
    decide: async (state, questions, context) => {
      calls.push({ state, questions, ...(context === undefined ? {} : { context }) });
      const entries = await Promise.all(
        Object.entries(questions).map(async ([id, q]) => [id, await answer(q, state)] as const),
      );
      return Object.fromEntries(entries);
    },
  };
};
