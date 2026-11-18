-- P8.6 demonstration refunds move no money, so they have no M-Pesa reference. A confirmed refund still needs its
-- confirmation time, and needs a provider reference unless it is a demonstration refund that belongs to no M-Pesa
-- payment. The unique index on "providerReference" is unchanged. The new check accepts every row the old one did. To
-- reverse it, restore the previous check, which fails while a confirmed demonstration refund without a reference exists.

ALTER TABLE "Refund" DROP CONSTRAINT "Refund_confirmation_check";
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_confirmation_check" CHECK (
  "status" <> 'CONFIRMED' OR (
    "confirmedAt" IS NOT NULL
    AND ("providerReference" IS NOT NULL OR ("method" = 'DEMONSTRATION' AND "paymentId" IS NULL))
  )
);
