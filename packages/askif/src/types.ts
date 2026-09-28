/** Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** What a question is asked about: text, a JSON object, or an array. */
export type State = Json;

/** Text the model reads: a plain string, or structured JSON such as `{ what, examples }`. */
export type Description = Json;

/* -------------------------------------------------------------------------- */
/* Backend contract                                                           */
/* -------------------------------------------------------------------------- */

export type YesNoCriteria = {
  readonly true?: Description;
  readonly false?: Description;
};

export type YesNoQuestion = {
  readonly kind: "yesno";
  readonly instructions: Description;
  readonly criteria?: YesNoCriteria;
};

export type ChoiceOption = {
  readonly key: string;
  /** `null` when the key explains itself. */
  readonly description: Description;
};

export type ChoiceQuestion = {
  readonly kind: "choice";
  readonly instructions: Description;
  readonly options: readonly ChoiceOption[];
};

export type ScaleQuestion = {
  readonly kind: "scale";
  readonly instructions: Description;
  /** Ordered from the low end of the scale to the high end. */
  readonly levels: readonly Description[];
};

export type Question = YesNoQuestion | ChoiceQuestion | ScaleQuestion;

export type YesNoAnswer = {
  readonly kind: "yesno";
  /** Probability that the answer is yes, from 0 to 1. */
  readonly probability: number;
};

export type ChoiceAnswer = {
  readonly kind: "choice";
  /** Probability per option key. */
  readonly probabilities: Readonly<Record<string, number>>;
  /** Backend-reported confidence. Computed by askif when absent. */
  readonly confidence?: number;
};

export type ScaleAnswer = {
  readonly kind: "scale";
  /** Probability per level, in level order. */
  readonly probabilities: readonly number[];
  /** Backend-reported confidence. Computed by askif when absent. */
  readonly confidence?: number;
};

export type Answer = YesNoAnswer | ChoiceAnswer | ScaleAnswer;

export type BackendLimits = {
  readonly maxOptions?: number;
  readonly maxLevels?: number;
  readonly maxQuestionsPerCall?: number;
};

/** Anything that can answer yes/no, choice, and scale questions. */
export type Backend = {
  readonly name: string;
  readonly limits?: BackendLimits;
  /** Answer every question about one state. Keys in the result match keys in `questions`. */
  readonly decide: (
    state: State,
    questions: Readonly<Record<string, Question>>,
  ) => Promise<Readonly<Record<string, Answer>>>;
};

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type AskConfig = {
  readonly backend: Backend;
  /** `ask.if` / `ask.is`: probability above which the condition counts as true. */
  readonly threshold: number;
  /** `ask.if` with `.unsure()`: probabilities inside this band are unsure. */
  readonly unsureBand: readonly [number, number];
  /** `ask.switch` / `ask.score` with `.unsure()`: confidence below this is unsure. */
  readonly minConfidence: number;
  /** Most questions sent in one backend call. */
  readonly maxBatchSize: number;
};

export type CallOptions = {
  /** Use a different backend for this call. */
  readonly backend?: Backend;
};

export type IfOptions = CallOptions & {
  readonly threshold?: number;
  readonly unsureBand?: readonly [number, number];
  /** What counts as a yes and a no, for conditions with a fuzzy boundary. */
  readonly criteria?: YesNoCriteria;
};

export type DecisionOptions = CallOptions & {
  readonly minConfidence?: number;
};

/* -------------------------------------------------------------------------- */
/* Results and chains                                                         */
/* -------------------------------------------------------------------------- */

export type Handler<R> = (result: R) => unknown;

export type IfResult = {
  readonly branch: "then" | "else" | "unsure";
  /** Probability that the condition holds, from 0 to 1. */
  readonly probability: number;
};

export type Ranked<K extends string> = {
  readonly key: K;
  readonly probability: number;
};

export type SwitchResult<C extends string, All extends string = string> = {
  readonly branch: "case" | "unsure";
  /** The most likely option. */
  readonly choice: C;
  readonly confidence: number;
  /** Every option, most likely first. */
  readonly ranking: readonly Ranked<All>[];
};

export type ScoreResult<L extends string> = {
  readonly branch: "level" | "unsure";
  /** The most likely level. */
  readonly level: L;
  /** Position of `level`, from 0. */
  readonly index: number;
  /** Probability-weighted position, from 0 to the top level. May fall between levels. */
  readonly score: number;
  /** `score` scaled to 0..1, for comparing scales of different lengths. */
  readonly normalized: number;
  readonly confidence: number;
  /** Probability per level, in level order. */
  readonly probabilities: readonly number[];
};

export type IfChain = {
  /** Runs when the condition is judged false. */
  readonly else: (handler: Handler<IfResult>) => IfChain;
  /** Runs when the probability falls inside the unsure band. */
  readonly unsure: (handler: Handler<IfResult>) => IfChain;
  readonly then: PromiseLike<IfResult>["then"];
};

export type SwitchChain<K extends readonly string[]> = {
  readonly case: <const C extends string>(
    key: C,
    descriptionOrHandler?: Description | Handler<SwitchResult<C>>,
    handler?: Handler<SwitchResult<C>>,
  ) => SwitchChain<readonly [...K, C]>;
  /** Adds an `other` option the model can pick when nothing else fits. */
  readonly other: (
    descriptionOrHandler?: Description | Handler<SwitchResult<"other">>,
    handler?: Handler<SwitchResult<"other">>,
  ) => SwitchChain<readonly [...K, "other"]>;
  /** Runs when confidence is below `minConfidence`. */
  readonly unsure: (handler: Handler<SwitchResult<string>>) => SwitchChain<K>;
  readonly then: PromiseLike<SwitchResult<K[number], K[number]>>["then"];
};

export type ScoreChain<L extends readonly string[]> = {
  readonly level: <const D extends string>(
    key: D,
    descriptionOrHandler?: Description | Handler<ScoreResult<D>>,
    handler?: Handler<ScoreResult<D>>,
  ) => ScoreChain<readonly [...L, D]>;
  /** Runs when confidence is below `minConfidence`. */
  readonly unsure: (handler: Handler<ScoreResult<string>>) => ScoreChain<L>;
  readonly then: PromiseLike<ScoreResult<L[number]>>["then"];
};

export type Ask = {
  readonly if: (
    state: State,
    condition: string,
    then?: Handler<IfResult>,
    options?: IfOptions,
  ) => IfChain;
  readonly switch: (
    state: State,
    question: Description,
    options?: DecisionOptions,
  ) => SwitchChain<readonly []>;
  readonly score: (
    state: State,
    question: Description,
    options?: DecisionOptions,
  ) => ScoreChain<readonly []>;
  /** `if (await ask.is(state, condition)) { ... }` */
  readonly is: (state: State, condition: string, options?: IfOptions) => Promise<boolean>;
  /** Probability (0 to 1) that `condition` holds for `state`. */
  readonly probability: (state: State, condition: string, options?: IfOptions) => Promise<number>;
  /** Change defaults for this instance. */
  readonly configure: (config: Partial<AskConfig>) => void;
};
