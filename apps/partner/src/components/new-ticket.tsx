"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";

import { eszkozAzonosito } from "@/lib/eszkoz-azonosito";
import { helyszinFa } from "@/lib/helyszin-fa";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Message } from "./ticket-list";

/**
 * ÚJ HIBAJEGY -- FIGMA 9. KÖR, PILOT-AQUA (surgos kor, 2026-09-25, acrobot
 * kérése: "a portál Uj hibajegy urlap ... a pilot-aqua keretben, egy PR =
 * egy kepernyo a friss mainrol").
 *
 * A VISELKEDÉS VÁLTOZATLAN, CSAK A KERET CSERÉLT: ugyanaz a mezőkör,
 * ugyanaz a submit-folyamat, ugyanazok a szöveges figyelmeztetések, mint
 * korábban -- a `frame.tsx` `PANEL`/`LAP_*` konstansai és a `globals.css`
 * `.form`/`.checkbox-list`/`.form-actions` szabályai helyett `PilotCard`/
 * `PilotFormField`/`PilotButton` és Tailwind-osztályok, ugyanazzal a
 * mintával, mint a hibajegy-lista (#1117) és -adatlap (#1127).
 *
 * KÉT KOMPENZÁLÓ VÁLTOZÁS, UGYANAZ A MINTA, MINT A `document-panel.tsx`-NÉL
 * (#1130): a `PilotInput`-nak nincs `maxLength` propja, ezért a "Mi a
 * probléma?" (300) és a "Részletes leírás" (4000) mező hosszkorlátját az
 * `onChange` maga kényszeríti ki (`value.slice(...)`). A natív `required`
 * a "Mi a probléma?" mezőn eddig is csak a böngésző saját, felül nem
 * írható hibaüzenetét adta -- a szerver validálja a mezőt ténylegesen, és
 * a submit gomb korábban is engedélyezett maradt üres cím mellett is
 * (a hibaüzenetet a szerver válasza adta), tehát a `required` elhagyása
 * nem old fel semmilyen eddigi védelmet.
 *
 * A LEÍRÁS MEZŐ NATÍV `<textarea>`, NEM `PilotInput`: a csomagnak nincs
 * pilot-textarea komponense. A natív elem a `PilotInput` UGYANAZON
 * Tailwind-osztályait kapja kézzel, hogy vizuálisan egyezzen vele.
 *
 * AZ ÉRINTETT ESZKÖZÖK JELÖLŐNÉGYZETEI ÚJ MINTA: ez az ELSŐ checkbox-lista
 * pilot-aqua keretben a repóban (mérve: nulla előzmény máshol). A natív
 * `<input type="checkbox">` marad, `accent-pilot-aqua-600`-tal színezve,
 * egy `pilot-grey-200` keretes sorba ágyazva -- ugyanaz a sor-keret, mint
 * a lista-oldalak táblázat-sorai.
 */

function orderedDepartments(items: WorksheetDepartmentSummary[]) {
  return helyszinFa(items.filter((item) => item.isActive));
}

export function NewTicket() {
  const { user } = useAuth();
  const router = useRouter();
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentId, setDepartmentId] = useState("");
  const [assets, setAssets] = useState<
    Awaited<ReturnType<typeof partnerApi.assets>>["items"]
  >([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const customerId = user?.customerId ?? "";
  const locations = useMemo(
    () => orderedDepartments(departments),
    [departments],
  );

  useEffect(() => {
    if (!customerId) return;
    void partnerApi
      .departments(customerId)
      .then((result) => setDepartments(result.items))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A helyszínek nem tölthetők be.",
        ),
      )
      .finally(() => setLoading(false));
  }, [customerId]);
  useEffect(() => {
    if (!customerId || !departmentId) {
      setAssets([]);
      setAssetIds([]);
      return;
    }
    void partnerApi
      .assets({ departmentId })
      .then((result) => {
        setAssets(result.items);
        setAssetIds([]);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eszközök nem tölthetők be.",
        ),
      );
  }, [customerId, departmentId]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const created = await partnerApi.createTicket({
          title,
          description: description || undefined,
          departmentId: departmentId || undefined,
          assetIds,
        });
        /*
          A FELTOLTES CSAK A LETREJOTT JEGYRE MEHET, tehat a sorrend kotott: a
          vegpont a jegy azonositojara ir (`POST service/jobs/:id/documents`),
          es az azonosito csak itt szuletik meg.

          ES HA A JEGY LETREJON, DE A KEP NEM MEGY FEL: NEM iranyitunk at, es NEM
          mondjuk, hogy "a hibajegy nem nyithato meg" -- mert megnyilt. Egy
          altalanos hibauzenet itt arra vinne a bejelentot, hogy MEGISMETELJE a
          bejelentest, es ket jegy keletkezne ugyanarrol.

          A masik irany (atiranyitas, hallgatva a bukasrol) azt eredmenyezne,
          hogy a bejelento azt hiszi, a kep ott van. A kettobol ez a rosszabb:
          a duplikalt jegy LATSZIK, a hianyzo kep nem.
        */
        try {
          for (const file of files)
            await partnerApi.uploadTicketDocument(created.id, file, "");
        } catch (uploadCause) {
          // A JEGY MAR MEGVAN: a hibauzenet ezt MONDJA KI, es a link ott all
          // hozza. Enelkul a bejelento ujra bekuldene, es ket jegy lenne.
          setError(
            `A hibajegy megnyílt, de a fájl feltöltése nem sikerült: ${
              uploadCause instanceof Error
                ? uploadCause.message
                : "ismeretlen hiba"
            } A képet az adatlapon pótolhatja.`,
          );
          setCreatedId(created.id);
          return;
        }
        router.replace(`/hibajegyek/${created.id}`);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "A hibajegy nem nyitható meg.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [assetIds, departmentId, description, files, router, title],
  );

  return (
    <PilotThemeRoot className="flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          ÚJ BEJELENTÉS
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Hibajegy nyitása
        </h1>
        <p className="mt-1 text-sm text-pilot-grey-400">
          Az itt rögzített hibajegy a saját cégéhez kerül.
        </p>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-8 py-6">
        {error ? (
          <div className="mb-4">
            <Message tone="error" text={error} />
          </div>
        ) : null}
        {createdId ? (
          /*
            A LINK NELKUL AZ UZENET ZSAKUTCA: azt mondja, hogy a jegy megnyilt, de
            a bejelento az urlapon all, es az egyetlen kezenfekvo lepese az, hogy
            ujra bekuldi. Ez a sor viszi oda, ahol a kepet potolni tudja.
          */
          <p className="mb-4 text-sm">
            <a
              href={`/hibajegyek/${createdId}`}
              className="font-medium text-pilot-aqua-700 hover:underline"
            >
              A megnyílt hibajegy megnyitása
            </a>
          </p>
        ) : null}

        <form className="flex flex-col gap-5" onSubmit={submit}>
          <PilotCard>
            <div className="flex flex-col gap-4 px-5 py-5">
              <PilotFormField label="Mi a probléma?" required>
                <PilotInput
                  value={title}
                  onChange={(value) => setTitle(value.slice(0, 300))}
                  placeholder="Például: A keringető szivattyú nem indul"
                />
              </PilotFormField>
              <PilotFormField label="Részletes leírás">
                <textarea
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value.slice(0, 4000))
                  }
                  placeholder="Kérjük, írja le, mit tapasztalt."
                  rows={6}
                  className="w-full rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                />
              </PilotFormField>
              <PilotFormField label="Helyszín">
                <PilotSelect
                  value={departmentId}
                  onChange={setDepartmentId}
                  disabled={loading}
                >
                  <option value="">Nincs megadva</option>
                  {locations.map(({ item, depth }) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >{`${"— ".repeat(depth)}${item.name} (${item.code})`}</option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              {/*
                AZ URES VALASZTO MEGNEVEZI AZ OKOT, NEM CSAK URES.

                A lista a HOZZARENDELESI tablabol tolt, nem a vevo osszes
                alegysegebol: `worksheets.service.ts` a `assignedUnitIdsFor` hivason
                at szur. Egy hozzarendeles nelkuli partner-fiok tehat URES valasztot
                kap, es a mai lapon semmi nem mondja meg, miert.

                ES A KETTO KIVULROL EGYFORMA: egy ures lista ugyanugy nez ki, mint egy
                elromlott betoltes. Ugyanaz az alak, amit a mobil kepernyoknel mar
                egyszer felirtunk -- egy nem mukodo urlap es egy hibas urlap kozott a
                felhasznalo nem tud kulonbseget tenni, ha a lap hallgat.

                A BETOLTES ALATT NEM SZOL: addig a lista joggal ures, es egy
                villano figyelmeztetes epp a hibas allapotot utanozna.

                A SZOVEG MA IS IGAZ: helyszin nelkul ma MEG lehet jegyet nyitni, csak
                eszkozt nem lehet valasztani. Ha a helyszin egyszer kotelezove valik
                (15c9cd7a), ez a mondat BOVUL, nem cserelodik.
              */}
              {!loading && locations.length === 0 ? (
                <p className="text-xs leading-5 text-pilot-grey-400">
                  Önhöz még nincs helyszín rendelve. Amíg nincs, az eszközök
                  listája üres marad. A hozzárendelést az Acropora
                  ügyfélszolgálatán kérheti.
                </p>
              ) : null}
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Érintett eszközök" />
            <div className="px-5 py-4">
              <fieldset
                disabled={!departmentId || submitting}
                className="m-0 flex flex-col gap-2 border-0 p-0"
              >
                {!departmentId ? (
                  /*
                    KET ALLAPOT, KET MONDAT -- ES EDDIG EGY ALLT ITT.

                    Az "Előbb válasszon helyszínt" mondat annak szol, aki VALASZTHAT.
                    Egy hozzarendeles nelkuli partnernek ugyanez zsakutca, mert arra
                    kerte, hogy valasszon valamit, ami nincs a listajaban. A ket
                    allapotot ugyanaz a felteteles ag hozta elo, tehat a mondat a
                    rosszabbik esetben felrevezetett.
                  */
                  <p className="text-sm text-pilot-grey-400">
                    {locations.length === 0 && !loading
                      ? "Ehhez a bejelentéshez nem tud eszközt kiválasztani, mert nincs Önhöz rendelt helyszín."
                      : "Előbb válasszon helyszínt; ezután csak az ott található eszközök jelennek meg."}
                  </p>
                ) : assets.length ? (
                  assets.map((asset) => (
                    <label
                      key={asset.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
                    >
                      <input
                        type="checkbox"
                        checked={assetIds.includes(asset.id)}
                        onChange={(event) =>
                          setAssetIds((current) =>
                            event.target.checked
                              ? [...current, asset.id]
                              : current.filter((id) => id !== asset.id),
                          )
                        }
                        className="size-4 rounded accent-pilot-aqua-600"
                      />
                      <span className="text-sm text-pilot-grey-900">
                        {asset.name}
                      </span>
                      <span className="ml-auto font-mono text-xs text-pilot-grey-400">
                        {eszkozAzonosito(asset)}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-pilot-grey-400">
                    Ezen a helyszínen nincs megjeleníthető eszköz.
                  </p>
                )}
              </fieldset>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Fénykép, dokumentum" />
            <div className="flex flex-col gap-2 px-5 py-4">
              {/*
                A HIBAT A KEPPEL EGYUTT JELENTI BE AZ EMBER. 2026-09-18-ig ez a mezo
                nem letezett: csatolni csak a MAR LETREJOTT jegy adatlapjan lehetett,
                tehat a bejelentonek ket lepesben kellett elmondania ugyanazt.
              */}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,application/pdf"
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []))
                }
                className="cursor-pointer text-sm text-pilot-grey-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-pilot-aqua-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-pilot-aqua-700"
              />
              <p className="text-xs text-pilot-grey-400">
                Nem kötelező. A kép a bejelentés elküldése után kerül fel, és
                utólag az adatlapon is pótolható.
              </p>
            </div>
          </PilotCard>

          <div className="flex justify-end gap-3">
            <PilotButton
              variant="secondary"
              type="button"
              onClick={() => router.back()}
            >
              Mégsem
            </PilotButton>
            <PilotButton type="submit" disabled={submitting}>
              {submitting ? "Hibajegy megnyitása…" : "Hibajegy megnyitása"}
            </PilotButton>
          </div>
        </form>
      </div>
    </PilotThemeRoot>
  );
}
