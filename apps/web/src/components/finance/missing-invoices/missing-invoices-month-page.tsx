"use client";

import { hasPermission, PERMISSIONS } from "@acropora/types";
import { Icon } from "@acropora/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MISSING_INVOICES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { missingInvoicesApi } from "@/lib/api/missing-invoices";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";

import {
  MissingInvoicesDrawer,
  type ChargeDetailExtras,
  type UploadKind,
} from "./missing-invoices-drawer";
import {
  CHARGE_TABS,
  FILTER_CATEGORIES,
  type CandidateInvoice,
  type ChargeCategory,
  type ChargeRow,
  type ChargeTab,
} from "./missing-invoices-model";
import {
  MissingInvoicesMonthDetail,
  type MonthFilters,
} from "./missing-invoices-month-detail";
import {
  toChargeRow,
  toExtras,
  toSummary,
  type MissingInvoiceItemDetail,
  type MissingInvoiceMonthDetail,
} from "./missing-invoices-wire";

const PAGE_SIZE = 25;
const TAB_KEYS = CHARGE_TABS.map((tab) => tab.key);

/**
 * PÉNZÜGY > HIÁNYZÓ SZÁMLÁK > EGY HÓNAP (Figma 343:219, 343:867, 343:435).
 *
 * A FÜL, A SZŰRŐK ÉS A LAP AZ URL-BEN (`useUrlQuery`, #1271): egy tételből
 * visszajövet ugyanaz a nézet áll. A szűrés és a lapozás a szerveren fut
 * (brief 7. pont).
 *
 * MINDEN MÓDOSÍTÁS UTÁN A HÓNAP ÚJRATÖLTŐDIK: egy párosítás a csempék
 * számait is mozgatja (brief 19. pont, 8.), és azt a szerver számolja, nem a
 * felület.
 */
export function MissingInvoicesMonthPage({ month }: { month: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );

  const { params, update } = useUrlQuery();
  const tab = urlChoice<ChargeTab>(params, "tab", TAB_KEYS, "MISSING");
  const category = urlChoice<ChargeCategory | "">(
    params,
    "category",
    ["", ...FILTER_CATEGORIES],
    "",
  );
  const accountId = params.get("accountId") ?? "";
  const page = urlPage(params);
  const appliedSearch = params.get("q") ?? "";
  const [search, setSearch] = useState(appliedSearch);

  const [detail, setDetail] = useState<MissingInvoiceMonthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const statementInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState<ChargeRow | null>(null);
  const [extras, setExtras] = useState<ChargeDetailExtras | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        update({
          q: search.trim() || null,
          ...(search.trim() !== appliedSearch ? { page: null } : {}),
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [appliedSearch, search, update]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        setDetail(
          await missingInvoicesApi.month(
            token,
            month,
            {
              tab,
              q: appliedSearch,
              category,
              accountId,
              page,
              pageSize: PAGE_SIZE,
            },
            signal,
          ),
        );
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Az egyeztetés nem tölthető be.",
        );
      }
    },
    [accountId, appliedSearch, category, month, page, tab, token],
  );

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canView, load]);

  // A CÉG NEVE a hónaplista hívásából jön (nautilus 25303): a drawer „kérd
  // újra az … nevére” mondata ebből szól, nem egy beégetett névből.
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    missingInvoicesApi
      .months(token, controller.signal)
      .then((response) => setCompanyName(response.company.name))
      .catch(() => setCompanyName(null));
    return () => controller.abort();
  }, [canView, token]);

  const setFilters = (patch: Partial<MonthFilters>) => {
    if (patch.search !== undefined) setSearch(patch.search);
    const next: Record<string, string | null> = {};
    if (patch.category !== undefined) next.category = patch.category || null;
    if (patch.accountId !== undefined) next.accountId = patch.accountId || null;
    if (Object.keys(next).length > 0) update({ ...next, page: null });
  };

  const applyItem = (item: MissingInvoiceItemDetail) => {
    setOpen(toChargeRow(item));
    setExtras(toExtras(item));
  };

  const openRow = (row: ChargeRow) => {
    setOpen(row);
    setExtras(null);
    setNote(row.comment ?? "");
    setDrawerError(null);
    missingInvoicesApi
      .item(token, row.id)
      .then(applyItem)
      .catch((cause: unknown) =>
        setDrawerError(
          cause instanceof Error
            ? cause.message
            : "A terhelés részletei nem tölthetők be.",
        ),
      );
  };

  /** Egy módosítás a drawerből: a válasz a frissített tétel, utána a hónap. */
  const mutate = async (
    key: string,
    run: () => Promise<MissingInvoiceItemDetail>,
  ) => {
    setBusy(key);
    setDrawerError(null);
    try {
      applyItem(await run());
      await load();
    } catch (cause) {
      setDrawerError(
        cause instanceof Error ? cause.message : "A módosítás nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveNote = async () => {
    if (!open) return;
    setSaving(true);
    setDrawerError(null);
    try {
      applyItem(
        await missingInvoicesApi.comment(token, open.id, note.trim() || null),
      );
      await load();
    } catch (cause) {
      setDrawerError(
        cause instanceof Error ? cause.message : "A megjegyzés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const downloadAs = async (fetchBlob: () => Promise<Blob>, name: string) => {
    setExporting(true);
    setNotice(null);
    try {
      const url = URL.createObjectURL(await fetchBlob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "A letöltés nem sikerült.",
      );
    } finally {
      setExporting(false);
    }
  };

  const uploadStatement = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    try {
      await missingInvoicesApi.uploadStatement(token, file);
      await load();
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "A kivonat feltöltése nem sikerült.",
      );
    }
  };

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <p className="text-sm text-pilot-grey-600">
          A Hiányzó számlákhoz finance.view jog kell.
        </p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <Link
        href={MISSING_INVOICES_PATH}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a hónapokhoz
      </Link>
      {notice ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {notice}
        </p>
      ) : null}
      <MissingInvoicesMonthDetail
        month={month}
        accounts={detail?.accounts ?? []}
        state={detail?.status ?? null}
        summary={detail ? toSummary(detail.tiles) : null}
        tab={tab}
        onTab={(next) =>
          update({ tab: next === "MISSING" ? null : next, page: null })
        }
        filters={{ search, category, accountId }}
        onFilters={setFilters}
        rows={detail ? detail.items.map(toChargeRow) : null}
        totalItems={detail?.pagination.totalItems ?? 0}
        page={page}
        pageSize={detail?.pagination.pageSize ?? PAGE_SIZE}
        totalPages={detail?.pagination.totalPages ?? 1}
        onPage={(next) => update({ page: next === 1 ? null : String(next) })}
        onOpenRow={openRow}
        error={error}
        onRetry={() => void load()}
        canManage={canManage}
        onUploadStatement={() => statementInput.current?.click()}
        onDownloadMissing={() =>
          void downloadAs(
            () => missingInvoicesApi.missingList(token, month),
            `hianylista-${month}.xlsx`,
          )
        }
        onDownloadPackage={() =>
          void downloadAs(
            () => missingInvoicesApi.accountantPackage(token, month),
            `konyveloi-csomag-${month}.pdf`,
          )
        }
        exporting={exporting}
      />
      <input
        ref={statementInput}
        type="file"
        accept=".csv,text/csv"
        aria-label="Bankkivonat CSV"
        className="sr-only"
        onChange={(event) => {
          void uploadStatement(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <MissingInvoicesDrawer
        row={open}
        onClose={() => setOpen(null)}
        companyName={companyName}
        extras={extras}
        onPair={(candidate: CandidateInvoice) =>
          open &&
          void mutate(`pair:${candidate.documentId}`, () =>
            missingInvoicesApi.match(
              token,
              open.id,
              candidate.documentId,
              candidate.source,
            ),
          )
        }
        onUnpair={() =>
          open &&
          void mutate("unpair", () =>
            missingInvoicesApi.unmatch(token, open.id),
          )
        }
        onCategory={(next) =>
          open &&
          void mutate("category", () =>
            missingInvoicesApi.category(token, open.id, next),
          )
        }
        busy={busy}
        onUpload={(file: File, kind: UploadKind) =>
          open &&
          void mutate("upload", () =>
            missingInvoicesApi.uploadDocument(token, open.id, file, kind),
          )
        }
        note={note}
        onNote={setNote}
        onSave={() => void saveNote()}
        saving={saving}
        error={drawerError}
        canManage={canManage}
      />
    </PilotThemeRoot>
  );
}
