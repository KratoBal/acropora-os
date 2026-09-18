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

import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Message } from "./ticket-list";

function orderedDepartments(items: WorksheetDepartmentSummary[]) {
  const byParent = new Map<string | null, WorksheetDepartmentSummary[]>();
  for (const item of items.filter((item) => item.isActive)) {
    const entries = byParent.get(item.parentId) ?? [];
    entries.push(item);
    byParent.set(item.parentId, entries);
  }
  const result: { item: WorksheetDepartmentSummary; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const item of byParent.get(parentId) ?? []) {
      result.push({ item, depth });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
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
      .assets(departmentId)
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
    [assetIds, departmentId, description, router, title],
  );

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">ÚJ BEJELENTÉS</p>
          <h1>Hibajegy nyitása</h1>
          <p>Az itt rögzített hibajegy a saját cégéhez kerül.</p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      <form className="form panel" onSubmit={submit}>
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
            <p className="muted">
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
                  {asset.name} <span>{asset.assetNumber}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">
              Ezen a helyszínen nincs megjeleníthető eszköz.
            </p>
          )}
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
