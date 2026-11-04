"use client";

import { Alert, PilotBadge, PilotSection, PilotButton } from "@acropora/ui";
import type { ProductDetail } from "@acropora/types";
import { useState } from "react";

import { productApi } from "@/lib/api/products";

import {
  TAKEOVER_EDITABLE,
  TAKEOVER_FROZEN,
  TAKEOVER_PRICE_NOTE,
  TAKEOVER_UNTOUCHED,
} from "./takeover-scope";

/** Egy felsorolás a `takeover-scope` egyik listájából, címmel. */
function ScopeList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-pilot-grey-900">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-pilot-grey-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ki gondozza a termék törzsadatát, és hogyan vesszük át.
 *
 * A kártya akkor is látszik, amikor nincs mit tenni: az, hogy egy terméket a
 * webshop gondoz, ugyanolyan fontos információ, mint az átvétel lehetősége.
 * Ha csak az átvehető termékeknél jelenne meg, a hiánya kétértelmű lenne -
 * nem tudnánk, hogy nincs jogunk hozzá, vagy már a miénk a termék.
 */
export function ProductAuthorityCard({
  token,
  product,
  canTransfer,
  onTransferred,
}: {
  token: string;
  product: ProductDetail;
  canTransfer: boolean;
  onTransferred: (product: ProductDetail) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authority = product.catalogAuthority;

  const take = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onTransferred(await productApi.takeCatalogAuthority(token, product.id));
      setConfirming(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A törzsadat átvétele nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotSection
      title="Katalógusgazda"
      subtitle="Ki az elsődleges forrás a termék törzsadataihoz?"
      action={
        <PilotBadge
          variant={
            authority === "ACROPORA"
              ? "teal"
              : authority === "UNAS"
                ? "blue"
                : "amber"
          }
        >
          {authority === "ACROPORA"
            ? "Acropora OS"
            : authority === "UNAS"
              ? "UNAS webshop"
              : "Ellenőrzendő"}
        </PilotBadge>
      }
      bodyClassName="space-y-3 px-5 py-5"
    >
      {authority === "ACROPORA" ? (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-pilot-grey-600">
            A webshop-szinkron ezt a terméket teljes egészében kihagyja, tehát
            egy UNAS oldali módosítás semmit nem ír felül rajta.
          </p>
          <ScopeList title="Itt szerkesztjük" items={TAKEOVER_EDITABLE} />
          <ScopeList
            title="Az átvételkori UNAS-értéken áll, szerkesztő még nincs rá"
            items={TAKEOVER_FROZEN}
          />
        </div>
      ) : null}

      {authority === "UNAS" ? (
        <p className="text-sm leading-6 text-pilot-grey-600">
          A nevet és a leírást a webshop szinkronja gondozza, ezért itt nem
          szerkeszthető.
        </p>
      ) : null}

      {authority === null ? (
        <p className="text-sm leading-6 text-pilot-grey-600">
          Erről a termékről nem tudjuk, ki a törzsadat gazdája, ezért sem
          szerkeszteni, sem átvenni nem lehet. Ez adatállapot, nem jogosultsági
          kérdés.
        </p>
      ) : null}

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      {authority === "UNAS" && canTransfer ? (
        confirming ? (
          /*
            A megerősítés MEGNEVEZI a következményt, nem azt kérdezi, hogy
            biztos-e. A veszély itt nem az adatvesztés, hanem a csend: az
            átvétel után egy UNAS oldali javítás nem érkezik meg, és ez sehol
            nem fog hibaüzenetként jelentkezni.
          */
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/70 p-3">
            <p className="text-sm text-dusk-800">
              Az átvétel után a webshop-szinkron{" "}
              <strong>egyáltalán nem írja</strong> ezt a terméket, nem csak a
              nevét és a leírását. Ha valaki a UNAS felületén javít rajta
              valamit, az a javítás ide már nem érkezik meg, és erről nem kapunk
              értesítést.
            </p>
            <ScopeList
              title="Ezután itt szerkeszthető"
              items={TAKEOVER_EDITABLE}
            />
            <ScopeList
              title="Befagy a mai UNAS-értéken, és ma nincs rá szerkesztő"
              items={TAKEOVER_FROZEN}
            />
            <ScopeList title="Nem érinti" items={TAKEOVER_UNTOUCHED} />
            <p className="text-sm text-dusk-800">{TAKEOVER_PRICE_NOTE}</p>
            <p className="text-sm text-dusk-800">
              Visszaadni egyelőre nem lehet.
            </p>
            <div className="flex gap-2">
              <PilotButton
                variant="danger"
                onClick={() => void take()}
                disabled={busy}
              >
                Átvesszük a törzsadatot
              </PilotButton>
              <PilotButton
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Mégsem
              </PilotButton>
            </div>
          </div>
        ) : (
          <PilotButton variant="secondary" onClick={() => setConfirming(true)}>
            Törzsadat átvétele
          </PilotButton>
        )
      ) : null}
    </PilotSection>
  );
}
