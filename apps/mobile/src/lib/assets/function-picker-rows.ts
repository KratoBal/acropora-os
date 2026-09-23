/** Egy valaszthato funkcio: amit a szerver ad. */
export interface FunctionOption {
  id: string;
  name: string;
}

export interface FunctionPickerPlan {
  /** Ami a CSUKOTT soron all. */
  summary: string;
  /** A kinalt sorok, sorrendben. Az „Nincs megadva" gomb nem tartozik ide. */
  rows: FunctionOption[];
}

/**
 * MIT LAT A SZERELO A FUNKCIO-VALASZTOBAN -- SZO SZERINT A
 * `categoryPickerPlan` SZERKEZETE, mas torzsadaton.
 *
 * Kanban 68add892, 2026-09-22: Balazs kerese szerint a funkcio-legordulo
 * "ugyanugy" viselkedjen, mint a kategoriae. FUGGETLEN a kategoriatol, lasd
 * az `AssetFunction` fejleceit -- nincs kozottuk kapcsolat.
 */
export function functionPickerPlan(input: {
  options: readonly FunctionOption[];
  value: string;
  /** Ami MOST az eszkozon all, neven nevezve. A felvitelen nincs ilyen. */
  currentName?: string;
}): FunctionPickerPlan {
  const valasztott = input.options.find((item) => item.id === input.value);
  if (valasztott) return { summary: valasztott.name, rows: [...input.options] };

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
