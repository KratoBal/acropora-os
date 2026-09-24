import { Prisma } from "@acropora/database";

export type DecimalInput = Prisma.Decimal | number | string;

export interface AquariumVolumeInput {
  lengthCm: DecimalInput | null;
  widthCm: DecimalInput | null;
  heightCm: DecimalInput | null;
  /** A kliens által küldött literérték, akkor is, ha a mező hiányzott. */
  volumeLiters: DecimalInput | null;
  /** A kliens saját jelzése: EBBEN a mentésben a felhasználó írta-e át a litert. */
  isManual: boolean;
}

export interface AquariumVolumeResult {
  systemVolumeLiters: Prisma.Decimal | null;
  systemVolumeIsManual: boolean;
}

/**
 * A LITER SZÁMOLÁSA -- VAGY A KÉZI ÉRTÉK MEGŐRZÉSE.
 *
 * Balázs kérése (2026-09-24): a liter a három méretből (cm) SZÁMOLÓDIK
 * (hossz × szélesség × magasság / 1000), de kézzel is beírható, és "ha a
 * felhasználó átírta, a kézi érték marad" -- egy KÉSŐBBI méretmódosítás nem
 * írhatja felül csendben.
 *
 * A DÖNTÉS EGYETLEN JELZŐN MÚLIK, AMIT A HÍVÓ KÜLD (`isManual`), NEM A
 * KORÁBBI REKORD ÁLLAPOTÁN: a webes felület tudja, hogy a liter mezőt EBBEN
 * a mentésben a felhasználó írta-e át, vagy a mérettől automatikusan
 * frissült -- ha a szerkesztőn a hossz változik, de a liter mezőt senki nem
 * érinti, a felület magától küldi tovább `isManual: true`-val a korábbi
 * kézi értéket, ez a függvény pedig nem számol felül semmit. Enélkül a
 * szervernek a KORÁBBI rekordot kellene ismernie, és a "manuális módban
 * vagyunk, de a liter mező most éppen nem változott" eset szétválna a
 * "manuális módból most lépünk ki" esettől -- ugyanazzal a bemenettel.
 *
 * HA NINCS MIND A HÁROM MÉRET, NEM SZÁMOL: "Csak liter is menthető méretek
 * nélkül" (Balázs). Ilyenkor a kapott literérték változatlanul megy tovább,
 * a `isManual` jelzővel együtt -- ez fedi azt az esetet is, amikor tóhoz
 * nincs egyáltalán méret, csak egy kézzel becsült literszám.
 */
export function resolveAquariumVolume(
  input: AquariumVolumeInput,
): AquariumVolumeResult {
  if (
    !input.isManual &&
    input.lengthCm != null &&
    input.widthCm != null &&
    input.heightCm != null
  ) {
    const liters = new Prisma.Decimal(input.lengthCm)
      .mul(input.widthCm)
      .mul(input.heightCm)
      .div(1000);
    return { systemVolumeLiters: liters, systemVolumeIsManual: false };
  }
  return {
    systemVolumeLiters:
      input.volumeLiters != null
        ? new Prisma.Decimal(input.volumeLiters)
        : null,
    systemVolumeIsManual: input.isManual,
  };
}
