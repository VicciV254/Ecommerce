import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TrackingEvent } from "../api/orders";
import { OrderTimeline } from "./OrderRecords";

const event = (overrides: Partial<TrackingEvent>): TrackingEvent => ({
  id: "event", status: "PENDING", description: "Step", location: null, createdAt: "2026-11-18T10:00:00.000Z", actorType: null, ...overrides,
});

describe("OrderTimeline", () => {
  it("says who recorded each step and where, without repeating a word that names both", () => {
    render(<OrderTimeline events={[
      event({ id: "demonstration", actorType: "DEMONSTRATION", location: "Demonstration", description: "Demonstration payment recorded" }),
      event({ id: "staff", actorType: "STAFF", location: "Staff portal", description: "Dispatched for delivery" }),
    ]} />);
    const details = screen.getAllByRole("listitem").map((item) => within(item).getAllByText(/·/)[0].textContent);
    expect(details[0]).toMatch(/ · Demonstration$/);
    expect(details[0]).not.toMatch(/Demonstration · Demonstration/);
    expect(details[1]).toMatch(/ · Staff · Staff portal$/);
  });
});
