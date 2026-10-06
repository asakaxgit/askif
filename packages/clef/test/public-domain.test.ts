import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { clef } from "../src/index.js";

// The real-world public-domain images in fixtures/public-domain (see SOURCES.md there).
// Guards against a file being swapped or corrupted without its provenance being updated.
const dir = new URL("./fixtures/public-domain/", import.meta.url);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const manifest: unknown = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const entries = Array.isArray(manifest) ? manifest.filter(isRecord) : [];

const signature = { "image/png": "89504e47", "image/jpeg": "ffd8ff" } as const;

test("every public-domain image is listed with provenance, a license and a matching checksum", () => {
  const files = readdirSync(dir).filter((name) => /\.(png|jpg)$/.test(name));
  assert.equal(entries.length, files.length);
  assert.deepEqual(entries.map((e) => e["file"]).sort(), files.sort());

  for (const entry of entries) {
    const { file, contentType, sha256, source, license, creator } = entry;
    assert.ok(typeof file === "string" && typeof sha256 === "string", "file and sha256");
    for (const field of [source, license, creator]) {
      assert.ok(typeof field === "string" && field.length > 0, `${file} has source, license and creator`);
    }
    assert.ok(typeof source === "string" && source.startsWith("https://commons.wikimedia.org/wiki/File:"));

    const bytes = readFileSync(new URL(file, dir));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, `${file} matches its checksum`);
    assert.ok(bytes.length < 400_000, `${file} is small`);
    const expected = contentType === "image/png" ? signature["image/png"] : signature["image/jpeg"];
    assert.ok(bytes.toString("hex").startsWith(expected), `${file} has the ${String(contentType)} signature`);
  }
});

test("the public-domain images go out in Clef's images field", async () => {
  const sent: unknown[] = [];
  const backend = clef({
    binding: {
      run: async (_model, input) => {
        sent.push(input);
        return { model: "clef", answers: { q: { type: "noul", noul: 0.5 } } };
      },
    },
  });
  // Four at once is Clef's limit.
  const photos = entries.slice(0, 4).map(
    (e) => `data:${String(e["contentType"])};base64,${readFileSync(new URL(String(e["file"]), dir)).toString("base64")}`,
  );
  await backend.decide({ photos }, { q: { kind: "yesno", instructions: "Is there a cat?" } });
  const [input] = sent;
  assert.ok(isRecord(input));
  assert.deepEqual(input["images"], photos);
  assert.deepEqual(input["state"], { photos: ["[image 1]", "[image 2]", "[image 3]", "[image 4]"] });
});
