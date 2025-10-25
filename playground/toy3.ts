import mingo from "npm:mingo";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const store0: any = [];
const store1: any = [];
const store2: any = [];

const store0Manager = {
  obtain: async (subject: any, operation: string) => {
    if(!operation.startsWith("article.")) {
      return [];
    }
    await delay(100 + Math.random() * 200);
    return store0.filter((entry: any) => entry.subject === subject.id);
  }
}

const store1Manager = {
  obtain: async (subject: any, operation: string) => {
    await delay(100 + Math.random() * 200);
    return store1.filter((entry: any) => {
      if(entry.groupId && subject.groups && subject.groups.includes(entry.groupId)) {
        return true;
      }
      return false;
    }).map((entry: any) => ({
      subject: subject.id,
      operation: entry.operation,
      resource: entry.resource,
      with: entry.with,
      groupId: undefined, // Remove groupId for clarity
    }));
  }
}

// Subject
// Operation
// Resource?
// Constraints?

// Load Permissions
// Compute Permissions
// Save Permissions

const articlesPermissions = {
  "article.manage" : () => {
    return [
      {
        key: "article.create",
      },
      {
        key: "article.read",
      },
      {
        key: "article.update",
      },
      {
        key: "article.delete",
      }
    ]
  },
  "article.create" : () => true,
  "article.read" : () => true,
  "article.update" : () => true,
  "article.delete" : () => true,
}

const actionPermissions = {
  "system.shutdown": () => true,
  "system.restart": () => true,
}

const articleA = {
  id: "article:A",
  owner: "user:2",
  title: "Article A",
  content: "Content of Article A",
}

const articleB = {
  id: "article:B",
  owner: "user:2",
  title: "Article B",
  content: "Content of Article B",
}

const user1 = {
  id: "user:1",
  groups: ["group:admin"],
}

store0.push({
  _origin: "store1",
  subject: "user:1",
  operation: "article.read",
  resource: "article:A",
});

store1.push({
  groupId: "group:admin",
  operation: "system.restart",
})

const articleDefault = (subject: any) => {
  return [
    {
      subject,
      operation: "article.read",
      resource: "article:*",
      with: {
        owner: subject,
      }
    },
    {
      subject,
      operation: "article.update",
      resource: "article:*",
      with: {
        owner: subject,
      }
    },
    {
      subject,
      operation: "article.delete",
      resource: "article:*",
      with: {
        owner: subject,
        // Prevent deleting locked articles
        locked: { $ne: true }
      }
    }
  ]
}

async function can(subject: any, operation: string, resource?: any): Promise<boolean> {
  const permissions = await Promise.all([
    store0Manager.obtain(subject, operation),
    store1Manager.obtain(subject, operation),
    articleDefault(subject.id),
  ]);

  const flatPermissions = permissions.flat();
  const pertinentPermissions = flatPermissions.filter((p: any) => p.operation === operation && subject.id === p.subject);
  let allowed = false;

  for(const permission of pertinentPermissions) {
    // Check resource match
    if(resource) {
      const resourceMatch = permission.resource === resource.id || permission.resource === "*" || (permission.resource.endsWith("*") && resource.id.startsWith(permission.resource.slice(0, -1)));
      if(!resourceMatch) continue;
    }

    // Check constraints
    const validator = new mingo.Query(permission.with || {});
    const isValid = validator.test(resource);
    if(!isValid) continue;

    allowed = true;
    break;
  }

  return allowed;
}

// API Simulation
const haveRights = await can(user1, "article.read", articleA);
console.log("User 1 can read Article A:", haveRights);

const canRestart = await can(user1, "system.restart");
console.log("User 1 can restart system:", canRestart);