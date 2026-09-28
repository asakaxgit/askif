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

## License

MIT
