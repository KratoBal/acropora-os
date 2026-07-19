import type { AuthenticatedUser } from "@acropora/types";

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
  authToken?: string;
}

export interface DevelopmentLoginDto {
  email: string;
}
