import type {
  CreateTaskInput,
  MyServiceWorkResponse,
  MyServiceWorkView,
  TaskAssigneeOptionsResponse,
  TaskListResponse,
  TaskStatusFilter,
  TaskSummary,
} from "@acropora/types";

import { apiRequest } from "./client";

export const tasksApi = {
  /** A szervizes Feladataim tartalma (kártya 041a3dd5). */
  serviceWork(token: string, view: MyServiceWorkView, signal?: AbortSignal) {
    return apiRequest<MyServiceWorkResponse>(
      `/tasks/service-work?view=${encodeURIComponent(view)}`,
      token,
      { signal },
    );
  },
  listMine(token: string, status: TaskStatusFilter, signal?: AbortSignal) {
    return apiRequest<TaskListResponse>(
      `/tasks/mine?status=${encodeURIComponent(status)}`,
      token,
      { signal },
    );
  },
  assignees(token: string, signal?: AbortSignal) {
    return apiRequest<TaskAssigneeOptionsResponse>("/tasks/assignees", token, {
      signal,
    });
  },
  create(token: string, input: CreateTaskInput) {
    return apiRequest<TaskSummary>("/tasks", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  close(token: string, id: string) {
    return apiRequest<TaskSummary>(
      `/tasks/${encodeURIComponent(id)}/close`,
      token,
      { method: "PATCH" },
    );
  },
  reopen(token: string, id: string) {
    return apiRequest<TaskSummary>(
      `/tasks/${encodeURIComponent(id)}/reopen`,
      token,
      { method: "PATCH" },
    );
  },
};
