-- AZ EGY UTALÁS TÖBB SZÁMLÁRA FORRÁSA (kártya aeddb2c3, Balázs 2026-11-04 16:36 UTC: a közleményben
-- „2026/00083,86,85,84”). A sourceRef a banki jóváírás azonosítója. Csak egy új enum-érték, adat nem változik.
ALTER TYPE "OutgoingPaymentMarkSource" ADD VALUE 'BANK_TRANSFER';
