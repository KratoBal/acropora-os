/**
 * A méretekből számolt liter, függetlenül a fetch/SecureStore rétegtől -- ugyanaz
 * az elv, mint az `asset-fields.ts`-nél: tiszta `tsc` + `node --test` teszteli.
 *
 * A szerver `Aquarium.systemVolumeLiters` oszlopa `Decimal(12, 3)`, ezért a
 * kerekítés itt is 3 tizedesig megy: egy negyedik tizedesnyi eltérés a mentéskor
 * úgyis levágódna, és a felvitel közben mutatott javaslat ne ígérjen többet, mint
 * amennyi végül megmarad.
 *
 * EZ CSAK JAVASLAT, NEM AUTORITATÍV ÉRTÉK: a felhasználó felülírhatja, és a
 * kézi/számolt megkülönböztetés (melyik marad meg egy későbbi méretmódosításnál)
 * a szerver DTO-jának a mezője -- azt onnan importáljuk, ha megvan, nem itt
 * találjuk ki.
 */
export function calculatedVolumeLiters(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
): number {
  const liters = (lengthCm * widthCm * heightCm) / 1000;
  return Math.round(liters * 1000) / 1000;
}

/**
 * A HAROM MERET EGYUTT KELL. Ha barmelyik hianyzik vagy nem pozitiv szam, nincs
 * mit szamolni -- a felulet ilyenkor a kezi liter-mezot kinalja, nem egy hibas
 * javaslatot.
 */
export function volumeLitersFromDimensions(
  lengthCm: number | null,
  widthCm: number | null,
  heightCm: number | null,
): number | null {
  if (
    lengthCm === null ||
    widthCm === null ||
    heightCm === null ||
    !(lengthCm > 0) ||
    !(widthCm > 0) ||
    !(heightCm > 0)
  )
    return null;
  return calculatedVolumeLiters(lengthCm, widthCm, heightCm);
}
