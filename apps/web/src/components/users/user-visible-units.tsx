"use client";

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS, type UserRole } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";

interface Assignment {
  departmentId: string;
  createdAt: string;
  department: { name: string; code: string };
}
interface Unit {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
}

/**
 * MELYIK ALEGYSÉGEK HIBAJEGYEIT LÁTJA EZ A FIÓK.
 *
 * A SAJÁT JOGÁN KAPUZVA, NEM A LAPÉRA BÍZVA. A felhasználó-lap
 * `users.manage` alatt áll, ez a szakasz `service.visibility.assign` alatt.
 * Ma a két halmaz egybeesik (OWNER és ADMIN), de NEM ugyanaz a szabály: ha
 * valaki később ad `service.visibility.assign` jogot `users.manage` nélkül, az
 * illető nem érné el a szakaszt, és ez csendben derülne ki.
 *
 * A VÁLASZTHATÓ LISTÁT A SZERVER ADJA, nem itt áll össze: a lánc felhasználó ->
 * szállító -> tükör-vevő sor -> alegységek, és a felület a második lépéshez nem
 * lát utat.
 */
export function UserVisibleUnits({
  userId,
  role,
  binding,
}: {
  userId: string;
  role: UserRole | undefined;
  /**
   * MIHEZ VAN KOTVE A FIOK -- ES EZ CSAK AZ URES ESET MONDATAHOZ KELL.
   *
   * A VALASZTHATO LISTAT tovabbra is a szerver adja; ez a mezo nem szur es nem
   * dont. Az URES eset viszont HAROMFELE, es a ket kotes MAS mondatot kivan:
   * egy vevohoz kotott fiok tulajdonosanak a "tukor-vevo sor" ertelmetlen szo.
   *
   * A KET KOTES KIZARJA EGYMAST (`User_at_most_one_partner_check`), tehat ez
   * harom allapot, nem negy.
   */
  binding: "customer" | "supplier" | "internal";
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const viewerRole = session?.user.role;
  const canAssign = viewerRole
    ? hasPermission(viewerRole, PERMISSIONS.SERVICE_VISIBILITY_ASSIGN)
    : false;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<Assignment | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canAssign) return;
      setLoading(true);
      try {
        const [sorok, valaszthato] = await Promise.all([
          serviceJobsApi.visibilityAssignments(token, userId, signal),
          serviceJobsApi.selectableUnits(token, userId, signal),
        ]);
        setAssignments(sorok);
        setUnits(valaszthato.items);
        setLoadError(null);
      } catch (cause) {
        /**
         * A HIBA NEM ÜRES LISTA. Egy sikertelen lekérdezés üres tömbre esve azt
         * mondaná, hogy ennek a fióknak nincs hozzárendelése -- és aki ezt
         * látja, nyugodtan adna neki egy újat, holott lehet, hogy már van.
         */
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "A láthatósági hozzárendelések nem tölthetők be.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canAssign, token, userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const assign = async () => {
    if (!chosen) return;
    setBusy(true);
    setActionError(null);
    try {
      await serviceJobsApi.assignUnit(token, userId, chosen);
      setChosen("");
      await load();
    } catch (cause) {
      // A SZERVER MONDATA MEGY KI, NEM EGY SAJÁT: a három elutasítás három
      // KÜLÖNBÖZŐ teendőt ad (nem partner-fiók, nincs tükör-sor, másik
      // partner alegysége), és egy közös "nem sikerült" mindhármat elrejtené.
      setActionError(
        cause instanceof Error
          ? cause.message
          : "A hozzárendelés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const unassign = async (departmentId: string) => {
    setToRemove(null);
    setBusy(true);
    setActionError(null);
    try {
      await serviceJobsApi.unassignUnit(token, userId, departmentId);
      await load();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A levétel nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canAssign) return null;

  const mar = new Set(assignments.map((a) => a.departmentId));
  const valaszthato = units.filter((u) => !mar.has(u.id));

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Látható alegységek</h2>
      {/*
        A HATÁS KIMONDVA, MERT KÜLÖNBEN NEM LÁTSZIK. Ez a lista dönti el, hogy
        a partner-oldali fiók MELYIK hibajegyeket látja -- egy üres lista nem
        "nincs beállítva", hanem "csak a sajátjait".
      */}
      <p className="text-xs text-dusk-500">
        Ezeknek az alegységeknek a hibajegyeit látja a fiók. Üres listával csak
        a saját nyitott jegyeit.
      </p>

      {loadError ? (
        <Alert
          variant="danger"
          title="Nem tölthető be"
          description={loadError}
        />
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          title="Nem sikerült"
          description={actionError}
        />
      ) : null}

      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : assignments.length ? (
        <ul className="space-y-1 text-sm" aria-label="Látható alegységek">
          {assignments.map((row) => (
            <li key={row.departmentId} className="flex items-center gap-2">
              <span className="font-medium">
                {row.department.code} - {row.department.name}
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setToRemove(row)}
              >
                Levétel
              </Button>
            </li>
          ))}
        </ul>
      ) : loadError ? null : (
        <EmptyState
          title="Nincs hozzárendelt alegység"
          description="A fiók egyelőre csak a saját nyitott jegyeit látja."
        />
      )}

      {units.length === 0 && !loading && !loadError ? (
        /*
          AZ URES VALASZTO RENDES ALLAPOTBOL JON, nem hibabol -- a mondat ezert
          a FELTETELT nevezi meg.

          ES A FELTETEL A FIOK ALAKJATOL FUGG. A korabbi szoveg MINDIG a
          szallitos lancot sorolta fel (szerviz partner, tukor-vevo sor, aktiv
          alegyseg), holott a mai partner-fiokok TOBBSEGE vevohoz kotott. Annak
          a tulajdonosa harom olyan feltetelt olvasott, amibol egy sem rola
          szolt -- es joggal hitte, hogy a mondat ertelmetlen.
          (Merve 2026-09-17, eles akadaskent.)
        */
        <p className="text-xs text-dusk-500">
          {binding === "customer"
            ? "Ehhez a fiókhoz nincs választható alegység. Alegység akkor jelenik meg itt, ha a fiók vevője alatt aktív alegység áll."
            : binding === "supplier"
              ? "Ehhez a fiókhoz nincs választható alegység. Alegység akkor jelenik meg itt, ha a fiók szerviz partneréhez tartozik tükör-vevő sor, és az alatt aktív alegység áll."
              : "Ez a fiók nem partnerhez kötött, ezért nincs mit szűkíteni: belső hatókörrel amúgy is minden hibajegyet lát."}
        </p>
      ) : null}

      {valaszthato.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Alegység hozzáadása"
            className="rounded border px-2 py-1 text-sm"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">Válassz alegységet</option>
            {valaszthato.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} - {unit.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!chosen || busy}
            onClick={() => void assign()}
          >
            Hozzáadás
          </Button>
        </div>
      ) : null}

      {/*
        A SZEREP KIÍRVA, MERT A KÉT TENGELY KÜLÖN ÁLL: ez a lista az
        alegység-hatókört szűkíti, a szerep pedig azt mondja meg, MIT tehet a
        fiók. Aki csak az egyiket látja, a másikat fogja hibásnak hinni.
      */}
      {role ? (
        <p className="text-xs text-dusk-500">
          A hozzárendelés a hatókört szűkíti; hogy mit tehet a fiók, azt a
          szerepköre dönti el.
        </p>
      ) : null}

      {/*
        A LEVÉTEL VISSZAFORDÍTHATÓ, MÉGIS KÉRDEZÜNK -- és a kettő nem mond
        ellent. A hiba ALAKJA dönti el: egy véletlen levétel után a
        partner-oldali fiók CSENDBEN kevesebb hibajegyet lát, és nem tudja,
        miért. A visszaút viszont ott áll ugyanezen a lapon, egy kattintással,
        ezért a kérdés ezt ki is mondja -- egy kérdés, ami nem mondja meg, van-e
        visszaút, ugyanúgy megijeszt egy ártalmatlan lépésnél, mint egy
        véglegesnél.
      */}
      <ConfirmDialog
        open={toRemove !== null}
        title="Leveszed ezt az alegységet a fiókról?"
        consequence={
          toRemove
            ? `A fiók ezután nem látja a(z) ${toRemove.department.code} - ${toRemove.department.name} alegység hibajegyeit.`
            : ""
        }
        recovery="Visszatehető: az alegység újra megjelenik a választóban, és ugyanitt bármikor visszaadható."
        confirmLabel="Levétel"
        busy={busy}
        onConfirm={() => {
          if (toRemove !== null) void unassign(toRemove.departmentId);
        }}
        onCancel={() => setToRemove(null)}
      />
    </Card>
  );
}
