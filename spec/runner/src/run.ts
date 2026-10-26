import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { audience, readCriteria, runsOn } from "./criteria.ts";
import type { Criterion } from "./criteria.ts";
import { diffPaths } from "./match.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => JSON.parse(text);

const readJson = async (file: string): Promise<unknown> => parseJson(await readFile(file, "utf8"));

const caseFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return caseFiles(full);
      return entry.name.endsWith(".json") ? [full] : [];
    }),
  );
  return files.flat().sort();
};

type Driver = { readonly language: string; readonly argv: readonly string[] };

const driversFrom = (value: unknown): readonly Driver[] => {
  if (!isRecord(value)) throw new Error("drivers.json must be an object");
  return Object.entries(value).map(([language, argv]) => {
    if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error(`${language} argv must be a string array`);
    }
    const [command, ...args] = argv;
    if (command === undefined) throw new Error(`${language} argv is empty`);
    return { language, argv: [command, ...args] };
  });
};

const runProcess = (argv: readonly string[], input: string): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> =>
  new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      reject(new Error("empty argv"));
      return;
    }
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    child.stdin.end(input);
  });

type CaseFile = { readonly file: string; readonly value: Readonly<Record<string, unknown>> };

const checkCase = async (driver: Driver, caseFile: CaseFile): Promise<{ readonly ok: boolean; readonly detail: string }> => {
  const payload = JSON.stringify(caseFile.value);
  let run: { readonly code: number; readonly stdout: string; readonly stderr: string };
  try {
    run = await runProcess(driver.argv, payload);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  if (run.code !== 0) {
    return { ok: false, detail: `exit ${run.code}\n${run.stderr}` };
  }
  let actual: unknown;
  try {
    actual = parseJson(run.stdout);
  } catch (error) {
    return { ok: false, detail: `stdout was not JSON\n${run.stdout}\n${error instanceof Error ? error.message : ""}` };
  }
  if (!isRecord(actual)) return { ok: false, detail: "driver result was not an object" };
  const expect = caseFile.value["expect"];
  if (!isRecord(expect)) return { ok: false, detail: "case has no expect object" };
  const epsilon = typeof caseFile.value["epsilon"] === "number" ? caseFile.value["epsilon"] : 1e-6;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(expect)) projected[key] = actual[key];
  const diffs = diffPaths(projected, expect, epsilon);
  if (diffs.length === 0) return { ok: true, detail: "" };
  return { ok: false, detail: `${diffs.join("\n")}\n--- actual ---\n${JSON.stringify(projected, null, 2)}\n--- stderr ---\n${run.stderr}` };
};

const main = async (): Promise<void> => {
  const schemaPath = path.join(root, "spec/schema/case.schema.json");
  const schema = parseJson(await readFile(schemaPath, "utf8"));
  if (typeof schema !== "object" || schema === null) throw new Error("schema must be an object");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const criteria = await readCriteria(path.join(root, "spec/CRITERIA.md"));
  const files = await caseFiles(path.join(root, "spec/cases"));
  const cases: CaseFile[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const value: unknown = await readJson(file);
    if (!validate(value) || !isRecord(value) || typeof value["id"] !== "string") {
      problems.push(`${path.relative(root, file)}: ${ajv.errorsText(validate.errors)}`);
      continue;
    }
    cases.push({ file, value });
  }
  const byId = new Map(cases.map((item) => [item.value["id"], item]));
  for (const criterion of criteria) {
    if (criterion.cases.length === 0) problems.push(`${criterion.id} lists no cases`);
    for (const id of criterion.cases) {
      const found = byId.get(id);
      if (found === undefined) problems.push(`${criterion.id} lists missing case ${id}`);
      else if (!stringList(found.value["criteria"]).includes(criterion.id)) {
        problems.push(`${id} does not list criterion ${criterion.id}`);
      }
    }
  }
  for (const item of cases) {
    const id = stringOf(item.value["id"]);
    for (const criterion of stringList(item.value["criteria"])) {
      const heading = criteria.find((candidate) => candidate.id === criterion);
      if (heading === undefined) problems.push(`${id} names unknown criterion ${criterion}`);
      else if (!heading.cases.includes(id)) problems.push(`${criterion} does not list case ${id}`);
    }
  }
  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(1);
  }

  const drivers = driversFrom(await readJson(path.join(root, "spec/drivers.json")));
  const only = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
  const selected = only === undefined ? drivers : drivers.filter((driver) => driver.language === only);
  const caseFilter = process.argv.find((arg) => arg.startsWith("--case="))?.slice("--case=".length);
  const chosen = caseFilter === undefined ? cases : cases.filter((item) => stringOf(item.value["id"]).includes(caseFilter));
  const results = new Map<string, boolean>();
  let failed = 0;
  for (const driver of selected) {
    for (const item of chosen) {
      const tags = stringList(item.value["tags"]);
      const id = stringOf(item.value["id"]);
      if (!runsOn(tags, driver.language)) continue;
      const outcome = await checkCase(driver, item);
      results.set(`${driver.language}:${id}`, outcome.ok);
      if (!outcome.ok) {
        failed += 1;
        process.stderr.write(`\nFAIL ${driver.language} ${id}\n${outcome.detail}\n`);
      }
    }
  }

  const languages = selected.map((driver) => driver.language);
  const header = ["criterion", ...languages].join("\t");
  const rows = [header];
  for (const criterion of criteria) {
    const columns = languages.map((language) => statusFor(criterion, language, cases, results));
    rows.push([criterion.id, ...columns].join("\t"));
  }
  process.stdout.write(`${rows.join("\n")}\n`);
  const red = rows.slice(1).some((row) => row.split("\t").includes("fail"));
  if (failed > 0 || red) process.exit(1);
};

const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");

const statusFor = (
  criterion: Criterion,
  language: string,
  cases: readonly CaseFile[],
  results: ReadonlyMap<string, boolean>,
): "pass" | "fail" | "skipped" => {
  const who = audience(criterion.tag);
  if (who !== "all" && !who.includes(language)) return "skipped";
  const applicable = cases.filter(
    (item) => stringList(item.value["criteria"]).includes(criterion.id) && runsOn(stringList(item.value["tags"]), language),
  );
  if (applicable.length === 0) return "fail";
  const ran = applicable.filter((item) => results.has(`${language}:${stringOf(item.value["id"])}`));
  if (ran.length !== applicable.length) return ran.length === 0 ? "skipped" : "fail";
  return ran.every((item) => results.get(`${language}:${stringOf(item.value["id"])}`) === true) ? "pass" : "fail";
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
