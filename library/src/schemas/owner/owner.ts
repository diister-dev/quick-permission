import type { Schema } from "../../types/schema.ts";

type OwnerRequest = {
    from: string;
    owner: string;
}

export function owner(): Schema<object, OwnerRequest> {
    return {
        name: "owner",
        request(obj: unknown): obj is OwnerRequest {
            if (typeof obj !== "object" || !obj) return false;
            if (typeof (obj as OwnerRequest).from !== "string") return false;
            if (typeof (obj as OwnerRequest).owner !== "string") return false;
            return true;
        }
    }
}