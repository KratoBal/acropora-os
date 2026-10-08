-- #1582 P3 follow-up (acrobot, #1610 review): the test address a mail went to
-- instead of the recipients, so the stage log does not read as if the
-- customer got it.
-- AlterTable
ALTER TABLE "QuoteMailDelivery" ADD COLUMN     "redirectedTo" TEXT;

