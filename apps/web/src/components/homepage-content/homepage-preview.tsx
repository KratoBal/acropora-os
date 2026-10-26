"use client";

import { PilotCallout, PilotCard } from "@acropora/ui";
import { HOMEPAGE_BLOCK_KEYS, type HomepageBlockKey } from "@acropora/types";
import { useEffect, useRef, useState } from "react";

import {
  PREVIEW_MESSAGE,
  PREVIEW_PATH,
  PREVIEW_PROTOCOL_VERSION,
  readPreviewMessage,
  type PreviewRecord,
} from "./homepage-preview-protocol";

/** Without a ready message in this time the frame is said not to answer. */
export const PREVIEW_READY_TIMEOUT_MS = 8000;
const SEND_DELAY_MS = 300;

/**
 * THE RIGHT COLUMN, "Élő előnézet" (Balázs's brief, 5. pont; Figma 685:535):
 * the REAL test storefront in a frame, never an imitation. The unsaved content
 * goes to the frame in a message (protocol v1) and is never stored; the saved
 * state is what "Előnézet új lapon" opens.
 *
 * Both directions check the exact origin, and `targetOrigin` is never `*`. The
 * frame answers "ready" when it can draw; until then nothing is sent, and if it
 * never answers the panel says so instead of showing a blank frame.
 */
export function HomepagePreview({
  storefrontUrl,
  record,
  selected,
  onSelect,
}: {
  storefrontUrl: string | null;
  record: PreviewRecord;
  selected: HomepageBlockKey | null;
  onSelect: (key: HomepageBlockKey) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [phone, setPhone] = useState(false);
  const [state, setState] = useState<"connecting" | "ready" | "silent">(
    "connecting",
  );
  const [refused, setRefused] = useState<string | null>(null);
  /* counts the ready messages, so a reloaded frame gets the content again */
  const [readyCount, setReadyCount] = useState(0);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!storefrontUrl) return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== storefrontUrl) return;
      if (event.source !== frame.current?.contentWindow) return;
      const message = readPreviewMessage(event.data);
      if (!message) return;
      if (message.type === "ready") {
        setState("ready");
        setRefused(null);
        setReadyCount((n) => n + 1);
      } else if (message.type === "error") setRefused(message.message);
      else if (
        (HOMEPAGE_BLOCK_KEYS as readonly string[]).includes(message.block)
      )
        onSelectRef.current(message.block as HomepageBlockKey);
    };
    window.addEventListener("message", listen);
    const silent = window.setTimeout(
      () => setState((now) => (now === "connecting" ? "silent" : now)),
      PREVIEW_READY_TIMEOUT_MS,
    );
    return () => {
      window.removeEventListener("message", listen);
      window.clearTimeout(silent);
    };
  }, [storefrontUrl]);

  useEffect(() => {
    if (!storefrontUrl || state !== "ready") return;
    const send = window.setTimeout(() => {
      frame.current?.contentWindow?.postMessage(
        {
          type: PREVIEW_MESSAGE.content,
          version: PREVIEW_PROTOCOL_VERSION,
          record,
        },
        storefrontUrl,
      );
    }, SEND_DELAY_MS);
    return () => window.clearTimeout(send);
  }, [storefrontUrl, state, record, readyCount]);

  useEffect(() => {
    if (!storefrontUrl || state !== "ready") return;
    frame.current?.contentWindow?.postMessage(
      {
        type: PREVIEW_MESSAGE.select,
        version: PREVIEW_PROTOCOL_VERSION,
        block: selected,
      },
      storefrontUrl,
    );
  }, [storefrontUrl, state, selected, readyCount]);

  return (
    <PilotCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          Élő előnézet
        </h2>
        <div role="group" aria-label="Előnézet mérete" className="flex gap-1">
          {(
            [
              [false, "Asztali"],
              [true, "Telefon"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={phone === value}
              onClick={() => setPhone(value)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                phone === value
                  ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                  : "bg-pilot-grey-100 text-pilot-grey-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-pilot-grey-500">
        Teszt webshop · kezdőlap · a mentetlen módosításokkal
      </p>
      {!storefrontUrl ? (
        <div className="mt-4">
          <PilotCallout
            tone="warm"
            title="A teszt kirakat címe ebben a környezetben nincs beállítva."
            description="Az élő előnézethez a HOMEPAGE_STOREFRONT_URL kell (csak ott, ahol a webshopba küldés engedélyezett). A szerkesztés és a mentés így is működik."
          />
        </div>
      ) : (
        <>
          {state === "silent" ? (
            <div className="mt-4">
              <PilotCallout
                tone="warm"
                title="A teszt kirakat előnézeti oldala nem válaszol."
                description="A kirakat oldali előnézeti útvonal még nincs telepítve, vagy nincs bekapcsolva (HOMEPAGE_PREVIEW_ENABLED). Az „Előnézet új lapon” a mentett állapotot mutatja."
              />
            </div>
          ) : null}
          {refused ? (
            <div className="mt-4">
              <PilotCallout
                tone="warm"
                title="A kirakat nem fogadta el az előnézeti tartalmat."
                description={refused}
              />
            </div>
          ) : null}
          <div className="mt-4 flex justify-center overflow-hidden rounded-lg ring-1 ring-pilot-grey-200">
            <iframe
              ref={frame}
              title="A teszt kirakat kezdőlapjának élő előnézete"
              src={`${storefrontUrl}${PREVIEW_PATH}`}
              referrerPolicy="no-referrer"
              className={`h-[720px] bg-white ${phone ? "w-[390px]" : "w-full"}`}
            />
          </div>
        </>
      )}
    </PilotCard>
  );
}
