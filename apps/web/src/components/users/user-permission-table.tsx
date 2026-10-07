"use client";

import { Alert, Button, Card, Skeleton } from "@acropora/ui";
import {
  areaLevel,
  areaLevels,
  isMachineRole,
  OWNER_GRANTED_PERMISSIONS,
  overridesForDesired,
  PERMISSION_AREAS,
  permissionOverrideChangeProblem,
  withAreaLevel,
  type Permission,
  type PermissionArea,
  type PermissionLevel,
  type UserPermissionOverview,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { usersApi } from "@/lib/api/users";

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  none: "Nincs",
  view: "Megtekintés",
  manage: "Kezelés",
};

const OWNER_ONLY = new Set<Permission>(OWNER_GRANTED_PERMISSIONS);

/**
 * A FELHASZNÁLÓ JOGAI, TERÜLETENKÉNT (3. lépés; Balázs döntése 2026-10-06:
 * szerepkör-sablon + egyéni eltérés; acrobot 27194).
 *
 * Minden sor egy terület: Nincs / Megtekintés / Kezelés. Ami a szerep
 * sablonjából jön, halványan áll (a „Sablon:” felirat mutatja); ami attól
 * eltér, kiemelve. A terület többi joga (pl. a számlázás kiállítása) a sor
 * alatt külön kapcsoló. Mentéskor a kívánt állapotból számolt eltérések mennek
 * a szerverre (`PUT /users/:id/permissions`), a teljes listát cserélve.
 *
 * A SZABÁLYOKAT A KÖZÖS FÜGGVÉNY MONDJA KI, ugyanaz, amit a szerver futtat
 * (`permissionOverrideChangeProblem`): a felület előre jelzi, a szerver dönt.
 */
export function UserPermissionTable({
  userId,
  customerId,
  supplierId,
}: {
  userId: string;
  customerId: string | null;
  supplierId: string | null;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [overview, setOverview] = useState<UserPermissionOverview | null>(null);
  const [desired, setDesired] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((next: UserPermissionOverview) => {
    setOverview(next);
    setDesired(new Set(next.effective));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    usersApi
      .permissions(token, userId, controller.signal)
      .then(apply)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error ? cause.message : "A jogok nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [apply, token, userId]);

  const template = useMemo(
    () => new Set<Permission>(overview?.template ?? []),
    [overview],
  );
  const after = useMemo(
    () => (overview ? overridesForDesired(overview.role, desired) : []),
    [desired, overview],
  );
  const problem = overview
    ? permissionOverrideChangeProblem({
        actorRole: session?.user.role ?? "VIEWER",
        self: session?.user.id === userId,
        target: { role: overview.role, customerId, supplierId },
        before: overview.overrides,
        after,
      })
    : null;
  const effectiveNow = useMemo(
    () => new Set<Permission>(overview?.effective ?? []),
    [overview],
  );
  const dirty =
    desired.size !== effectiveNow.size ||
    [...desired].some((permission) => !effectiveNow.has(permission));

  if (error && !overview)
    return <Alert variant="danger" title="Jogosultságok" description={error} />;
  if (!overview)
    return (
      <Card className="p-6">
        <Skeleton className="h-64" />
      </Card>
    );

  const readOnly = isMachineRole(overview.role);
  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      apply(await usersApi.replacePermissions(token, userId, after));
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="font-semibold">Jogosultságok</h2>
        <p className="mt-1 text-xs text-dusk-500">
          A szerepkör sablonja az alapértelmezés; ettől felhasználónként el
          lehet térni. Az eltérő sor kiemelve áll. A módosítás a felhasználó
          következő kérésénél érvényes, újra belépnie nem kell.
        </p>
        {readOnly ? (
          <p className="mt-2 text-sm text-dusk-700">
            Gépi fiók: a jogai a feladatához tartoznak, nem módosíthatók.
          </p>
        ) : null}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-dusk-100 text-left text-xs uppercase tracking-wide text-dusk-500">
            <th className="py-2 pr-3 font-medium">Terület</th>
            <th className="py-2 pr-3 font-medium">Szint</th>
            <th className="py-2 font-medium">Sablon</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_AREAS.map((area) => (
            <AreaRows
              key={area.key}
              area={area}
              desired={desired}
              template={template}
              readOnly={readOnly}
              onChange={setDesired}
            />
          ))}
        </tbody>
      </table>

      {problem && dirty ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="text-sm text-emerald-700">A jogosultságok elmentve.</p>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setDesired(new Set(template))}
          >
            Vissza a sablonra
          </Button>
          <Button
            variant="secondary"
            disabled={saving || !dirty}
            onClick={() => setDesired(new Set(effectiveNow))}
          >
            Elvetés
          </Button>
          <Button
            disabled={saving || !dirty || problem !== null}
            onClick={() => void save()}
          >
            {saving ? "Mentés…" : "Jogosultságok mentése"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function AreaRows({
  area,
  desired,
  template,
  readOnly,
  onChange,
}: {
  area: PermissionArea;
  desired: Set<Permission>;
  template: Set<Permission>;
  readOnly: boolean;
  onChange: (next: Set<Permission>) => void;
}) {
  const level = areaLevel(area, desired);
  const templateLevel = areaLevel(area, template);
  const differs = level !== templateLevel;
  const ownerOnly =
    (area.view && OWNER_ONLY.has(area.view)) ||
    (area.manage && OWNER_ONLY.has(area.manage));
  return (
    <>
      <tr
        className={`border-b border-dusk-50 ${differs ? "bg-amber-50" : ""}`}
        data-testid={`terulet-${area.key}`}
      >
        <td className="py-2 pr-3 font-medium text-dusk-800">
          {area.label}
          {ownerOnly ? <OwnerOnlyMark /> : null}
          {differs ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
              egyéni
            </span>
          ) : null}
        </td>
        <td className="py-2 pr-3">
          <div
            role="radiogroup"
            aria-label={`${area.label} szintje`}
            className="inline-flex overflow-hidden rounded-md ring-1 ring-dusk-200"
          >
            {areaLevels(area).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={level === option}
                disabled={readOnly}
                onClick={() => onChange(withAreaLevel(area, desired, option))}
                className={`px-2.5 py-1 text-xs ${
                  level === option
                    ? "bg-dusk-800 text-white"
                    : "bg-white text-dusk-600 hover:bg-dusk-50"
                } disabled:cursor-not-allowed`}
              >
                {LEVEL_LABEL[option]}
              </button>
            ))}
          </div>
        </td>
        <td className="py-2 text-xs text-dusk-400">
          {LEVEL_LABEL[templateLevel]}
        </td>
      </tr>
      {area.extras.map((extra) => {
        const on = desired.has(extra.permission);
        const extraDiffers = on !== template.has(extra.permission);
        return (
          <tr
            key={extra.permission}
            className={`border-b border-dusk-50 ${extraDiffers ? "bg-amber-50" : ""}`}
          >
            <td className="py-1.5 pl-5 pr-3 text-dusk-600" colSpan={2}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={readOnly}
                  onChange={(event) => {
                    const next = new Set(desired);
                    if (event.target.checked) next.add(extra.permission);
                    else next.delete(extra.permission);
                    onChange(next);
                  }}
                />
                {extra.label}
                {OWNER_ONLY.has(extra.permission) ? <OwnerOnlyMark /> : null}
                {extraDiffers ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                    egyéni
                  </span>
                ) : null}
              </label>
            </td>
            <td className="py-1.5 text-xs text-dusk-400">
              {template.has(extra.permission) ? "Igen" : "Nem"}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function OwnerOnlyMark() {
  return (
    <span
      title="Ezt a jogot csak tulajdonos adhatja meg."
      className="ml-2 rounded bg-dusk-100 px-1.5 py-0.5 text-[11px] text-dusk-600"
    >
      csak tulajdonos
    </span>
  );
}
