import { UsersRepository } from "./users.repository.js";
import type { CreateUserDto, SetUserPasswordDto, UpdateUserDto, UserListQueryDto } from "./dto/user.dto.js";
export declare class UsersService {
    private readonly repository;
    constructor(repository: UsersRepository);
    list(query: UserListQueryDto): Promise<import("@acropora/types").UserListResponse>;
    detail(id: string): Promise<import("@acropora/types").UserDetail>;
    create(input: CreateUserDto, actorId: string): Promise<import("@acropora/types").UserDetail>;
    update(id: string, input: UpdateUserDto, actorId: string): Promise<import("@acropora/types").UserDetail>;
    setPassword(id: string, input: SetUserPasswordDto, actorId: string): Promise<import("@acropora/types").UserDetail>;
    activate(id: string, actorId: string): Promise<import("@acropora/types").UserDetail>;
    deactivate(id: string, actorId: string): Promise<import("@acropora/types").UserDetail>;
    private map;
}
