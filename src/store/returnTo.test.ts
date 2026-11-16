import { describe, expect, it } from "vitest";
import {
  CHECKOUT_REGISTER,
  CHECKOUT_SIGN_IN,
  MAX_RETURN_LENGTH,
  loginRoute,
  registerRoute,
  safeReturnTo,
  verifiedSignInRoute,
  verifyEmailRoute,
} from "./returnTo";

describe("sign-in return routes", () => {
  it.each([
    "/", "/checkout", "/cart", "/product/prod-linen-shirt", "/shop?cat=shirts&a.size=M&page=2", "/account/orders", "/track?order=APX-1",
  ])("accepts the internal route %s", (route) => {
    expect(safeReturnTo(route)).toBe(route);
  });

  it.each([
    [null], [undefined], [""], ["checkout"], ["//evil.example/checkout"], ["https://evil.example"], ["javascript:alert(1)"],
    ["/javascript:alert(1)"], ["/\\evil.example"], ["/admin"], ["/admin/orders"], ["/login"], ["/login?returnTo=/checkout"],
    ["/register"], ["/verify-email"], ["/unknown"], ["/shop/../admin"], ["/./checkout"], ["/checkout#top"],
    ["/checkout\n/admin"], ["/check out"], ["/cart\u0000"], [`/shop?q=${"a".repeat(MAX_RETURN_LENGTH)}`],
  ])("sends %j home instead", (route) => {
    expect(safeReturnTo(route)).toBe("/");
  });

  it("builds sign-in links that carry only safe routes, encoded", () => {
    expect(CHECKOUT_SIGN_IN).toBe("/login?returnTo=%2Fcheckout");
    expect(loginRoute("/shop?cat=shirts&page=2")).toBe("/login?returnTo=%2Fshop%3Fcat%3Dshirts%26page%3D2");
    expect(new URLSearchParams(loginRoute("/shop?cat=shirts&page=2").split("?")[1]).get("returnTo")).toBe("/shop?cat=shirts&page=2");
    expect(loginRoute("/")).toBe("/login");
    expect(loginRoute("/login?returnTo=/cart")).toBe("/login");
    expect(loginRoute("//evil.example")).toBe("/login");
  });

  it("carries a safe route from registration through verification to sign-in", () => {
    const fromRegister = registerRoute("/checkout");
    expect(fromRegister).toBe(CHECKOUT_REGISTER);
    expect(fromRegister).toBe("/register?returnTo=%2Fcheckout");
    const verify = new URLSearchParams(verifyEmailRoute("new+shopper@example.test", "/checkout?step=delivery").split("?")[1]);
    expect(Object.fromEntries(verify)).toEqual({ email: "new+shopper@example.test", returnTo: "/checkout?step=delivery" });
    const signIn = verifiedSignInRoute("new+shopper@example.test", "/checkout");
    expect(signIn.startsWith("/login?")).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(signIn.split("?")[1]))).toEqual({
      verified: "1", email: "new+shopper@example.test", returnTo: "/checkout",
    });
  });

  it.each(["//evil.example/checkout", "https://evil.example", "/admin", "/login", "/register", "/verify-email", "/"])(
    "drops returnTo=%s at every hop instead of carrying it",
    (route) => {
      expect(registerRoute(route)).toBe("/register");
      expect(verifyEmailRoute("a@example.test", route)).toBe("/verify-email?email=a%40example.test");
      expect(verifiedSignInRoute("a@example.test", route)).toBe("/login?verified=1&email=a%40example.test");
    },
  );
});
