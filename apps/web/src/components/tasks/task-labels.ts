import type { TaskSource, TaskStatus, TaskStatusFilter } from "@acropora/types";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Nyitott",
  DONE: "Lezárt",
};

export const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  MANUAL: "Kézi felvitel",
  AGENT: "Flotta",
};

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
