import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import About from "./About";
import Contact from "./Contact";
import { Footer } from "../components/Footer";
import type { CatalogDelivery } from "../api/catalog";
import { fixtureSnapshot } from "../test-support/catalogFixtures";

const contact = vi.hoisted(() => ({ send: vi.fn() }));
const subscriptions = vi.hoisted(() => ({ subscribe: vi.fn() }));
const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, refreshUser: vi.fn() } }));
const catalog = vi.hoisted(() => ({
  value: { returnPolicy: null as { windowDays: number } | null, delivery: null as CatalogDelivery[] | null },
}));
vi.mock("../api/contact", () => ({ contactAPI: contact }));
vi.mock("../api/subscriptions", () => ({ subscriptionsAPI: subscriptions }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }) }));
vi.mock("../store/CatalogContext", () => ({
  useCatalog: () => ({
    categories: { roots: [{ slug: "fashion", name: "Fashion" }] }, returnPolicy: catalog.value.returnPolicy, delivery: catalog.value.delivery,
  }),
}));

function apiError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, undefined, { status, statusText: String(status), data, headers: new AxiosHeaders(), config });
}

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
  const { returnPolicy, delivery } = fixtureSnapshot();
  catalog.value = { returnPolicy, delivery };
  auth.value = { user: null, refreshUser: vi.fn().mockResolvedValue(undefined) };
  subscriptions.subscribe.mockReset();
});

describe("About", () => {
  it("states only the approved shopping facts, with the published return window", () => {
    render(<About />);
    expect(screen.getByRole("heading", { level: 1, name: "About Apex Cart" })).toBeTruthy();
    expect(screen.getByText(/online store with products across departments/)).toBeTruthy();
    expect(screen.getByText("Prices are shown excluding VAT; 16% VAT is added at checkout.")).toBeTruthy();
    expect(screen.getByText(/Pay by M-Pesa/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Delivery" })).toBeTruthy();
    expect(screen.getByText(
      "Standard delivery anywhere in Kenya; same-day delivery in Nairobi only. The fee appears in your total before you reserve the order.",
    )).toBeTruthy();
    expect(screen.getByText(/returned within 7 days of delivery; some only if unopened/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/pick ?up|collect/i);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expectNoRetiredDetails();
  });

  it("names no return window or delivery methods until the catalog has loaded them", () => {
    catalog.value = { returnPolicy: null, delivery: null };
    render(<About />);
    expect(screen.getByText("Each product page shows its return rule and window. Refunds are sent by M-Pesa.")).toBeTruthy();
    expect(screen.getByText("Delivery fees appear in your total before you reserve the order.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ days|anywhere in Kenya|Nairobi/);
  });

  it("states delivery from whatever methods the catalog offers, in its order", () => {
    catalog.value = { returnPolicy: null, delivery: [
      { method: "SAME_DAY", fee: 450, freeAbove: null, counties: ["Nairobi", "Kiambu", "Machakos"] },
      { method: "STORE_PICKUP", fee: 0, freeAbove: null, counties: [] },
    ] };
    render(<About />);
    expect(screen.getByText(
      "Same-day delivery in Nairobi, Kiambu and Machakos only; store pickup anywhere in Kenya. The fee appears in your total before you reserve the order.",
    )).toBeTruthy();
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
    fireEvent.submit(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("✓ Your message has been sent.")).toBeTruthy();
    expect(contact.send).toHaveBeenCalledWith({ name: "Amina", email: "amina@example.test", phone: undefined, message: "Where is my order TEST-1?" });
    expect(screen.getByRole("status").textContent).not.toMatch(/shortly|soon|hours?|days?|minutes?/i);
  });

  it("reports a failed send inside the form and keeps what was typed", async () => {
    contact.send.mockRejectedValue(new Error("offline"));
    render(<Contact />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A question about delivery" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send message" }));
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
    expect(screen.getByText(/^Standard delivery anywhere in Kenya; same-day delivery in Nairobi only\./)).toBeTruthy();
    expect(screen.getByText(/returned within 7 days of delivery; some/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/pick ?up|collect/i);
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Staff portal" }).getAttribute("href")).toBe("#/admin");
    expectNoRetiredDetails();
  });
});

describe("Footer subscription", () => {
  const THANKS = "Thank you for subscribing. Every email has a link to unsubscribe.";
  function subscribe(email: string) {
    render(<Footer />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
    fireEvent.submit(screen.getByRole("button", { name: "Subscribe" }));
  }

  it("confirms in place and refreshes the signed-in account, so its profile shows the change", async () => {
    subscriptions.subscribe.mockResolvedValue({ data: { message: "Subscribed. Every email has a link to unsubscribe." } });
    auth.value = { user: { id: "user-1" }, refreshUser: vi.fn().mockResolvedValue(undefined) };
    subscribe("Amina@Example.test");
    expect((await screen.findByRole("status")).textContent).toBe(THANKS);
    expect(subscriptions.subscribe).toHaveBeenCalledWith({ email: "Amina@Example.test" });
    expect(auth.value.refreshUser).toHaveBeenCalledTimes(1);
  });

  it("refreshes no account when nobody is signed in", async () => {
    subscriptions.subscribe.mockResolvedValue({ data: { message: "Subscribed. Every email has a link to unsubscribe." } });
    subscribe("amina@example.test");
    expect((await screen.findByRole("status")).textContent).toBe(THANKS);
    expect(auth.value.refreshUser).not.toHaveBeenCalled();
  });

  it("moves focus from the removed form to the confirmation, so keyboard and screen reader users keep their place", async () => {
    subscriptions.subscribe.mockResolvedValue({ data: { message: "Subscribed. Every email has a link to unsubscribe." } });
    render(<Footer />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "amina@example.test" } });
    const button = screen.getByRole("button", { name: "Subscribe" });
    button.focus();
    fireEvent.submit(button);
    const status = await screen.findByRole("status");
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it("leaves focus alone when the person has moved on before the confirmation arrives", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    subscriptions.subscribe.mockReturnValue(new Promise((settle) => { resolve = settle; }));
    render(<Footer />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "amina@example.test" } });
    fireEvent.submit(screen.getByRole("button", { name: "Subscribe" }));
    const elsewhere = screen.getByRole("link", { name: "Shop all" });
    elsewhere.focus();
    resolve({ data: { message: "Subscribed. Every email has a link to unsubscribe." } });
    expect((await screen.findByRole("status")).textContent).toBe(THANKS);
    expect(document.activeElement).toBe(elsewhere);
  });

  it("shows the server's refusal beside the field and keeps what was typed", async () => {
    subscriptions.subscribe.mockRejectedValue(apiError(400, { error: "Enter a valid email address.", code: "SUBSCRIPTION_EMAIL_INVALID" }));
    auth.value = { user: { id: "user-1" }, refreshUser: vi.fn().mockResolvedValue(undefined) };
    subscribe("amina@");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Enter a valid email address.");
    const field = screen.getByLabelText("Email address") as HTMLInputElement;
    expect(field.value).toBe("amina@");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeTruthy();
    expect(auth.value.refreshUser).not.toHaveBeenCalled();
  });
});
