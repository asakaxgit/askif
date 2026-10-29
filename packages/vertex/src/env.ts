/** A snapshot of `process.env`, or a test double with the same shape. */
export type Env = Readonly<Record<string, string | undefined>>;

export const trimmed = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
};
