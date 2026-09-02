"use client";

import { Button, Card, Input } from "@acropora/ui";
import type { ReactNode } from "react";

import type { WorksheetLineInput } from "@acropora/types";

import { currencySuffix, formatAmount } from "./worksheet-labels";

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

/**
 * A sor nettója. Csak megjelenítés: a lapra kerülő összeget a szerver
 * számolja a sorokból, a kliens értékét nem veszi át. Ha a két szám
 * eltérne, a szerveré az igaz.
 */
function lineNet(line: WorksheetLineDraft): number {
  const quantity = Number(line.quantity);
  const unitNet = Number(line.unitNet);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitNet)) return 0;
  return quantity * unitNet;
}

export function linesNetTotal(lines: readonly WorksheetLineDraft[]): number {
  return lines.reduce((total, line) => total + lineNet(line), 0);
}

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
const COLUMNS = "md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]";

/** A keskeny nézet felirata. Széles nézetben a fejlécsor mondja ugyanezt. */
function NarrowLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-medium text-slate-500 md:hidden">
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
function Suffixed({
  suffix,
  children,
}: {
  suffix: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      <span className="shrink-0 text-xs text-slate-500">{suffix}</span>
    </div>
  );
}

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
        <h2 className="text-sm font-semibold text-slate-800">Tételek</h2>
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
        <p className="text-sm text-slate-500">
          Még nincs tétel. Tétel nélküli munkalap nem zárható le.
        </p>
      ) : null}
      {lines.length ? (
        <div
          className={`hidden gap-2 text-xs font-medium text-slate-500 md:grid ${COLUMNS}`}
          aria-hidden="true"
        >
          <span>Megnevezés</span>
          <span>Mennyiség</span>
          <span>Mértékegység</span>
          <span>Egységár</span>
          <span>ÁFA</span>
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
            <div className="space-y-1">
              <NarrowLabel>Egységár</NarrowLabel>
              <Suffixed suffix={currencySuffix()}>
                <Input
                  aria-label={`${index + 1}. tétel egységára`}
                  value={line.unitNet}
                  disabled={disabled}
                  inputMode="decimal"
                  onChange={(event) =>
                    update(index, { unitNet: event.target.value })
                  }
                />
              </Suffixed>
            </div>
            <div className="space-y-1">
              <NarrowLabel>ÁFA</NarrowLabel>
              <Suffixed suffix="%">
                <Input
                  aria-label={`${index + 1}. tétel ÁFA-kulcsa`}
                  value={line.vatRatePercent}
                  disabled={disabled}
                  inputMode="decimal"
                  onChange={(event) =>
                    update(index, { vatRatePercent: event.target.value })
                  }
                />
              </Suffixed>
            </div>
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
      {lines.length ? (
        <p className="text-right text-sm text-slate-600">
          Nettó összesen (előnézet):{" "}
          <strong className="tabular-nums">
            {formatAmount(String(linesNetTotal(lines)))}
          </strong>
        </p>
      ) : null}
    </Card>
  );
}
