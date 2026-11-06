"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  PageHeader,
  Textarea,
} from "@acropora/ui";
import {
  formatMoney,
  RENTAL_EQUIPMENT_LIMITS,
  type RentalEquipment,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { rentalEquipmentApi } from "@/lib/api/rental-equipment";

import {
  EMPTY_RENTAL_EQUIPMENT_FORM,
  formFromRentalEquipment,
  rentalEquipmentPayload,
  type RentalEquipmentForm,
} from "./rental-equipment-form";

/**
 * THE RENTAL EQUIPMENT MASTER (task eszkozberles, S1; Balázs, 2026-11-06): one row per rented-out device, edited here and
 * picked on the rental screen. The layout follows the other Settings master lists (asset functions, categories).
 *
 * A device is retired, never deleted: a rental and its printed contract will point at it.
 */
export function RentalEquipmentPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [items, setItems] = useState<RentalEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RentalEquipmentForm>(
    EMPTY_RENTAL_EQUIPMENT_FORM,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const response = await rentalEquipmentApi.list(token, true, signal);
        setItems(response.items);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eszközök nem tölthetők be.",
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const set = (key: keyof RentalEquipmentForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setForm(EMPTY_RENTAL_EQUIPMENT_FORM);
    setEditingId(null);
  };

  const save = async () => {
    const payload = rentalEquipmentPayload(form);
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId === null)
        await rentalEquipmentApi.create(token, payload.input);
      else await rentalEquipmentApi.update(token, editingId, payload.input);
      reset();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (item: RentalEquipment, isActive: boolean) => {
    setError(null);
    try {
      await rentalEquipmentApi.update(token, item.id, { isActive });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem módosítható.",
      );
    }
  };

  const edit = (item: RentalEquipment) => {
    setEditingId(item.id);
    setForm(formFromRentalEquipment(item));
    setError(null);
  };

  const field = (
    key: keyof RentalEquipmentForm,
    label: string,
    options: { maxLength?: number; placeholder?: string; amount?: boolean },
  ) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-dusk-700">{label}</span>
      <Input
        aria-label={label}
        value={form[key]}
        maxLength={options.maxLength}
        inputMode={options.amount ? "numeric" : undefined}
        placeholder={options.placeholder}
        onChange={(event) => set(key)(event.target.value)}
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bérelhető eszközök"
        description="A kölcsönzött eszközök darabonként. Az összegek bruttó forintban értendők. Kivezetni lehet, törölni nem: a bérlések és a szerződések hivatkoznak rájuk."
      />

      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">
            {editingId === null ? "Új eszköz" : "Eszköz szerkesztése"}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("name", "Név", {
              maxLength: RENTAL_EQUIPMENT_LIMITS.name.max,
              placeholder: "pl. Ozmózis víztisztító",
            })}
            {field("serialNumber", "Gyári szám", {
              maxLength: RENTAL_EQUIPMENT_LIMITS.serialNumber.max,
            })}
            {field("dailyFeeHuf", "Napi bérleti díj (Ft)", { amount: true })}
            {field("depositHuf", "Kaució (Ft)", { amount: true })}
            {field("replacementValueHuf", "Pótlási érték (Ft)", {
              amount: true,
            })}
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">
              Tartozékok
            </span>
            <Textarea
              aria-label="Tartozékok"
              value={form.accessories}
              maxLength={RENTAL_EQUIPMENT_LIMITS.accessories.max}
              placeholder="pl. tápegység, 2 tömlő, használati útmutató"
              onChange={(event) => set("accessories")(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">
              Megjegyzés
            </span>
            <Textarea
              aria-label="Megjegyzés"
              value={form.note}
              maxLength={RENTAL_EQUIPMENT_LIMITS.note.max}
              onChange={(event) => set("note")(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Mentés…" : editingId === null ? "Felvétel" : "Mentés"}
            </Button>
            {editingId !== null ? (
              <Button variant="secondary" disabled={saving} onClick={reset}>
                Mégse
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">A lista</h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-dusk-500">Betöltés…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-dusk-500">
              Még egyetlen bérelhető eszköz sincs felvéve.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div
                    className={
                      item.isActive
                        ? "space-y-1 text-sm text-dusk-800"
                        : "space-y-1 text-sm text-dusk-400"
                    }
                  >
                    <p
                      className={
                        item.isActive
                          ? "font-medium"
                          : "font-medium line-through"
                      }
                    >
                      {item.name}
                      {item.serialNumber ? ` · ${item.serialNumber}` : ""}
                      {item.isActive ? "" : " (kivezetve)"}
                    </p>
                    <p>
                      Napi díj {formatMoney(item.dailyFeeHuf, "HUF")} · Kaució{" "}
                      {formatMoney(item.depositHuf, "HUF")} · Pótlási érték{" "}
                      {formatMoney(item.replacementValueHuf, "HUF")}
                    </p>
                    {item.accessories ? (
                      <p className="text-dusk-500">
                        Tartozékok: {item.accessories}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => edit(item)}>
                      Szerkesztés
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void setActive(item, !item.isActive)}
                    >
                      {item.isActive ? "Kivezetés" : "Visszahozás"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
