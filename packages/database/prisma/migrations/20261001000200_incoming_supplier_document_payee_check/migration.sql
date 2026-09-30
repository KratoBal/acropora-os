-- Hiányzó számlák, 3. szelet: kinek szól a postafiókba érkezett számla (COMPANY,
-- NOT_COMPANY, UNKNOWN). Az első párosításkor számolódik a szövegből; a régi
-- sorokra NULL.

-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "payeeCheck" TEXT;

