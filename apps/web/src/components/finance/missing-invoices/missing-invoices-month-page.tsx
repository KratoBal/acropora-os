"use client";

import {
  hasPermission,
  PERMISSIONS,
  type BankStatementImportResult,
} from "@acropora/types";
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

import { MissingInvoicesDrawer } from "./missing-invoices-drawer";
import { MissingInvoicesImportResult } from "./missing-invoices-import-result";
import {
  CHARGE_TABS,
  FILTER_CATEGORIES,
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
  toSummary,
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
 * EBBEN A KÖRBEN OLVASÓ LAP (acrobot 25309): a hónap, a csempék, a tábla és a
 * kivonat-feltöltés áll. A tétel részletei (jelöltek, teendő), a párosítás, a
 * megjegyzés és az exportok nautilus következő szeleteivel jönnek; a drawer
 * addig a sor adatait mutatja, és ezt kimondja.
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
  const [notice, setNotice] = useState<string | null>(null);
  const statementInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<BankStatementImportResult | null>(
    null,
  );
  const [open, setOpen] = useState<ChargeRow | null>(null);

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

  const uploadStatement = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    try {
      setImported(await missingInvoicesApi.uploadStatement(token, file));
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
      {imported ? (
        <MissingInvoicesImportResult
          result={imported}
          onClose={() => setImported(null)}
        />
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
        onOpenRow={setOpen}
        error={error}
        onRetry={() => void load()}
        canManage={canManage}
        onUploadStatement={() => statementInput.current?.click()}
        exporting={false}
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
        extras={null}
        detailsLater
        onPair={() => undefined}
        onUnpair={() => undefined}
        onCategory={() => undefined}
        busy={null}
        onUpload={() => undefined}
        note={open?.comment ?? ""}
        onNote={() => undefined}
        onSave={() => undefined}
        saving={false}
        error={null}
        canManage={false}
      />
    </PilotThemeRoot>
  );
}
