"use client";

import {
  Alert,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import type { ProductDetail, ProductUpdateInput } from "@acropora/types";
import { type FormEvent, useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * AZ ELO ALLATOK NEVEI (kartya 20b0dd47, Balazs 2026-08-31, emlek 1113): a tudomanyos nev a termeknev, alatta KERESHETO
 * mezokent a magyar, az angol es a nemet nev (a nemet a kulfoldi nyitashoz). A blokk minden elo allat termeken
 * megjelenik: korall, gerinctelen ES hal (acrobot 46058: a V2.2 tartasi blokk hianylistaja halnal is keri a magyar nevet,
 * murena 46056); a fajtat a kategoria-fa gyokere adja (a szerver mondja: `livestockKind`), a tobbi termeknel nincs. A nevek az OS-ben tarolodnak es szerkeszthetok; a webshopba MA NEM mennek.
 *
 * A mentes a kulon nev-vegpontra megy (`PATCH /products/:id/names`), mert a UNAS-gazdaju termeken a termek TOBBI mezoje 409,
 * a nevek viszont Acropora-tulajdonuak, es ott is irhatonak kell lenniuk (acrobot stage-probaja: a korallok tobbsege UNAS-
 * gazdaju). A mentes CSAK A VALTOZOTT mezoket kuldi: egy meg sosem kitoltott termeken a puszta mentes nem hoz letre adatlap-sort. Az
 * ures mezo torli a nevet. A szerver a mentes utan visszaolvasva adja a termeket, azt tesszuk ki (mint az alapadat-
 * szerkesztonel).
 */
const FIELDS = [
  { key: "magyarNev", label: "Magyar név", id: "product-name-hu" },
  { key: "angolNev", label: "Angol név", id: "product-name-en" },
  { key: "nemetNev", label: "Német név", id: "product-name-de" },
] as const;

type NameKey = (typeof FIELDS)[number]["key"];

const stored = (product: ProductDetail, key: NameKey) => product[key] ?? "";

export function ProductNamesCard({
  token,
  product,
  canManage,
  onSaved,
}: {
  token: string;
  product: ProductDetail;
  canManage: boolean;
  onSaved: (product: ProductDetail) => void;
}) {
  const [values, setValues] = useState<Record<NameKey, string>>({
    magyarNev: stored(product, "magyarNev"),
    angolNev: stored(product, "angolNev"),
    nemetNev: stored(product, "nemetNev"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // egy ujratoltott termek (mentes utan, masik oldalrol) a szerver ertekeit mutatja, nem a regi piszkozatot
  useEffect(() => {
    setValues({
      magyarNev: stored(product, "magyarNev"),
      angolNev: stored(product, "angolNev"),
      nemetNev: stored(product, "nemetNev"),
    });
  }, [product.magyarNev, product.angolNev, product.nemetNev]); // eslint-disable-line react-hooks/exhaustive-deps

  // every live animal: a coral, an invertebrate or a fish; not the other products
  if (product.livestockKind === null) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canManage) return;
    setError(null);
    setNotice(null);
    const changed: Pick<ProductUpdateInput, NameKey> = {};
    for (const { key } of FIELDS) {
      const next = values[key].trim();
      if (next !== stored(product, key).trim()) changed[key] = next;
    }
    if (Object.keys(changed).length === 0) {
      setNotice("Nincs változás, nincs mit menteni.");
      return;
    }
    setBusy(true);
    try {
      await productApi.updateNames(token, product.id, changed);
      onSaved(await productApi.detail(token, product.id));
      setNotice("A nevek a szerverről visszaolvasva látszanak.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotCard>
      <PilotCardHeader title="Nevek" />
      <div className="p-5">
        <p className="text-xs text-dusk-500">
          A tudományos név a terméknév; alatta kereshető mezőként a magyar, az
          angol és a német név. Az Acropora OS-ben tárolódnak, a webshopba ma
          nem mennek.
        </p>
        {error ? (
          <Alert
            className="mt-3"
            variant="danger"
            title="A mentés nem sikerült"
            description={error}
          />
        ) : null}
        {notice ? (
          <Alert
            className="mt-3"
            variant="info"
            title="Mentve"
            description={notice}
          />
        ) : null}
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          {FIELDS.map(({ key, label, id }) => (
            <PilotFormField key={key} label={label} htmlFor={id}>
              <PilotInput
                id={id}
                value={values[key]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [key]: value }))
                }
                disabled={busy || !canManage}
              />
            </PilotFormField>
          ))}
          {canManage ? (
            <PilotButton type="submit" disabled={busy}>
              {busy ? "Mentés…" : "Mentés"}
            </PilotButton>
          ) : null}
        </form>
      </div>
    </PilotCard>
  );
}
