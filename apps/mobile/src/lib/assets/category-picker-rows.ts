/** Egy valaszthato kategoria: amit a szerver ad. */
export interface CategoryOption {
  id: string;
  name: string;
}

export interface CategoryPickerPlan {
  /** Ami a CSUKOTT soron all. */
  summary: string;
  /** A kinalt sorok, sorrendben. Az „Nincs megadva" gomb nem tartozik ide. */
  rows: CategoryOption[];
}

/**
 * MIT LAT A SZERELO A KATEGORIA-VALASZTOBAN.
 *
 * TISZTA FUGGVENY, ES NEM KENYELEMBOL: a mobilon NINCS komponens-teszt
 * keretrendszer, tehat ami a `.tsx`-ben marad, azt semmi nem tudja megmerni.
 * Ugyanaz az alak, mint a helyszin-valasztonal (`unitPickerPlan`).
 *
 * A KERDES, AMIT ELDONT: mi tortenik, ha az eszkozon KIVEZETETT kategoria all.
 * A valaszto a torzsadat AKTIV sorait kapja, tehat a kivezetett nincs kozottuk.
 * Ket rossz valasz van, es mind a ketto CSENDES:
 *
 *   ures csukott sor   -> a szerelo azt hiszi, nincs kategoria, es valaszt
 *                         egyet: egy ervenyes erteket ir felul vakon
 *   csak a csukott sor -> latja, mi all rajta, de ha kinyitja es meggondolja
 *                         magat, NEM tudja visszaallitani
 *
 * Ezert a kivezetett ertek a LISTABA is bekerul, megjelolve, es a lista ELEJEN
 * -- ott, ahol a szerelo a mostani erteket keresi.
 */
export function categoryPickerPlan(input: {
  options: readonly CategoryOption[];
  value: string;
  /** Ami MOST az eszkozon all, neven nevezve. A felvitelen nincs ilyen. */
  currentName?: string;
}): CategoryPickerPlan {
  const valasztott = input.options.find((item) => item.id === input.value);
  if (valasztott) return { summary: valasztott.name, rows: [...input.options] };

  /**
   * NINCS A LISTABAN, DE VAN ERTEKE: kivezetett kategoria all az eszkozon.
   *
   * A NEV NELKULI eset kulon ag: ha a hivo nem tudja a nevet (regi mentett
   * lap), az AZONOSITO kerul ki. Az sem szep, de IGAZ -- a „Nincs megadva"
   * ott hazudna.
   */
  if (input.value !== "") {
    const nev = input.currentName ?? input.value;
    return {
      summary: nev,
      rows: [
        { id: input.value, name: `${nev} (kivezetett)` },
        ...input.options,
      ],
    };
  }

  return { summary: "Nincs megadva", rows: [...input.options] };
}
