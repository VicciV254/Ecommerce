import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../utils/storage";
import {
  EMPTY_ADDRESS,
  addressInput,
  addressProblems,
  clearAddressDraft,
  readAddressDraft,
  saveAddressDraft,
  type AddressDraft,
} from "./addressModel";

const typed: AddressDraft = { street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", postalCode: "" };

describe("address entry", () => {
  it("asks for the street, town and county with the server's minimum lengths; the postal code is optional", () => {
    expect(addressProblems(EMPTY_ADDRESS)).toEqual({
      street: "Enter the street address.", city: "Enter the town or city.", county: "Enter the county.",
    });
    expect(addressProblems({ street: " 1 A ", city: "N", county: " ", postalCode: "" })).toEqual({
      street: "Enter at least 5 characters for the street address.",
      city: "Enter at least 2 characters for the town or city.",
      county: "Enter the county.",
    });
    expect(addressProblems(typed)).toEqual({});
  });

  it("accepts each field at exactly its minimum length, counted after trimming", () => {
    // The server's minimums are inclusive: 5 characters of street, 2 of town and of county are enough.
    expect(addressProblems({ street: " Moi 5 ", city: "Nk", county: "Ka ", postalCode: "" })).toEqual({});
    expect(addressProblems({ street: "Moi ", city: "N", county: "K", postalCode: "" })).toEqual({
      street: "Enter at least 5 characters for the street address.",
      city: "Enter at least 2 characters for the town or city.",
      county: "Enter at least 2 characters for the county.",
    });
  });

  it("sends trimmed values and leaves out an empty postal code", () => {
    expect(addressInput({ ...typed, street: "  12 Moi Avenue " }, true)).toEqual({
      street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", isDefault: true,
    });
    expect(addressInput({ ...typed, postalCode: " 00100 " }, false)).toMatchObject({ postalCode: "00100", isDefault: false });
  });
});

describe("checkout address draft", () => {
  it("is kept for this tab and account until it is cleared", () => {
    saveAddressDraft("customer-a", typed);
    expect(readAddressDraft("customer-a")).toEqual(typed);
    // A reload reads the same tab's session storage.
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft) ?? "null")).toEqual({ owner: "customer-a", draft: typed });
    clearAddressDraft();
    expect(readAddressDraft("customer-a")).toBeNull();
  });

  it("is never shown to another account, which removes it", () => {
    saveAddressDraft("customer-a", typed);
    expect(readAddressDraft("customer-b")).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
    expect(readAddressDraft("customer-a")).toBeNull();
  });

  it("leaves nothing behind for an emptied form and ignores damaged entries", () => {
    saveAddressDraft("customer-a", typed);
    saveAddressDraft("customer-a", { ...EMPTY_ADDRESS, street: "   " });
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
    sessionStorage.setItem(STORAGE_KEYS.checkoutAddressDraft, JSON.stringify({ owner: "customer-a", draft: { street: 12 } }));
    expect(readAddressDraft("customer-a")).toBeNull();
    sessionStorage.setItem(STORAGE_KEYS.checkoutAddressDraft, "{not json");
    expect(readAddressDraft("customer-a")).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
  });
});
