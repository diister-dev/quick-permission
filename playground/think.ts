import { createPermissionSystem, FilterRule, intermediate, permission, PermissionProvider, Subject, WithRule } from "../library/mod.ts"
import { TimeRule } from "../library/rules/time.ts";

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

function selfPermission() : PermissionProvider {
  return {
    provide: (subject) => [
      { subject, key: "user.read", target: subject.id },
      { subject, key: "user.update", target: subject.id, filter: { name: true } }
    ]
  }
}

const directSource = directPermission();

const permSystem = createPermissionSystem({
  schemas: {
    "user.create": permission(),
    "user.read": permission(getUser, [WithRule(), FilterRule()]),
    "user.update": permission(getUser, [FilterRule()]),
    "user.delete": permission(getUser, [WithRule()]),
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
    selfPermission(),
  ],
  rules: [TimeRule()]
});

const subject1 = { id: "user:2" };
await directSource.add(subject1, "user.manage", {
  target: "user:1",
  filter: { name: true },
  with: { name: "User user:1" },
  startDate: new Date(Date.now() + 1000 * 60), // Started 1 minute ago
});

const permContext = permSystem.context({
  subject: subject1,
});
{
  const result = await permContext.can("user.update", "user:1");
  console.log("Permission granted:", result);
}
{
  const result = await permContext.can("user.update", "user:1");
  console.log("Permission granted:", result);
}
{
  const result = await permContext.can("user.update", "user:1");
  console.log("Permission granted:", result);
}