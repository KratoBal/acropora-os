"use client";

import { Button, Card, Input } from "@acropora/ui";
import type { WorksheetLineInput } from "@acropora/types";

import { formatAmount } from "./worksheet-labels";

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
export function toLineInput(line: WorksheetLineDraft): WorksheetLineInput {
  return {
    description: line.description.trim(),
    detail: line.detail.trim() ? line.detail.trim() : null,
    quantity: Number(line.quantity),
    unit: line.unit.trim(),
    unitNet: Number(line.unitNet),
    vatRatePercent: Number(line.vatRatePercent),
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
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-2 border-b pb-3 last:border-0 last:pb-0 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
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
            <Input
              aria-label={`${index + 1}. tétel mennyisége`}
              value={line.quantity}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) =>
                update(index, { quantity: event.target.value })
              }
            />
            <Input
              aria-label={`${index + 1}. tétel mértékegysége`}
              value={line.unit}
              disabled={disabled}
              onChange={(event) => update(index, { unit: event.target.value })}
            />
            <Input
              aria-label={`${index + 1}. tétel egységára`}
              value={line.unitNet}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) =>
                update(index, { unitNet: event.target.value })
              }
            />
            <Input
              aria-label={`${index + 1}. tétel ÁFA-kulcsa`}
              value={line.vatRatePercent}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) =>
                update(index, { vatRatePercent: event.target.value })
              }
            />
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
