# Examples

`backends.ts` runs offline. It shows `fallback()` splitting a failed Jev-shaped call onto another backend, and `selectAskBackend()` choosing from `ASK_BACKEND` and `TYPESAFE_API_KEY`.

```sh
npx tsx examples/backends.ts
```
