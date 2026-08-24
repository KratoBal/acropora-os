"use client";

import { Alert, Badge, Button, Card } from "@acropora/ui";
import type { ProductDetail } from "@acropora/types";
import { useState } from "react";

import { productApi } from "@/lib/api/products";

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
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          A törzsadat gazdája
        </h2>
        <Badge variant={authority === "ACROPORA" ? "success" : "info"}>
          {authority === "ACROPORA"
            ? "Acropora OS"
            : authority === "UNAS"
              ? "UNAS webshop"
              : "Ellenőrzendő"}
        </Badge>
      </div>

      {authority === "ACROPORA" ? (
        <p className="text-sm text-slate-700">
          A nevet és a leírást itt szerkesztjük. A webshop-szinkron ezt a
          terméket kihagyja, tehát egy UNAS oldali módosítás nem írja felül,
          amit itt beírunk.
        </p>
      ) : null}

      {authority === "UNAS" ? (
        <p className="text-sm text-slate-700">
          A nevet és a leírást a webshop szinkronja gondozza, ezért itt nem
          szerkeszthető.
        </p>
      ) : null}

      {authority === null ? (
        <p className="text-sm text-slate-700">
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
            <p className="text-sm text-slate-800">
              Az átvétel után a webshop-szinkron <strong>nem írja</strong> ennek
              a terméknek a nevét és leírását. Ha valaki a UNAS felületén
              javítja őket, az a javítás ide már nem érkezik meg, és erről nem
              kapunk értesítést.
            </p>
            <p className="text-sm text-slate-800">
              Visszaadni egyelőre nem lehet.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => void take()}
                disabled={busy}
              >
                Átvesszük a törzsadatot
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Mégsem
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Törzsadat átvétele
          </Button>
        )
      ) : null}
    </Card>
  );
}
