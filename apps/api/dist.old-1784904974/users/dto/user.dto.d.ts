import { type UserRole } from "@acropora/types";
export declare class CreateUserDto {
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
    password?: string;
}
export declare class UpdateUserDto {
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: UserRole;
    expectedUpdatedAt: string;
}
export declare class SetUserPasswordDto {
    password: string;
}
export declare class UserListQueryDto {
    page: number;
    pageSize: number;
    search?: string;
    status: "ACTIVE" | "INACTIVE" | "ALL";
    role?: UserRole;
}
