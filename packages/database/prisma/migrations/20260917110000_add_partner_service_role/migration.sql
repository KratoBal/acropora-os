-- Partnerhez kötött felhasználók szűk, csak szerviz-területeket adó szerepe.
-- Meglévő felhasználói sorokat nem ír át.
ALTER TYPE "UserRole" ADD VALUE 'PARTNER_SERVICE';
