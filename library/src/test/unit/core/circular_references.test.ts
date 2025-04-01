/**
 * Tests specifically for circular reference detection in permission hierarchies
 */
import { hierarchy, flatHierarchy } from "../../../core/hierarchy.ts";
import { permission } from "../../../core/permission.ts";
import { assertThrows } from "jsr:@std/assert";

Deno.test("flatHierarchy - should detect simple circular references", () => {
  // Arrange: Create a circular reference where a permission references itself
  const circularPermission: any = permission({ rules: [] });
  circularPermission.children = { self: circularPermission };
  
  const permissionTree = {
    problematic: circularPermission
  };

  // Act & Assert
  assertThrows(
    () => flatHierarchy(permissionTree),
    Error,
    "Circular reference detected in hierarchy"
  );
});

Deno.test("flatHierarchy - should detect nested circular references", () => {
  // Arrange: Create a nested circular reference (A -> B -> C -> A)
  const permissionA: any = permission({ rules: [] });
  const permissionB: any = permission({ rules: [] });
  const permissionC: any = permission({ rules: [] });
  
  permissionA.children = { b: permissionB };
  permissionB.children = { c: permissionC };
  permissionC.children = { a: permissionA }; // Creates the circle
  
  const permissionTree = {
    root: permissionA
  };

  // Act & Assert
  assertThrows(
    () => flatHierarchy(permissionTree),
    Error,
    "Circular reference detected in hierarchy"
  );
});

Deno.test("flatHierarchy - should detect self-reference in children", () => {
  // Arrange: Create a permission that includes itself in its children
  const rootPermission: any = permission({ rules: [] });
  const childPermission: any = permission({ rules: [] });
  
  rootPermission.children = { 
    child: childPermission,
    circular: rootPermission // Self-reference
  };
  
  const permissionTree = {
    root: rootPermission
  };

  // Act & Assert
  assertThrows(
    () => flatHierarchy(permissionTree),
    Error,
    "Circular reference detected in hierarchy"
  );
});

Deno.test("hierarchy - should throw an error when constructing a hierarchy with circular references", () => {
  // Arrange: Create a circular reference
  const circularPermission: any = permission({ rules: [] });
  circularPermission.children = { self: circularPermission };
  
  const permissionTree = {
    problematic: circularPermission
  };

  // Act & Assert
  assertThrows(
    () => hierarchy(permissionTree),
    Error,
    "Circular reference detected in hierarchy"
  );
});

Deno.test("flatHierarchy - should handle valid complex hierarchies", () => {
  // Arrange: Create a deep but valid hierarchy with no circular references
  const leaf1 = permission({ rules: [] });
  const leaf2 = permission({ rules: [] });
  const leaf3 = permission({ rules: [] });
  
  const branch1: any = permission({ 
    rules: [],
    children: { leaf1, leaf2 }
  });
  
  const branch2: any = permission({ 
    rules: [],
    children: { leaf3 }
  });
  
  const root = permission({
    rules: [],
    children: { branch1, branch2 }
  });
  
  const permissionTree = { root };

  // Act & Assert - Should not throw
  flatHierarchy(permissionTree);
});