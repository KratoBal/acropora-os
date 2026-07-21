import type {
  CreateUserInput,
  SetUserPasswordInput,
  UpdateUserInput,
  UserDetail,
  UserListResponse,
} from "@acropora/types";
import { apiRequest } from "./client";

export const usersApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<UserListResponse>(`/users?${query}`, token, { signal });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<UserDetail>(`/users/${encodeURIComponent(id)}`, token, {
      signal,
    });
  },
  create(token: string, input: CreateUserInput) {
    return apiRequest<UserDetail>("/users", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateUserInput) {
    return apiRequest<UserDetail>(`/users/${encodeURIComponent(id)}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  setPassword(token: string, id: string, input: SetUserPasswordInput) {
    return apiRequest<UserDetail>(
      `/users/${encodeURIComponent(id)}/password`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  activate(token: string, id: string) {
    return apiRequest<UserDetail>(
      `/users/${encodeURIComponent(id)}/activate`,
      token,
      { method: "POST" },
    );
  },
  deactivate(token: string, id: string) {
    return apiRequest<UserDetail>(
      `/users/${encodeURIComponent(id)}/deactivate`,
      token,
      { method: "POST" },
    );
  },
};
