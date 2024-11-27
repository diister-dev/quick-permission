// Permission hierarchy
export type PermissionHierarchy = Record<string, PermissionElement>;

export type PermissionElement = {
    // Hierarchy
    children?: PermissionHierarchy
    // Local
    check?: (state: any) => boolean, // Check if the permission state is valid
    allowed?: (request: any, state: any | undefined) => Promise<boolean> | boolean // Check if the permission request is valid
}

// Permission Keys
export type Permission<T extends PermissionHierarchy> = {
    [K in keyof T]: DeepName<T[K], K>
}[keyof T];

type DeepName<T, K> = K extends string ?
    T extends PermissionElement ?
    T['children'] extends PermissionHierarchy ? K | `${K}.${Permission<T['children']>}` : K
    : never
    : never;

export type FlatPermissionHierarchy<T extends PermissionHierarchy> = {
    [K in Permission<T>]: PermissionValue<T, K>;
};

// Permission value
export type PermissionValue<H extends PermissionHierarchy, K> = K extends `${infer HEAD}.${infer TAIL}` ?
    H[HEAD] extends PermissionElement ?
    H[HEAD]["children"] extends PermissionHierarchy ?
    PermissionValue<H[HEAD]["children"], TAIL> : HEAD
    : never
    : K extends string ?
    H[K] extends PermissionElement ? H[K] : never
    : never;

type PermissionRequest<T> = T extends PermissionElement ?
    T['allowed'] extends (request: infer R, state: any) => Promise<boolean> | boolean ? R : never
    : never;

type PermissionState<T> = T extends PermissionElement ?
    T['allowed'] extends (request: any, state: infer R) => Promise<boolean> | boolean ? R : boolean
    : never;

export type RequestsChild<T> = T extends PermissionHierarchy ?
    {
        [K in keyof FlatPermissionHierarchy<T>]: {
            type: "child",
            key: K,
            request: PermissionRequest<FlatPermissionHierarchy<T>[K]>
        }
    }[keyof FlatPermissionHierarchy<T>]
    : never;

// Permission state
export type PermissionSet<T extends Record<string, PermissionElement>> = Partial<Record<Permission<T>, any>>;
export type PermissionStrictSet<T extends Record<string, PermissionElement>> = Partial<{
    [K in Permission<T>]: PermissionState<PermissionValue<T, K>>;
}>;

// Module
export function validateBy<T extends PermissionHierarchy, V extends Permission<T>>(
    permission: V,
    permissionSet: PermissionSet<T>,
) : Permission<T>[] {
    const splitted = permission.split(".");
    const matched: string[] = [];
    let accumulator = "";
    for (let i = 0; i < splitted.length; i++) {
        accumulator += (i !== 0 ? "." : "") + splitted[i];
        const element = permissionSet[accumulator as Permission<T>];
        if (!element) continue;
        matched.push(accumulator);
    }

    return matched as Permission<T>[];
}

/**
 * Returns a flattened version of a hierarchical object of permissions. The keys in the resulting object are the concatenation
 * of the keys of the original object, separated by periods.
 *
 * @param hierarchy - A hierarchical object of permissions.
 * @param prefix - A string to prefix each key with. Default is an empty string.
 * @returns A flattened version of the given hierarchical object of permissions.
 */
function flatPermissionHierarchy<T extends PermissionHierarchy>(
    hierarchy: T,
    prefix: string = "",
    globalFlat: Record<string, PermissionElement> = {},
): FlatPermissionHierarchy<T> {
    for (const key in hierarchy) {
        const element = hierarchy[key];
        const childs = element.children;
        if (Object.values(globalFlat).includes(element)) throw new Error("Circular hierarchy");
        globalFlat[`${prefix}${key}`] = element;
        if (childs) {
            flatPermissionHierarchy(childs, `${prefix}${key}.`, globalFlat);
        }
    }

    return globalFlat as FlatPermissionHierarchy<T>;
}

type PermissionHierarchyElement<T extends PermissionHierarchy> = {
    validate: <V extends Permission<T>>(
        permission: V,
        permissionSet: PermissionSet<T> | PermissionSet<T>[],
        ...params: PermissionRequest<PermissionValue<T, V>> extends never ? [] : [PermissionRequest<PermissionValue<T, V>>]
    ) => Promise<boolean>;
    check: <V extends Permission<T>>(
        key: V,
        ...params: PermissionState<PermissionValue<T, V>> extends never ? [] : [PermissionState<PermissionValue<T, V>>]
    ) => boolean;
};

export function createPermissionHierarchy<T extends PermissionHierarchy>(hierarchy: T): PermissionHierarchyElement<T> {
    const flatten = flatPermissionHierarchy(hierarchy);

    return {
        // Validate if a key is validated by a permission set
        validate: async <V extends Permission<T>>(
            permission: V,
            permissionSet: PermissionSet<T> | PermissionSet<T>[],
            ...params: PermissionRequest<PermissionValue<T, V>> extends never ? [] : [PermissionRequest<PermissionValue<T, V>>]
        ) => {
            const [request] = params;
            const permissionsSet = Array.isArray(permissionSet) ? permissionSet : [permissionSet];

            const hierarchyElement = flatten[permission] as PermissionElement;
            if (!hierarchyElement) throw new Error("Invalid key request");

            for (const set of permissionsSet) {
                const validated = validateBy(permission, set) as V[];
                if (validated.length == 0) continue;

                for (const key of validated) {
                    const hierarchyElement = flatten[key] as PermissionElement;
                    if (!hierarchyElement) throw new Error("Invalid key request");

                    if (hierarchyElement.allowed) {
                        const scopedPermission = permission.slice(key.length + 1) as V;

                        const localRequest = key === permission ? request : {
                            type: "child",
                            key: scopedPermission,
                            request,
                        };

                        if (await hierarchyElement?.allowed(localRequest, set[key])) {
                            return true;
                        }
                    }
                }
            }

            // No permission found, check with empty state
            if (hierarchyElement.allowed) {
                if (await hierarchyElement?.allowed(request, undefined)) {
                    return true;
                }
            }

            return false;
        },
        // Check permission state for a given key
        check: <V extends Permission<T>>(
            key: V,
            ...params: PermissionState<PermissionValue<T, V>> extends never ? [] : [PermissionState<PermissionValue<T, V>>]
        ) => {
            const [state] = params;
            const hierarchyElement = flatten[key] as PermissionElement;
            if (!hierarchyElement) throw new Error("Invalid key request");

            if (hierarchyElement.check) {
                return hierarchyElement.check?.(state);
            }

            return typeof state === 'boolean';
        }
    }
}