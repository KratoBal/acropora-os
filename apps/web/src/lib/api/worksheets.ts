import type {
  CreateWorksheetDepartmentInput,
  CreateWorksheetInput,
  SetWorksheetAssigneesInput,
  SignWorksheetVersionInput,
  UpdateWorksheetDraftInput,
  WorksheetAssignableUserListResponse,
  WorksheetAttachableListResponse,
  WorksheetSelectablePartnerListResponse,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  WorksheetDetail,
  WorksheetListResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/service/worksheets";

function worksheetPath(id: string, suffix = "") {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const worksheetsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<WorksheetListResponse>(`${base}?${query}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDetail>(worksheetPath(id), token, { signal });
  },
  /** A lapok, amik alatt meg nincs hibajegy. A hibajegy felulete keri. */
  attachable(token: string, customerId: string, signal?: AbortSignal) {
    return apiRequest<WorksheetAttachableListResponse>(
      `${base}/attachable?customerId=${encodeURIComponent(customerId)}`,
      token,
      { signal },
    );
  },
  selectablePartners(token: string, signal?: AbortSignal) {
    return apiRequest<WorksheetSelectablePartnerListResponse>(
      `${base}/selectable-partners`,
      token,
      { signal },
    );
  },
  assignableUsers(token: string, signal?: AbortSignal) {
    return apiRequest<WorksheetAssignableUserListResponse>(
      `${base}/assignable-users`,
      token,
      { signal },
    );
  },
  departments(token: string, customerId: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDepartmentListResponse>(
      `${base}/customers/${encodeURIComponent(customerId)}/departments`,
      token,
      { signal },
    );
  },
  createDepartment(
    token: string,
    customerId: string,
    input: CreateWorksheetDepartmentInput,
  ) {
    return apiRequest<WorksheetDepartmentSummary>(
      `${base}/customers/${encodeURIComponent(customerId)}/departments`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  create(token: string, input: CreateWorksheetInput) {
    return apiRequest<WorksheetDetail>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  updateDraft(token: string, id: string, input: UpdateWorksheetDraftInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id), token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  setAssignees(token: string, id: string, input: SetWorksheetAssigneesInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/assignees"), token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  close(token: string, id: string) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/close"), token, {
      method: "POST",
    });
  },
  continueFrom(token: string, id: string) {
    return apiRequest<WorksheetDetail>(`${worksheetPath(id)}/continue`, token, {
      method: "POST",
    });
  },
  sign(token: string, id: string, input: SignWorksheetVersionInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/sign"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
