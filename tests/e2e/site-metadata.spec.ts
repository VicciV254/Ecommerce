import { expect, test } from "./fixtures";

/** WhatsApp reads a page's head only within its first 300 KB; Meta within 1 MB. */
const PREVIEW_LIMIT = 300 * 1024;

test("the served page has its description and preview tags ahead of the inlined app, with robots.txt and the card", async ({ request, isMobile }) => {
  test.skip(isMobile, "One project checks the served files.");
  const html = await (await request.get("/")).body();
  const app = html.indexOf("<script");
  expect(app, "the app is inlined in a script").toBeGreaterThan(0);
  for (const tag of ['name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"']) {
    const at = html.indexOf(tag);
    expect.soft(at, `${tag} is served`).toBeGreaterThan(0);
    expect.soft(at, `${tag} comes before the inlined app`).toBeLessThan(app);
    expect.soft(at, `${tag} is in the first 300 KB`).toBeLessThan(PREVIEW_LIMIT);
  }

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toBe("User-agent: *\nAllow: /\n");

  const card = await request.get("/og-image.png");
  expect(card.headers()["content-type"]).toBe("image/png");
  const png = await card.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
