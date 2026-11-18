-- P8.6 demonstration payments: a sample order can be paid with a demonstration payment, which takes no money.
-- PostgreSQL cannot use an enum value in the transaction that adds it, so this migration only adds the value; the
-- refund confirmation check changes in the next migration. To reverse it, recreate the type without the value once
-- no order uses it.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'DEMONSTRATION';
