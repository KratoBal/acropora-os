import type { AuthenticatedUser } from "./types";

/**
 * MELYIK HATOKORBEN DOLGOZIK EZ A FIOK -- UGYANAZ A SZABALY, AMIT A SZERVER
 * HASZNAL (`partnerScopeOf`).
 *
 * === MIERT NEM A SZEREP DONT ===
 *
 * A `PARTNER_SERVICE` szerep VISELI a `service.manage` jogot, es ez IGAZ
 * allitas -- a szerver tenyleg megadja neki. Amit a szerver NEM ad, az a BELSOS
 * IRAS (`requireInternalWriter`), es azt a HATOKORBOL dönti el, nem a
 * szerepbol. Ha a telefon a szerepre kotne, egy HAMIS allitast tenne a
 * jogosultsag helyere -- es elvenné azt is, amit a partner ma jogosan hasznal.
 *
 * Ugyanez az erv dontott 2026-09-22 este a leptetes-gombnal is.
 *
 * === A HARMADIK ALLAPOT, AMI NEM A VILAGROL SZOL ===
 *
 * A ket mezo ELHAGYHATO a tukorben, es a hianyuk MAST jelent, mint a `null`:
 *
 *     null        a szerver AZT MONDTA, hogy nincs hatokor -> belso kollega
 *     undefined   a mezo MEG NEM ERKEZETT MEG -- regebbi szerver, vagy
 *                 elveszett az uton
 *
 * A KETTO MA MEGKULONBOZTETHETETLEN LENNE, ha egyben kezelnenk oket, es pont ez
 * az, amire acrobot 2026-09-22-en kulon kert orzot: a „mind a ketto hianyzik"
 * helyzet VAGY belso fiok (helyes), VAGY hiba az uton.
 *
 * AMIT A HIANYRA CSINALUNK, ES MIERT EPP AZT: visszaesunk a SZEREPRE, es a
 * `bizonytalan` jelzovel kimondjuk. A ket irany ara nem egyforma:
 *
 *   ha ilyenkor PARTNERNEK vennenk mindenkit  -> egy regebbi szerver ellen
 *     MINDEN belso kollega elvesztene a munkalap-gombot. Hangos, de sulyos.
 *   ha a SZEREPRE esunk vissza                -> a ma ismert partner-szerep
 *     tovabbra is ki van zarva, a belsok dolgoznak, es a bizonytalansag
 *     LATHATO marad annak, aki naplot olvas.
 *
 * A szerep itt tehat NEM a szabaly, hanem VESZ-TARTALEK, es csak akkor sul el,
 * amikor a valodi bemenet hianyzik.
 *
 * MERVE AZ ELES ADATBAZISON (acrobot, 2026-09-22 21:15): nyolc felhasznalo, a
 * ket partner-fioknak VAN `customerId` erteke, a hat belsonek mind a ketto
 * `null`. A `supplierId` ma minden soron `null` -- ALLAPOT, nem szerkezet,
 * ezert olvassuk azt is.
 */
export type Hatokor =
  | { kind: "internal" }
  | { kind: "customer"; customerId: string }
  | { kind: "supplier"; supplierId: string };

export interface HatokorEredmeny {
  hatokor: Hatokor;
  /**
   * IGAZ, ha a valaszban EGYIK mezo sem allt, tehat a hatokort nem a szerver
   * mondta meg, hanem a szerepbol becsultuk. Aki naplot ir vagy hibat keres,
   * EBBOL tudja meg, hogy a dontes nem mert adaton all.
   */
  bizonytalan: boolean;
}

export function hatokorAValaszbol(
  user: Pick<AuthenticatedUser, "role" | "customerId" | "supplierId">,
): HatokorEredmeny {
  const vanMezo =
    user.customerId !== undefined || user.supplierId !== undefined;

  if (!vanMezo)
    return {
      hatokor:
        user.role === "PARTNER_SERVICE"
          ? { kind: "customer", customerId: "" }
          : { kind: "internal" },
      bizonytalan: true,
    };

  /**
   * A KET MEZO EGYSZERRE NEM ALLHAT. A szerver ilyenkor DOB (adathiba, nem
   * jogosultsagi kerdes). A telefon nem dobhat egy kepernyo kozepén, ezert a
   * SZUKEBB ertelmezest valasztja: partnernek veszi. Az irany ugyanaz, mint
   * fent -- a tul szuk valasz hangos, a tul bo nema.
   */
  if (user.customerId)
    return {
      hatokor: { kind: "customer", customerId: user.customerId },
      bizonytalan: false,
    };
  if (user.supplierId)
    return {
      hatokor: { kind: "supplier", supplierId: user.supplierId },
      bizonytalan: false,
    };
  return { hatokor: { kind: "internal" }, bizonytalan: false };
}

/** Belsos iras: a szerver `requireInternalWriter`-je ezt engedi csak. */
export function belsosIrasEngedett(
  user: Parameters<typeof hatokorAValaszbol>[0],
): boolean {
  return hatokorAValaszbol(user).hatokor.kind === "internal";
}
