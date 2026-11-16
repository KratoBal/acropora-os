-- The sent confirmation mails' Gmail ids (card jatek-level-torles): the erasure deletes exactly these from the
-- sender's mailbox, then empties the list. Additive, with a default: the old rows read as an empty list.

-- AlterTable
ALTER TABLE "GameEntry" ADD COLUMN     "sentMailIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
