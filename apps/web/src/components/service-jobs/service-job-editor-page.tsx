"use client";

import { Alert, Button, Input } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetSelectablePartner,
} from "@acropora/types";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceListHeader } from "@/components/service/service-list-chrome";
import { ServiceBackLink } from "@/components/service/service-detail-chrome";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { JobAssetPicker } from "./job-asset-picker";
import { PartnerPicker } from "./partner-picker";
import { ServiceJobStepCard } from "./service-job-page-chrome";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "@/components/worksheets/worksheet-assignee-picker";

/**
 * ÚJ HIBAJEGY, BELSŐ FELVITEL.
 *
 * EZ A FOLYAMAT MÁSODIK FELE, névvel: „a lap eljut a felelőshöz (aki ilyenkor
 * MI vagyunk), a felelős létrehozza a hibajegyet, és a meglévő lap annak
 * részévé válik" (Balázs, 2026-09-02 08:02). Tehát a jegyet BELÜL nyitjuk, egy
 * bejelentkezett kollégaként - az ügyfél-oldali bejelentés külön munka, és az
 * ügyfélportál kérdése.
 *
 * A PARTNER NEM KÖTELEZŐ, és ez nem lazaság. A tipikus úton a jegy egy MÁR
 * MEGLÉVŐ lapból születik, a lapnak pedig van partnere - vagyis a partner
 * ADOTT, nem beírandó. Ha itt kötelezővé tennénk, épp azt az utat nehezítenénk,
 * amit a fenti döntés leír. A partner nélküli jegy ezért nem hiba, hanem
 * ÁTMENETI állapot, és a csatolás mai tiltása erre az átmenetre szól.
 *
 * A VÁLASZTÓ KERES, NEM LISTÁZ. A vevő-lista lapozott, és egy oldal legfeljebb
 * százat ad: egy sima legördülő CSENDBEN levágná a többit, és a hiányzó partner
 * úgy nézne ki, mintha nem is létezne.
 */
export function ServiceJobEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  /**
   * A BETOLTOTTSEG KULON ALL AZ URES LISTATOL. Egy ures lista jelentheti azt,
   * hogy a partnernek nincs helyszine, es azt is, hogy meg nem jott meg a
   * valasz. A ket allapot ket kulon mondatot erdemel -- a telefonos urlapon ma
   * pontosan ez a kulonbseg hianyzott, es egy ures valaszto ugy nezett ki,
   * mintha a partnernek nem lenne helyszine.
   */
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  /**
   * A MAR LETREJOTT JEGY, HA A CSATOLMANYOK FELTOLTESE BUKOTT EL.
   *
   * KET LEPES, KET KIMENET, ES A MASODIK BUKASA NEM TESZI SEMMISSE AZ ELSOT.
   * A jegy ilyenkor LETEZIK -- ha a kepernyo csak annyit mondana, hogy "nem
   * sikerult", a kezelo ujra megnyomna a gombot, es egy MASODIK jegy szuletne
   * ugyanarrol a hibarol. Ezert a gomb ettol a pillanattol nem felvitel, hanem
   * UJRAPROBALAS a csatolmanyokra.
   */
  const [created, setCreated] = useState<{
    id: string;
    jobNumber: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";

  /**
   * A VALASZTHATO KOLLEGAK LISTAJA. A `canManage` a kapcsolo: jogosultsag
   * nelkul a lap amugy is elutasitja a felvitelt, tehat a lekerdezes sem indul.
   */
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );

  /**
   * A PARTNER HELYSZINEI, UGYANARROL A VEGPONTROL, AMIT A MUNKALAP HASZNAL.
   *
   * Nem uj vegpont es nem uj fa: a `WorksheetDepartment` ugyanaz a torzsadat,
   * amit a munkalap-szerkeszto es az eszkoz-urlap is olvas. A jegy eddig CSAK a
   * partnert tudta, tehat a lancban a legelso lepes volt a legkevesbe pontos.
   *
   * CSAK AZ AKTIV SOROK, ugyanugy, mint a munkalapon: archivalt egysegre ne
   * lehessen uj jegyet nyitni. A ket helyen ugyanaz a szures all, tehat a
   * felajanlott halmaz sem tud elcsuszni egymastol.
   */
  const loadDepartments = useCallback(
    async (owner: string, signal?: AbortSignal) => {
      if (!owner) {
        setDepartments([]);
        setDepartmentsLoaded(false);
        return;
      }
      try {
        const response = await worksheetsApi.departments(token, owner, signal);
        setDepartments(response.items.filter((item) => item.isActive));
        setDepartmentsLoaded(true);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("A partner helyszínei nem tölthetők be.");
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(customer?.customerId ?? "", controller.signal);
    return () => controller.abort();
  }, [customer?.customerId, loadDepartments]);

  /**
   * PARTNERVALTASKOR A HELYSZIN ELESIK. Enelkul az elozo partner egysege
   * maradna kivalasztva, a valasztoban viszont mar nem szerepelne -- a mezo
   * URESNEK latszana, kozben ertek allna benne, es a szerver utasitana el a
   * felvitelt egy olyan hibaval, amit a kepernyon semmi nem magyaraz.
   */
  useEffect(() => {
    setDepartmentId("");
  }, [customer?.customerId]);

  /**
   * HELYSZINVALTASKOR AZ ESZKOZOK IS ELESNEK, ugyanabbol az okbol, amiert a
   * helyszin esik el partnervaltaskor: az elozo helyszin eszkoze a listaban
   * mar nem szerepel, tehat a valasztas LATHATATLANNA valna -- kozben elmenne
   * a szerverre, ami elutasitana, egy olyan hibaval, amit a kepernyon semmi
   * nem magyaraz.
   */
  useEffect(() => {
    setAssetIds([]);
  }, [departmentId]);

  /**
   * A VALASZTO A TELJES UTAT MUTATJA, NEM CSAK A LEVEL NEVET. A kod es a nev
   * csak TESTVEREK kozott egyedi (ADR-010), tehat ket kulonbozo ag alatt
   * ugyanaz a "Biodom" megengedett. Ugyanaz a `buildSiteOptions`, amit a
   * munkalap-szerkeszto, az eszkoz-szerkeszto es az eszkoz-lista hasznal.
   */
  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod hibajegyet nyitni"
        description="service.manage jogosultság szükséges."
      />
    );

  /**
   * A CSATOLMANYOK A JEGY LETREJOTTE UTAN MENNEK FEL.
   *
   * === MIERT NEM EGYUTT A FELVITELLEL ===
   *
   * Balazs kerese szo szerint "hibajegy rogzitesekor" csatolast mond -- a jegy
   * viszont a mentes pillanataban MEG NEM LETEZIK, tehat nincs mihez kotni a
   * fajlt. A fajlt ezert a mentes ELOTT valasztjuk ki, es a rekord letrejotte
   * UTAN toltjuk fel. Ugyanez a sorrend all a mobil eszkoz- es
   * munkalap-urlapjan (`planPhotosAfterRecord`), es ott mar bevalt.
   *
   * === A KEPEK ES AZ EGYEB FAJLOK KET KERESBEN MENNEK ===
   *
   * A `type` mezo keresenkent EGY ertek, a besorolas viszont a tartalombol
   * kovetkezik. Sorban, nem parhuzamosan: a szerver keret-ellenorzese a mar
   * felhasznalt helyet olvassa a tablabol, es parhuzamos irasoknal mindketto
   * ugyanazt a regi osszeget latna.
   */
  const uploadFiles = async (jobId: string) => {
    const kepek = files.filter((file) => file.type.startsWith("image/"));
    const egyeb = files.filter((file) => !file.type.startsWith("image/"));
    if (kepek.length)
      await serviceJobsApi.uploadDocument(token, jobId, "PHOTO", kepek);
    if (egyeb.length)
      await serviceJobsApi.uploadDocument(token, jobId, "OTHER", egyeb);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    /**
     * A MAR LETREJOTT JEGYRE NEM NYITUNK MASIKAT. Ha az elso kor a feltoltesen
     * bukott el, ez a gomb UJRAPROBALAS -- a felvitelt nem szabad megismetelni.
     */
    const job =
      created ??
      (await serviceJobsApi
        .create(token, {
          title: title.trim(),
          description: description.trim() || null,
          customerId: customer?.customerId ?? null,
          departmentId: departmentId || null,
          assetIds,
          assigneeIds,
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem jött létre.",
          );
          return null;
        }));
    if (!job) {
      setSaving(false);
      return;
    }
    setCreated(job);

    if (files.length) {
      try {
        await uploadFiles(job.id);
      } catch (cause) {
        /**
         * A RESZLEGES SIKER KIMONDVA, ES A JEGY SZAMAVAL EGYUTT.
         *
         * Ha csak annyit mondanank, hogy "nem sikerult", a kezelo azt hinne, a
         * jegy sem jott letre -- es vagy ujra felvinne, vagy elmenne, es a
         * fenykepek CSENDBEN elvesznenek. A szam azert kell, mert enelkul a
         * jegyet meg kellene keresnie a listaban.
         */
        setError(
          `A(z) ${job.jobNumber} hibajegy LÉTREJÖTT, de a csatolmányok feltöltése nem sikerült: ` +
            (cause instanceof Error ? cause.message : "ismeretlen hiba") +
            ". A fájlok kiválasztva maradtak, a gombbal újrapróbálhatod, vagy a jegy lapján is feltöltheted.",
        );
        setSaving(false);
        return;
      }
    }

    // A FRISS JEGY LAPJÁRA VISZÜNK, nem a listára: aki most nyitotta, azt
    // akarja folytatni - munkalapot csatolni, léptetni.
    router.push(`/szerviz/hibajegyek/${job.id}`);
  };

  return (
    <div className="space-y-6">
      {/*
        A KILÉPÉS A CÍM FÖLÖTT ÁLL, ÉS NEM HELYETTESÍTI A „MÉGSEM"-ET.

        A kettő MÁS HELYZETRE VALÓ, és a prototípus is mind a kettőt kiteszi: a
        láblécben álló „Mégsem" akkor, ha végigolvastad az űrlapot és úgy döntesz,
        hogy nem viszed végig; ez itt akkor, ha rossz lapra jöttél, és azonnal
        kilépnél - anélkül, hogy a mezők mellett végig kellene görgetned.

        FIX CÉL, NEM `useReturnTo`. A ház mindkét mintát ismeri, de ide a fix
        cím illik: erre a lapra EGYETLEN helyről lehet eljutni (a lista „Új
        hibajegy" gombjáról - lemérve, egy hivatkozás az egész alkalmazásban),
        tehát az előzmény ma ugyanoda vezetne. Egy menekülő-útnak pedig
        KISZÁMÍTHATÓNAK kell lennie: ugyanaz a link ugyanoda vigyen, ne attól
        függjön, honnan érkeztél. A hibajegy ADATLAPJA is így áll.
      */}
      <ServiceBackLink href="/szerviz/hibajegyek">Hibajegyek</ServiceBackLink>
      <ServiceListHeader
        eyebrow="Új bejegyzés"
        title="Új hibajegy"
        lead="A hibajegy a lánc első eleme. A munkalapokat utólag lehet alá csatolni - a lap keletkezhet előbb is, mint a jegy."
      />
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {/*
        A SORREND BALAZS KERESE, 2026-09-14, es nem izles kerdese: "Elso helyre
        keruljon a Partner kivalasztasa. Ez most lejebb van es nem is szepen van
        megoldva. Utana a Partnerhez kotodo helyszin valasztas jojjon a szokasos
        fa strukturaban. Ez alatt a Mi a baj mezo, majd ez alatt a reszletek
        mezo."

        AMIERT A FELVITEL SORRENDJE TARTALMI KERDES: a helyszin a partnertol
        FUGG. Ha a partner a lap aljan all, a kozbulso mezoket ugy tolti ki a
        kezelo, hogy a helyszin-valaszto meg ures -- vissza kell lepnie, es a
        lap ket iranyban olvashato. Elol a fuggoseg feje, alatta ami rola
        kovetkezik.
      */}
      {/*
        KET HASAB, ES A JOBB OLDALON NINCS MEZO.

        A felvitel MARAD egy oszlopban: egy urlap, aminek a mezoi ket hasabra
        szakadnak, ket kulonbozo olvasasi sorrendet kinal, es epp a sorrend az,
        ami itt tartalmi kerdes. A jobb hasab ezert csak ELMONDJA, mi kovetkezik
        -- nem kertez.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <ServiceJobStepCard number="01" title="Partner és helyszín">
            <div className="space-y-1">
              <label
                className="block text-sm font-semibold"
                htmlFor="hibajegy-partner"
              >
                Partner
              </label>
              {customer ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{customer.name}</span>
                  <button
                    type="button"
                    className="text-xs text-dusk-500 underline"
                    onClick={() => setCustomer(null)}
                  >
                    Másik partner
                  </button>
                </div>
              ) : (
                <>
                  <PartnerPicker id="hibajegy-partner" onPick={setCustomer} />
                  {/*
                A HIÁNY IS ÁLLÍTÁS: a partner elhagyható, és ezt ki kell mondani,
                különben a felhasználó keresni fog valamit, ami nem hiányzik.
                A következménye viszont ott áll mellette, mert az MA korlátoz.
              */}
                  <p className="pt-1 text-xs text-dusk-500">
                    Elhagyható. Partner nélkül a jegy megnyílik, de munkalapot
                    csak azután lehet alá csatolni, hogy a partnere megvan.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1">
              <label
                className="block text-sm font-semibold"
                htmlFor="hibajegy-helyszin"
              >
                Helyszín
              </label>
              {/*
            HAROM KULON ALLAPOT, HAROM KULON MONDAT, es ez nem bobeszedusseg.
            Nincs partner / meg toltunk / a partnernek nincs helyszine -- a
            telefonos urlapon pontosan ez a kulonbseg hianyzott, es egy ures
            valaszto ugy nezett ki, mintha a partnernek nem lenne helyszine.
            Aki egy ures listat lat magyarazat nelkul, a rossz helyen kezd
            keresni.
          */}
              {!customer ? (
                <p className="text-sm text-dusk-500">
                  Előbb válassz partnert. A helyszínek a partner saját fájából
                  jönnek.
                </p>
              ) : !departmentsLoaded ? (
                <p className="text-sm text-dusk-500">Helyszínek betöltése...</p>
              ) : departmentOptions.length === 0 ? (
                <p className="text-sm text-dusk-500">
                  Ehhez a partnerhez nincs felvéve helyszín. A jegy enélkül is
                  megnyitható.
                </p>
              ) : (
                <select
                  id="hibajegy-helyszin"
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={departmentId}
                  onChange={(event) => setDepartmentId(event.target.value)}
                >
                  <option value="">Nincs megadva</option>
                  {departmentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </ServiceJobStepCard>

          <ServiceJobStepCard number="02" title="A hiba leírása">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="hibajegy-cim">
                Mi a baj?
              </label>
              <Input
                id="hibajegy-cim"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Például: a hármas medence szivattyúja nem indul"
              />
            </div>

            <div className="space-y-1">
              <label
                className="text-sm font-semibold"
                htmlFor="hibajegy-leiras"
              >
                Részletek
              </label>
              <textarea
                id="hibajegy-leiras"
                className="w-full rounded border px-2 py-1 text-sm"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <span className="text-sm font-semibold">Érintett eszközök</span>
              {/*
            A CIMKE ITT `span`, NEM `label`. Egy `label` egyetlen mezohoz
            tartozik, itt viszont egy JELOLONEGYZET-LISTA all: a felirat a
            csoportra vonatkozik, es a sajat feliratat minden sor viszi. Egy
            `htmlFor` nelkuli `label` csendben semmire nem mutatna.
          */}
              <JobAssetPicker
                departmentId={departmentId}
                selected={assetIds}
                onChange={setAssetIds}
              />
            </div>
          </ServiceJobStepCard>

          {/*
          A SORREND BALAZS 2026-09-14-I LISTAJAT KOVETI, es a ket uj mezo a
          VEGERE megy: a lista a HIBAT irja le, majd azt, amit erint, majd a
          bizonyitekot. A harmadik lepes EZT a ket mezot fogja ossze.
        */}
          <ServiceJobStepCard number="03" title="Fájlok és delegálás">
            <div className="space-y-1">
              <label
                className="block text-sm font-semibold"
                htmlFor="hibajegy-fajlok"
              >
                Fényképek és fájlok
              </label>
              {/* A SZAGGATOTT KERET A TERVBOL JON, es CSAK keret: a mezo
                  maga valtozatlan, az azonositoja es a felirata is. A kettot
                  nem szabad osszekotni -- egy "szebb" sajat gomb elvenne a
                  bongeszo sajat fajlvalasztojat, es azzal a billentyuzetes
                  utat is. */}
              <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-5">
                <input
                  id="hibajegy-fajlok"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,application/pdf"
                  className="text-sm"
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files ?? []))
                  }
                />
              </div>
              {/*
            A SORRENDET KI KELL MONDANI. A fajl a jegy LETREJOTTE UTAN megy fel,
            mert addig nincs mihez kotni -- es ha errol hallgatnank, egy lassu
            feltoltes ugy nezne ki, mintha a felvitel akadt volna el.
          */}
              <p className="pt-1 text-xs text-dusk-500">
                {files.length
                  ? `${files.length} fájl feltöltésre vár. A hibajegy megnyitása után töltjük fel.`
                  : "Elhagyható. JPEG, PNG vagy PDF, fájlonként legfeljebb 10 MB."}
              </p>
            </div>

            <div className="space-y-1">
              {/*
            A CIMKE ITT `span`, NEM `label` -- ugyanabbol az okbol, amiert az
            "Érintett eszközök" felirata is az: egy jelolonegyzet-LISTA all
            alatta, es a sajat feliratat minden sor viszi. Egy `htmlFor`
            nelkuli `label` csendben semmire nem mutatna.
          */}
              <span className="text-sm font-semibold">Delegált kollégák</span>
              <WorksheetAssigneePicker
                candidates={candidates}
                selected={assigneeIds}
                onToggle={(userId) =>
                  setAssigneeIds((current) => toggleAssignee(current, userId))
                }
              />
              {candidatesError ? (
                <p className="text-xs font-medium text-rose-600">
                  {candidatesError}
                </p>
              ) : null}
              {/*
            MIERT A VEGEN: Balazs 2026-09-14-i sorrendje a HIBAT irja le, majd
            azt, amit erint, majd a bizonyitekot. A delegalas az egyetlen mezo,
            ami nem a hibarol szol, hanem a SZERVEZESROL -- aki a munkat
            kiadja, a legvegen dont rola.
          */}
              <p className="pt-1 text-xs text-dusk-500">
                Elhagyható. A delegált kollégák értesítést kapnak a jegyről.
              </p>
            </div>
          </ServiceJobStepCard>

          {/*
            A ZARO SAV KULON DOBOZ, NEM AZ UTOLSO LEPES ALJA.

            A gomb az EGESZ urlapra vonatkozik, nem a fajlokra es a delegalasra
            -- az utolso lepesen belul viszont pont ugy nezne ki, mintha csak
            azt mentene. A "Megsem" is ide tartozik: eddig SEHOL nem allt kiut
            a lapon, es a bongeszo vissza-gombja nem ugyanaz, mert a felvitt
            szoveg sorsarol semmit nem mond.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dusk-200/80 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-xs text-dusk-500">
              A „Mi a baj?” mező kötelező, a többi elhagyható.
            </p>
            <div className="flex items-center gap-2">
              <Link href="/szerviz/hibajegyek">
                <Button variant="secondary">Mégsem</Button>
              </Link>
              <Button
                disabled={(!created && !title.trim()) || saving}
                onClick={() => void submit()}
              >
                {created
                  ? "Csatolmányok feltöltése újra"
                  : "Hibajegy megnyitása"}
              </Button>
            </div>
          </div>
        </div>

        {/*
          A JOBB HASAB NEM ISMETLI A MEZOKET, HANEM A MENETET MONDJA EL.

          Harom sor, ugyanaz a harom lepes, ami balra all. Nem dísz: a felvitel
          sorrendje itt fuggosegi kerdes (a helyszin a partnertol jon), es ez az
          egyetlen hely, ahol ez SZOVEGBEN is ki van mondva.
        */}
        <aside className="space-y-3 rounded-xl border border-dusk-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <h2 className="text-base font-bold tracking-tight text-dusk-950">
            Rövid út a kész feladatig
          </h2>
          <p className="text-sm leading-6 text-dusk-500">
            A hibajegy összefogja a bejelentést, az eszközöket és a
            munkalapokat.
          </p>
          <ol className="space-y-2 text-sm text-dusk-600">
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">1.</span>
              Partner és pontos helyszín
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">2.</span>
              Rövid, felismerhető leírás
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">3.</span>A munka
              kiosztása a csapatnak
            </li>
          </ol>
        </aside>
      </div>
    </div>
  );
}
