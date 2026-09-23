"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge, Card, EmptyState } from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Message } from "./ticket-list";

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
 * === AZ ELRENDEZÉS A BELSŐ RENDSZERÉ (2026-09-21) ===
 *
 * Balázs kérése, 2026-09-21 14:25:28 UTC: az ügyfél „ugyanolyan elrendezesben
 * es desigban lassa" a lapot, mint mi az app.acropora.hu oldalon. Ez a lap az
 * ELSŐ, amelyik átáll: a közös `@acropora/ui` elemeire és Tailwindre.
 *
 * A TARTALOM EBBEN A KÖRBEN NEM VÁLTOZIK. Ugyanaz a kilenc adatsor, ugyanabban
 * a sorrendben, ugyanazokkal a hívásokkal. Ha a mezők halmaza ugyanabban a
 * diffben mozdulna, egy elrendezési hiba nem lenne megkülönböztethető egy
 * jogosultsági szivárgástól.
 *
 * A KÖZÖS RÉTEG A `@acropora/ui`, NEM az `apps/web`. A belső lap saját
 * `Service*` keretet használ, ami az `apps/web`-ben él; arra a portál NEM
 * hivatkozhat (őrző méri: `visual-base.spec.ts`). Hogy az a keret közös
 * csomagba kerüljön-e, az a MÁSODIK szakasz kérdése, és csak ezen a lapon
 * mérve dönthető el.
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
      <section className="flex flex-col gap-4">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!asset)
    return <p className="text-[13px] text-muted">Eszköz betöltése…</p>;

  return (
    <section className="flex flex-col gap-4">
      <VisszaLink />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] tracking-[0.08em] text-muted">
            ESZKÖZ
          </p>
          <h1 className="m-0 text-[22px] leading-tight font-semibold text-ink">
            {asset.name}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {asset.assetNumber}
            {asset.partnerInternalCode ? ` · ${asset.partnerInternalCode}` : ""}
          </p>
        </div>
        <Badge>{asset.status}</Badge>
      </header>

      <Card className="p-[22px]">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
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
          {/*
            A MATRICA KÓDJA, ÉS A CÍMKE IS EZÉRT VÁLTOZOTT.

            Itt eddig a `qrToken` állt, "QR-azonosító" néven. Az a mező egy
            uuid, nem a matrica száma -- és épp a CÍMKE tette csábítóvá: a
            felhasználó a matricát hívja így. Egy jó tartalom rossz cím alatt
            ugyanaz a csapda marad, ezért a kettő együtt mozdult.

            A `qrToken` NEM került mellé. Nem titok, de a partnernek nincs
            jelentése, ÉS ez az a kulcs, amit a `scan/:qrToken` végpont
            elfogad. Egy képernyőről leolvasható kulcs akkor is fölösleges
            kockázat, ha ma nem tágít hatókört.

            ÉS A TARTALÉK ITT MÁS, MINT A LISTÁKON -- szándékosan. A listasorban
            a matrica hiányában az eszköz-szám marad, mert ott semmi más nem
            azonosítja a sort. Ezen a lapon az eszköz-szám MÁR OTT ÁLL a
            fejlécben, tehát ugyanaz a tartalék két helyen mutatná ugyanazt,
            két különböző cím alatt. A lap saját szokása a hiányra a "Nincs
            megadva", és minden testvér sor ezt használja.
          */}
          <Sor cim="Matricakód">{asset.labelCode ?? "Nincs megadva"}</Sor>
        </dl>
      </Card>

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

      <Card className="p-[22px]">
        <h2 className="mt-0 mb-3 text-[15px] font-semibold text-ink">
          Előzmények
        </h2>
        {asset.events.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {asset.events.map((esemeny) => (
              <li
                key={esemeny.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dusk-200 pb-2 last:border-0 last:pb-0"
              >
                <strong className="text-[13px] font-semibold text-ink">
                  {esemeny.type}
                </strong>
                <span className="text-[12px] text-muted">
                  {new Date(esemeny.occurredAt).toLocaleString("hu-HU")}
                  {esemeny.actor ? ` · ${esemeny.actor.displayName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nincs előzmény"
            description="Ehhez az eszközhöz még nem rögzítettünk eseményt."
          />
        )}
      </Card>
    </section>
  );
}

/**
 * EGY ADATSOR, A BELSO LAP ALAKJABAN.
 *
 * A meretek (`11px` cimke, `13px` ertek) a belso `ServiceDataItem`-bol jonnek,
 * hogy a ket felulet UGYANAZT a ritmust adja. Az a komponens az `apps/web`-ben
 * el, es a portal nem hivatkozhat ra -- ezert all itt ujra, nem importalva.
 *
 * ES EZ A HAROM SOR AZ, AMI A 2. SZAKASZ KERDESET ELDONTI: ha ot tovabbi nezet
 * is ugyanezt ismetli meg, akkor a keretet kozos csomagba kell emelni. EGY
 * lapbol ezt nem lehet megallapitani, es epp ezert all itt meg masolatkent.
 */
function Sor({ cim, children }: { cim: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 text-[11px] text-muted">{cim}</dt>
      <dd className="m-0 text-[13px] leading-[1.5] text-ink">{children}</dd>
    </div>
  );
}

/** A VISSZAFELE VEZETO UT. Egy helyen all, mert a lap KET agan is kell. */
function VisszaLink() {
  return (
    <Link
      className="text-[13px] text-muted no-underline hover:text-ink"
      href="/eszkozok"
    >
      ← Eszközök
    </Link>
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
