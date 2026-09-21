"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Empty, Message } from "./ticket-list";

/**
 * AZ ESZKÖZ ADATLAPJA A PARTNER PORTÁLON.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) ===
 *
 * Szó szerint: „ha rakattint akkor ugfyanaz jojjon be mint az app oldalon, csak
 * ne tudjon szerkeszteni". A tartalom tehát a belső lapé
 * (`apps/web/.../asset-detail-page.tsx`), a műveletek viszont nem.
 *
 * === A NÉGY MŰVELET, AMI NINCS ITT, ÉS AZ INDOK PONTOSAN ===
 *
 * Szerkesztés, QR-csere, kivezetés, végleges törlés.
 *
 * AMIT A LAP INDOKKÉNT MOND, AZ CSAK AZ EGYIKRE IGAZ, ÉS EZT MÉRTEM:
 * a `PARTNER_SERVICE` szerep `[SERVICE_VIEW, SERVICE_MANAGE]` (auth.ts:388),
 * a szerkesztés (`PATCH /service/assets/:id`) és a QR-csere
 * (`POST :id/qr/rotate`) viszont `SERVICE_MANAGE` alatt áll -- vagyis a partner
 * fiókjának MA VAN joga hozzájuk. Egyedül a törlés áll külön jog alatt
 * (`SERVICE_ASSET_DELETE`), a kivezetésnek pedig nincs saját végpontja: az
 * `archivedAt` a szerkesztés része.
 *
 * EZEKET TEHÁT NEM AZÉRT NEM KÍNÁLJUK, MERT NINCS RÁ JOG, hanem mert Balázs
 * ezt kérte. A különbség nem szőrszálhasogatás: egy hamis indok túléli azt a
 * feltételt, ami létrehozta, és a következő olvasó a jogosultságok között
 * keresné, miért nincs itt gomb. A rés (a szerver engedi, a felület nem
 * kínálja) a pull request törzsében ki van mondva.
 *
 * === AMIT VISZONT KÍNÁLUNK, ÉS MIÉRT ===
 *
 * A dokumentum-feltöltés marad: a szerveren `SERVICE_MANAGE` alatt áll, a
 * partner viseli ezt a jogot, és a feladatlap kizárt-listáján NEM szerepel. A
 * partner a hibajegyéhez ma is csatol fájlt; ez ugyanaz a képesség, más lapon.
 */
export function AssetDetail({ id }: { id: string }) {
  const [asset, setAsset] = useState<Awaited<
    ReturnType<typeof partnerApi.asset>
  > | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof partnerApi.assetDocuments>>["items"]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, documentList] = await Promise.all([
        partnerApi.asset(id),
        partnerApi.assetDocuments(id),
      ]);
      setAsset(detail);
      setDocuments(documentList.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem tölthető be.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <section>
        <Link className="back-link" href="/eszkozok">
          ← Eszközök
        </Link>
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!asset) return <p className="muted">Eszköz betöltése…</p>;

  return (
    <section>
      <Link className="back-link" href="/eszkozok">
        ← Eszközök
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">ESZKÖZ</p>
          <h1>{asset.name}</h1>
          <p>
            {asset.assetNumber}
            {asset.inventoryNumber ? ` · ${asset.inventoryNumber}` : ""}
          </p>
        </div>
        <span className="status neutral">{asset.status}</span>
      </header>

      <div className="panel">
        <dl className="asset-facts">
          <Sor cim="Helyszín">
            {asset.unit?.path.join(" / ") ?? "Nincs megadva"}
          </Sor>
          <Sor cim="Cím">{asset.address?.formatted ?? "Nincs megadva"}</Sor>
          <Sor cim="Gyártó">{asset.manufacturer ?? "Nincs megadva"}</Sor>
          <Sor cim="Teljesítmény">
            {asset.performance
              ? `${asset.performance}${
                  asset.performanceUnit ? ` ${asset.performanceUnit.code}` : ""
                }`
              : "Nincs megadva"}
          </Sor>
          <Sor cim="Telepítés">{datum(asset.installedAt)}</Sor>
          <Sor cim="Garancia lejárata">{datum(asset.warrantyExpiresAt)}</Sor>
          <Sor cim="Karbantartási intervallum">
            {asset.serviceIntervalDays
              ? `${asset.serviceIntervalDays} nap`
              : "Nincs megadva"}
          </Sor>
          <Sor cim="Utolsó karbantartás">{datum(asset.lastServicedAt)}</Sor>
          <Sor cim="QR-azonosító">{asset.qrToken}</Sor>
        </dl>
      </div>

      {/*
        A DOKUMENTUMOK ES A FENYKEPEK UGYANAZON A PANELEN allnak, ugyanugy, mint
        a hibajegyen: a panel a kepeket csempekent rajzolja, a tobbit nevvel.
        A bajtokat a SAJAT hivasunk hozza (blob + object URL), mert a bongeszo
        `<img>` eleme nem kuld Authorization fejlecet.
      */}
      <DocumentPanel
        title="Dokumentumok és fényképek"
        items={documents.map((item) => ({
          ...item,
          caption: item.caption ?? null,
        }))}
        loadBlob={(documentId) => partnerApi.assetDocumentBlob(id, documentId)}
        upload={(file, caption) =>
          partnerApi.uploadAssetDocument(id, file, caption)
        }
        onUploaded={load}
      />

      <div className="panel">
        <h2>Előzmények</h2>
        {asset.events.length ? (
          <ul className="event-list">
            {asset.events.map((esemeny) => (
              <li key={esemeny.id}>
                <strong>{esemeny.type}</strong>
                <span>
                  {new Date(esemeny.occurredAt).toLocaleString("hu-HU")}
                  {esemeny.actor ? ` · ${esemeny.actor.displayName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title="Nincs előzmény"
            text="Ehhez az eszközhöz még nem rögzítettünk eseményt."
          />
        )}
      </div>
    </section>
  );
}

function Sor({ cim, children }: { cim: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{cim}</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * A HIÁNYZÓ DÁTUM KIMONDVA ÁLL, nem üres cellaként. Egy üres hely három
 * különböző dolgot jelenthet (nincs, nem látja, nem töltődött be), és a
 * felület ezeket egybemosná.
 */
function datum(ertek?: string): string {
  return ertek ? new Date(ertek).toLocaleDateString("hu-HU") : "Nincs megadva";
}
