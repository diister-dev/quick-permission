export type User = {
    id: `user:${string}`;
}

export const users: User[] = [
    { id: "user:1" },
    { id: "user:2" },
    { id: "user:3" },
];

export type Group = {
    id: `group:${string}`;
}

export const groups: Group[] = [
    { id: "group:admin" },
    { id: "group:user" },
    { id: "group:guest" },
];

export type UserGroup = {
    userId: `user:${string}`;
    groupId: `group:${string}`;
}

export const userGroups: UserGroup[] = [
    { userId: "user:1", groupId: "group:admin" },
    { userId: "user:2", groupId: "group:user" },
    { userId: "user:3", groupId: "group:user" },
];

export type Article = {
    id: `article:${string}`;
    ownerId: User["id"];
}

export const articles: Article[] = [
    { id: "article:1", ownerId: "user:1" },
    { id: "article:2", ownerId: "user:2" },
];

export type Comment = {
    id: `comment:${string}`;
    articleId: Article["id"];
    ownerId: User["id"];
    content: string;
}

export const comments: Comment[] = [
    { id: "comment:1", articleId: "article:1", ownerId: "user:1", content: "Hello" },
    { id: "comment:2", articleId: "article:1", ownerId: "user:2", content: "World" },
    { id: "comment:3", articleId: "article:2", ownerId: "user:3", content: "!" },
];