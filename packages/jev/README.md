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
- OpenJev's image and `think`/`samples` extensions aren't exposed by askif.

## License

MIT
