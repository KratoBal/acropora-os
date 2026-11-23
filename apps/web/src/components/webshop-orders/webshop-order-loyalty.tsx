"use client";
import {
  isLoyaltyPoints,
  WEBSHOP_LOYALTY_REASON_MAX,
  type WebshopLoyaltyAdjustmentInput,
  type WebshopLoyaltyAdjustmentResult,
  type WebshopLoyaltyEntry,
  type WebshopOrderLoyalty,
} from "@acropora/types";
import { useEffect, useRef, useState } from "react";

import { PilotButton, PilotInput } from "@/components/pilot/pilot-ui";
import { formatDateTimeHu } from "@/lib/format/date";

import { Shell, useSave } from "./webshop-order-edits";

/**
 * A HŰSÉGPONTOK KÁRTYÁJA A RENDELÉS ADATLAPJÁN (kártya dfb79916, második szelet). A főkönyv a webshopé: itt az egyenleg és
 * a legújabb sorok látszanak, és innen lehet kézzel jóírni vagy levonni. Vendég rendelésnél nincs főkönyv: a kártya ezt
 * mondja ki, nem nullát mutat (az úgy olvasódna, mintha a vevőnek nem lenne pontja).
 */
export type LoyaltyCardApi = {
  load: () => Promise<WebshopOrderLoyalty>;
  adjust: (
    input: WebshopLoyaltyAdjustmentInput & { requestId: string },
  ) => Promise<WebshopLoyaltyAdjustmentResult>;
};

/** A sor neve a fajtából és az előjelből: a kézi mozgás előjele dönti el, jóírás vagy levonás. */
export function loyaltyEntryLabel(
  entry: Pick<WebshopLoyaltyEntry, "kind" | "points">,
): string {
  switch (entry.kind) {
    case "accrual":
      return "Gyűjtés";
    case "redemption":
      return "Beváltás";
    case "reversal":
      return "Visszavonás";
    case "adjustment":
      return entry.points > 0 ? "Kézi jóírás" : "Kézi levonás";
    default:
      return entry.kind;
  }
}

/** A pont előjellel: `+200`, `−50` (valódi mínusz jel). */
export function signedPoints(points: number): string {
  return `${points > 0 ? "+" : "−"}${Math.abs(points).toLocaleString("hu-HU")}`;
}

/** A beírt pontszám: egész, nem nulla; az elejére tett `+` megengedett. `null`, ha nem az. */
export function parsePointsInput(text: string): number | null {
  const match = /^([+\-−])?(\d+)$/.exec(text.trim());
  if (!match) return null;
  const value =
    Number(match[2]) * (match[1] === "-" || match[1] === "−" ? -1 : 1);
  return isLoyaltyPoints(value) ? value : null;
}

const newRequestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function AdjustDialog({
  adjust,
  onClose,
  onDone,
}: {
  adjust: LoyaltyCardApi["adjust"];
  onClose: () => void;
  onDone: (result: WebshopLoyaltyAdjustmentResult) => void;
}) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  // one id per opening of the dialog: a double click or a retry stores one row (the shop's idempotency key)
  const requestId = useRef(newRequestId());
  const { busy, error, save } = useSave(onClose);
  const value = parsePointsInput(points);
  const cleanReason = reason.trim();
  const valid =
    value !== null &&
    cleanReason.length > 0 &&
    cleanReason.length <= WEBSHOP_LOYALTY_REASON_MAX;
  return (
    <Shell
      title="Pont jóváírása vagy levonása"
      busy={busy}
      error={error}
      onClose={onClose}
      saveDisabled={!valid}
      onSave={() =>
        save(async () => {
          if (value === null) return;
          onDone(
            await adjust({
              points: value,
              reason: cleanReason,
              requestId: requestId.current,
            }),
          );
        })
      }
    >
      <label className="block text-xs text-pilot-grey-500">
        Pont (jóíráshoz pozitív, levonáshoz negatív egész szám)
        <PilotInput
          aria-label="Pont"
          inputMode="numeric"
          value={points}
          onChange={setPoints}
          className="mt-1"
        />
      </label>
      <label className="block text-xs text-pilot-grey-500">
        Indok
        <PilotInput
          aria-label="Indok"
          value={reason}
          onChange={setReason}
          className="mt-1"
        />
      </label>
      <p className="text-xs text-pilot-grey-500">
        A mozgás azonnal módosítja a vevő egyenlegét. A bejegyzés nem törölhető,
        egy tévedést ellenkező előjelű mozgás javít. Az indokot a vevő nem
        látja.
      </p>
    </Shell>
  );
}

export function WebshopOrderLoyalty({
  api,
  canManage,
}: {
  api: LoyaltyCardApi;
  canManage: boolean;
}) {
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; loyalty: WebshopOrderLoyalty }
  >({ phase: "loading" });
  const [adjusting, setAdjusting] = useState(false);
  // the page hands a new `api` object on every render: the card loads once per mount
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let alive = true;
    (async () => apiRef.current.load())().then(
      (loyalty) => alive && setState({ phase: "ready", loyalty }),
      (cause: unknown) =>
        alive &&
        setState({
          phase: "error",
          message:
            cause instanceof Error
              ? cause.message
              : "A hűségpont-egyenleg nem olvasható.",
        }),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === "loading")
    return <p className="text-sm text-pilot-grey-500">Betöltés…</p>;
  if (state.phase === "error")
    return (
      <p role="alert" className="text-sm text-pilot-red-700">
        {state.message}
      </p>
    );
  const { loyalty } = state;
  if (!loyalty.available)
    return (
      <p className="text-sm text-pilot-grey-500">
        Vendég rendeléshez nincs hűségpont-főkönyv: a pont a regisztrált vevőé.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-pilot-grey-900">
        Egyenleg:{" "}
        <strong data-testid="loyalty-balance">
          {loyalty.balance.toLocaleString("hu-HU")} pont
        </strong>
      </p>
      {loyalty.entries.length ? (
        <ul className="space-y-1" aria-label="Legutóbbi mozgások">
          {loyalty.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap justify-between gap-x-3 text-xs text-pilot-grey-500"
            >
              <span>
                {formatDateTimeHu(entry.createdAt)} · {loyaltyEntryLabel(entry)}
                {entry.reason ? ` · ${entry.reason}` : ""}
              </span>
              <span className="font-medium text-pilot-grey-900">
                {signedPoints(entry.points)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-pilot-grey-500">Még nincs mozgás.</p>
      )}
      {canManage ? (
        <PilotButton
          size="regular"
          variant="secondary"
          onClick={() => setAdjusting(true)}
        >
          Pont jóváírása vagy levonása
        </PilotButton>
      ) : null}
      {adjusting ? (
        <AdjustDialog
          adjust={api.adjust}
          onClose={() => setAdjusting(false)}
          onDone={(result) =>
            setState({ phase: "ready", loyalty: result.loyalty })
          }
        />
      ) : null}
    </div>
  );
}
