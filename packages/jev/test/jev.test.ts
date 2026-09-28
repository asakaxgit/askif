import assert from "node:assert/strict";
import { test } from "node:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createAsk } from "askif";
import type { Json } from "askif";
import { jev } from "../src/index.js";

const isRecord = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

test("the TypeSafe backend sends and reads the System One format", async () => {
  const bodies: Json[] = [];
  const client = new TypeSafeClient({
    apiKey: "test",
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      const body: Json = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q0: { type: "noul", noul: 0.97 },
            q1: {
              type: "choice",
              choice: "returns",
              confidence: 0.42,
              probabilities: { returns: 0.61, billing: 0.39 },
            },
            q2: {
              type: "score",
              score: 1.43,
              confidence: 0.35,
              legend: { "0": "a", "1": "b", "2": "c" },
              probabilities: { "0": 0, "1": 0.57, "2": 0.43 },
            },
          },
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const ask = createAsk({ backend: jev({ client, model: "jev-1.13" }) });

  const [odd, team, severity] = await Promise.all([
    ask.is(7, "is odd"),
    ask.switch(7, "Which team?").case("returns", "Exchanges").case("billing"),
    ask.score(7, "How severe?").level("a").level("b").level("c"),
  ]);

  assert.equal(odd, true);
  assert.equal(team.choice, "returns");
  assert.equal(team.confidence, 0.42); // TypeSafe's own confidence is kept
  assert.equal(severity.level, "b");
  assert.equal(severity.confidence, 0.35);

  assert.equal(bodies.length, 1);
  const body = bodies[0];
  assert.ok(isRecord(body));
  assert.equal(body["state"], "7"); // numbers are sent as text
  assert.equal(body["model"], "jev-1.13");
  assert.deepEqual(body["questions"], {
    q0: {
      type: "noul",
      instructions: { condition: "is odd", question: "Is `condition` true of the state?" },
    },
    q1: { type: "choice", instructions: "Which team?", criteria: { returns: "Exchanges", billing: null } },
    q2: { type: "score", instructions: "How severe?", criteria: ["a", "b", "c"] },
  });
});
