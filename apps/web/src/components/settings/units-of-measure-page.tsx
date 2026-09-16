"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  UNIT_OF_MEASURE_KINDS,
  unitOfMeasureKindLabel,
  type UnitOfMeasure,
  type UnitOfMeasureKind,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { unitsOfMeasureApi } from "@/lib/api/units-of-measure";
import {
  sortUnits,
  TORLES_HELYETT_KIVEZETES,
  unitFormProblem,
} from "./units-of-measure";

/**
 * A MÉRTÉKEGYSÉGEK KARBANTARTÁSA, SAJÁT MENÜPONT ALATT.
 *
 * MIÉRT TÖRZSADAT ÉS NEM SZABAD SZÖVEG (acrobot döntése): ma tíz helyen áll
 * szabad szöveges mértékegység a sémában, és abból már két világ keveredik.
 * Egy karbantartott lista az egyetlen, amiből később a munkalap is dolgozhat --
 * és a kikötés az volt, hogy KÉT PÁRHUZAMOS LISTA UTÓLAG NEM VONHATÓ ÖSSZE.
 *
 * A FAJTA SZERINT KÜLÖN, EGY KÉPERNYŐN. Három kérés megy, nem egy: a végpont
 * fajtát követel, mert fajta nélkül a három világ egyvelege jönne vissza. Aki
 * itt fajtát vált, LÁTJA, hogy másik listát néz.
 *
 * A KIVEZETÉS NEM TÖRLÉS, és ez a lap legfontosabb mondata. Amire eszköz
 * hivatkozik, azt a szerver nem törli (némán ürítené ki a mezőket); a
 * kivezetés a választóból veszi ki, a meglévő értékek mellett viszont
 * olvasható marad.
 */
export function UnitsOfMeasurePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const role = session?.user.role;
  /**
   * A JOG A SZEREPBŐL JÖN, NEM A TOKENBŐL.
   *
   * Egy `token`-re kötött feltétel élesben, sütis munkamenetben mindig üres --
   * és akkor a képernyő üzemképesnek látszik, de semmit nem enged. Ez pontosan
   * az a hiba, ami a Tartalom-felvitelnél kiment (2026-09-02).
   */
  const canManage = role
    ? hasPermission(role, PERMISSIONS.SETTINGS_MANAGE)
    : false;

  const [kind, setKind] = useState<UnitOfMeasureKind>("PERFORMANCE");
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * A TORLES KERDEZ, ES A KERDES A KOZOS KOMPONENSE.
   *
   * Nem stilus: a torles VEGLEGES, es a `recovery` mezo letezese az, ami a
   * kerdest feltetette velem -- van-e visszaut. Itt nincs, es a kivezetes az,
   * ami ugyanazt a hatast eri el visszafordithatoan. Ezert a kerdes SZOVEGE a
   * kivezetesre mutat, nem csak figyelmeztet.
   */
  const [torlendo, setTorlendo] = useState<UnitOfMeasure | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setListError(null);
      try {
        // A KARBANTARTO A KIVEZETETTEKET IS LATJA. Enelkul azt hinne, hogy
        // torlodtek, es ujra felvinne ugyanazt a kodot -- amit az egyediseg
        // aztan elutasit, latszolag ok nelkul.
        const response = await unitsOfMeasureApi.list(token, kind, {
          includeInactive: true,
          signal,
        });
        setUnits(sortUnits(response.items));
      } catch (error) {
        if (signal?.aborted) return;
        setListError(
          error instanceof Error
            ? error.message
            : "A lista betöltése nem sikerült.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [kind, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function felvitel() {
    const problem = unitFormProblem({ code, name });
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const created = await unitsOfMeasureApi.create(token, {
        code: code.trim(),
        name: name.trim(),
        kind,
      });
      setUnits((elozo) => sortUnits([...elozo, created]));
      setCode("");
      setName("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "A felvitel nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function kivezetes(unit: UnitOfMeasure) {
    setBusyId(unit.id);
    setRowError(null);
    try {
      const updated = await unitsOfMeasureApi.update(token, unit.id, {
        isActive: !unit.isActive,
      });
      setUnits((elozo) =>
        sortUnits(elozo.map((sor) => (sor.id === unit.id ? updated : sor))),
      );
    } catch (error) {
      setRowError(
        error instanceof Error ? error.message : "A módosítás nem sikerült.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function torles(unit: UnitOfMeasure) {
    setTorlendo(null);
    setBusyId(unit.id);
    setRowError(null);
    try {
      await unitsOfMeasureApi.remove(token, unit.id);
      setUnits((elozo) => elozo.filter((sor) => sor.id !== unit.id));
    } catch (error) {
      /**
       * A HASZNALATBAN LEVO EGYSEG ELUTASITASA NEM "HIBA", HANEM EGY MASIK UT.
       *
       * A szerver mondata is megnevezi a kivezetest, de az UZENET a hivo
       * nyelven all itt: ha a szerver valasza valaha valtozik, a kezelo
       * akkor is megtudja, MIT tegyen helyette.
       */
      const uzenet =
        error instanceof Error ? error.message : "A törlés nem sikerült.";
      setRowError(
        uzenet.includes("használatban") ? TORLES_HELYETT_KIVEZETES : uzenet,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mértékegységek"
        description="A karbantartott mértékegység-lista. A kivezetett egység kiesik a választóból, a meglévő értékek mellett viszont olvasható marad."
      />

      <Card>
        <CardHeader>
          <span className="font-semibold text-dusk-900">Fajta</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-dusk-500">
            A fajta azt mondja meg, MIT mér az egység -- nem azt, hol
            választható. Három külön lista.
          </p>
          <FormField label="Fajta" htmlFor="unit-kind">
            <Select
              id="unit-kind"
              aria-label="Fajta"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as UnitOfMeasureKind)
              }
            >
              {UNIT_OF_MEASURE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {unitOfMeasureKindLabel[value]}
                </option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <span className="font-semibold text-dusk-900">Új mértékegység</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-dusk-500">
              A(z) „{unitOfMeasureKindLabel[kind]}" listába kerül. A fajta
              utólag nem írható át.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Rövid jel"
                htmlFor="unit-code"
                description="Ahogy a felületen áll: W, kW, l/h."
              >
                <Input
                  id="unit-code"
                  aria-label="Rövid jel"
                  value={code}
                  maxLength={16}
                  onChange={(event) => setCode(event.target.value)}
                />
              </FormField>
              <FormField
                label="Név"
                htmlFor="unit-name"
                description="A teljes név, ami a listában segít választani."
              >
                <Input
                  id="unit-name"
                  aria-label="Név"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
            </div>
            {formError ? (
              <Alert variant="danger" title="A felvitel nem ment végig">
                {formError}
              </Alert>
            ) : null}
            <Button onClick={() => void felvitel()} disabled={saving}>
              {saving ? "Mentés..." : "Felvitel"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <span className="font-semibold text-dusk-900">
            {unitOfMeasureKindLabel[kind]}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-dusk-500">
            A kivezetettek is itt állnak, hogy ne tűnjenek töröltnek.
          </p>
          {listError ? (
            <Alert variant="danger" title="A lista nem töltődött be">
              {listError}
            </Alert>
          ) : null}
          {rowError ? (
            <Alert variant="danger" title="A művelet nem ment végig">
              {rowError}
            </Alert>
          ) : null}
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : units.length === 0 ? (
            <EmptyState
              title="Ebben a fajtában még nincs mértékegység"
              description="Vidd fel az elsőt a fenti űrlappal."
            />
          ) : (
            <ul className="divide-y divide-dusk-100">
              {units.map((unit) => (
                <li
                  key={unit.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <span className="font-semibold text-dusk-900">
                    {unit.code}
                  </span>
                  <span className="text-sm text-dusk-600">{unit.name}</span>
                  {unit.isActive ? null : (
                    <Badge variant="neutral">Kivezetve</Badge>
                  )}
                  {canManage ? (
                    <span className="ml-auto flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={busyId === unit.id}
                        onClick={() => void kivezetes(unit)}
                      >
                        {unit.isActive ? "Kivezetés" : "Visszaállítás"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyId === unit.id}
                        onClick={() => setTorlendo(unit)}
                      >
                        Törlés
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={torlendo !== null}
        title={`Törlöd a(z) „${torlendo?.code ?? ""}" mértékegységet?`}
        consequence="A mértékegység eltűnik a listából, és nem lesz többé választható. Ha bármelyik eszközön már szerepel, a törlést a rendszer elutasítja."
        recovery="Nincs visszaút: a törölt mértékegységet újra fel kell vinni. Ha csak azt szeretnéd, hogy ne legyen választható, vezesd ki helyette -- akkor a meglévő értékek mellett olvasható marad."
        confirmLabel="Végleges törlés"
        busy={busyId !== null}
        onConfirm={() => {
          if (torlendo) void torles(torlendo);
        }}
        onCancel={() => setTorlendo(null)}
      />
    </div>
  );
}
