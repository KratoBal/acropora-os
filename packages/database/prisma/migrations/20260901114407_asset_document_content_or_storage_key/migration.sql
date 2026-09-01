-- AlterTable
ALTER TABLE "AssetDocument" ADD COLUMN     "storageKey" TEXT,
ALTER COLUMN "content" DROP NOT NULL;

-- A TARTALOM PONTOSAN AZ EGYIK HELYEN ALL.
--
-- Miert adatbazis-szintu megkotes, es miert nem eleg az alkalmazas ellenorzese:
-- egy hattermunka, egy migracio vagy egy uj vegpont nem orokli a kod
-- ellenorzeseit, a tabla megkotesét viszont igen. A ket rossz allapot (mindketto
-- null, mindketto kitoltve) csendben keletkezne, es csak a letoltesnel derulne
-- ki: ures fajl vagy ket egymasnak ellentmondo forras.
--
-- A MAI SOROKON ATMEGY: minden meglevo sorban a content nem null es a
-- storageKey null, tehat a feltetel igaz rajuk, es a hozzaadas nem bukik el.
--
-- A NUM_NONNULLS ALAK A REPO MEGLEVO MINTAJA, nem sajat talalmany: az Asset
-- tablan ugyanez all "Asset_exactly_one_owner_check" neven
-- (num_nonnulls("customerId", "supplierId") = 1). Ugyanaz a kerdes, ugyanaz az
-- alak -- aki az egyiket erti, a masikat is.
ALTER TABLE "AssetDocument"
  ADD CONSTRAINT "AssetDocument_exactly_one_content_source_check"
  CHECK (num_nonnulls("content", "storageKey") = 1);
