import type { Json } from "../../packages/askif/src/index.ts";

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJson = (value: unknown): value is Json => {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJson);
};

export const readString = (value: unknown, path: string): string => {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
};

export const readNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${path} must be a number`);
  return value;
};

export const bandOf = (value: unknown, path: string): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${path} must be a pair`);
  const low = value[0];
  const high = value[1];
  if (typeof low !== "number" || typeof high !== "number") throw new Error(`${path} must be numeric`);
  return [low, high];
};

export const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
