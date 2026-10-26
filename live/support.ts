import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAskError } from "../packages/askif/src/index.js";
import type { AskError } from "../packages/askif/src/index.js";

/** Clear-cut yes: a domestic cat is a living animal. */
export const YES = 0.7;
/** Clear-cut no: that same cat is not a hammer, and a dog photo is not a bicycle. */
export const NO = 0.3;

/** Per-test budget. Provider clients use a shorter per-attempt timeout and do not retry. */
export const NETWORK_TIMEOUT_MS = 120_000;

const blank = (name: string): boolean => {
  const value = process.env[name];
  return value === undefined || value.trim() === "";
};

/**
 * Skip a networked test when a variable is missing.
 * `LIVE_REQUIRE=1` (set by the GitHub Actions job, after it has checked the secret)
 * turns that skip into a failure so a job cannot pass while every call was skipped.
 */
export const skipWithout = (...names: readonly string[]): string | false => {
  const missing = names.filter(blank);
  if (missing.length === 0) return false;
  if (process.env["LIVE_REQUIRE"] === "1") {
    throw new Error(`LIVE_REQUIRE=1 but ${missing.join(", ")} is not set`);
  }
  return `missing ${missing.join(", ")}`;
};

/** A variable the skip already proved present. The value is not included in any assertion message. */
export const requiredEnv = (name: string): string => {
  const value = process.env[name];
  assert.ok(value !== undefined && value.trim() !== "");
  return value;
};

export const fixtureBytes = (relativePath: string): Uint8Array =>
  readFileSync(new URL(`../packages/clef/test/fixtures/${relativePath}`, import.meta.url));

export const assertProbability = (value: number, label: string): void => {
  assert.ok(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `${label} should be a probability in [0, 1], got ${value}`,
  );
};

export const assertUnsupported = (error: unknown, pattern: RegExp): true => {
  assert.ok(isAskError(error));
  assert.equal(error.code, "UNSUPPORTED_INPUT");
  assert.match(error.message, pattern);
  return true;
};

export const assertAskError = (error: unknown): AskError => {
  assert.ok(isAskError(error));
  return error;
};

export type SeenRequest = {
  readonly url: string;
  readonly contentType: string | null;
  readonly dangerZone: string | null;
};

/**
 * Records the URL and two headers, then performs the real request.
 * Authorization is not stored.
 */
type FetchInput = Parameters<typeof fetch>[0];

export const recordingFetch =
  (seen: SeenRequest[]): ((input: FetchInput, init?: RequestInit) => Promise<Response>) =>
  async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      contentType: headers.get("content-type"),
      dangerZone: headers.get("typesafe-danger-zone-images"),
    });
    return fetch(input, init);
  };

export const onlyCall = (seen: readonly SeenRequest[]): SeenRequest => {
  assert.equal(seen.length, 1, `expected one live request, saw ${seen.length}`);
  const call = seen[0];
  assert.ok(call !== undefined);
  return call;
};
