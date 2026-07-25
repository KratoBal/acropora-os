import { type AuthenticatedUser } from "@acropora/types";
import { UsersService } from "./users.service.js";
import { CreateUserDto, SetUserPasswordDto, UpdateUserDto, UserListQueryDto } from "./dto/user.dto.js";
export declare class UsersController {
    private readonly service;
    constructor(service: UsersService);
    list(query: UserListQueryDto): Promise<import("@acropora/types").UserListResponse>;
    detail(id: string): Promise<import("@acropora/types").UserDetail>;
    create(input: CreateUserDto, user: AuthenticatedUser): Promise<import("@acropora/types").UserDetail>;
    update(id: string, input: UpdateUserDto, user: AuthenticatedUser): Promise<import("@acropora/types").UserDetail>;
    setPassword(id: string, input: SetUserPasswordDto, user: AuthenticatedUser): Promise<import("@acropora/types").UserDetail>;
    activate(id: string, user: AuthenticatedUser): Promise<import("@acropora/types").UserDetail>;
    deactivate(id: string, user: AuthenticatedUser): Promise<import("@acropora/types").UserDetail>;
}
