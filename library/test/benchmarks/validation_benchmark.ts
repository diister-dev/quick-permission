/**
 * Performance benchmarks for quick-permission
 *
 * Run with: deno bench library/test/benchmarks/validation_benchmark.ts
 */

import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowSelf } from "../../rules/allowSelf/allowSelf.ts";
import { allowOwner } from "../../rules/allowOwner/allowOwner.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { ensureTime } from "../../rules/ensureTime/ensureTime.ts";
import { and, not, or } from "../../operators/operations.ts";

// Create a utility function to build hierarchies of varying depths
function createHierarchyWithDepth(depth: number) {
  let currentLevel: any = {};
  let current = currentLevel;

  for (let i = 0; i < depth; i++) {
    current["level" + i] = permission({
      rules: [allowTarget({ wildcards: true })],
      children: {},
    });
    current = current["level" + i].children;
  }

  current["leaf"] = permission({
    rules: [allowOwner()],
  });

  return hierarchy(currentLevel);
}

// Create a utility function to build a wide hierarchy
function createWideHierarchy(width: number) {
  const rootChildren: any = {};

  for (let i = 0; i < width; i++) {
    rootChildren["branch" + i] = permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        leaf: permission({
          rules: [allowOwner()],
        }),
      },
    });
  }

  return hierarchy({
    root: permission({
      rules: [],
      children: rootChildren,
    }),
  });
}

// Create a utility function to generate permission states
function createStates(permissionKeys: string[]) {
  return [{
    ...Object.fromEntries(
      permissionKeys.map((key) => [key, { target: [`resource:${key}`] }]),
    ),
  }];
}

// Create test hierarchies with varying depths
const smallHierarchy = hierarchy({
  user: permission({
    rules: [allowTarget({ wildcards: true })],
    children: {
      view: permission({
        rules: [allowSelf()],
      }),
    },
  }),
});

const mediumHierarchy = hierarchy({
  user: permission({
    rules: [allowTarget({ wildcards: true })],
    children: {
      profile: permission({
        rules: [allowTarget({ wildcards: true })],
        children: {
          view: permission({
            rules: [allowSelf()],
          }),
          edit: permission({
            rules: [allowOwner()],
          }),
        },
      }),
      content: permission({
        rules: [allowTarget({ wildcards: true })],
        children: {
          view: permission({
            rules: [allowTarget({ wildcards: true })],
          }),
          edit: permission({
            rules: [allowOwner()],
          }),
        },
      }),
    },
  }),
});

const deepHierarchy = createHierarchyWithDepth(10);
const wideHierarchy = createWideHierarchy(100);

// Create complex rules for testing
const complexRules = permission({
  rules: [
    and([
      allowTarget({ wildcards: true }),
      or([
        allowSelf(),
        allowOwner(),
        not(allowSelf()),
      ]),
    ]),
    ensureTime(),
  ],
});

// Create test requests
const simpleRequest = { from: "user:123", target: "user:123" };
const complexRequest = {
  from: "user:123",
  target: "resource:article",
  owner: "user:123",
  date: new Date(),
};

// Test states
const simpleStates = [
  { "user.view": { target: ["user:*"] } },
];

const mediumStates = [
  {
    "user.profile.view": { target: ["user:*"] },
    "user.profile.edit": { target: ["user:123"] },
    "user.content.view": { target: ["resource:*"] },
    "user.content.edit": { target: [] },
  },
];

// Many states sources
const multipleStateSources = Array.from({ length: 10 }, (_, i) => ({
  [`resource.${i}`]: { target: [`resource:${i}`] },
}));

// Benchmarks for different hierarchy sizes
Deno.bench("hierarchy creation - small", () => {
  hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        view: permission({
          rules: [allowSelf()],
        }),
      },
    }),
  });
});

Deno.bench("hierarchy creation - medium", () => {
  hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        profile: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              rules: [allowSelf()],
            }),
            edit: permission({
              rules: [allowOwner()],
            }),
          },
        }),
        content: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            edit: permission({
              rules: [allowOwner()],
            }),
          },
        }),
      },
    }),
  });
});

Deno.bench("hierarchy creation - deep (10 levels)", () => {
  createHierarchyWithDepth(10);
});

Deno.bench("hierarchy creation - wide (100 branches)", () => {
  createWideHierarchy(100);
});

// Benchmarks for validation with different hierarchy complexities
Deno.bench("validation - simple hierarchy simple check", () => {
  validate(smallHierarchy, simpleStates, "user.view", simpleRequest);
});

Deno.bench("validation - medium hierarchy simple check", () => {
  validate(
    mediumHierarchy,
    simpleStates as any,
    "user.profile.view",
    simpleRequest,
  );
});

Deno.bench("validation - medium hierarchy with complete states", () => {
  validate(mediumHierarchy, mediumStates, "user.profile.edit", complexRequest);
});

Deno.bench("validation - deep hierarchy", () => {
  validate(
    deepHierarchy,
    [{}],
    "level0.level1.level2.level3.level4.level5.level6.level7.level8.level9.leaf",
    complexRequest as never,
  );
});

Deno.bench("validation - wide hierarchy", () => {
  validate(wideHierarchy, [{}], "root.branch50.leaf", complexRequest as never);
});

Deno.bench("validation - with complex operators", () => {
  validate(
    hierarchy({
      test: complexRules,
    }),
    [
      {
        "test": {
          target: ["resource:*"],
          dateStart: new Date(Date.now() - 86400000), // Yesterday
          dateEnd: new Date(Date.now() + 86400000), // Tomorrow
        },
      },
    ],
    "test",
    complexRequest,
  );
});

// Benchmarks for different numbers of state sources
Deno.bench("validation - with single state source", () => {
  validate(
    smallHierarchy,
    [{ "user.view": { target: ["user:*"] } }],
    "user.view",
    simpleRequest,
  );
});

Deno.bench("validation - with 10 state sources", () => {
  validate(
    smallHierarchy,
    multipleStateSources,
    "user.view",
    simpleRequest,
  );
});

// Benchmarks for repeated validations (to test potential caching benefits)
Deno.bench("validation - repeated validation same permission", () => {
  for (let i = 0; i < 10; i++) {
    validate(mediumHierarchy, mediumStates, "user.profile.view", simpleRequest);
  }
});

Deno.bench("validation - repeated validation different permissions", () => {
  const permissions = [
    "user.profile.view",
    "user.profile.edit",
    "user.content.view",
    "user.content.edit",
  ];
  for (const perm of permissions) {
    validate(mediumHierarchy, mediumStates, perm as any, complexRequest);
  }
});
