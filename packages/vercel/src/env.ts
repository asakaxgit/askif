/** A non-blank string, or undefined. Empty and whitespace-only values count as unset. */
export const configured = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value;

/** Read one environment variable. Missing, empty, and non-Node runtimes are unset. */
export const envValue = (name: string): string | undefined => {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  return configured(value);
};
