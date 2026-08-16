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

/**
 * Payload of the machine ingest endpoint (`POST /tasks/ingest`), which is
 * authenticated by a service token rather than by a user session.
 */
export interface TaskIngestInput {
  title: string;
  description?: string;
  linkUrl?: string;
  /** The responsible person, looked up by e-mail address. */
  assigneeEmail: string;
  /**
   * The caller's own identifier for this item, e.g. `required-inputs#1.3`.
   * Required, because it is what makes a retry safe: the server stores it
   * namespaced with the token's slug and treats a repeat as the same task.
   * The caller cannot choose the namespace, so one machine caller can never
   * write in another's name.
   */
  reference: string;
}

export interface TaskIngestResult {
  id: string;
  status: TaskStatus;
  /** False when this reference already existed and nothing new was written. */
  created: boolean;
}
