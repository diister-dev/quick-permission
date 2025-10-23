import { createPermissionSystem, FilterRule, intermediate, permission, PermissionProvider, Subject, WithRule } from "../library_2/mod.ts"

async function getUser(id: string): Promise<{ id: string; name: string }> {
  console.log("Getting user:", id);
  return { id, name: `User ${id}` };
}

function directPermission() : PermissionProvider & {
  add(subject: Subject, key: string, metadata: any): Promise<void>;
  remove(id: string): Promise<void>;
} {
  const permissionsState: any[] = [];

  return {
    provide: async (subject) => {
      return permissionsState.filter(p => 
        p.subject.id === subject.id
      );
    },
    add: async (subject: Subject, key: string, metadata: any) => {
      const id = crypto.randomUUID();
      permissionsState.push({ ...metadata, subject, key, id });
    },
    remove: async (id: string) => {
      const index = permissionsState.findIndex(p => p.id === id);
      if (index !== -1) {
        permissionsState.splice(index, 1);
      }
    }
  }
}

const directSource = directPermission();

const permSystem = createPermissionSystem({
  schemas: {
    "user.create": permission(),
    "user.read": permission(getUser, [WithRule(), FilterRule()] as const),
    "user.update": permission(getUser, [FilterRule()] as const),
    "user.manage": intermediate((ctx) => {
      return [
        { ...ctx, key: "user.create" },
        { ...ctx, key: "user.read" },
        { ...ctx, key: "user.update" },
        { ...ctx, key: "user.delete" },
      ]
    })
  },
  sources: [
    directSource,
  ]
});

const subject1 = { id: "subject:1" };
await directSource.add(subject1, "user.manage", {
  target: "user:1",
  filter: { name: true },
  with: { name: "User user:2" },
});

const result = await permSystem.can(subject1, "user.update", "user:2");
console.log("Permission granted:", result);