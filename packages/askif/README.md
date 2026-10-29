# askif

*Let Jev decide.*

The provider-neutral toolkit behind `askif`: the `Backend` contract, `createAsk`, chain logic, a `mock` backend for tests, and `fallback()` to send a failed call to a second backend. No dependency on any specific model provider. State text is cleaned before it is sent; see [Security](https://github.com/asakaxgit/askif#security). `protection: false` keeps the previous request body.

For the batteries-included Jev/TypeSafe bundle (a ready-to-use `ask`), see [`@askif/jev`](https://www.npmjs.com/package/@askif/jev).

```sh
npm install askif
```

Full documentation, the `ask.if`/`ask.switch`/`ask.score` guide, and runnable examples live in the [main repo README](https://github.com/asakaxgit/askif#readme).

## License

MIT
