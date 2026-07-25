import { Repository } from "@acropora/database";
import type { UserDetail, UserListResponse } from "@acropora/types";
import type { CreateUserDto, SetUserPasswordDto, UpdateUserDto, UserListQueryDto } from "./dto/user.dto.js";
export declare class UsersRepository extends Repository {
    constructor();
    list(query: UserListQueryDto): Promise<UserListResponse>;
    detail(id: string): Promise<UserDetail | null>;
    create(input: CreateUserDto, actorId: string): Promise<UserDetail>;
    update(id: string, input: UpdateUserDto, actorId: string): Promise<UserDetail>;
    setPassword(id: string, input: SetUserPasswordDto, actorId: string): Promise<UserDetail>;
    setActive(id: string, isActive: boolean, actorId: string): Promise<UserDetail>;
    private toSummary;
    private toDetail;
    private event;
}
