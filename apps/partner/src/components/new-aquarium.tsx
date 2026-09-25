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
import {
  Icon,
  PilotButton,
  PilotCard,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";

import { helyszinFa } from "@/lib/helyszin-fa";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Message } from "./ticket-list";

/**
 * ÚJ AKVÁRIUM FELVITELE A PORTÁLON -- PILOT-STÍLUS (Balázs döntése, emlék
 * 1847, 2026-09-25 16:04 UTC).
 *
 * A MEZŐK ÉS A LOGIKA VÁLTOZATLANOK a korábbi körhöz képest (Akvárium
 * neve*, Víztípus*, Víztérfogat, Helyszín* -- a szerver oldali kötelező
 * `departmentId` és a `resolvePartnerOwnership` ugyanúgy érvényes, lásd
 * `aquariums.service.ts`). CSAK A KERET cserélt: a régi `frame.tsx`
 * (`LAP_FEJLEC`/`LAP_CIM`/`PANEL`) helyett `PilotCard`/`PilotFormField`/
 * `PilotInput`/`PilotSelect`/`PilotButton` (`packages/ui/src/pilot-ui.tsx`),
 * a belső web `pilot-aquarium-editor-page.tsx` felviteli mezőinek
 * elrendezését követve.
 *
 * === MIÉRT NINCS HOSSZ/SZÉLESSÉG/MAGASSÁG MEZŐ ===
 *
 * A belső űrlap ezekből számolja a litert (`resolveAquariumVolume`). A
 * portál MINDIG közvetlen liter-értéket kér -- Balázs kifejezett kérése
 * erre a körre (emlék 1847): "FIZIKAI MERETEK NINCSENEK (hossz/szel/mag),
 * csak a liter". A `systemVolumeIsManual: true` innen mindig igaz, hiszen
 * a partner sosem méretekből, hanem közvetlenül adja meg -- ugyanígy volt
 * a korábbi körben is, ez nem új döntés.
 *
 * === "ESZKÖZÖK A MEDENCÉBEN" TOVÁBBRA SINCS EBBEN A KÖRBEN ===
 *
 * Az eszköz-hozzárendelés a 3. kör (emlék 1843, külön jog), erre az
 * űrlapra nem vonatkozik ebben a körben sem.
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
    <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          ÚJ AKVÁRIUM
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Akvárium felvitele
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          Az itt felvitt akvárium a saját cégéhez, az Ön hozzárendelt helyszínei
          közül a megadotthoz kerül.
        </p>
      </div>

      {error ? <Message tone="error" text={error} /> : null}

      <form onSubmit={submit} className="max-w-xl">
        <PilotCard>
          <div className="flex flex-col gap-4 p-5">
            <PilotFormField label="Akvárium neve" required>
              <PilotInput
                value={name}
                onChange={setName}
                placeholder="Például: Trópusi korall, 1. medence"
              />
            </PilotFormField>

            <PilotFormField label="Víztípus" required>
              <PilotSelect
                value={waterType}
                onChange={(value) => setWaterType(value as WaterType)}
              >
                {WATER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>

            <PilotFormField label="Víztérfogat (liter)">
              <PilotInput
                type="number"
                min={0}
                value={volumeLiters}
                onChange={setVolumeLiters}
                placeholder="Nem kötelező"
              />
            </PilotFormField>

            <PilotFormField
              label="Helyszín"
              required
              help={
                !departmentsLoading && locations.length === 0
                  ? "Önhöz nincs helyszín rendelve, ezért akváriumot sem tud felvinni. A hozzárendelést az Acropora ügyfélszolgálatán kérheti."
                  : undefined
              }
            >
              <PilotSelect
                value={departmentId}
                onChange={setDepartmentId}
                disabled={departmentsLoading}
              >
                <option value="">Válasszon helyszínt</option>
                {locations.map(({ item, depth }) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >{`${"— ".repeat(depth)}${item.name} (${item.code})`}</option>
                ))}
              </PilotSelect>
            </PilotFormField>
          </div>
        </PilotCard>

        <div className="mt-4 flex items-center gap-2">
          <PilotButton
            type="button"
            variant="secondary"
            onClick={() => router.back()}
          >
            Mégsem
          </PilotButton>
          <PilotButton
            type="submit"
            disabled={submitting || locations.length === 0}
          >
            {submitting ? (
              "Létrehozás…"
            ) : (
              <>
                <Icon name="plus" size={14} />
                Akvárium létrehozása
              </>
            )}
          </PilotButton>
        </div>
      </form>
    </PilotThemeRoot>
  );
}
