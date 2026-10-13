-- === BASIC QUANTITY UNITS (t19, 2026-10-13) ===
--
-- A purchase contract item must carry a quantity unit (`kind = 'QUANTITY'`),
-- but the units_of_measure migration created the table empty, and on
-- production only PERFORMANCE units were entered by hand. The contract item
-- unit picker therefore offered nothing to choose.
--
-- These are the common quantity units of the shop. ON CONFLICT on the
-- (kind, code) unique key: a unit that was already entered by hand stays as it
-- is (name, sort order, active flag untouched), so the migration is idempotent
-- and never overwrites a setting. Further units are added on the
-- Beállítások → Mértékegységek page.

INSERT INTO "UnitOfMeasure" ("id", "code", "name", "kind", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('uom_qty_db',      'db',      'darab',        'QUANTITY', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_ora',     'óra',     'óra',          'QUANTITY', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_kg',      'kg',      'kilogramm',    'QUANTITY', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_g',       'g',       'gramm',        'QUANTITY', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_l',       'l',       'liter',        'QUANTITY', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_m',       'm',       'méter',        'QUANTITY', true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_m2',      'm²',      'négyzetméter', 'QUANTITY', true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_csomag',  'csomag',  'csomag',       'QUANTITY', true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('uom_qty_keszlet', 'készlet', 'készlet',      'QUANTITY', true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("kind", "code") DO NOTHING;
