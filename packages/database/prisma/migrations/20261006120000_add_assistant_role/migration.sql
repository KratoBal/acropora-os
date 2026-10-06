-- Sutyerák rendszer-felhasználójának szerepe (4. pont B, Balázs döntése
-- 2026-10-06): csak `messages.use`. Külön migráció, mert az új enum-érték
-- ugyanabban a tranzakcióban nem használható.
ALTER TYPE "UserRole" ADD VALUE 'ASSISTANT';
