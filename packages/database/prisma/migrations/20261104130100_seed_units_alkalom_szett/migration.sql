-- === QUANTITY UNITS "alkalom" AND "szett" (2026-11-04) ===
--
-- Luca's order flow needs two units that the basic list (20261013100000_seed_quantity_units) lacks:
-- "alkalom" (one-off service occasion) and "szett" (set). Requested through acrobot in inter-agent
-- message 42198 (Balázs priority, 2026-11-04). Same idempotent shape as the first seed: ON CONFLICT on
-- the (kind, code) unique key leaves a unit that was already entered by hand untouched.

INSERT INTO "UnitOfMeasure" ("id", "code", "name", "kind", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('uom_qty_alkalom', 'alkalom', 'alkalom', 'QUANTITY', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_szett',   'szett',   'szett',   'QUANTITY', true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("kind", "code") DO NOTHING;
