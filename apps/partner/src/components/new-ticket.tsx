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

import { eszkozAzonosito } from "@/lib/eszkoz-azonosito";
import { helyszinFa } from "@/lib/helyszin-fa";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Message } from "./ticket-list";
import { CIMKE, LAP_CIM, LAP_FEJLEC, LAP_LEIRAS, PANEL } from "./frame";

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
    <section>
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>ÚJ BEJELENTÉS</p>
          <h1 className={LAP_CIM}>Hibajegy nyitása</h1>
          <p className={LAP_LEIRAS}>
            Az itt rögzített hibajegy a saját cégéhez kerül.
          </p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      {createdId ? (
        /*
          A LINK NELKUL AZ UZENET ZSAKUTCA: azt mondja, hogy a jegy megnyilt, de
          a bejelento az urlapon all, es az egyetlen kezenfekvo lepese az, hogy
          ujra bekuldi. Ez a sor viszi oda, ahol a kepet potolni tudja.
        */
        <p>
          <a href={`/hibajegyek/${createdId}`}>
            A megnyílt hibajegy megnyitása
          </a>
        </p>
      ) : null}
      <form className={`form ${PANEL}`} onSubmit={submit}>
        <label>
          Mi a probléma?
          <input
            required
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Például: A keringető szivattyú nem indul"
          />
        </label>
        <label>
          Részletes leírás
          <textarea
            maxLength={4000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Kérjük, írja le, mit tapasztalt."
            rows={6}
          />
        </label>
        <label>
          Helyszín
          <select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            disabled={loading}
          >
            <option value="">Nincs megadva</option>
            {locations.map(({ item, depth }) => (
              <option
                key={item.id}
                value={item.id}
              >{`${"— ".repeat(depth)}${item.name} (${item.code})`}</option>
            ))}
          </select>
        </label>
        <fieldset disabled={!departmentId || submitting}>
          <legend>Érintett eszközök</legend>
          {!departmentId ? (
            <p className="leading-[1.5] text-[#666677]">
              Előbb válasszon helyszínt; ezután csak az ott található eszközök
              jelennek meg.
            </p>
          ) : assets.length ? (
            <div className="checkbox-list">
              {assets.map((asset) => (
                <label key={asset.id}>
                  <input
                    type="checkbox"
                    value={asset.id}
                    checked={assetIds.includes(asset.id)}
                    onChange={(event) =>
                      setAssetIds((current) =>
                        event.target.checked
                          ? [...current, asset.id]
                          : current.filter((id) => id !== asset.id),
                      )
                    }
                  />
                  {asset.name} <span>{eszkozAzonosito(asset)}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="leading-[1.5] text-[#666677]">
              Ezen a helyszínen nincs megjeleníthető eszköz.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>Fénykép, dokumentum</legend>
          {/*
            A HIBAT A KEPPEL EGYUTT JELENTI BE AZ EMBER. 2026-09-18-ig ez a mezo
            nem letezett: csatolni csak a MAR LETREJOTT jegy adatlapjan lehetett,
            tehat a bejelentonek ket lepesben kellett elmondania ugyanazt.
          */}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <p className="leading-[1.5] text-[#666677]">
            Nem kötelező. A kép a bejelentés elküldése után kerül fel, és utólag
            az adatlapon is pótolható.
          </p>
        </fieldset>
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => router.back()}
          >
            Mégsem
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? "Hibajegy megnyitása…" : "Hibajegy megnyitása"}
          </button>
        </div>
      </form>
    </section>
  );
}
