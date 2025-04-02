/**
 * Tests for hierarchical permission structures
 * 
 * These tests demonstrate scenarios with multi-level permission hierarchies:
 * - Permission inheritance across multiple levels
 * - Nested permission structures
 * - Access control at different hierarchy levels
 */
import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { assertEquals } from "jsr:@std/assert";
import { assertValidationSuccess, assertValidationFailure } from "../helpers/test_utils.ts";

Deno.test("Hierarchical Permissions - Multi-level hierarchy with permission inheritance", () => {
  // Arrange - Create a multi-level permission hierarchy
  const contentPermissions = hierarchy({
    content: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        document: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            edit: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            share: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
        folder: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            add: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            remove: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
      }
    }),
  });

  // Create a single permission source with folder view access only
  const folderViewOnlyStates = [
    {
      // Minimum permissions needed for folder view only
      "content.folder.view": { target: ["folder:project-A/*"] },
    }
  ];

  // Create a permission source with document edit access
  const documentEditStates = [
    {
      // First source: folder view access
      "content.folder.view": { target: ["folder:project-A/*"] },
    },
    {
      // Second source: document edit access
      "content.document.edit": { target: ["document:project-A/report.md"] },
    }
  ];

  // Test folder viewing with just the first permission source
  const viewFolderResult = validate(
    contentPermissions,
    folderViewOnlyStates,
    "content.folder.view",
    { from: "user:bob", target: "folder:project-A/docs" }
  );
  assertValidationSuccess(viewFolderResult);

  // Test folder adding with just the view permission source (should fail)
  const addToFolderResult = validate(
    contentPermissions,
    folderViewOnlyStates,
    "content.folder.add",
    { from: "user:bob", target: "folder:project-A/docs" }
  );
  assertValidationFailure(addToFolderResult);

  // Test document editing with both permission sources
  const editDocumentResult = validate(
    contentPermissions,
    documentEditStates,
    "content.document.edit",
    { from: "user:bob", target: "document:project-A/report.md" }
  );
  assertValidationSuccess(editDocumentResult);

  // Test document editing on a non-permitted document
  const editOtherDocumentResult = validate(
    contentPermissions,
    documentEditStates,
    "content.document.edit",
    { from: "user:bob", target: "document:project-A/other.md" }
  );
  assertValidationFailure(editOtherDocumentResult);

  // Test accessing content outside of permitted workspace
  const viewOtherFolderResult = validate(
    contentPermissions,
    documentEditStates,
    "content.folder.view",
    { from: "user:bob", target: "folder:project-B/docs" }
  );
  assertValidationFailure(viewOtherFolderResult);
});

Deno.test("Hierarchical Permissions - Deep nesting with parent-child relationships", () => {
  // Arrange - Create a deeply nested hierarchy for an organization structure
  const organizationPermissions = hierarchy({
    org: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        department: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            team: permission({
              rules: [allowTarget({ wildcards: true })],
              children: {
                project: permission({
                  rules: [allowTarget({ wildcards: true })],
                  children: {
                    view: permission({
                      rules: [allowTarget({ wildcards: true })],
                    }),
                    edit: permission({
                      rules: [allowTarget({ wildcards: true })],
                    }),
                    manage: permission({
                      rules: [allowTarget({ wildcards: true })],
                    }),
                  }
                }),
              }
            }),
            manage: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
        admin: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
      }
    }),
  });

  // Create permission states with different levels of access
  const states = [
    {
      // Regular employee permissions limited to specific team and project
      "org": { target: ["org:acme"] },
      "org.department": { target: ["department:engineering"] },
      "org.department.team": { target: ["team:backend"] },
      "org.department.team.project": { target: ["project:api"] },
      "org.department.team.project.view": { target: ["project:api/*"] },
      "org.department.team.project.edit": { target: ["project:api/services/*"] },
    },
    {
      // Team lead permissions with management access
      "org.department.team.manage": { target: ["team:backend"] },
      "org.department.team.project.manage": { target: ["project:api"] },
    }
  ];

  // Test - Can view projects in the hierarchy
  const viewProjectResult = validate(
    organizationPermissions,
    states,
    "org.department.team.project.view",
    { from: "user:dev1", target: "project:api/models" }
  );
  assertValidationSuccess(viewProjectResult);

  // Test - Can edit services part of the project
  const editServiceResult = validate(
    organizationPermissions,
    states,
    "org.department.team.project.edit",
    { from: "user:dev1", target: "project:api/services/userAuth" }
  );
  assertValidationSuccess(editServiceResult);

  // Test - Cannot edit other project areas
  const editModelsResult = validate(
    organizationPermissions,
    states,
    "org.department.team.project.edit",
    { from: "user:dev1", target: "project:api/models/user" }
  );
  assertValidationFailure(editModelsResult);

  // Test - Can manage the team (from team lead permissions)
  const manageTeamResult = validate(
    organizationPermissions,
    states,
    "org.department.team",
    { from: "user:lead1", target: "team:backend" }
  );
  assertValidationSuccess(manageTeamResult);

  // Test - Cannot access other departments
  const otherDepartmentResult = validate(
    organizationPermissions,
    states,
    "org.department",
    { from: "user:dev1", target: "department:marketing" }
  );
  assertValidationFailure(otherDepartmentResult);
});