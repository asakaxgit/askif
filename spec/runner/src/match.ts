const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const diffPaths = (actual: unknown, expect: unknown, epsilon: number, path = "$"): string[] => {
  if (typeof expect === "number" && typeof actual === "number") {
    return Math.abs(actual - expect) <= epsilon ? [] : [`${path}: ${actual} != ${expect}`];
  }
  if (expect === null) {
    return actual === null ? [] : [`${path}: expected null, got ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expect)) {
    if (!Array.isArray(actual)) return [`${path}: expected array`];
    if (actual.length !== expect.length) return [`${path}: length ${actual.length} != ${expect.length}`];
    return expect.flatMap((item, index) => diffPaths(actual[index], item, epsilon, `${path}[${index}]`));
  }
  if (isRecord(expect)) {
    if (!isRecord(actual)) return [`${path}: expected object`];
    return Object.entries(expect).flatMap(([key, value]) => diffPaths(actual[key], value, epsilon, `${path}.${key}`));
  }
  return Object.is(actual, expect) ? [] : [`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expect)}`];
};
