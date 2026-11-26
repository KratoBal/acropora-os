"use client";

import Link from "next/link";
import {
  PilotBadge,
  PilotCard,
  PilotCardHeader,
  pilotBadgeVariantForTone,
} from "@acropora/ui";
import {
  partnerWorksheetVersionLabel,
  worksheetListLines,
  worksheetStatusTone,
  type ServiceJobLinkedWorksheet,
} from "@acropora/types";

import { Message } from "./ticket-list";

/**
 * A KARBANTARTÁSI LAPHOZ KAPCSOLT MUNKALAPOK A PARTNER PORTÁLON (kártya efe02c6f). A belső lap kártyájának
 * (`apps/web/.../pilot-linked-worksheets-card.tsx`) és a lap PDF-jének („Kapcsolódó munkalapok (munkaóra és ár nélkül)”)
 * párja, CSAK OLVASÁSRA: a hozzákapcsolás és a levétel belső művelet, a szerver a partnernek 404-et ad rá.
 *
 * A lista a szerveré, és ugyanazt mondja, amit a PDF és a csomag: a partner a saját egységei munkalapjait látja, rejtettet
 * soha (`linkedWorksheetReadWhere`), és azt sem, ki kapcsolta. A sor a munkalap saját adatlapjára visz (`/munkalapok/<id>`),
 * ugyanazzal az egység-szabállyal, tehát a link nem vezet tiltott lapra.
 *
 * A „csak hivatkozás” mondat azért áll itt is, mert egy lap alatti munkalap-lista azt sugallja, hogy a munkájuk ennek a
 * lapnak a része; a munkalap a helyén marad, és ennek a lapnak semmilyen összegébe nem számít bele.
 */
export const PARTNER_LINKED_WORKSHEETS_NOTICE =
  "Hivatkozás: a munkalap a saját helyén marad, és ennek a karbantartási lapnak semmilyen összegébe nem számít bele.";

const day = new Intl.DateTimeFormat("hu-HU", { dateStyle: "long" });

export function LinkedWorksheetsCard({
  items,
  error,
  retry,
}: {
  /** `null`, amíg a lista nem jött meg */
  items: readonly ServiceJobLinkedWorksheet[] | null;
  error: string | null;
  retry: () => Promise<void>;
}) {
  return (
    <PilotCard>
      <PilotCardHeader title="Kapcsolódó munkalapok" />
      <p
        className="border-b border-pilot-grey-50 px-5 py-3 text-xs text-pilot-grey-500"
        data-testid="linked-worksheets-notice"
      >
        {PARTNER_LINKED_WORKSHEETS_NOTICE}
      </p>
      <div className="px-5 py-3">
        {error ? (
          <Message tone="error" text={error} retry={retry} />
        ) : items === null ? (
          <p className="py-2 text-sm text-pilot-grey-400">
            Kapcsolódó munkalapok betöltése…
          </p>
        ) : items.length === 0 ? (
          <p className="py-2 text-sm italic text-pilot-grey-500">
            Nincs kapcsolódó munkalap.
          </p>
        ) : (
          <ul className="divide-y divide-pilot-grey-50">
            {items.map((item) => {
              const lines = worksheetListLines(item);
              return (
                <li
                  key={item.worksheetId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm"
                  data-testid="linked-worksheet"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      className="break-words font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                      href={`/munkalapok/${item.worksheetId}`}
                    >
                      {lines.main}
                    </Link>
                    {lines.detail ? (
                      <span className="block text-xs text-pilot-grey-500">
                        {lines.detail}
                      </span>
                    ) : null}
                    <span className="block text-xs text-pilot-grey-400">
                      {item.departmentPath?.join(" / ") ?? "Helyszín nélkül"}
                      {" · "}
                      megnyitva: {day.format(new Date(item.createdAt))}
                      {item.homeJobNumber
                        ? ` · a(z) ${item.homeJobNumber} alatt áll`
                        : ""}
                    </span>
                  </div>
                  <PilotBadge
                    variant={pilotBadgeVariantForTone(
                      worksheetStatusTone(item.status),
                    )}
                  >
                    {partnerWorksheetVersionLabel[item.status]}
                  </PilotBadge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PilotCard>
  );
}
