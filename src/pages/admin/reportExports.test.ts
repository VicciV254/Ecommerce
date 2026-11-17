import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCsv } from "./reportExports";

/* Staff open the sales CSV in a spreadsheet app, which runs a cell starting with =, +, -, @, a tab or a carriage return as a formula. */

let saved: Blob | undefined;

beforeEach(() => {
  saved = undefined;
  // jsdom has no object URLs: stand in for the browser and keep the file the download would save.
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: (blob: Blob) => { saved = blob; return "blob:sales-report"; } });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  vi.restoreAllMocks();
});

async function downloadedLines(rows: Record<string, unknown>[]) {
  downloadCsv("sales.csv", rows);
  expect(saved).toBeDefined();
  return (await saved!.text()).split("\n");
}

describe("sales report CSV", () => {
  it("keeps shopper text a spreadsheet would run as a formula as text, and leaves other text and the amounts as they were", async () => {
    const lines = await downloadedLines([
      { customer: '=HYPERLINK("https://attacker.example","Refund")', email: "+254@example.test", total: 1500 },
      { customer: "-2+3+cmd|' /C calc'!A0", email: "@SUM(1+1)*cmd|' /C calc'!A0", total: -250 },
      { customer: "\t=1+1", email: "\r=1+1", total: 0 },
      { customer: 'Wanjiru "Wawi" Kamau', email: "wanjiru@example.test", total: 980.5 },
    ]);
    expect(lines).toEqual([
      "customer,email,total",
      `"'=HYPERLINK(""https://attacker.example"",""Refund"")","'+254@example.test","1500"`,
      `"'-2+3+cmd|' /C calc'!A0","'@SUM(1+1)*cmd|' /C calc'!A0","-250"`,
      `"'\t=1+1","'\r=1+1","0"`,
      `"Wanjiru ""Wawi"" Kamau","wanjiru@example.test","980.5"`,
    ]);
  });
});
