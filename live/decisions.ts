import assert from "node:assert/strict";
import type { Ask } from "../packages/askif/src/index.js";
import { NO, YES, assertProbability } from "./support.js";

/** One state, so a backend that batches same-tick questions sends a single request. */
export const CAT = "A small domestic cat asleep on a cushion.";

/**
 * `ask.if`, `ask.switch`, `ask.score`, and `ask.probability` on one unambiguous state.
 * Started together so Jev and Clef batch them. Thresholds are wide of 0.5 on purpose.
 */
export const assertClearDecisions = async (ask: Ask): Promise<void> => {
  const [animal, hammer, kind, alive] = await Promise.all([
    ask.if(CAT, "is a living animal").else(() => undefined),
    ask.probability(CAT, "is a hammer made of metal"),
    ask
      .switch(CAT, "Which kind of thing is described?")
      .case("animal", "A living animal")
      .case("vehicle", "A car, bicycle, or boat")
      .case("tool", "A hammer, wrench, or other hand tool"),
    ask
      .score(CAT, "Is the thing described alive?")
      .level("inanimate", "Not alive: an object, tool, or machine")
      .level("alive", "A living animal"),
  ]);

  assert.equal(animal.branch, "then");
  assert.ok(animal.branch === "then");
  assert.equal(animal.index, 0);
  assert.equal(animal.condition, "is a living animal");
  assertProbability(animal.probability, "ask.if");
  assert.ok(animal.probability >= YES, `ask.if probability ${animal.probability} is below ${YES}`);

  assertProbability(hammer, "ask.probability");
  assert.ok(hammer <= NO, `ask.probability ${hammer} is above ${NO}`);

  assert.equal(kind.branch, "case");
  assert.equal(kind.choice, "animal");
  assertProbability(kind.confidence, "ask.switch confidence");
  const top = kind.ranking[0];
  assert.ok(top !== undefined);
  assert.equal(top.key, "animal");
  assertProbability(top.probability, "ask.switch");
  assert.ok(top.probability >= 0.6, `ask.switch top probability ${top.probability} is below 0.6`);
  for (const row of kind.ranking) assertProbability(row.probability, `ask.switch ${row.key}`);

  assert.equal(alive.branch, "level");
  assert.equal(alive.level, "alive");
  assert.equal(alive.index, 1);
  assertProbability(alive.confidence, "ask.score confidence");
  assert.ok(alive.normalized >= 0.5 && alive.normalized <= 1);
  const high = alive.probabilities[1];
  assert.ok(high !== undefined);
  assertProbability(high, "ask.score");
  assert.ok(high >= 0.6, `ask.score level probability ${high} is below 0.6`);
  for (const value of alive.probabilities) assertProbability(value, "ask.score level");
};
