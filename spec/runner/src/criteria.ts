import { readFile } from "node:fs/promises";

export type Criterion = {
  readonly id: string;
  readonly tag: "core" | "adapter" | "ts-only" | "deferred";
  readonly cases: readonly string[];
};

const heading = /^### ([A-Z]+-\d+)\s*$/;
const tagLine = /^- tag: (core|adapter|ts-only|deferred)\s*$/;
const caseLine = /^- cases: (.+)\s*$/;

export const readCriteria = async (path: string): Promise<readonly Criterion[]> => {
  const text = await readFile(path, "utf8");
  const criteria: Criterion[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const found = heading.exec(lines[index] ?? "");
    if (found === null) continue;
    const id = found[1];
    if (id === undefined) continue;
    let tag: Criterion["tag"] | undefined;
    let cases: readonly string[] | undefined;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      if (line.startsWith("### ") || line.startsWith("## ")) break;
      const tagged = tagLine.exec(line);
      if (tagged !== null && tagged[1] !== undefined) {
        if (tagged[1] === "core" || tagged[1] === "adapter" || tagged[1] === "ts-only" || tagged[1] === "deferred") {
          tag = tagged[1];
        }
      }
      const listed = caseLine.exec(line);
      if (listed !== null && listed[1] !== undefined) {
        cases = listed[1].split(",").map((item) => item.trim()).filter((item) => item.length > 0);
      }
    }
    if (tag === undefined || cases === undefined) throw new Error(`${id} is missing tag or cases`);
    criteria.push({ id, tag, cases });
  }
  return criteria;
};

export const runsOn = (tags: readonly string[], language: string): boolean => {
  if (language === "typescript") return true;
  return tags.includes("core") || tags.includes("adapter");
};

export const audience = (tag: Criterion["tag"]): readonly string[] | "all" =>
  tag === "core" || tag === "adapter" ? "all" : ["typescript"];
