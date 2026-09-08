-- A ProductRelation kap idobelyeget, hogy egy kapcsolat-valtozas esedekesse
-- tegye a terméket a Medusa-vetites szemeben.
--
-- A MEGLEVO SOROK 1970-01-01-ET KAPNAK, NEM `now()`-T, ES EZ SZANDEKOS:
-- a `now()` azt allitana, hogy minden meglevo kapcsolat a migracio pillanataban
-- valtozott. Ez hamis, es egyetlen korben minden kapcsolattal rendelkezo
-- terméket esedekesse tenne -- csupa hamis pozitiv. A konzervativ ertekkel
-- semmi nem vesz el: egy soha nem vetitett termek amugy is esedekes.
--
-- Ha kesobb SZANDEKOSAN kell egy teljes ujravetites, azt kulon lepesben lehet
-- kerni (a vetites-CLI megnevezett termekekre), nem egy migracio
-- mellektermekekent.

ALTER TABLE "ProductRelation"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT TIMESTAMP '1970-01-01 00:00:00',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT TIMESTAMP '1970-01-01 00:00:00';

-- Az UJ sorok mar a jelen idot kapjak. Az `updatedAt` erteket a Prisma allitja
-- minden irasnal (`@updatedAt`), a DB-alapertelmezes csak azoknak a soroknak
-- szol, amik a Prisma megkerulesevel keletkeznenek.
ALTER TABLE "ProductRelation"
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
