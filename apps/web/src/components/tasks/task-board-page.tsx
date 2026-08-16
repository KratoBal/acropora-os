"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type TaskListResponse,
  type TaskPersonSummary,
  type TaskStatusFilter,
  type TaskSummary,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { tasksApi } from "@/lib/api/tasks";
import {
  formatTaskDate,
  TASK_SOURCE_LABELS,
  TASK_STATUS_FILTERS,
  TASK_STATUS_LABELS,
} from "./task-labels";

export function TaskBoardPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.TASKS_VIEW),
  );

  const [status, setStatus] = useState<TaskStatusFilter>("OPEN");
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [assignees, setAssignees] = useState<TaskPersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await tasksApi.listMine(token, status, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A feladatlista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, status, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void tasksApi
      .assignees(token, controller.signal)
      .then((response) => setAssignees(response.items))
      // A missing assignee list only costs the "felelős" dropdown its
      // options - the board itself stays usable, so this must not surface
      // as a page-level error.
      .catch(() => undefined);
    return () => controller.abort();
  }, [canView, token]);

  const toggle = async (task: TaskSummary) => {
    setPendingId(task.id);
    setError(null);
    try {
      if (task.status === "OPEN") await tasksApi.close(token, task.id);
      else await tasksApi.reopen(token, task.id);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A feladat állapotát nem sikerült módosítani.",
      );
    } finally {
      setPendingId(null);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a feladatokhoz"
        description="tasks.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feladataim"
        description="A rád váró kérdések és feladatok egy helyen, azzal együtt, hogy mit blokkolnak."
        actions={
          <Button onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Mégsem" : "Új feladat"}
          </Button>
        }
      />

      {error ? (
        <Alert
          variant="danger"
          title="Hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      {formOpen ? (
        <TaskForm
          assignees={assignees}
          token={token}
          onCancel={() => setFormOpen(false)}
          onCreated={async () => {
            setFormOpen(false);
            await load();
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {TASK_STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={status === filter.value ? "primary" : "secondary"}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
        {data ? (
          <span className="ml-auto text-sm text-slate-600">
            {data.openCount} nyitott, {data.doneCount} lezárt
          </span>
        ) : null}
      </div>

      {data?.truncated ? (
        <Alert
          variant="info"
          title="A lista csonkolva van"
          description="Túl sok tétel gyűlt össze, ezért csak a legfrissebbek látszanak. Zárj le néhány feladatot, vagy szólj a fejlesztőnek."
        />
      ) : null}

      {loading && !data ? (
        <div aria-label="Feladatok betöltése" className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="clipboard" size={20} />}
          title="Nincs megjeleníthető feladat"
          description={
            status === "OPEN"
              ? "Most nincs nyitott tételed. Ha a flotta kérdez valamit, itt fog megjelenni."
              : "Ebben a szűrésben nincs tétel."
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <ul className="space-y-3">
          {data.items.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={task}
                pending={pendingId === task.id}
                onToggle={() => void toggle(task)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TaskCard({
  onToggle,
  pending,
  task,
}: {
  onToggle: () => void;
  pending: boolean;
  task: TaskSummary;
}) {
  const closed = task.status === "DONE";
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">
          {task.linkUrl ? (
            <a
              href={task.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              {task.title}
            </a>
          ) : (
            task.title
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant={closed ? "neutral" : "info"}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
          {task.source === "AGENT" ? (
            <Badge variant="warning">{TASK_SOURCE_LABELS.AGENT}</Badge>
          ) : null}
        </div>
      </div>

      {/*
        The reasoning is the point of the tile, not the title — so it is
        rendered at body size, uncropped, with its line breaks intact,
        rather than as a faint footnote under the heading.
      */}
      {task.description ? (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
          {task.description}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <span>Felvéve: {formatTaskDate(task.createdAt)}</span>
        <span>
          Kérte: {task.createdBy?.displayName ?? TASK_SOURCE_LABELS.AGENT}
        </span>
        {task.closedAt ? (
          <span>
            Lezárva: {formatTaskDate(task.closedAt)}
            {task.closedBy ? ` (${task.closedBy.displayName})` : ""}
          </span>
        ) : null}
        {task.linkUrl ? (
          <a
            href={task.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-teal-700 underline-offset-4 hover:underline"
          >
            Beszélgetés megnyitása
          </a>
        ) : null}
        <span className="ml-auto">
          <Button variant="secondary" onClick={onToggle} disabled={pending}>
            {closed ? "Újranyitás" : "Lezárás"}
          </Button>
        </span>
      </div>
    </Card>
  );
}

function TaskForm({
  assignees,
  onCancel,
  onCreated,
  token,
}: {
  assignees: TaskPersonSummary[];
  onCancel: () => void;
  onCreated: () => Promise<void>;
  token: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("A feladat címe kötelező.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await tasksApi.create(token, {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(linkUrl.trim() ? { linkUrl: linkUrl.trim() } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      });
      await onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A feladatot nem sikerült létrehozni.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">Új feladat</h2>
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <FormField label="Cím">
        <Input
          aria-label="Feladat címe"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder="Rövid, egy mondatos összefoglaló"
        />
      </FormField>

      <FormField
        label="Indoklás"
        description="Miért kérdezzük, és mit blokkol, ha nincs meg. Ez a tétel lényege."
      >
        <Textarea
          aria-label="Indoklás"
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={4000}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Hivatkozás"
          description="A beszélgetés vagy szál teljes címe (http:// vagy https://)."
        >
          <Input
            aria-label="Hivatkozás"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            maxLength={500}
            placeholder="https://discord.com/channels/..."
          />
        </FormField>

        <FormField label="Felelős">
          <Select
            aria-label="Felelős"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Én magam</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.displayName}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Mégsem
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? "Mentés..." : "Feladat létrehozása"}
        </Button>
      </div>
    </Card>
  );
}
