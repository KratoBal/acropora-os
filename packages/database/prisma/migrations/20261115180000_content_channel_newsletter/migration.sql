-- T5.5 S4: the newsletter channel. Its own migration: a new enum value cannot be used in the transaction that adds it,
-- and the template rows of the next migration use it.

-- AlterEnum
ALTER TYPE "ContentChannel" ADD VALUE 'NEWSLETTER';
