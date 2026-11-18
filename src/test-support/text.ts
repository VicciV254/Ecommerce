/** Text as browsers expose and search it: soft hyphens (U+00AD, line-break hints) removed. */
export const withoutSoftHyphens = (text: string | null | undefined) => (text ?? "").replace(/\u00AD/g, "");

/**
 * An accessible-name matcher that ignores soft hyphens. Browsers leave them out of accessible names, but jsdom keeps
 * them, so a plain string would miss (and an absence check would pass) for a label that contains one.
 */
export const named = (expected: string | RegExp) => (name: string) => {
  const plain = withoutSoftHyphens(name);
  return typeof expected === "string" ? plain === expected : expected.test(plain);
};
