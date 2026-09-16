import type { Prisma } from "@acropora/database";

/**
 * AZ ESZKOZ-LISTA MATRICA-SZUROI, EGY HELYEN.
 *
 * KET KULONBOZO KERDES AD UGYANARRA A KAPCSOLT SORRA FELTETELT:
 *
 *   `label`      VAN-E matrica az eszkozon (`with` / `without`)
 *   `labelCode`  EZ a matrica all-e rajta (pontos egyezes)
 *
 * MIERT KELL KOZOS FUGGVENY, ES MIERT NEM ELEG KET SPREAD (merve 2026-09-16,
 * acrobot talalta meg): a ket ag UGYANARRA a `label` kulcsra irt egy objektum
 * literalban, tehat a masodik spread NEMAN felulirta az elsot. Egy
 * `label=without&labelCode=V2196` hivas a V2196 kodu eszkozt adta vissza --
 * holott a hivo MATRICA NELKULI eszkozoket kert, es arra az ures halmaz a
 * helyes valasz (aminek nincs matricaja, annak kodja sincs).
 *
 * A HIBA NEM TUNT VOLNA FEL: a valasz nem ures es nem hibas alaku, hanem egy
 * ERTELMES, NEM URES lista -- csak epp a MASIK kerdesre.
 *
 * AZ `AND` CSAK AKKOR KERUL BE, HA TENYLEG KET AG VAN. Egy aggal a visszaadott
 * objektum BETURE ugyanaz, mint korabban: egy meglevo hivas lekerdezese nem
 * valtozik attol, hogy ez a fuggveny bekerult.
 */
export function assetLabelWhere(
  label: "with" | "without" | undefined,
  labelCode: string | undefined,
): Prisma.AssetWhereInput {
  const agak: Prisma.AssetWhereInput[] = [];
  /**
   * A `label: null` a Prisma egy-az-egyhez kapcsolatan azt jelenti, hogy NINCS
   * kapcsolt sor -- ez teszi megtalalhatova a matrica nelkul felvitt
   * eszkozoket. A `isNot: null` a masik irany.
   */
  if (label === "without") agak.push({ label: null });
  else if (label === "with") agak.push({ label: { isNot: null } });
  if (labelCode) agak.push({ label: { code: labelCode } });

  if (agak.length === 0) return {};
  if (agak.length === 1) return agak[0]!;
  return { AND: agak };
}
