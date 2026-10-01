"use client";

import {
  hasPermission,
  PERMISSIONS,
  type BankStatementImportResult,
} from "@acropora/types";
import { ConfirmDialog, Icon } from "@acropora/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MISSING_INVOICES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  missingInvoicesApi,
  type MissingInvoicesExport,
} from "@/lib/api/missing-invoices";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";

import {
  MissingInvoicesDrawer,
  type ChargeDetailExtras,
} from "./missing-invoices-drawer";
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
 * A DRAWER a tétel részleteivel nyílik (`GET …/items/:id`, nautilus #1303):
 * jelöltek, teendő, Drive. Minden módosítás (párosítás, visszavonás,
 * átsorolás, papír-eredeti, megjegyzés) a frissített tételt adja vissza, és
 * utána a HÓNAP ÚJRATÖLTŐDIK: a csempék a szerver számai (brief 19. pont, 8.).
 * A számla feltöltése (4b, nautilus #1305) ugyanígy megy. A két export
 * (hiánylista, könyvelői csomag) fájlként töltődik le (nautilus #1308).
 */
/** A szerver csak ezekre ad javaslatot (`OPEN_STATES`); a többire nem kérdezünk. */
const JEV_STATES = new Set<ChargeRow["state"]>(["NOT_MATCHED", "NO_INVOICE"]);

/** Egy látható Jev-javaslat; a sor azonosítójával, hogy késve se kerüljön másik drawerbe. */
interface JevPick {
  rowId: string;
  documentId: string;
  confidence: number | null;
}

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
  const [extras, setExtras] = useState<ChargeDetailExtras | null>(null);
  const [jev, setJev] = useState<JevPick | null>(null);
  const jevRequest = useRef<AbortController | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  /**
   * A JEV JAVASLATA KÜLÖN KÉRÉSBEN (acrobot 25871): nem várja meg a drawer, és
   * semmit nem mutat, amíg nincs látható javaslat. Árnyék-módban a válasz üres,
   * tehát a felület betűre ugyanaz; hibánál (időtúllépés, 5xx) csendben semmi.
   * A #1324 végpontjának eddig nem volt hívója: ettől jelenik meg élőben.
   */
  const askJev = (row: ChargeRow) => {
    jevRequest.current?.abort();
    setJev(null);
    if (!JEV_STATES.has(row.state)) return;
    const controller = new AbortController();
    jevRequest.current = controller;
    missingInvoicesApi
      .jevSuggestion(token, row.id, controller.signal)
      .then((suggestion) => {
        if (
          !controller.signal.aborted &&
          suggestion.enabled &&
          suggestion.documentId !== null
        )
          setJev({
            rowId: row.id,
            documentId: suggestion.documentId,
            confidence: suggestion.confidence,
          });
      })
      .catch(() => {
        // a javaslat kimaradása nem hiba: a drawer nélküle is teljes
      });
  };

  const closeDrawer = () => {
    jevRequest.current?.abort();
    setJev(null);
    setOpen(null);
  };

  const openRow = (row: ChargeRow) => {
    setOpen(row);
    setExtras(null);
    setNote(row.comment ?? "");
    setDrawerError(null);
    askJev(row);
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
      // a 409 mondata is ide jön (a számla máshoz van kézzel párosítva)
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

  /**
   * A KÉT EXPORT (nautilus #1308): a fájl a szerver adta néven töltődik le. Egy
   * elutasítás (jog, hónap alakja) a szerver mondatával jelenik meg fent.
   */
  const download = async (
    fetchExport: () => Promise<MissingInvoicesExport>,
  ) => {
    setExporting(true);
    setNotice(null);
    try {
      const { blob, fileName } = await fetchExport();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Az export nem tölthető le.",
      );
    } finally {
      setExporting(false);
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
        onOpenRow={openRow}
        error={error}
        onRetry={() => void load()}
        canManage={canManage}
        onUploadStatement={() => statementInput.current?.click()}
        onDownloadMissing={() =>
          void download(() => missingInvoicesApi.missingXlsx(token, month))
        }
        onDownloadPackage={() =>
          void download(() =>
            missingInvoicesApi.accountantPackage(token, month),
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
        onClose={closeDrawer}
        companyName={companyName}
        extras={extras}
        jevSuggestion={
          jev && open && jev.rowId === open.id && JEV_STATES.has(open.state)
            ? jev
            : null
        }
        onPair={(candidate) =>
          open &&
          void mutate(`pair:${candidate.documentId}`, () =>
            missingInvoicesApi.match(token, open.id, candidate.documentId),
          )
        }
        onUnpair={() => setConfirmUnpair(true)}
        onCategory={(next) =>
          open &&
          void mutate("category", () =>
            missingInvoicesApi.category(token, open.id, next),
          )
        }
        onUpload={(file, kind) =>
          open &&
          void mutate("upload", () =>
            missingInvoicesApi.uploadDocument(token, open.id, file, kind),
          )
        }
        onPaperOriginal={(marked) =>
          open &&
          void mutate("paper", () =>
            missingInvoicesApi.paperOriginal(token, open.id, marked),
          )
        }
        onPayee={(documentId, payee) =>
          open &&
          void mutate(`payee:${documentId}`, () =>
            missingInvoicesApi.markPayee(token, open.id, documentId, payee),
          )
        }
        busy={busy}
        note={note}
        onNote={setNote}
        onSave={() => void saveNote()}
        saving={saving}
        error={drawerError}
        canManage={canManage}
      />
      {/*
        A KÉZI PÁROSÍTÁS VISSZAVONÁSA EGY DÖNTÉST SZÜNTET MEG, ezért a közös
        kérdés előzi meg (a repó szabálya: minden törlő hívás előtt).
      */}
      <ConfirmDialog
        open={confirmUnpair}
        title="A kézi párosítás visszavonása"
        consequence={`A terhelés és a(z) ${open?.document?.number ?? "párosított"} számla kapcsolata megszűnik; a terhelés újra a szabály szerint áll.`}
        recovery="A számla a javasolt számlák közül újra párosítható."
        confirmLabel="Visszavonás"
        busy={busy === "unpair"}
        onConfirm={() => {
          setConfirmUnpair(false);
          if (open)
            void mutate("unpair", () =>
              missingInvoicesApi.unmatch(token, open.id),
            );
        }}
        onCancel={() => setConfirmUnpair(false)}
      />
    </PilotThemeRoot>
  );
}
