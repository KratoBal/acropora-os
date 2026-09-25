"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { WaterType, WorksheetDepartmentSummary } from "@acropora/types";

import { helyszinFa } from "@/lib/helyszin-fa";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Message } from "./ticket-list";
import { CIMKE, LAP_CIM, LAP_FEJLEC, LAP_LEIRAS, PANEL } from "./frame";

/**
 * ÚJ AKVÁRIUM FELVITELE A PORTÁLON.
 *
 * A Partner Portál Akváriumok terv harmadik UI-köre
 * (`agents/murena/partner-portal-akvariumok-terv-2026-09-25.md`), Balázs
 * 2026-09-25-i döntése szerint: a mezők Akvárium neve*, Víztípus*, Víztérfogat,
 * Helyszín* (kötelezőként jelölve a Figmában is).
 *
 * === "ESZKÖZÖK A MEDENCÉBEN" NINCS EBBEN A KÖRBEN ===
 *
 * A Figma terv az új akvárium felviteléhez helyszín szerint szűrt eszköz-
 * választót is rajzol. Balázs döntése (emlék 1843, 2026-09-25 14:24): az
 * eszköz akváriumhoz rendelése/levétele a portálon KÜLÖN JOGOSULTSÁGHOZ
 * kötött, és ez a jog ma még nem létezik (külön PR jön rá). Amíg nincs
 * meg, ez az űrlap sem kínál hozzárendelést -- ugyanaz a döntés, ami az
 * adatlapon (`aquarium-detail.tsx`) is olvasásra korlátozza az "Eszközök a
 * medencében" kártyát.
 *
 * === A HELYSZÍN ITT KÖTELEZŐ, A HIBAJEGY-NYITÁSNÁL NEM ===
 *
 * A `new-ticket.tsx`-en a helyszín elhagyható. Itt a szerver
 * (`aquariums.service.ts` `resolvePartnerOwnership`) 400-at ad
 * `departmentId` nélkül -- ez NEM UI-döntés, hanem a szerver kényszeríti,
 * mert egy helyszín nélküli akvárium nem tudná, KI adta ki a hozzáférést
 * hozzá a portálon (a láthatóság a `departmentId`-n áll, lásd
 * `aquarium-visibility.ts`).
 *
 * === EZ AZ ÁG A #1118/#1121 ELŐTT, ÖNÁLLÓAN ÉPÜLT ===
 *
 * (acrobot kérése: ne stackeljek.) A lánc azóta beolvadt -- ez a fejezet
 * a #1118/#1121 utáni post-merge mainre rebase-elve készült el: az "Új
 * akvárium" gomb bekötve az `aquarium-list.tsx`-en, és a `portal-shell.tsx`
 * `user.navigation`-alapú kapuja (lásd annak fejlécét) a
 * `pathname.startsWith("/akvariumok")` feltételen át már ELEVE fedi ezt az
 * útvonalat is (`/akvariumok/uj` is `/akvariumok`-kal kezdődik) -- nem
 * kellett hozzá külön kód.
 */

const WATER_TYPE_OPTIONS: { value: WaterType; label: string }[] = [
  { value: "TENGERI", label: "Tengeri" },
  { value: "EDESVIZI", label: "Édesvízi" },
];

function orderedDepartments(items: WorksheetDepartmentSummary[]) {
  return helyszinFa(items.filter((item) => item.isActive));
}

export function NewAquarium() {
  const { user } = useAuth();
  const router = useRouter();
  const customerId = user?.customerId ?? "";

  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [waterType, setWaterType] = useState<WaterType>("TENGERI");
  const [volumeLiters, setVolumeLiters] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      .finally(() => setDepartmentsLoading(false));
  }, [customerId]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      if (!departmentId) {
        setError("A helyszín megadása kötelező.");
        return;
      }
      setSubmitting(true);
      try {
        const parsedVolume = volumeLiters.trim()
          ? Number(volumeLiters)
          : undefined;
        const created = await partnerApi.createAquarium({
          departmentId,
          name,
          waterType,
          ...(parsedVolume !== undefined
            ? { systemVolumeLiters: parsedVolume, systemVolumeIsManual: true }
            : {}),
        });
        router.replace(`/akvariumok/${created.id}`);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Az akvárium nem hozható létre.",
        );
        setSubmitting(false);
      }
    },
    [departmentId, name, router, volumeLiters, waterType],
  );

  return (
    // A `content` osztaly indoka: lasd `settings.tsx` azonos megjegyzeset.
    <section className="content">
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>ÚJ AKVÁRIUM</p>
          <h1 className={LAP_CIM}>Akvárium felvitele</h1>
          <p className={LAP_LEIRAS}>
            Az itt felvitt akvárium a saját cégéhez, az Ön hozzárendelt
            helyszínei közül a megadotthoz kerül.
          </p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      <form className={`form ${PANEL}`} onSubmit={submit}>
        <label>
          Akvárium neve
          <input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Például: Trópusi korall, 1. medence"
          />
        </label>
        <label>
          Víztípus
          <select
            required
            value={waterType}
            onChange={(event) => setWaterType(event.target.value as WaterType)}
          >
            {WATER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Víztérfogat (liter)
          <input
            type="number"
            min={0}
            step="1"
            value={volumeLiters}
            onChange={(event) => setVolumeLiters(event.target.value)}
            placeholder="Nem kötelező"
          />
        </label>
        <label>
          Helyszín
          <select
            required
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            disabled={departmentsLoading}
          >
            <option value="">Válasszon helyszínt</option>
            {locations.map(({ item, depth }) => (
              <option
                key={item.id}
                value={item.id}
              >{`${"— ".repeat(depth)}${item.name} (${item.code})`}</option>
            ))}
          </select>
        </label>
        {/*
          UGYANAZ A MINTA, MINT A `new-ticket.tsx`-EN: a hozzárendelés
          nélküli fiók üres választót kap, és ez nem hibának, hanem a
          helyzet okának néz ki -- lásd annak fejlécét a teljes indoklásért.
          Itt a helyzet SÚLYOSABB, mert a helyszín itt kötelező: a hozzá-
          rendelés nélküli partner egyáltalán nem tud akváriumot felvinni.
        */}
        {!departmentsLoading && locations.length === 0 ? (
          <p className="leading-[1.5] text-[#666677]">
            Önhöz nincs helyszín rendelve, ezért akváriumot sem tud felvinni. A
            hozzárendelést az Acropora ügyfélszolgálatán kérheti.
          </p>
        ) : null}
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => router.back()}
          >
            Mégsem
          </button>
          <button type="submit" disabled={submitting || locations.length === 0}>
            {submitting ? "Létrehozás…" : "Akvárium létrehozása"}
          </button>
        </div>
      </form>
    </section>
  );
}
