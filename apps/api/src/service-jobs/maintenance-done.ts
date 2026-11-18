import type { Prisma } from "@acropora/database";

/**
 * MIKOR KÉSZ EGY KARBANTARTÁSI LAP (Balázs, 2026-11-18 11:31 UTC): ha van munkalapja, és MINDEGYIK munkalap legutolsó verziója aláírt.
 * A karbantartásnak nincs hibajegy-állapota; a lista jelvénye ("Kész" / "Folyamatban"), a lista fülei és a fülek számlálója (acrobot 56182,
 * f4590db6) ebből az egy szabályból jönnek.
 *
 * SZŰRŐKÉNT, NEM AZONOSÍTÓ-LISTAKÉNT (a9db2779; barracuda a #2711-en). A Prisma ebből két részlekérdezést fordít: EXISTS munkalap, és NOT
 * EXISTS olyan munkalap, aminek nincs legutolsó verziója, vagy az nem aláírt. A "legutolsó verzió" a `WorksheetLatestVersion` nézet (egy sor
 * munkalaponként, a legnagyobb sorszámú). Így a lista és a számláló egy-egy lekérdezés, és nincs olyan `in` / `notIn` lista, ami a lapok
 * számával nő (a lap sosem zárul, tehát évről évre gyűlne a Postgres bind-határa felé).
 */
export const MAINTENANCE_DONE: Prisma.ServiceJobWhereInput = {
  worksheets: {
    some: {},
    none: {
      OR: [
        { latestVersion: { is: null } },
        { latestVersion: { is: { status: { not: "SIGNED" } } } },
      ],
    },
  },
};

/** A karbantartási lista fülének szűrője: a még nem kész (`progress`) vagy a kész (`done`) lapok. */
export type MaintenanceListState = "progress" | "done";

/** A fül szűrője ugyanabból a szabályból: a Kész fül maga a szabály, a Folyamatban fül a tagadása. */
export function maintenanceStateWhere(
  state: MaintenanceListState,
): Prisma.ServiceJobWhereInput {
  return state === "done" ? MAINTENANCE_DONE : { NOT: MAINTENANCE_DONE };
}
