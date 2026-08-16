export type TaskStatus = "OPEN" | "DONE";

export type TaskSource = "MANUAL" | "AGENT";

export type TaskStatusFilter = TaskStatus | "ALL";

export interface TaskPersonSummary {
  id: string;
  displayName: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  /**
   * The reasoning behind the task: why it is being asked and what it
   * blocks. This is the primary content of a task, not a footnote to the
   * title, and the UI is expected to present it that way.
   */
  description?: string;
  status: TaskStatus;
  /** External link (typically a Discord thread) the task originated from. */
  linkUrl?: string;
  source: TaskSource;
  assignee: TaskPersonSummary;
  /** Absent for machine-created tasks, which have no acting user. */
  createdBy?: TaskPersonSummary;
  closedBy?: TaskPersonSummary;
  createdAt: string;
  closedAt?: string;
}

export interface TaskListResponse {
  items: TaskSummary[];
  openCount: number;
  doneCount: number;
  /**
   * True when `items` was clipped by the server-side cap. The personal
   * board is not paginated; this flag exists so the UI can say so out loud
   * instead of silently showing a partial list.
   */
  truncated: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  linkUrl?: string;
  /** Defaults to the authenticated user when omitted. */
  assigneeId?: string;
}

export interface TaskAssigneeOptionsResponse {
  items: TaskPersonSummary[];
}
