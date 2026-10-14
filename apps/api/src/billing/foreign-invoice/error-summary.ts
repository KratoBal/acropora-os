import { Prisma } from "@acropora/database";

/*
  A HIBA FAJTÁJA A NAPLÓBA, A TARTALMA NEM (kulfoldi-szamla-olvasas-hiba,
  2026-10-14). Az időzítő eddig csak az osztály nevét írta, mert a Prisma
  üzenete számla-adatot hordozhat (az érték, ami nem fért el). Így viszont egy
  napnyi bukásból sem derült ki, melyik szabály sérült. A kód (P2000, P2020, …)
  és a mező vagy kényszer NEVE nem adat; a `meta` többi része (például a P2020
  `details`-e, ami magát az értéket idézi) kimarad.
*/
const IDENTIFIER = /^[A-Za-z0-9_.]{1,64}$/;

function names(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return (
    list
      .filter((item): item is string => typeof item === "string")
      // a P2003 `field_name`-je kényszernév és zárójeles megjegyzés
      // („…_fkey (index)”, barracuda #1689): a megjegyzés nélkül még név
      .map((item) => item.replace(/\s*\([^()]*\)$/, ""))
      .filter((item) => IDENTIFIER.test(item))
  );
}

/** `PrismaClientKnownRequestError P2000 (currency)`, vagy csak az osztály neve. */
export function prismaErrorSummary(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (error.meta ?? {}) as Record<string, unknown>;
    const fields = [
      ...names(meta.modelName),
      ...names(meta.column_name),
      ...names(meta.field_name),
      ...names(meta.target),
    ];
    const code = IDENTIFIER.test(error.code) ? error.code : "?";
    return `${error.name} ${code}${fields.length ? ` (${fields.join(", ")})` : ""}`;
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}
