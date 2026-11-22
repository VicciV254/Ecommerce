# Frontend: storefront and staff app

`src/` is one React app: the storefront for shoppers and, at `#/admin`, the staff app. This page lists the rules to
keep when you change it. For the API behind it, see [Backend setup](../backend/SETUP.md).

## Routes and links

- Routes live in the URL hash, such as `#/shop` or `#/admin`, and the app's own router in `src/router.tsx` handles
  them. Use its `Link`, `navigate` and `parseRoute`.
- `Link` forwards anchor attributes and refs, respects a caller's `preventDefault`, and leaves modified clicks, other
  targets and downloads to the browser.
- A section of a page has the address `#/<page>?section=<id>`, never a bare `#id`, because the hash is the route.
- An unknown address shows a not-found page with links to the home page, the shop and Contact. It is served like every
  other page, so there is no HTTP 404 status.

## Sessions and browser storage

- Attach customer credentials to each request, never as an Axios default (`src/api/client.ts`). Concurrent customer
  401 responses share one bounded refresh, and each request retries at most once.
- Staff requests and public sign-in failures never use the customer's refresh credentials. Responses for a superseded
  session are cancelled, and a passing network error doesn't sign the customer out.
- Keep browser state under the `apex-cart:v2` namespace (`src/utils/storage.ts`). Keys outside it, such as an unscoped
  `token` or `nmb-*` caches, are never read, migrated or cleared.
- Orders come only from the API, never from data saved in the browser.

## Prices and checkout

The server owns prices, discounts, totals, quotes and stock holds; the browser never calculates them. See
[Pricing and reservation contract](../backend/SETUP.md#pricing-and-reservation-contract).

- Pass canonical products to `ProductCard`. Cards, the product page and search show each variant's server-made
  `pricing` and available stock. A catalog without a variant's `pricing` is rejected, never filled in by the browser.
  Base prices stay separate, for staff editing.
- The cart and checkout offer exactly the delivery methods in the catalog's `delivery` list (`GET /api/catalog`), in
  that order. A saved choice that is no longer offered falls back to the first one, while orders placed with it, such
  as Store pickup orders, still show and complete. The promise under each method, such as "2–5 working days", is
  worded in `src/store/storeFacts.ts`.
- Coupon and delivery choices are saved with the account's cart. A change of price, address or delivery needs a new
  quote, which the customer reviews before ordering.
- **Reserve order** works only with `ENABLE_ORDER_RESERVATIONS=true`. If the outcome of an order request is unknown,
  the browser keeps the same quote and `Idempotency-Key` across retries and reloads. Only a verified order removes its
  units from the cart; items added meanwhile stay.
- Paying with M-Pesa is a separate action that sends only the order ID and a phone number, so it can't set the
  amount. See [Order-linked M-Pesa](../backend/SETUP.md#order-linked-m-pesa).

## Demonstration store

With `DEMONSTRATION_STORE=true` (see [Demonstration store](../backend/SETUP.md#demonstration-store)), the payment
panel offers **Pay with a demonstration payment**, which takes no money and sends no phone prompt. M-Pesa's sandbox
stays behind a closed **Pay with M-Pesa sandbox instead** disclosure.

The owner of a sample order plays the store's part from **Demonstration controls** in the order's **Receipt details**:
preparing, dispatching and delivering it, approving and receiving a return, and recording the refund. The buttons are
exactly the steps the server lists in the order's `demonstrationActions`. Each sends the status it was shown with, so
a stale step is refused and the order reloads.

Pages that describe ordering or payment, such as the FAQ, Terms, Privacy notice, About, the footer and checkout, follow
the catalog's `demonstrationOrders`. Until the catalog loads, or with it off, they describe a store whose checkout
stops before an order is placed. Order pages follow each order's `paymentMethod`.

## Storefront editor, preview and history

- Shoppers see only the published storefront. Saving a draft and publishing are separate operations, each checked
  against the version the editor holds. Disabled sections and unused campaigns are left out of public responses, and
  invalid catalog or media references can't be published.
- A draft carries its referenced media and the IDs of unavailable media, so unpublished artwork still previews after a
  reload. Campaigns share their copy and call to action across screen sizes; without separate mobile artwork, phones
  use the desktop image at the campaign's mobile focal point.
- The draft preview shows the storefront at phone, tablet and desktop widths (390, 768 and 1280 px). It runs the
  shoppers' renderer in a same-origin frame (`#/admin/storefront/preview-frame`) of that width, scaled down only for
  display, so any framing policy for the frontend must allow its own origin (`frame-ancestors 'self'`). Links don't
  open from the preview, and its product cards offer no buying or wishlist.
- Every publication is kept with its time and publisher. Super admins and admins can restore an earlier version into
  the draft, never straight to shoppers; a version that breaks the current rules or uses a deleted product, category
  or image is refused.
- Section headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated"
  or "trending". The one exception is the best sellers section, which the server ranks: its heading is always "Best
  sellers".

## Dialogs

Use `ModalDialog` or `ConfirmModal` (`src/components/Modal.tsx`) instead of a separate fixed overlay. They provide
native modality, initial and restored focus, Tab wrapping at the edges, and dismissal with Escape or the backdrop.
Guard `onClose` while an operation is pending, keep content within the viewport, and show feedback inside the active
dialog. The shared `Toast` follows the active dialog layer.

## Information pages

The public pages describe how the demonstration store is set up; they don't promise delivery, refunds or emails.

- Delivery (`#/delivery`), Returns and refunds (`#/returns`), the FAQ (`#/faq`), the Privacy notice (`#/privacy`) and
  the Terms of use (`#/terms`) share one reading layout, `src/components/InfoPage.tsx`.
- The FAQ, Privacy notice and Terms list their sections under "On this page". Following a section link scrolls its
  heading into view below the sticky header and moves focus to it; Back returns to the top of the page.
- FAQ answers are native disclosures (`<details>`): each stays closed until its question is opened, and several can be
  open at once.
- Contacts, support hours, the demonstration statement, the policies' dates and the delivery promises are worded once,
  in `src/store/storeFacts.ts`. A unit test fails if another source file repeats the email address, phone number or
  hours.
- Fees, free-delivery thresholds, covered counties, the return window, the delivery-fee refund rule and the return
  rules come from the catalog (`GET /api/catalog`: `delivery`, `returnPolicy` and each category's `returnRule`), so the
  pages match what checkout offers. Until the catalog loads, Delivery and Returns show a loading panel and the FAQ
  gives general answers.

## Link previews and search

Link previews don't run JavaScript, so `index.html` carries the store's description, canonical address, and Open Graph
and X card tags beside `<title>`, ahead of the inlined app.

- The description is the demonstration statement from `src/store/storeFacts.ts`; a unit test keeps the two equal.
- The canonical address, `og:url` and `og:image` hold the store's public address. Change all three together.
- The preview image is `public/og-image.png` (1200 × 630): the gold mark, the store name and "A demonstration store"
  on navy.
- `public/robots.txt` lets every crawler in, including `/api`, which the pages render from.
- There is no product or offer markup and no sitemap: the products are samples, and hash routes aren't separate pages
  to search engines.
- The tags are fixed text, so a store name changed in the storefront editor doesn't reach link previews.

## Development preview notice

When the hosting platform builds the app for a preview or development environment, every page, the staff area
included, starts with the notice "Development preview: use test accounts and test data only." Production and local
builds never show it. The build decides this once, from the hosting platform's environment setting
(`src/deployment.ts`, `src/components/DeploymentNotice.tsx`).

## Staff app

Staff sign in at `#/admin` with their email address and password. Super admins and admins can use every section;
view-only staff can read every section except Email promotions and Staff activity, and change nothing.

| Group | Sections |
|---|---|
| Overview | Dashboard (sales, orders and the work that needs action now); Sales report, with exports |
| Orders and returns | Orders; Returns; Refunds (manual M-Pesa refunds, from approval to a recorded reference) |
| Catalog and inventory | Products (with categories and designers); Stock (on-hand, reserved and available units per SKU) |
| Storefront | Storefront editor (the homepage draft: brand, theme, sections and campaigns) |
| Customers and promotions | Customers; Discounts (automatic and coupon); Email promotions (newsletter subscribers and emails) |
| Settings and activity | Staff activity (sign-ins and staff changes, newest first) |

- A compare-at ("was") price must be higher than the product's price, or empty. The editor and the API refuse anything
  else, including a price raised to or above a saved compare-at price. A stored compare-at price that isn't higher is
  not shown.
- Each promotional email carries a link that unsubscribes only its recipient (`#/unsubscribe?token=…`). The page acts
  only when the person presses its button, so a mail scanner that opens the link unsubscribes nobody.
- Subscribing to the newsletter gives the same answer whether or not the address was already subscribed. An account's
  promotional-email preference always shows whether those emails go to its address.
