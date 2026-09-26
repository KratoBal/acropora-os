-- A levelsablon formazott (HTML) torzse. Nullazhato: a meglevo sorok NULL-t
-- kapnak, es a kimeno leveluk valtozatlan marad (egyreszes text/plain).
-- Az indoklas a schema.prisma-ban all: ez a fajl alkalmazas utan befagy.

-- AlterTable
ALTER TABLE "TicketMailTemplate" ADD COLUMN "bodyHtml" TEXT;
