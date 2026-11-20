import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCategory, CatalogDelivery } from "../api/catalog";
import type { ReturnRule } from "../api/orders";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { STORE_FACTS } from "../store/storeFacts";
import { fixtureCategory, fixtureSnapshot } from "../test-support/catalogFixtures";
import Delivery from "./Delivery";
import Faq from "./Faq";
import NotFound from "./NotFound";
import Privacy from "./Privacy";
import Returns from "./Returns";
import Terms from "./Terms";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null, titles: [] as string[] }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StorefrontContext", () => ({
  useStorefront: () => ({ brandName: "Apex Cart" }),
  usePageTitle: (title: string) => { state.titles.push(title); },
}));

function readyCatalog(overrides: Partial<CatalogValue> = {}, categories: CatalogCategory[] = fixtureSnapshot().categories): CatalogValue {
  const snapshot = fixtureSnapshot();
  return {
    status: "ready", error: null, mode: "demo", products: snapshot.products,
    productsById: new Map(snapshot.products.map((product) => [product.id, product])), categories: buildCategoryTree(categories),
    designers: [], discounts: [], returnPolicy: snapshot.returnPolicy, delivery: snapshot.delivery, demonstrationOrders: snapshot.demonstrationOrders,
    sampleOrderRetentionDays: null, reload: vi.fn(), ...overrides,
  };
}

const loadingCatalog = () => readyCatalog({ status: "loading", mode: null, returnPolicy: null, delivery: null, demonstrationOrders: null, sampleOrderRetentionDays: null }, []);
const failedCatalog = () => readyCatalog({ status: "error", error: "The catalog could not be loaded. Try again later.", mode: null, returnPolicy: null, delivery: null, demonstrationOrders: null, sampleOrderRetentionDays: null }, []);

const text = () => document.body.textContent ?? "";
const block = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("li")!;
/** Each fact in a block's definition list, as [term, definitions…]. */
const facts = (element: Element) => [...element.querySelectorAll("dt")].map((term) => {
  const values: string[] = [];
  for (let node = term.nextElementSibling; node?.tagName === "DD"; node = node.nextElementSibling) values.push(node.textContent ?? "");
  return [term.textContent, ...values];
});
const links = (scope: HTMLElement = document.body) => within(scope).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);

beforeEach(() => {
  state.catalog = readyCatalog();
  state.titles.length = 0;
  window.location.hash = "#/";
});

describe("Delivery", () => {
  it("shows one block per offered method with where it delivers, its fee and its delivery time", () => {
    render(<Delivery />);
    expect(screen.getByRole("heading", { level: 1, name: "Delivery" })).toBeTruthy();
    expect(state.titles.at(-1)).toBe("Delivery · Apex Cart");
    expect(screen.getByRole("note").textContent).toBe(`${STORE_FACTS.demonstration} This page shows the delivery options the store is set up with.`);
    expect(facts(block("Standard delivery"))).toEqual([["Where", "Anywhere in Kenya"], ["Fee", "KES 200"], ["Delivery time", "2–5 working days"]]);
    expect(facts(block("Same-day delivery"))).toEqual([
      ["Where", "Nairobi only"], ["Fee", "KES 500"],
      ["Delivery time", "Paid by 12:00 EAT on a working day: arrives that day; otherwise the next working day"],
    ]);
    expect(text()).not.toMatch(/Free when/);
    for (const line of [
      "Working days are Monday to Friday, except public holidays in Kenya.",
      "The delivery fee is shown in the total at checkout, before an order is reserved. VAT (16%) is added to items, not to the delivery fee.",
      "Pickup isn't offered.",
    ]) expect(screen.getByText(line)).toBeTruthy();
  });

  it("states a free-delivery threshold exactly, since the server frees delivery from that very amount", () => {
    for (const [freeAbove, shown] of [[4999.99, "KES 4,999.99"], [5000, "KES 5,000"], [5000.01, "KES 5,000.01"]] as const) {
      const delivery: CatalogDelivery[] = [{ method: "STANDARD", fee: 200, freeAbove, counties: [] }];
      state.catalog = readyCatalog({ delivery });
      const { unmount } = render(<Delivery />);
      expect(facts(block("Standard delivery"))[1]).toEqual([
        "Fee", "KES 200", `Free when the items subtotal after discounts, before VAT and delivery, is ${shown} or more.`,
      ]);
      unmount();
    }
  });

  it("follows a policy that still offers pickup, which has no stated delivery time", () => {
    state.catalog = readyCatalog({ delivery: [{ method: "STORE_PICKUP", fee: 0, freeAbove: null, counties: [] }] });
    render(<Delivery />);
    expect(facts(block("Store pickup"))).toEqual([["Where", "Anywhere in Kenya"], ["Fee", "KES 0"]]);
    expect(text()).not.toMatch(/Pickup isn't offered/);
  });

  it("says the options are loading, never a fee of KES 0, until the catalog has them", () => {
    state.catalog = loadingCatalog();
    render(<Delivery />);
    expect(screen.getByRole("status").textContent).toBe("Loading the delivery options…");
    expect(text()).not.toMatch(/KES|Pickup isn't offered/);
  });

  it("reports a failed catalog with a retry instead of guessing the options", () => {
    state.catalog = failedCatalog();
    render(<Delivery />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Delivery options are unavailable" })).toBeTruthy();
    expect(alert.textContent).toContain("The catalog could not be loaded. Try again later.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(state.catalog.reload).toHaveBeenCalledTimes(1);
    expect(text()).not.toMatch(/KES|Pickup isn't offered/);
  });
});

describe("Returns and refunds", () => {
  const categories = [
    fixtureCategory({ id: "health", name: "Health & Beauty", returnRule: "UNOPENED_OR_FAULT" }),
    fixtureCategory({ id: "hair", name: "Hair Care", parentId: "health" }),
    fixtureCategory({ id: "tools", name: "Hair Tools", parentId: "hair", returnRule: "STANDARD" }),
    fixtureCategory({ id: "fashion", name: "Fashion", order: 1 }),
    fixtureCategory({ id: "men", name: "Men", parentId: "fashion" }),
    fixtureCategory({ id: "underwear", name: "Underwear", parentId: "men", returnRule: "FAULT_ONLY" }),
    fixtureCategory({ id: "baby", name: "Baby", order: 2 }),
    fixtureCategory({ id: "wipes", name: "Wipes & Holders", parentId: "baby", returnRule: "UNOPENED_OR_FAULT" }),
  ];
  const rules = () => [...screen.getByRole("heading", { level: 2, name: "What can be returned" }).nextElementSibling!.children]
    .map((item) => [item.firstChild?.textContent, ...[...item.querySelectorAll("li")].map((group) => group.textContent)]);

  it("states the window, the rules by category and the refund terms from the catalog", () => {
    state.catalog = readyCatalog({}, categories);
    render(<Returns />);
    expect(state.titles.at(-1)).toBe("Returns and refunds · Apex Cart");
    expect(screen.getByRole("note").textContent).toBe(
      `${STORE_FACTS.demonstration} This page shows the return rules the store is set up with for new orders. Your orders shows the rules and deadline saved with each order.`,
    );
    expect(within(screen.getByRole("note")).getByRole("link", { name: "Your orders" }).getAttribute("href")).toBe("#/account/orders");
    expect(screen.getByText(
      "Customers can ask to return items within 7 days of delivery, from Your orders, choosing the items and a reason.",
    )).toBeTruthy();
    expect(rules()).toEqual([
      ["Most items: for any reason."],
      ["Only if unopened, or if faulty, damaged or wrong:", "Health & Beauty, except Hair Tools", "Wipes & Holders"],
      ["Only if faulty, damaged or wrong:", "Underwear"],
      ["Each product page shows the rule that applies to it."],
    ]);
    const refunds = screen.getByRole("heading", { level: 2, name: "Refunds" }).nextElementSibling!;
    expect([...refunds.children].map((item) => item.textContent?.replace(/\s+/g, " "))).toEqual([
      "Returns are refunded; exchanges and store credit aren't offered.",
      "Staff check returned items when they arrive. Accepted items are refunded by M-Pesa, which staff send by hand.",
      "The delivery fee is refunded only if staff confirm an item was faulty, damaged or wrong.",
      "Refunds are rounded up to the nearest whole shilling and never exceed what was paid.",
      "Cancelling a paid order before it's dispatched asks for a refund of whatever hasn't already been refunded, including delivery. Staff then send it by M-Pesa; cancelling doesn't send money by itself.",
    ]);
  });

  it("leaves out a rule no category has, and words the delivery fee by the published rule", () => {
    const policy = fixtureSnapshot().returnPolicy;
    for (const [deliveryFeeRefund, sentence] of [
      ["ALWAYS", "The delivery fee is included in your first accepted return refund."],
      ["NEVER", "The delivery fee is not refunded for returns."],
    ] as const) {
      state.catalog = readyCatalog({ returnPolicy: { ...policy, windowDays: 14, deliveryFeeRefund } });
      const { unmount } = render(<Returns />);
      expect(rules()).toEqual([["Most items: for any reason."], ["Each product page shows the rule that applies to it."]]);
      expect(screen.getByText(/within 14 days of delivery/)).toBeTruthy();
      expect(screen.getByText(sentence)).toBeTruthy();
      unmount();
    }
  });

  it("says the rules are loading, and offers a retry when the catalog failed", () => {
    state.catalog = loadingCatalog();
    const { unmount } = render(<Returns />);
    expect(screen.getByRole("status").textContent).toBe("Loading the return rules…");
    expect(text()).not.toMatch(/days of delivery|Refunds are rounded/);
    unmount();

    state.catalog = failedCatalog();
    render(<Returns />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Return rules are unavailable" })).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(state.catalog.reload).toHaveBeenCalledTimes(1);
  });
});

describe("FAQ", () => {
  const questions = () => [...document.querySelectorAll<HTMLDetailsElement>("details")];
  /** The answer under a question, read whether or not it is open. */
  const answer = (question: string) => {
    const disclosure = questions().find((details) => details.querySelector(":scope > summary")?.textContent === question);
    if (!disclosure) throw new Error(`No question "${question}"`);
    const parts = [...disclosure.children].filter((node) => node.tagName !== "SUMMARY").flatMap((panel) => [...panel.children])
      .flatMap((node) => (node.tagName === "UL" ? [...node.children].map((item) => item.textContent ?? "") : [node.textContent ?? ""]));
    return parts.join(" ").replace(/\s+/g, " ");
  };

  it("groups the questions under topics listed On this page, each answer closed under its question", () => {
    window.location.hash = "#/faq";
    render(<Faq />);
    expect(state.titles.at(-1)).toBe("FAQ · Apex Cart");
    expect(screen.getByRole("note").textContent).toBe(STORE_FACTS.demonstration);
    expect(links(screen.getByRole("navigation", { name: "On this page" }))).toEqual([
      ["About this store", "#/faq?section=about-this-store"], ["How the store is set up", "#/faq?section=how-the-store-is-set-up"],
      ["Your account and privacy", "#/faq?section=your-account-and-privacy"], ["Contact", "#/faq?section=contact"],
    ]);
    expect(questions().map((details) => details.querySelector(":scope > summary")?.textContent)).toEqual([
      "Is Apex Cart a real shop?", "What can I try?", "Will I be charged?", "How are prices shown?", "Do I need an account?",
      "How does payment work?", "Where does the store deliver?", "What can be returned?", "How do I stop promotional emails?",
      "How do I delete my account or my information?", "How do I contact you?",
    ]);
    expect(questions().filter((details) => details.open)).toEqual([]);
    expect(screen.getByRole("heading", { level: 2, name: "Contact" }).closest("section")?.querySelector("summary")?.textContent)
      .toBe("How do I contact you?");
    expect(answer("Is Apex Cart a real shop?")).toBe(
      "No. Apex Cart is a demonstration store built as a personal project. Its products are samples, and nothing is sold or delivered.",
    );
    expect(answer("How do I contact you?")).toBe(
      `Email ${STORE_FACTS.email} or call ${STORE_FACTS.phone.display} (${STORE_FACTS.hours}), or use the contact form.`,
    );
    expect(answer("How do I delete my account or my information?")).toBe(
      `Email ${STORE_FACTS.email} from the address on your account. Accounts are deleted on request; an account with orders is disabled instead, which keeps its data. Deleting an account doesn't end a newsletter subscription, so ask us to remove that too, or use its unsubscribe link. See the Privacy notice.`,
    );
    expect(links().filter(([name]) => ["Privacy notice", "contact form", "your account", STORE_FACTS.email, STORE_FACTS.phone.display].includes(name ?? "")))
      .toEqual([
        ["your account", "#/account"], [STORE_FACTS.email, `mailto:${STORE_FACTS.email}`], ["Privacy notice", "#/privacy"],
        [STORE_FACTS.email, `mailto:${STORE_FACTS.email}`], [STORE_FACTS.phone.display, `tel:${STORE_FACTS.phone.tel}`], ["contact form", "#/contact"],
      ]);
  });

  it("answers delivery and returns from the catalog's facts once they have loaded", () => {
    render(<Faq />);
    expect(answer("Where does the store deliver?")).toBe(
      "Standard delivery: Anywhere in Kenya · 2–5 working days. Same-day delivery: Nairobi only · Paid by 12:00 EAT on a working day: arrives that day; otherwise the next working day. Pickup isn't offered. See Delivery.",
    );
    expect(answer("What can be returned?")).toBe("Items within 7 days of delivery. Each product page shows its rule. See Returns and refunds.");
    expect(screen.getByRole("link", { name: "Delivery" }).getAttribute("href")).toBe("#/delivery");
    expect(screen.getByRole("link", { name: "Returns and refunds" }).getAttribute("href")).toBe("#/returns");
  });

  it("names in the returns answer only the restrictions the category rules set", () => {
    const rules = (byId: Record<string, ReturnRule>) => fixtureSnapshot().categories.map((category) => ({ ...category, returnRule: byId[category.id] ?? null }));
    const cases: [Record<string, ReturnRule>, string][] = [
      [{ "cat-shirts": "UNOPENED_OR_FAULT" }, "Most items within 7 days of delivery; some only if unopened, or if faulty, damaged or wrong."],
      [{ "cat-smartphones": "FAULT_ONLY" }, "Most items within 7 days of delivery; some only if faulty, damaged or wrong."],
      [{ "cat-shirts": "UNOPENED_OR_FAULT", "cat-smartphones": "FAULT_ONLY" },
        "Most items within 7 days of delivery; some only if unopened, or if faulty, damaged or wrong; others only if faulty, damaged or wrong."],
    ];
    for (const [byId, sentence] of cases) {
      state.catalog = readyCatalog({}, rules(byId));
      const { unmount } = render(<Faq />);
      expect(answer("What can be returned?")).toBe(`${sentence} Each product page shows its rule. See Returns and refunds.`);
      unmount();
    }
  });

  for (const [name, catalog] of [["loading", loadingCatalog], ["failed", failedCatalog]] as const) {
    it(`answers with general sentences, and no spinner, while the catalog is ${name}`, () => {
      state.catalog = catalog();
      render(<Faq />);
      expect(answer("Where does the store deliver?")).toBe("Delivery options and fees are shown at checkout. See Delivery.");
      expect(answer("What can be returned?")).toBe("Each product page shows its return rule. See Returns and refunds.");
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }
});

describe("Privacy notice", () => {
  it("is dated, lists its sections On this page and gives the approved contacts", () => {
    window.location.hash = "#/privacy";
    render(<Privacy />);
    expect(state.titles.at(-1)).toBe("Privacy notice · Apex Cart");
    expect(screen.getByText(/^Last updated/).textContent).toBe("Last updated 18 November 2026");
    const sections = links(screen.getByRole("navigation", { name: "On this page" }));
    expect(sections.map(([name]) => name)).toEqual([
      "Who is responsible", "What we collect and why", "Why we may use it", "Who can see it", "Who else receives information",
      "How long we keep it", "Your browser", "Your rights", "Children", "Security", "Changes",
    ]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => `#/privacy?section=${heading.id}`)).toEqual(sections.map(([, href]) => href));
    expect(text()).toContain(
      `Apex Cart (a trading name) decides how this site uses personal information. Contact ${STORE_FACTS.email} or ${STORE_FACTS.phone.display} (${STORE_FACTS.hours}).`,
    );
  });

  it("publishes the corrected statements, which match what the site does", () => {
    render(<Privacy />);
    for (const statement of [
      "can see customer accounts and any orders with their delivery addresses",
      "the server logs requests with your network (IP) address",
      "(verification codes after 10 minutes, verification links after 24 hours, reset links after an hour)",
      "(name, email, phone, photo, saved addresses and preferences)",
      "Our email service: sends account and promotional emails, and delivers contact-form messages to our mailbox.",
      "Google (Gmail): hosts our mailbox, where messages to us are kept.",
      "Administrators can also see the promotional email list.",
      "and, just after you sign in, which account a guest cart is joining.",
      "Promotional subscriptions stay until you ask us to remove them: unsubscribing stops the emails, and your address stays on the list marked as unsubscribed.",
    ]) expect(text().replace(/\s+/g, " ")).toContain(statement);
  });

  it("links the regulator's sites in the same tab, showing their addresses as written", () => {
    render(<Privacy />);
    for (const [name, href] of [["www.odpc.go.ke", "https://www.odpc.go.ke/"], ["cie.odpc.go.ke", "https://cie.odpc.go.ke/"]]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.hasAttribute("target")).toBe(false);
    }
  });
});

describe("Terms of use", () => {
  it("opens with the demonstration note, is dated and links the pages that describe the set-up", () => {
    window.location.hash = "#/terms";
    render(<Terms />);
    expect(state.titles.at(-1)).toBe("Terms of use · Apex Cart");
    expect(screen.getByRole("note").textContent).toBe(STORE_FACTS.demonstration);
    expect(screen.getByText(/^Last updated/).textContent).toBe("Last updated 18 November 2026");
    expect(links(screen.getByRole("navigation", { name: "On this page" })).map(([name]) => name)).toEqual([
      "A demonstration store", "How the store is set up", "Using the site", "Your account", "Availability", "Liability", "Law", "Contact",
    ]);
    const setUp = screen.getByRole("heading", { level: 2, name: "How the store is set up" }).parentElement!;
    expect(links(setUp)).toEqual([["Delivery", "#/delivery"], ["Returns and refunds", "#/returns"], ["FAQ", "#/faq"]]);
    const contact = screen.getByRole("heading", { level: 2, name: "Contact" }).parentElement!;
    expect(contact.textContent).toBe(`Contact${STORE_FACTS.email} · ${STORE_FACTS.phone.display} · ${STORE_FACTS.hours}.`);
  });
});

describe("wording where sample orders take demonstration payments", () => {
  /** A FAQ answer, read whether or not its question is open. */
  const faqAnswer = (question: string) => {
    const disclosure = [...document.querySelectorAll("details")]
      .find((details) => details.querySelector(":scope > summary")?.textContent === question);
    if (!disclosure) throw new Error(`No question "${question}"`);
    return (disclosure.querySelector(":scope > div")?.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const flat = () => text().replace(/\s+/g, " ");
  const OFF = {
    tryIt: "You can browse and search the products, fill a cart and a wishlist, create an account, save addresses and see the delivery options at checkout. The products are samples, so on this site checkout stops before an order is placed.",
    charged: "No. Nothing can be bought here, and the site takes no real payments.",
    payment: "The store is set up for M-Pesa: the customer approves a prompt on their phone, so the store never sees an M-Pesa PIN.",
    terms: "Nothing is sold or delivered, and the site takes no real payments: on this site, checkout stops before an order is placed.",
    checkout: "The sample products can't be ordered on this site, so checkout saves none of these here.",
    safaricom: "the phone number, amount and an order reference, if a payment is requested. That can't happen on this site.",
    security: "Payments are approved on the customer's phone in M-Pesa, so the store never sees an M-Pesa PIN. Staff tools need a staff account.",
  };
  const ON = {
    tryIt: "You can browse and search the products, fill a cart and a wishlist, create an account, save addresses, and order sample products with a demonstration payment, which takes no money. You can then play the store's part for your own order: dispatch, delivery, a return and its refund.",
    charged: "No. A demonstration payment takes no money and sends no phone prompt. M-Pesa is set up in Safaricom's test sandbox, and its prompts can only be sent to the owner's approved test numbers.",
    payment: `${OFF.payment} On this site, sample orders are paid with a demonstration payment, unless an approved test number is used.`,
    terms: "Nothing is sold or delivered, and the site takes no real payments: sample orders are paid with a demonstration payment that takes no money.",
    checkout: "Orders for sample products are kept like any order. A demonstration payment records the method, amount and time, but no mobile-money or provider details.",
    safaricom: "the phone number, amount and an order reference, if a payment is requested. On this site, prompts can only be sent to the owner's approved test numbers.",
    security: "Payments are approved on the customer's phone in M-Pesa, so the store never sees an M-Pesa PIN. A demonstration payment involves no M-Pesa at all. Staff tools need a staff account.",
    refunds: "Refunds of demonstration payments are recorded without moving money.",
  };

  it("answers the FAQ for demonstration payments only when the catalog says sample orders take them", () => {
    state.catalog = readyCatalog({ demonstrationOrders: true });
    render(<Faq />);
    expect([faqAnswer("What can I try?"), faqAnswer("Will I be charged?"), faqAnswer("How does payment work?")])
      .toEqual([ON.tryIt, ON.charged, ON.payment]);
  });

  for (const [name, catalog] of [["off", () => readyCatalog({ demonstrationOrders: false })], ["loading", loadingCatalog]] as const) {
    it(`keeps today's FAQ, Terms and Privacy wording while demonstration orders are ${name}`, () => {
      state.catalog = catalog();
      const faq = render(<Faq />);
      expect([faqAnswer("What can I try?"), faqAnswer("Will I be charged?"), faqAnswer("How does payment work?")])
        .toEqual([OFF.tryIt, OFF.charged, OFF.payment]);
      faq.unmount();
      const terms = render(<Terms />);
      expect(flat()).toContain(OFF.terms);
      terms.unmount();
      render(<Privacy />);
      for (const statement of [OFF.checkout, OFF.safaricom, OFF.security]) expect(flat()).toContain(statement);
      expect(flat()).not.toContain("demonstration payment");
    });
  }

  it("states demonstration payments in the Terms and the Privacy notice", () => {
    state.catalog = readyCatalog({ demonstrationOrders: true });
    const terms = render(<Terms />);
    expect(flat()).toContain(ON.terms);
    expect(flat()).not.toContain("checkout stops before an order is placed");
    terms.unmount();
    render(<Privacy />);
    for (const statement of [ON.checkout, ON.safaricom, ON.security]) expect(flat()).toContain(statement);
    for (const statement of [OFF.checkout, "That can't happen on this site."]) expect(flat()).not.toContain(statement);
  });

  const RETENTION = {
    checkout: "Orders for sample products record the same details as any order, and are scheduled for deletion 7 days after they're placed unless an M-Pesa sandbox payment was tried for them. A demonstration payment records the method, amount and time, but no mobile-money or provider details.",
    keep: "This is a demonstration. Sample orders, with the delivery details copied onto them and their history, are scheduled for deletion 7 days after they're placed, unless an M-Pesa sandbox payment was tried for them. Nothing else is deleted automatically yet: your account, your saved addresses and other checkout records stay until they're deleted on request or the demonstration is reset.",
    none: "This is a demonstration, and there's no automatic deletion yet. Account, address and checkout records stay until they're deleted on request or the demonstration is reset.",
  };
  const keepSection = () => (document.getElementById("how-long-we-keep-it")?.closest("section")?.textContent ?? "").replace(/\s+/g, " ");

  it("says in the Privacy notice when sample orders are deleted, only when the catalog states a period", () => {
    state.catalog = readyCatalog({ demonstrationOrders: true, sampleOrderRetentionDays: 7 });
    render(<Privacy />);
    expect(flat()).toContain(RETENTION.checkout);
    expect(keepSection()).toContain(RETENTION.keep);
    for (const statement of [ON.checkout, RETENTION.none]) expect(flat()).not.toContain(statement);
  });

  it("keeps the Privacy notice's retention wording where no period is stated", () => {
    for (const catalog of [readyCatalog({ demonstrationOrders: true }), readyCatalog({ demonstrationOrders: false }), loadingCatalog()]) {
      state.catalog = catalog;
      const { unmount } = render(<Privacy />);
      expect(keepSection()).toContain(RETENTION.none);
      expect(flat()).not.toContain("scheduled for deletion");
      unmount();
    }
  });

  it("adds that demonstration refunds move no money to the Returns page only when sample orders take demonstration payments", () => {
    state.catalog = readyCatalog({ demonstrationOrders: true });
    const on = render(<Returns />);
    const refunds = () => [...screen.getByRole("heading", { level: 2, name: "Refunds" }).nextElementSibling!.children].map((item) => item.textContent);
    expect(refunds()).toContain(ON.refunds);
    expect(refunds().indexOf(ON.refunds)).toBe(refunds().findIndex((item) => item?.startsWith("Staff check returned items")) + 1);
    on.unmount();
    state.catalog = readyCatalog({ demonstrationOrders: false });
    render(<Returns />);
    expect(refunds()).not.toContain(ON.refunds);
  });
});

describe("Not found", () => {
  it("says the page can't be found and offers the ways on", () => {
    window.location.hash = "#/does-not-exist";
    render(<NotFound />);
    expect(state.titles.at(-1)).toBe("Page not found · Apex Cart");
    const heading = screen.getByRole("heading", { level: 1, name: "We can't find that page" });
    expect(heading.tabIndex).toBe(-1);
    expect(screen.getByText("The address may be mistyped, or the page may have moved.")).toBeTruthy();
    expect(links()).toEqual([["Go to the home page", "#/"], ["Browse the shop", "#/shop"], ["Contact us", "#/contact"]]);
  });
});

describe("every information page", () => {
  it("keeps every internal link a route (#/…), never a bare #section", () => {
    for (const page of [<Delivery key="d" />, <Returns key="r" />, <Faq key="f" />, <Privacy key="p" />, <Terms key="t" />, <NotFound key="n" />]) {
      const { unmount } = render(page);
      for (const [, href] of links()) expect(href).toMatch(/^(#\/|mailto:|tel:|https:\/\/)/);
      unmount();
    }
  });
});
