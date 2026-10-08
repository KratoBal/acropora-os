-- #1582 P8: a quote's follow-up task. An enum value goes in its own migration.

-- AlterEnum
ALTER TYPE "TaskSource" ADD VALUE 'QUOTE';

