# @askif/jev

*Let Jev decide.*

The batteries-included [askif](https://www.npmjs.com/package/askif) bundle for TypeSafe's Jev: the `jev()` backend factory, plus a ready-to-use `ask`.

```sh
npm install askif @askif/jev
export TYPESAFE_API_KEY=...
```

```ts
import { ask } from "@askif/jev";

await ask.if("cat", "is animal", () => {
  console.log("cat is animal");
});
```

Full documentation, the `ask.if`/`ask.switch`/`ask.score` guide, and runnable examples live in the [main repo README](https://github.com/asakaxgit/askif#readme).

## Different states, one request

`systemOne` takes one `state` per request. Cross-state packing is off unless you opt in:

```ts
import { createAsk } from "askif";
import { jev } from "@askif/jev";

const ask = createAsk({ backend: jev({ multiState: true }) });

await Promise.all([
  ask.score(tweetA, "How spicy?").level("mild").level("hot"),
  ask.if(tweetB, "is a reply", () => {}),
]);
```

Those calls then share one request, up to `maxStatesPerBatch` on the `ask` instance (default 16) and this backend's own cap of 32 states. The state on the wire is `{ items: { i0: tweetA, i1: tweetB } }`, and each question is pointed at its item. A tick that only mentions one state is sent exactly as before. `live/jev.test.ts` covers this packing against the live API when `TYPESAFE_API_KEY` is set (see the repo's Live tests section). It is not part of `pnpm run check`.

Leave `multiState` unset, or set `ask.configure({ maxStatesPerBatch: 1 })`, to keep one request per state.

## Images

Experimental, and off unless you opt in. Jev 1.13.0 and 1.14.0 accept images (and `jev-latest` while it points at 1.14). The [models page](https://docs.typesafe.ai/models) still lists their input as text, so treat the format as unstable.

```ts
import { createAsk, image } from "askif";
import { jev } from "@askif/jev";

const ask = createAsk({ backend: jev({ images: true }) });

await ask.if(
  { photo: image(bytes), note: "customer upload" },
  "shows a damaged parcel",
  () => openClaim(),
);
```

The same shapes as askif core work here: `image()` (bytes, base64, or a `data:` URL), a `data:image/...;base64,` string, or an object with exactly `{ content_type, base64 }`. They can sit in the state, in question instructions, or in criteria. Each one is replaced with `[image N]`, numbered from 1 across the whole request: the state first (each distinct state in a packed call, via `extractImages(state, { from })`), then each question. A repeated state is numbered once. A whole value that is exactly `[image N]` is that image.

Jev also replaces that reference inside a longer string, and every copy counts toward the size limit, so don't write `[image N]` into your own text. `[image 1]` is a prefix of `[image 10]`.

A request that actually contains an image is multipart (`request` JSON plus `asset-N` file parts) and sends `TypeSafe-Danger-Zone-Images: true`. A text-only request stays JSON and does not send that header. With `images` left off, an image fails with `UNSUPPORTED_INPUT` before any request, instead of going out as text.

Limits, from the [images docs](https://docs.typesafe.ai/images). Both ends of each range are allowed, and nothing is resized:

- PNG and JPEG only (`image/jpg` counts as JPEG). WebP, GIF, and an animated PNG fail with `UNSUPPORTED_INPUT`.
- Each side 280–1568 pixels, and 78,400–2,458,624 pixels in total. 16 MiB per image (decoded), 32 MiB for the request body.
- At most 64 images per request. Jev publishes no count; 64 is askif's guard (`limits.maxImages`). A packed call counts each distinct state once and will not exceed it, and images inside questions share the same 64 and the same 32 MiB budget.
- Jev strips metadata and does not apply EXIF orientation. A baseline JPEG is the documented preference.

`images` and `multiState` are separate switches. Box questions are not part of askif. Pointing `baseURL` at OpenRouter (which lists `typesafe/jev-1.14` with image input) is covered by `live/openrouter.test.ts` when `OPENROUTER_API_KEY` is set: that test sends the multipart body and the `TypeSafe-Danger-Zone-Images` header to `https://openrouter.ai/api/v1/systemone` and checks the answer. It is not part of `pnpm run check`.

## Vercel AI Gateway, TypeSafe-compatible route

AI Gateway accepts TypeSafe's request shape at `https://ai-gateway.vercel.sh/typesafe`, including `noul` for yes/no. Point `jev()` at it:

```ts
import { jev } from "@askif/jev";

const backend = jev({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh/typesafe",
  model: "typesafe-ai/jev",
});
```

The URL and model id are from [Vercel's TypeSafe API docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe). This repo has not called that URL. For the Decision API itself (`boolean` instead of `noul`, plus fallbacks and gateway cost), use [`@askif/vercel`](../vercel).

## Other Jev-compatible servers

`@askif/jev` speaks TypeSafe's Jev wire API, so it also works with [OpenJev](https://github.com/razorback16/openjev), an open Jev-compatible server (DiffusionGemma via vLLM or MLX; hosted on [Codiv](https://codiv.ai)). Only `baseURL` and `model` change:

```ts
import { jev } from "@askif/jev";

const backend = jev({
  apiKey: process.env.OPENJEV_API_KEY, // not needed by a server you run without auth
  baseURL: "https://api.codiv.ai", // or your own server, e.g. "http://127.0.0.1:8080"
  model: "openjev-latest",
});
```

- OpenJev uses its own model ids (`openjev-latest`, `openjev-0.1`); `jev-latest` and `jev-preview` are accepted as aliases, but a pinned Jev id like `jev-1.13.0` returns `400 Unknown model`.
- Scales take 1–10 levels, matching this backend's limit. Some of OpenJev's other models allow fewer choices than this backend's 255 (Verdict: 24), which the server rejects with a 400.
- Checked live against the hosted Codiv API (2026-09-30): yes/no, choice and scale in one batch (about 0.5–0.7 s), `openjev-latest` and the `jev-latest` alias, scales of 2 and 10 levels, and the unknown-model error. Not tested: OpenJev's other models, or a self-hosted server with a real model.
- OpenJev's own image extension, and its `think`/`samples` extensions, aren't exposed by askif. The TypeSafe image input above is a different API and has not been tried against OpenJev.

## License

MIT
