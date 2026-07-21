import type { UserRole } from "./auth.js";

export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetail extends UserSummary {
  avatarUrl?: string;
  passwordUpdatedAt?: string;
}

export type UserStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

export interface UserListResponse {
  items: UserSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  password?: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: UserRole;
  expectedUpdatedAt: string;
}

export interface SetUserPasswordInput {
  password: string;
}
