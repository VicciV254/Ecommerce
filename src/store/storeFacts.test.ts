import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STORE_FACTS } from "./storeFacts";

const SOURCE = resolve(process.cwd(), "src");
/** This module states the facts; its test names them. Everything else imports them. */
const OWNERS = new Set(["store/storeFacts.ts", "store/storeFacts.test.ts"]);

/** The approved contacts and hours, in any spelling a copy might use. */
const FACT_LITERALS = [
  { fact: "email", pattern: /vicmutua254/i },
  // "+254 729 125 144", "+254729125144" and "0729 125 144", with any spacing or hyphens.
  { fact: "phone", pattern: /729[\s-]*125[\s-]*144/ },
  { fact: "hours", pattern: /08:00\s*[–—-]\s*18:00/ },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("store facts", () => {
  it("are stated only in storeFacts.ts, so every page shows the same contacts and hours", () => {
    const copies = sourceFiles(SOURCE)
      .map((path) => ({ file: relative(SOURCE, path).split("\\").join("/"), text: readFileSync(path, "utf8") }))
      .filter(({ file }) => !OWNERS.has(file))
      .flatMap(({ file, text }) => FACT_LITERALS.filter(({ pattern }) => pattern.test(text)).map(({ fact }) => `${file}: ${fact}`));
    expect(copies).toEqual([]);
  });

  it("match the patterns the search uses, so the search cannot miss them", () => {
    expect(STORE_FACTS.email).toMatch(FACT_LITERALS[0].pattern);
    for (const phone of [STORE_FACTS.phone.display, STORE_FACTS.phone.tel, "0729 125 144", "0729-125-144"]) {
      expect(phone).toMatch(FACT_LITERALS[1].pattern);
    }
    expect(STORE_FACTS.hours).toMatch(FACT_LITERALS[2].pattern);
  });

  it("build the demonstration statement from the operator's name", () => {
    expect(STORE_FACTS.demonstration).toBe(
      `${STORE_FACTS.operator} is a demonstration store: its products are samples, and nothing is sold or delivered.`,
    );
    expect(STORE_FACTS.phone.tel).toBe(STORE_FACTS.phone.display.replace(/\s/g, ""));
  });
});
