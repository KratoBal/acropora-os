"use client";

import { Button, Card, Input } from "@acropora/ui";

import type { WorksheetLineInput } from "@acropora/types";

export interface WorksheetLineDraft {
  description: string;
  detail: string;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
}

export function emptyLine(): WorksheetLineDraft {
  return {
    description: "",
    detail: "",
    quantity: "1",
    unit: "óra",
    unitNet: "0",
    vatRatePercent: "27",
  };
}

/**
 * A sorok szövegmezőkben élnek, nem számokban: egy félig beírt "1," vagy egy
 * kiürített mező számmá alakítva NaN lenne, és a felhasználó gépelés közben
 * kapna hibát olyanra, amit épp javítani készül. A számmá alakítás egy
 * helyen, a beküldéskor történik.
 */
/**
 * AZ ÜRES ÁRMEZŐ NEM NULLA, HANEM HIÁNY - és ez a különbség egy `Number("")`
 * hívásban veszne el.
 *
 * A `Number("")` értéke NULLA, nem `NaN`: egy üresen hagyott ármező csendben
 * nulla forintos tétellé válna, ami a lapon ÉRTÉKNEK látszik, nem hiánynak.
 * Aki ránéz, nem tudja megkülönböztetni az ingyenes munkától, és semmi nem
 * szól, ha valaki elfelejtette kitölteni.
 *
 * A fordító ezt nem fogja meg: a `Number("")` érvényes szám.
 */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

export function toLineInput(line: WorksheetLineDraft): WorksheetLineInput {
  return {
    description: line.description.trim(),
    detail: line.detail.trim() ? line.detail.trim() : null,
    quantity: Number(line.quantity),
    unit: line.unit.trim(),
    unitNet: optionalNumber(line.unitNet),
    vatRatePercent: optionalNumber(line.vatRatePercent),
  };
}

/*
  A `lineNet` ÉS A `linesNetTotal` 2026-09-17-ÉN KIKERÜLT.

  Mind a kettő a megjelenített összeget számolta, és az összeg már nem látszik
  (Balázs döntése). Mérve, mielőtt kivettem: a `linesNetTotal` exportált volt, és
  NULLA hívója állt más fájlban -- a szerkesztő-oldal és a komponens-teszt is
  csak az `emptyLine`, a `toLineInput`, a `WorksheetLineEditor` és a
  `WorksheetLineDraft` nevet importálja innen.

  A `purchasing` modulban is áll egy `lineNet`, de az SAJÁT függvénye
  (`InvoiceLineState` bemenettel), nem ez -- ezért nem lett belőle árva hívás.
*/

export interface WorksheetLineEditorProps {
  lines: WorksheetLineDraft[];
  onChange: (lines: WorksheetLineDraft[]) => void;
  disabled?: boolean;
}

/**
 * A NEGY RÖVID MEZŐ FELIRATA, ÉS MIÉRT KÉT KÜLÖN MÓDON.
 *
 * A hiba MOBILON tűnt fel (Balázs, 2026-08-21): széles képernyőn a mezők EGY
 * SORBAN állnak, és a sorrendjük sugallja a jelentésüket -- keskeny nézetben
 * viszont EGYMÁS ALÁ kerülnek, és ott a felhasználó négy számot lát egymás
 * alatt, kontextus nélkül.
 *
 * Ezért nem elég a fejlécsor: az a széles nézetben működik, mobilon nem, mert
 * a fejléc nem a mező mellett áll, hanem valahol fent. És nem elég a
 * placeholder sem: az pont akkor tűnik el, amikor a felhasználónak
 * ELLENŐRIZNIE kellene, amit beírt.
 *
 * A megoldás három rétegű, és mindegyik réteg más nézetben dolgozik:
 *  - az ÉRTÉK MELLETT álló jel (`%`, `Ft`) MINDKÉT nézetben,
 *  - fejlécsor a széles nézetben (a sor ismétlődik, a fejléc egyszer fizet),
 *  - mezőnkénti felirat a keskeny nézetben (ott úgyis egymás alatt vannak,
 *    tehát a felirat nem vesz el helyet a sorból).
 */
/**
 * A FEJLEC ES A RACS EGY FORRASBOL, MERT KETTO ELCSUSZOTT (merve 2026-09-17).
 *
 * A #811-ben kikerult az egysegar es az AFA beviteli mezoje, es a FEJLECSOR
 * ottmaradt: hat cimke allt negy cella folott. Rendereelve merve: a "Torles"
 * gomb az "Egysegar" oszlop ala esett, ket cimke pedig a semmi fole.
 *
 * NEM A FIGYELMEM HIANYZOTT: ugyanaz a szabaly KET helyen allt (a racs-osztaly
 * es a fejlec felsorolasa), es amikor az egyiket atirtam, a masik nem szolt.
 * Es a sajat tesztem ORIZTE a hibat: nev szerint allitotta, hogy az "Egysegar"
 * cimke ott van.
 *
 * Mostantol a fejlec EBBOL a tombbol keletkezik. A racs-osztaly Tailwind miatt
 * literal marad (a JIT nem lat osszefuzott osztalynevet) -- azt a komponens
 * teszt koti ossze: a racs oszlopainak szama legyen `MEZO_FEJLECEK.length + 1`.
 */
const MEZO_FEJLECEK = ["Megnevezés", "Mennyiség", "Mértékegység"] as const;

const COLUMNS = "md:grid-cols-[2fr_1fr_1fr_auto]";

/** A keskeny nézet felirata. Széles nézetben a fejlécsor mondja ugyanezt. */
function NarrowLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-medium text-dusk-500 md:hidden">
      {children}
    </span>
  );
}

/**
 * A JEL A MEZŐ MELLETT ÁLL, NEM AZ ÉRTÉKBEN.
 *
 * Ha a mező tartalma `27 %` lenne, azt vissza kellene fejteni számmá, és az
 * első elgépelésnél elszállna. Az érték szám marad; a jel a szeme mellett áll.
 */

export function WorksheetLineEditor({
  lines,
  onChange,
  disabled,
}: WorksheetLineEditorProps) {
  const update = (index: number, patch: Partial<WorksheetLineDraft>) => {
    onChange(
      lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    );
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dusk-800">Tételek</h2>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange([...lines, emptyLine()])}
        >
          Új tétel
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-dusk-500">
          Még nincs tétel. Tétel nélküli munkalap nem zárható le.
        </p>
      ) : null}
      {lines.length ? (
        <div
          className={`hidden gap-2 text-xs font-medium text-dusk-500 md:grid ${COLUMNS}`}
          aria-hidden="true"
        >
          {MEZO_FEJLECEK.map((fejlec) => (
            <span key={fejlec}>{fejlec}</span>
          ))}
          {/* A törlés gomb oszlopa: fejléc nélkül, de a rácsban helyet foglal. */}
          <span />
        </div>
      ) : null}
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`grid gap-2 border-b pb-3 last:border-0 last:pb-0 ${COLUMNS}`}
          >
            <div className="space-y-2">
              <Input
                aria-label={`${index + 1}. tétel megnevezése`}
                value={line.description}
                disabled={disabled}
                placeholder="Megnevezés"
                onChange={(event) =>
                  update(index, { description: event.target.value })
                }
              />
              <Input
                aria-label={`${index + 1}. tétel kiegészítő sora`}
                value={line.detail}
                disabled={disabled}
                placeholder="Kiegészítő sor (pl. gépazonosító)"
                onChange={(event) =>
                  update(index, { detail: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <NarrowLabel>Mennyiség</NarrowLabel>
              <Input
                aria-label={`${index + 1}. tétel mennyisége`}
                value={line.quantity}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) =>
                  update(index, { quantity: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              {/* A mértékegységnek nincs jele: a mező TARTALMA maga a jel
                  (`óra`, `db`), tehát egy melléírt egység csak ismételné. */}
              <NarrowLabel>Mértékegység</NarrowLabel>
              <Input
                aria-label={`${index + 1}. tétel mértékegysége`}
                value={line.unit}
                disabled={disabled}
                onChange={(event) =>
                  update(index, { unit: event.target.value })
                }
              />
            </div>
            {/*
              AZ EGYSÉGÁR ÉS AZ ÁFA BEVITELE 2026-09-17-ÉN KIKERÜLT INNEN.

              Balázs kérése: a nettó, bruttó és áfa mezők ne jelenjenek meg sem
              a weben, sem az appban. Két utat tettünk elé, és a "B"-t
              választotta: tűnjenek el mindenhonnan, és akkor a lezárásból is ki
              kell venni az ár-feltételt (#809, beolvadt).

              AMI SZÁNDÉKOSAN NEM VÁLTOZOTT: a `WorksheetLineDraft` továbbra is
              TARTJA a `unitNet` és `vatRatePercent` értéket, a betöltés kiolvassa
              a szerverről, és a `toLineInput` VISSZAKÜLDI. Balázs kifejezetten
              azt kérte, hogy "ne töröljük ezeket" -- és egy szerkesztés, ami a
              mezőt nem küldi vissza, NÉMÁN törölné a meglévő árat: a lap
              tartalma teljes, a mentés sikeres, és az érték eltűnik.

              EZT EGY ŐRZŐ MÉRI (`worksheet-line-price-megorzes.component.test.tsx`).
              Ha valaki egyszer "takarítja" a draftot -- jó szándékkal, mert a
              mező már nem látszik --, az a teszt pirosodik ki.
            */}
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`${index + 1}. tétel törlése`}
              onClick={() =>
                onChange(lines.filter((_, position) => position !== index))
              }
            >
              Törlés
            </Button>
          </div>
        ))}
      </div>
      {/*
        A "Nettó összesen (előnézet)" sor ugyanabban a körben került ki: az ár
        nem látszik, tehát egy belőle számolt összeg sem.
      */}
    </Card>
  );
}
