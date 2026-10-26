/** Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** What a question is asked about: text, a JSON object, or an array. */
export type State = Json;

/**
 * Where an image's bytes come from. Only base64 for now; a URL or a bucket object (R2, S3, GCS)
 * would be further kinds, resolved to base64 before a backend that can't fetch them sees them.
 */
export type ImageSource = {
  readonly kind: "base64";
  /** e.g. "image/png". */
  readonly mediaType: string;
  /** The image bytes, base64-encoded (no `data:` prefix). */
  readonly data: string;
};

/** An image inside a state. Build one with `image()`. It is plain JSON, so it works anywhere a state does. */
export type Image = {
  readonly type: "image";
  readonly source: ImageSource;
};

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
  /** How many images a state may contain. Absent means the backend takes no images. */
  readonly maxImages?: number;
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

/** Options for one condition. `.elseif()` falls back to the `ask.if` options, then the config. */
export type ConditionOptions = {
  readonly threshold?: number;
  readonly unsureBand?: readonly [number, number];
  /** What counts as a yes and a no, for conditions with a fuzzy boundary. */
  readonly criteria?: YesNoCriteria;
};

export type IfOptions = CallOptions & ConditionOptions;

export type DecisionOptions = CallOptions & {
  readonly minConfidence?: number;
};

/* -------------------------------------------------------------------------- */
/* Results and chains                                                         */
/* -------------------------------------------------------------------------- */

export type Handler<R> = (result: R) => unknown;

type IfResultBase = {
  /** Probability of every condition, in order: the `if`, then each `.elseif()`. */
  readonly probabilities: readonly number[];
  /** Positions of every condition judged unsure, so a handler can see them even when a later branch won. */
  readonly unsureIndexes: readonly number[];
};

/** The `if` condition held. */
export type IfThenResult = IfResultBase & {
  readonly branch: "then";
  readonly index: 0;
  readonly condition: string;
  /** Probability that `condition` holds, from 0 to 1. */
  readonly probability: number;
};

/** An `.elseif()` condition held (and nothing before it did). */
export type IfElseIfResult = IfResultBase & {
  readonly branch: "elseif";
  /** Position of the `.elseif()`, from 1. */
  readonly index: number;
  readonly condition: string;
  readonly probability: number;
};

/** No condition held. See `probabilities` for how likely each one was. */
export type IfElseResult = IfResultBase & {
  readonly branch: "else";
};

/** A condition fell inside the unsure band. */
export type IfUnsureResult = IfResultBase & {
  readonly branch: "unsure";
  /** Position of the unsure condition: 0 for the `if`, 1.. for each `.elseif()`. */
  readonly index: number;
  readonly condition: string;
  readonly probability: number;
};

export type IfResult = IfThenResult | IfElseIfResult | IfElseResult | IfUnsureResult;

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

/** What an unsure condition does to the rest of an `.elseif()` chain. */
export type UnsureOptions = {
  /**
   * `"stop"` (default): the first unsure condition runs the unsure handler and ends the chain,
   * so a later branch never beats an earlier one that might be true.
   * `"skip"`: an unsure condition counts as not matched and the chain moves on; a later clearly
   * true branch wins. If nothing matches and some condition was unsure, the unsure handler runs
   * instead of `else`.
   */
  readonly mode?: "stop" | "skip";
};

export type IfChain = {
  /**
   * Another condition. Every condition is sent in the same batch; the first one, in order,
   * that holds wins and only its handler runs.
   */
  readonly elseif: (
    condition: string,
    handler?: Handler<IfElseIfResult>,
    options?: ConditionOptions,
  ) => ElseIfChain;
  /** Runs when no condition holds. */
  readonly else: (handler: Handler<IfElseResult>) => IfChain;
  /** Runs when the probability falls inside the unsure band. */
  readonly unsure: (handler: Handler<IfUnsureResult>) => IfChain;
  readonly then: PromiseLike<IfResult>["then"];
};

/** An `ask.if` chain with at least one `.elseif()`, where `.unsure()` takes a mode. */
export type ElseIfChain = {
  readonly elseif: IfChain["elseif"];
  readonly else: (handler: Handler<IfElseResult>) => ElseIfChain;
  /** Runs when a probability falls inside the unsure band. See {@link UnsureOptions}. */
  readonly unsure: (handler: Handler<IfUnsureResult>, options?: UnsureOptions) => ElseIfChain;
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
    then?: Handler<IfThenResult>,
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
