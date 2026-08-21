"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CustomerSummary,
  type WorksheetContentInput,
  type WorksheetCustomerSummary,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { customersApi } from "@/lib/api/customers";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  emptyLine,
  toLineInput,
  WorksheetLineEditor,
  type WorksheetLineDraft,
} from "./worksheet-line-editor";

interface HeaderDraft {
  subject: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string;
}

function emptyHeader(): HeaderDraft {
  return {
    subject: "",
    description: "",
    issueDate: "",
    fulfillmentDate: "",
    dueDate: "",
  };
}

/** Az üres dátummezőt nem küldjük tovább üres szövegként: az API dátumot
 * vár vagy semmit, és az üres szöveg érvénytelen dátum, nem hiányzó adat. */
function dateOrNull(value: string): string | null {
  return value.trim() ? value : null;
}

function content(
  header: HeaderDraft,
  lines: WorksheetLineDraft[],
): WorksheetContentInput {
  return {
    subject: header.subject.trim(),
    description: header.description.trim() ? header.description.trim() : null,
    issueDate: dateOrNull(header.issueDate),
    fulfillmentDate: dateOrNull(header.fulfillmentDate),
    dueDate: dateOrNull(header.dueDate),
    lines: lines.map(toLineInput),
  };
}

/** The customer list endpoint refuses anything above 100 per page
 * (`customer.dto.ts`: `@Max(100)`), so this is the ceiling, not a preference.
 * Raising it here alone would not widen the picker, it would make the request
 * invalid and leave the picker empty. */
const CUSTOMER_PAGE_SIZE = 100;

/** Safety stop for the loop below, so a runaway pagination response cannot keep
 * the editor fetching forever. At the page size above this covers 2000
 * customers, well past what the shop has. Past that the picker truncates again
 * -- the same failure this fix is about -- so the loop says so out loud instead
 * of quietly dropping the tail. */
const CUSTOMER_PAGE_LIMIT = 20;

export interface WorksheetEditorPageProps {
  /** Megadva a lap piszkozatát szerkeszti, enélkül újat vesz fel. */
  worksheetId?: string;
}

export function WorksheetEditorPage({ worksheetId }: WorksheetEditorPageProps) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  /** The partner of a worksheet that already exists. It comes from the
   * worksheet itself rather than from the customer list, because the list is
   * deliberately not loaded while editing: the field is read-only there, so
   * fetching every customer to display one name would be pages of requests for
   * nothing. Without this the disabled Select had no option matching the
   * assigned id and fell back to the placeholder, so an existing worksheet
   * looked like it had no partner at all. */
  const [assignedCustomer, setAssignedCustomer] =
    useState<WorksheetCustomerSummary | null>(null);
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [customerId, setCustomerId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [header, setHeader] = useState<HeaderDraft>(emptyHeader);
  const [lines, setLines] = useState<WorksheetLineDraft[]>([emptyLine()]);
  const [newDepartment, setNewDepartment] = useState({ code: "", name: "" });
  const [loading, setLoading] = useState(Boolean(worksheetId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage || worksheetId) return;
    const controller = new AbortController();
    /** The picker needs every customer, but the endpoint hands out one page at
     * a time, so walk the pages instead of asking for a single big one. Asking
     * for one page of 100 was the defect: customer 101 onwards never reached
     * the dropdown, and nothing failed -- the list simply ended mid-alphabet. */
    const loadCustomers = async () => {
      const collected: CustomerSummary[] = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= CUSTOMER_PAGE_LIMIT) {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: String(CUSTOMER_PAGE_SIZE),
        });
        const response = await customersApi.list(
          token,
          query,
          controller.signal,
        );
        collected.push(...response.items);
        totalPages = response.pagination.totalPages;
        page += 1;
      }
      setCustomers(collected);
      if (totalPages > CUSTOMER_PAGE_LIMIT) {
        setError(
          `A vevőlista hosszabb, mint amit a választó egyszerre kezelni tud, ezért csak az első ${CUSTOMER_PAGE_LIMIT * CUSTOMER_PAGE_SIZE} vevő választható. Szólj a fejlesztőnek.`,
        );
      }
    };
    loadCustomers().catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError("A vevőlista nem tölthető be.");
    });
    return () => controller.abort();
  }, [canManage, token, worksheetId]);

  const loadDepartments = useCallback(
    async (owner: string, signal?: AbortSignal) => {
      if (!owner) {
        setDepartments([]);
        return;
      }
      try {
        const response = await worksheetsApi.departments(token, owner, signal);
        setDepartments(response.items.filter((item) => item.isActive));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("Az alegységek nem tölthetők be.");
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(customerId, controller.signal);
    return () => controller.abort();
  }, [customerId, loadDepartments]);

  useEffect(() => {
    if (!worksheetId || !canManage) return;
    const controller = new AbortController();
    setLoading(true);
    worksheetsApi
      .detail(token, worksheetId, controller.signal)
      .then((detail) => {
        const current = detail.currentVersion;
        setCustomerId(detail.customer.id);
        setAssignedCustomer(detail.customer);
        setDepartmentId(detail.department.id);
        setHeader({
          subject: current.subject,
          description: current.description ?? "",
          issueDate: current.issueDate ?? "",
          fulfillmentDate: current.fulfillmentDate ?? "",
          dueDate: current.dueDate ?? "",
        });
        setLines(
          current.lines.map((line) => ({
            description: line.description,
            detail: line.detail ?? "",
            quantity: line.quantity,
            unit: line.unit,
            unitNet: line.unitNet,
            vatRatePercent: line.vatRatePercent,
          })),
        );
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalap nem tölthető be.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, token, worksheetId]);

  const addDepartment = async () => {
    if (!customerId) return;
    setError(null);
    try {
      const created = await worksheetsApi.createDepartment(token, customerId, {
        code: newDepartment.code.trim().toUpperCase(),
        name: newDepartment.name.trim(),
      });
      setDepartments((current) => [...current, created]);
      setDepartmentId(created.id);
      setNewDepartment({ code: "", name: "" });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az alegység felvitele nem sikerült.",
      );
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = content(header, lines);
      const saved = worksheetId
        ? await worksheetsApi.updateDraft(token, worksheetId, body)
        : await worksheetsApi.create(token, {
            ...body,
            customerId,
            departmentId,
          });
      router.push(`/szerviz/munkalapok/${saved.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
      setSaving(false);
    }
  };

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod munkalapot írni"
        description="service.manage jogosultság szükséges."
      />
    );

  if (loading)
    return (
      <div className="space-y-3" aria-label="Munkalap betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  /** One partner on an existing worksheet, every selectable partner on a new
   * one. The two never mix: the field cannot be changed once the worksheet
   * exists, because the number was built from this partner. */
  const partnerOptions: { id: string; displayName: string }[] = assignedCustomer
    ? [assignedCustomer]
    : customers;

  const canSubmit =
    Boolean(header.subject.trim()) &&
    (Boolean(worksheetId) || (Boolean(customerId) && Boolean(departmentId)));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz"
        title={worksheetId ? "Munkalap szerkesztése" : "Új munkalap"}
        description={
          worksheetId
            ? "A piszkozat teljes tartalma cserélődik a mentéskor."
            : "A sorszám a lezáráskor keletkezik, a piszkozatnak nincs száma."
        }
        actions={
          <Link
            href={
              worksheetId
                ? `/szerviz/munkalapok/${worksheetId}`
                : "/szerviz/munkalapok"
            }
          >
            <Button variant="secondary">Mégsem</Button>
          </Link>
        }
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <Card className="grid gap-4 p-4 md:grid-cols-2">
        <FormField label="Partner">
          <Select
            aria-label="Partner"
            value={customerId}
            disabled={Boolean(worksheetId)}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setDepartmentId("");
            }}
          >
            <option value="">Válassz partnert</option>
            {partnerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Alegység"
          description="A munkalapszám középső tagja is ebből lesz."
        >
          <Select
            aria-label="Alegység"
            value={departmentId}
            disabled={Boolean(worksheetId) || !customerId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Válassz alegységet</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} — {department.name}
              </option>
            ))}
          </Select>
        </FormField>
        {!worksheetId && customerId ? (
          <div className="grid gap-2 md:col-span-2 md:grid-cols-[120px_1fr_auto]">
            <Input
              aria-label="Új alegység kódja"
              value={newDepartment.code}
              placeholder="Kód (BIO)"
              onChange={(event) =>
                setNewDepartment((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
            <Input
              aria-label="Új alegység neve"
              value={newDepartment.name}
              placeholder="Név (Biodóm)"
              onChange={(event) =>
                setNewDepartment((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Button
              type="button"
              variant="secondary"
              disabled={
                !newDepartment.code.trim() || !newDepartment.name.trim()
              }
              onClick={() => void addDepartment()}
            >
              Alegység felvitele
            </Button>
          </div>
        ) : null}
        <FormField label="Tárgy" className="md:col-span-2">
          <Input
            aria-label="Tárgy"
            value={header.subject}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                subject: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Keltezés">
          <Input
            aria-label="Keltezés"
            type="date"
            value={header.issueDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                issueDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Teljesítés">
          <Input
            aria-label="Teljesítés"
            type="date"
            value={header.fulfillmentDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                fulfillmentDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Határidő">
          <Input
            aria-label="Határidő"
            type="date"
            value={header.dueDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Megjegyzés" className="md:col-span-2">
          <Textarea
            aria-label="Megjegyzés"
            rows={3}
            value={header.description}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </FormField>
      </Card>

      <WorksheetLineEditor
        lines={lines}
        onChange={setLines}
        disabled={saving}
      />

      <div className="flex justify-end">
        <Button disabled={!canSubmit || saving} onClick={() => void submit()}>
          {saving ? "Mentés..." : "Mentés"}
        </Button>
      </div>
    </div>
  );
}
