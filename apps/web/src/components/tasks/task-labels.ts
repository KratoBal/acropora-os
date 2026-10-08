import type { TaskSource, TaskStatus, TaskStatusFilter } from "@acropora/types";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Nyitott",
  DONE: "Lezárt",
};

export const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  MANUAL: "Kézi felvitel",
  AGENT: "Flotta",
  QUOTE: "Árajánlat",
};

const budapestDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
});

/**
 * „KÉSŐBB” (#1582 P8): an open task due after today (Budapest). It is not
 * today's work, so the board shows it apart, under the rest.
 */
export function isTaskLater(
  task: { status: TaskStatus; dueAt?: string },
  now: Date = new Date(),
): boolean {
  return (
    task.status === "OPEN" &&
    task.dueAt !== undefined &&
    budapestDay.format(new Date(task.dueAt)) > budapestDay.format(now)
  );
}

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatTaskDay(isoDate: string): string {
  return dayFormatter.format(new Date(isoDate));
}

export const TASK_STATUS_FILTERS: {
  value: TaskStatusFilter;
  label: string;
}[] = [
  { value: "OPEN", label: "Nyitott" },
  { value: "DONE", label: "Lezárt" },
  { value: "ALL", label: "Mind" },
];

export function isTaskStatusFilter(value: string): value is TaskStatusFilter {
  return TASK_STATUS_FILTERS.some((filter) => filter.value === value);
}

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTaskDate(isoDate: string): string {
  return dateFormatter.format(new Date(isoDate));
}
