-- A javított beszállítói számla (acrobot döntése, 2026-09-30 10:42): ugyanaz a
-- számlaszám MÁS tartalommal egy későbbi levélben lecseréli a korábbit, amíg a
-- várható beérkezés nyitott (SUPERSEDED a régin); bevételezett tételen nem
-- cserél, csak jelez (LATE_CORRECTION az újon).
--
-- Ez a migráció EGYETLEN meglévő sort sem ír át: csak két új felsorolás-értéket
-- vesz fel, amit ma egyetlen sor sem visel. Az `ALTER TYPE ... ADD VALUE`
-- ugyanabban a tranzakcióban akkor biztonságos, ha a migráció az új értéket
-- DML-ben nem használja -- itt nem használja.

-- AlterEnum
ALTER TYPE "IncomingSupplierDocumentStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "IncomingSupplierDocumentStatus" ADD VALUE 'LATE_CORRECTION';
