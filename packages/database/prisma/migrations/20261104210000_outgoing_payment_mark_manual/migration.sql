-- A KÉZI KIFIZETÉS-RÖGZÍTÉS FORRÁSA (kártya 2026/00083-86, Balázs 2026-11-04 16:40 UTC: „a saját
-- felületünkön nem tudom kifizetettre állítani"). Csak egy új enum-érték, adat nem változik.
ALTER TYPE "OutgoingPaymentMarkSource" ADD VALUE 'MANUAL';
