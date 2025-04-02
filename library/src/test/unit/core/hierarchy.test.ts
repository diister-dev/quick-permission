/**
 * Tests for hierarchy functionality
 */
import {
  flatHierarchy,
  hierarchy,
  satisfiedBy,
} from "../../../core/hierarchy.ts";
import { permission } from "../../../core/permission.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("hierarchy - should create a valid hierarchy object", () => {
  // Arrange
  const permissionTree = {
    user: permission({
      rules: [],
      children: {
        view: permission({ rules: [] }),
        update: permission({ rules: [] }),
      },
    }),
    resource: permission({
      rules: [],
    }),
  };

  // Act
  const result = hierarchy(permissionTree);

  // Assert
  assertEquals(result.type, "hierarchy");
  assertEquals(Object.keys(result.flat).length, 4); // user, user.view, user.update, resource
  assertEquals(result.keys.length, 4);
  assertEquals(
    result.keys.sort(),
    ["resource", "user", "user.update", "user.view"].sort(),
  );
});

Deno.test("flatHierarchy - should correctly flatten a permission hierarchy", () => {
  // Arrange
  const permissionTree = {
    user: permission({
      rules: [],
      children: {
        view: permission({ rules: [] }),
        update: permission({ rules: [] }),
      },
    }),
  };

  // Act
  const flat = flatHierarchy(permissionTree);

  // Assert
  assertEquals(Object.keys(flat).length, 3);
  assertEquals(
    Object.keys(flat).sort(),
    ["user", "user.view", "user.update"].sort(),
  );
  assertEquals(flat["user"].rules, []);
  assertEquals(flat["user.view"].rules, []);
  assertEquals(flat["user.update"].rules, []);
});

Deno.test("flatHierarchy - should throw on invalid elements", () => {
  // Arrange: Create an invalid element
  const permissionTree: any = {
    user: "invalid", // Not a permission
  };

  // Act & Assert
  assertThrows(
    () => flatHierarchy(permissionTree),
    Error,
    "Invalid element in hierarchy",
  );
});

Deno.test("satisfiedBy - should find all permissions satisfied by a key", () => {
  // Arrange
  const permissionTree = hierarchy({
    user: permission({
      rules: [],
      children: {
        view: permission({
          rules: [],
          children: {
            self: permission({ rules: [] }),
            others: permission({ rules: [] }),
          },
        }),
        update: permission({ rules: [] }),
      },
    }),
  });

  // Act
  const result1 = satisfiedBy(permissionTree, "user.view.self");
  const result2 = satisfiedBy(permissionTree, "user.view");
  const result3 = satisfiedBy(permissionTree, "user");
  const result4 = satisfiedBy(permissionTree, "nonexistent" as any);

  // Assert
  assertEquals(result1, ["user", "user.view", "user.view.self"]);
  assertEquals(result2, ["user", "user.view"]);
  assertEquals(result3, ["user"]);
  assertEquals(result4, []);
});
