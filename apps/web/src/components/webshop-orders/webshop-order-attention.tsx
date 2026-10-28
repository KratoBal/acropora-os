"use client";
import Link from "next/link";
import type {
  WebshopOrderAttentionItem,
  WebshopOrderAttentionResponse,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { webshopOrdersApi } from "@/lib/api/webshop-orders";

/**
 * A FIGYELMET KÉRŐ RENDELÉSEK PANELJE (commerce-audit-p1, P1/6; acrobot
 * 2026-10-27: "az OS-be bejegyzés, a bolt ott dolgozik"). A webshop egy dolgot
 * jelez, csak jelzésként: egy vegyes kosár bolti (élő állatos) rendelése
 * hiányzik, miközben a kártyán a zárolás megvan. A lejárt előre utalást NEM
 * itt jelezzük: az a díjbekérő saját határidejéből, a listán ("Lejárt
 * díjbekérő") látszik. A lezárás emberi döntés: a rendszer semmit nem zár.
 *
 * KÜLÖN KÉRÉS, ÉS EZ SZÁNDÉK: a rendelés-lista ettől nem függ. Ha a webshop
 * még nem ismeri a végpontot (404), a panel semmit nem mutat (acrobot,
 * 2026-10-27 17:02: a webshop éles telepítése befagyasztva áll, a szürke sor
 * zaj lenne). Ha hibát ad vagy nincs kapcsolat, kimondja, hogy a lista nem
 * olvasható, és ez nem azt jelenti, hogy nincs teendő.
 */
const KIND_TEXT: Record<WebshopOrderAttentionItem["kind"], string> = {
  pickup_missing: "hiányzik a bolti (élő állatos) rendelés",
};

/** A várakozás emberi alakja: a webshop percben adja. */
export function waitingText(item: WebshopOrderAttentionItem): string {
  if (item.waiting < 60) return `${item.waiting} perce`;
  const hours = Math.floor(item.waiting / 60);
  if (hours < 48) return `${hours} órája`;
  return `${Math.floor(hours / 24)} napja`;
}

/** A leállítás napja magyar alakban; érvénytelen vagy hiányzó időnél üres. */
export function stoppedDateText(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("hu-HU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
}

export function WebshopOrderAttention({ token }: { token: string }) {
  const [data, setData] = useState<WebshopOrderAttentionResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    webshopOrdersApi
      .attention(token, controller.signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setData({ available: false, reason: "error", count: 0, items: [] });
      });
    return () => controller.abort();
  }, [token]);

  if (!data) return null;

  if (!data.available) {
    // 404: a webshop még nem ismeri a végpontot. A webshop éles telepítése
    // befagyasztva áll, ez várt állapot, és egy szürke sor minden megnyitáskor
    // zaj lenne (acrobot, 2026-10-27 17:02): semmit nem mutatunk.
    if (data.reason === "not_found") return null;
    // Hiba vagy nincs kapcsolat: a lista nem olvasható. Ezt kimondjuk, mert egy
    // néma panel "nincs teendő"-nek látszana.
    return (
      <p
        role="status"
        data-testid="figyelem-nem-elerheto"
        className="text-xs text-pilot-grey-500"
      >
        A figyelmet kérő rendelések most nem olvashatók a webshopból. Ez nem azt
        jelenti, hogy nincs teendő.
      </p>
    );
  }
  if (data.count === 0) return null;

  return (
    <section
      role="status"
      aria-label="Figyelmet kérő rendelések"
      data-testid="figyelem-panel"
      className="rounded border border-pilot-amber-700 bg-pilot-amber-50 px-4 py-3"
    >
      <h2 className="text-sm font-semibold text-pilot-amber-700">
        Figyelmet kér: {data.count} rendelés
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-pilot-grey-700">
        {data.items.map((item) => (
          <li
            key={`${item.kind}-${item.orderId ?? item.since}`}
            data-testid="figyelem-sor"
            data-kind={item.kind}
            data-retry-stopped={item.retryStopped ? "true" : undefined}
          >
            {item.orderId ? (
              <Link
                href={`/webshop/rendelesek/${encodeURIComponent(item.orderId)}`}
                className="font-semibold underline"
              >
                {item.displayId !== null ? `#${item.displayId}` : "Rendelés"}
              </Link>
            ) : (
              <span className="font-semibold">
                {item.displayId !== null ? `#${item.displayId}` : "Rendelés"}
              </span>
            )}
            : {KIND_TEXT[item.kind]}, {waitingText(item)}
            {item.retryStopped ? (
              <span data-testid="figyelem-leallitva">
                {" "}
                Az ismételt próbálkozás leállítva
                {stoppedDateText(item.retryStopped.at)
                  ? ` (${stoppedDateText(item.retryStopped.at)})`
                  : ""}
                {item.retryStopped.reason
                  ? `: ${item.retryStopped.reason}`
                  : ""}
                . A kártyás zárolás feloldása vagy visszatérítése emberi döntés.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
