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
  type WorksheetContentInput,
  type WorksheetCustomerSummary,
  type WorksheetSelectablePartner,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "./worksheet-assignee-picker";
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

  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  /** Whether the partner list has come back at all. An empty picker means two
   * different things before and after the answer arrives, and only one of them
   * is worth explaining: an empty list is a rule, a list that never arrived is
   * a broken connection, and that already has its own message. */
  const [partnersLoaded, setPartnersLoaded] = useState(false);
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
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(worksheetId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * A FELELŐSÖK CSAK A FELVITELNÉL kerülnek ide. Egy meglévő lapon a kiosztást a
   * részletek oldal szerkeszti: az a lap AZONOSSÁGÁHOZ tartozik, nem a
   * piszkozat tartalmához, amit ez az űrlap cserél.
   */
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage && !worksheetId,
  );

  useEffect(() => {
    if (!canManage || worksheetId) return;
    const controller = new AbortController();
    /** The picker reads the service partners, not the buyers: a worksheet is
     * written for a partner, and a webshop customer never gets one.
     *
     * The endpoint hands back the whole list rather than pages of it, and the
     * list it hands back is already narrowed to partners a sheet can actually
     * be finished for -- one that has no partner code could be picked, worked
     * on, and then refuse to close. What each entry carries is the id the
     * worksheet stores, so everything below this line is unchanged. */
    worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => {
        setPartners(response.items);
        setPartnersLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError("A partnerlista nem tölthető be.");
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
            // A HIÁNYZÓ ÁR ÜRES MEZŐ AZ ŰRLAPON. A szerkesztőben az üres
            // mező a "még nincs kitöltve" alakja, és a mentés ugyanígy
            // küldi vissza - a nulla ott is értéknek látszana.
            unitNet: line.unitNet ?? "",
            vatRatePercent: line.vatRatePercent ?? "",
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
            assigneeIds,
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
    : partners.map((partner) => ({
        id: partner.customerId,
        displayName: `${partner.partnerCode} - ${partner.name}`,
      }));

  /** The picker is narrowed on purpose: a partner with no abbreviation could be
   * picked and worked on, and would then refuse to close, in front of the
   * technician rather than the person who can fix it. That rule is invisible
   * from here, though - an empty dropdown looks like a broken screen, so it
   * says out loud why it is empty and where the missing field lives. */
  const noSelectablePartners =
    !worksheetId && partnersLoaded && partnerOptions.length === 0;

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
        <FormField
          label="Partner"
          description={
            noSelectablePartners
              ? "Csak az a partner választható, akinél be van pipálva a Szerviz, és van munkalap-rövidítése. A rövidítést a partner adatlapján lehet felvinni."
              : undefined
          }
        >
          <Select
            aria-label="Partner"
            value={customerId}
            disabled={Boolean(worksheetId)}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setDepartmentId("");
            }}
          >
            <option value="">
              {noSelectablePartners
                ? "Nincs választható szerviz partner"
                : "Válassz partnert"}
            </option>
            {partnerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Alegység"
          description="A munkalapszám első tagja is ebből lesz."
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
        {!worksheetId ? (
          <FormField
            label="Felelősök"
            className="md:col-span-2"
            description="Elhagyható: a kiosztás a lap adatlapján később is elvégezhető."
          >
            <div className="space-y-1">
              <WorksheetAssigneePicker
                candidates={candidates}
                selected={assigneeIds}
                onToggle={(userId) =>
                  setAssigneeIds((current) => toggleAssignee(current, userId))
                }
              />
              {candidatesError ? (
                <p className="text-xs font-medium text-rose-600">
                  {candidatesError}
                </p>
              ) : null}
            </div>
          </FormField>
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
