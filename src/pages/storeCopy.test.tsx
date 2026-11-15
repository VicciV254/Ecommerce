import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import About from "./About";
import Contact from "./Contact";
import { Footer } from "../components/Footer";
import { fixtureSnapshot } from "../test-support/catalogFixtures";

const contact = vi.hoisted(() => ({ send: vi.fn() }));
const catalog = vi.hoisted(() => ({ value: { returnPolicy: null as { windowDays: number } | null } }));
vi.mock("../api/contact", () => ({ contactAPI: contact }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }) }));
vi.mock("../store/CatalogContext", () => ({
  useCatalog: () => ({ categories: { roots: [{ slug: "fashion", name: "Fashion" }] }, returnPolicy: catalog.value.returnPolicy }),
}));

/** Details of the previous physical store that must not be published for Apex Cart. */
const RETIRED_DETAILS = [
  /maneno/i, /mombasa/i, /digo/i, /\bCBD\b/, /720\s*784\s*379/, /\+254/, /iko kitu/i, /floors?\b/i,
  /generations/i, /find us/i, /google maps/i, /\bmon\b|monday|sunday|9\s*am|6:30/i, /opening hours/i, /@\w/,
];

function expectNoRetiredDetails() {
  const text = document.body.textContent ?? "";
  for (const pattern of RETIRED_DETAILS) expect(text).not.toMatch(pattern);
  for (const link of document.querySelectorAll("a")) expect(link.getAttribute("href") ?? "").not.toMatch(/maps\.|goo\.gl/);
  for (const image of document.querySelectorAll("img")) expect(image.getAttribute("alt") ?? "").not.toMatch(/mombasa|market/i);
}

beforeEach(() => {
  catalog.value = { returnPolicy: fixtureSnapshot().returnPolicy };
});

describe("About", () => {
  it("states only the approved shopping facts, with the published return window", () => {
    render(<About />);
    expect(screen.getByRole("heading", { level: 1, name: "About Apex Cart" })).toBeTruthy();
    expect(screen.getByText(/online store with products across departments/)).toBeTruthy();
    expect(screen.getByText("Prices are shown excluding VAT; 16% VAT is added at checkout.")).toBeTruthy();
    expect(screen.getByText(/Pay by M-Pesa/)).toBeTruthy();
    expect(screen.getByText(/Choose delivery or pickup at checkout/)).toBeTruthy();
    expect(screen.getByText(/returned within 7 days of delivery or collection; some only if unopened/)).toBeTruthy();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expectNoRetiredDetails();
  });

  it("names no return window until the catalog's policy is known", () => {
    catalog.value = { returnPolicy: null };
    render(<About />);
    expect(screen.getByText("Each product page shows its return rule and window. Refunds are sent by M-Pesa.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ days/);
  });
});

describe("Contact", () => {
  it("keeps a labelled message form and publishes no store contact details", () => {
    render(<Contact />);
    for (const name of ["Name", "Email", "Phone (optional)", "Message"]) expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Track an order" }).getAttribute("href")).toBe("#/track");
    expect(document.querySelectorAll("img, iframe")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/@|\bcall\b|whatsapp/i);
    expectNoRetiredDetails();
  });

  it("sends the message and confirms it without promising a reply time", async () => {
    contact.send.mockResolvedValue({ data: { message: "Message sent successfully" } });
    render(<Contact />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Amina" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "amina@example.test" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Where is my order TEST-1?" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send Message" }));
    expect(await screen.findByText("✓ Your message has been sent.")).toBeTruthy();
    expect(contact.send).toHaveBeenCalledWith({ name: "Amina", email: "amina@example.test", phone: undefined, message: "Where is my order TEST-1?" });
    expect(screen.getByRole("status").textContent).not.toMatch(/shortly|soon|hours?|days?|minutes?/i);
  });

  it("reports a failed send inside the form and keeps what was typed", async () => {
    contact.send.mockRejectedValue(new Error("offline"));
    render(<Contact />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A question about delivery" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send Message" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Your message could not be sent. Please try again."));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("A question about delivery");
  });
});

describe("Footer", () => {
  it("shows the Apex Cart lockup and shopping facts instead of old store details", () => {
    render(<Footer />);
    const lockup = screen.getByRole("link", { name: "Apex Cart" });
    expect(lockup.getAttribute("href")).toBe("#/");
    expect(lockup.querySelector("svg linearGradient")).toBeTruthy();
    expect(screen.getByText("Prices are shown excluding VAT; 16% VAT is added at checkout.")).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Staff Portal" }).getAttribute("href")).toBe("#/admin");
    expectNoRetiredDetails();
  });
});
