/**
 * Complex integration tests for the permission system
 * 
 * These tests demonstrate advanced scenarios including:
 * - Cascading permissions
 * - Multi-level hierarchies
 * - Complex rule combinations
 * - Real-world permission patterns
 */
import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowOwner } from "../../rules/allowOwner/allowOwner.ts";
import { allowSelf } from "../../rules/allowSelf/allowSelf.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { denySelf } from "../../rules/denySelf/denySelf.ts";
import { ensureTime } from "../../rules/ensureTime/ensureTime.ts";
import { and, or, not, merge } from "../../operators/operations.ts";
import { assertEquals } from "jsr:@std/assert";
import { assertValidationSuccess, assertValidationFailure } from "../helpers/test_utils.ts";

Deno.test("Complex Integration - Multi-level organizational permissions", () => {
  // Arrange - Create a multi-level organization permission system
  const orgPermissions = hierarchy({
    organization: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        manage: permission({
          // Organization management operations
          rules: [],
          children: {
            create: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            update: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            delete: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
        team: permission({
          // Team-level operations
          rules: [allowTarget({ wildcards: true })],
          children: {
            create: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            join: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            leave: permission({
              rules: [allowSelf()],
            }),
            manage: permission({
              rules: [allowTarget({ wildcards: true })],
              children: {
                update: permission({
                  rules: [allowTarget({ wildcards: true })],
                }),
                delete: permission({
                  // Can't delete your own team
                  rules: [not(allowSelf()), allowTarget({ wildcards: true })],
                }),
              }
            }),
          }
        }),
        project: permission({
          // Project-level operations
          rules: [allowTarget({ wildcards: true })],
          children: {
            create: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            view: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            edit: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            delete: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
      }
    }),
  });

  // Create states with different permission levels
  const states = [
    {
      // System administrators - full access
      "organization": { target: ["org:*"] },
      "organization.manage": { target: ["org:*"] },
      "organization.manage.create": { target: ["org:*"] },
      "organization.manage.update": { target: ["org:*"] },
      "organization.manage.delete": { target: ["org:*"] },
      "organization.team": { target: ["team:*"] },
      "organization.team.create": { target: ["team:*"] },
      "organization.team.join": { target: ["team:*"] },
      "organization.team.leave": { target: ["team:*"] },
      "organization.team.manage": { target: ["team:*"] },
      "organization.team.manage.update": { target: ["team:*"] },
      "organization.team.manage.delete": { target: ["team:*"] },
      "organization.project": { target: ["project:*"] },
      "organization.project.create": { target: ["project:*"] },
      "organization.project.view": { target: ["project:*"] },
      "organization.project.edit": { target: ["project:*"] },
      "organization.project.delete": { target: ["project:*"] },
    },
    {
      // Organization administrators - org-specific full access
      "organization": { target: ["org:acme"] },
      "organization.manage": { target: ["org:acme"] },
      "organization.manage.update": { target: ["org:acme"] },
      "organization.team": { target: ["team:acme.*"] },
      "organization.team.create": { target: ["team:acme.*"] },
      "organization.team.join": { target: ["team:acme.*"] },
      "organization.team.manage": { target: ["team:acme.*"] },
      "organization.team.manage.update": { target: ["team:acme.*"] },
      "organization.team.manage.delete": { target: ["team:acme.*"] },
      "organization.project": { target: ["project:acme.*"] },
      "organization.project.create": { target: ["project:acme.*"] },
      "organization.project.view": { target: ["project:acme.*"] },
      "organization.project.edit": { target: ["project:acme.*"] },
      "organization.project.delete": { target: ["project:acme.*"] },
    },
    {
      // Team leaders - team-specific access
      "organization": { target: ["org:acme"] },
      "organization.team": { target: ["team:acme.engineering"] },
      "organization.team.manage": { target: ["team:acme.engineering"] },
      "organization.team.manage.update": { target: ["team:acme.engineering"] },
      "organization.project": { target: ["project:acme.eng.*"] },
      "organization.project.create": { target: ["project:acme.eng.*"] },
      "organization.project.view": { target: ["project:acme.eng.*"] },
      "organization.project.edit": { target: ["project:acme.eng.*"] },
    },
    {
      // Team members - limited access
      "organization": { target: ["org:acme"] },
      "organization.team.join": { target: ["team:acme.*"] },
      "organization.team.leave": { target: ["team:acme.engineering"] },
      "organization.project.view": { target: ["project:acme.eng.*"] },
      "organization.project.edit": { target: ["project:acme.eng.api", "project:acme.eng.frontend"] },
    }
  ];

  // System Admin Tests
  // Act & Assert - System admin can manage any organization
  const sysAdminManageOrgResult = validate(
    orgPermissions,
    states,
    "organization.manage.update",
    { from: "user:sysadmin", target: "org:globex" }
  );
  assertValidationSuccess(sysAdminManageOrgResult);

  // Act & Assert - System admin can delete any team
  const sysAdminDeleteTeamResult = validate(
    orgPermissions,
    states,
    "organization.team.manage.delete",
    { from: "user:sysadmin", target: "team:acme.marketing" }
  );
  assertValidationSuccess(sysAdminDeleteTeamResult);

  // Organization Admin Tests
  // Act & Assert - Org admin can update their organization
  const orgAdminUpdateOrgResult = validate(
    orgPermissions,
    states,
    "organization.manage.update",
    { from: "user:orgadmin", target: "org:acme" }
  );
  assertValidationSuccess(orgAdminUpdateOrgResult);

  // Act & Assert - Org admin cannot update other organizations
  const orgAdminUpdateOtherOrgResult = validate(
    orgPermissions,
    states,
    "organization.manage.update",
    { from: "user:orgadmin", target: "org:globex" }
  );
  assertValidationFailure(orgAdminUpdateOtherOrgResult);

  // Act & Assert - Org admin can create teams within their org
  const orgAdminCreateTeamResult = validate(
    orgPermissions,
    states,
    "organization.team.create",
    { from: "user:orgadmin", target: "team:acme.sales" }
  );
  assertValidationSuccess(orgAdminCreateTeamResult);

  // Team Leader Tests
  // Act & Assert - Team leader can update their team
  const teamLeaderUpdateTeamResult = validate(
    orgPermissions,
    states,
    "organization.team.manage.update",
    { from: "user:teamlead", target: "team:acme.engineering" }
  );
  assertValidationSuccess(teamLeaderUpdateTeamResult);

  // Act & Assert - Team leader cannot update other teams
  const teamLeaderUpdateOtherTeamResult = validate(
    orgPermissions,
    states,
    "organization.team.manage.update",
    { from: "user:teamlead", target: "team:acme.marketing" }
  );
  assertValidationFailure(teamLeaderUpdateOtherTeamResult);

  // Act & Assert - Team leader cannot delete their own team
  const teamLeaderDeleteOwnTeamResult = validate(
    orgPermissions,
    states,
    "organization.team.manage.delete",
    { from: "user:teamlead", target: "team:acme.engineering" }
  );
  assertValidationFailure(teamLeaderDeleteOwnTeamResult);

  // Team Member Tests
  // Act & Assert - Team member can view projects
  const teamMemberViewProjectResult = validate(
    orgPermissions,
    states,
    "organization.project.view",
    { from: "user:developer", target: "project:acme.eng.api" }
  );
  assertValidationSuccess(teamMemberViewProjectResult);

  // Act & Assert - Team member can edit specific projects
  const teamMemberEditProjectResult = validate(
    orgPermissions,
    states,
    "organization.project.edit",
    { from: "user:developer", target: "project:acme.eng.api" }
  );
  assertValidationSuccess(teamMemberEditProjectResult);

  // Act & Assert - Team member cannot edit projects they're not assigned to
  const teamMemberEditOtherProjectResult = validate(
    orgPermissions,
    states,
    "organization.project.edit",
    { from: "user:developer", target: "project:acme.eng.mobile" }
  );
  assertValidationFailure(teamMemberEditOtherProjectResult);

  // Act & Assert - Team member can leave their team
  const teamMemberLeaveResult = validate(
    orgPermissions,
    states,
    "organization.team.leave",
    { from: "user:developer", target: "team:acme.engineering" }
  );
  assertValidationSuccess(teamMemberLeaveResult);
});

Deno.test("Complex Integration - Time-bound cascading permissions", () => {
  // Create time periods for different access levels
  const now = new Date();
  
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Set to beginning of week (Sunday)
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // Set to end of week (Saturday)
  weekEnd.setHours(23, 59, 59, 999);
  
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Arrange - Create a permission hierarchy for documents with time-based access
  const documentPermissions = hierarchy({
    document: permission({
      rules: [ensureTime(), allowTarget({ wildcards: true })],
      children: {
        // Different access levels
        view: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
        comment: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
        edit: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            content: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            metadata: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            permissions: permission({
              rules: [allowOwner()], // Only owner can change permissions
            }),
          }
        }),
        delete: permission({
          rules: [allowOwner()], // Only owner can delete
        }),
      }
    }),
  });

  // Create states with time-based access levels
  const states = [
    {
      // Project document - draft phase (current week only)
      "document": { 
        target: ["doc:project-plan"],
        dateStart: weekStart,
        dateEnd: weekEnd
      },
      "document.view": { target: ["doc:project-plan"] },
      "document.comment": { target: ["doc:project-plan"] },
      "document.edit": { target: ["doc:project-plan"] },
      "document.edit.content": { target: ["doc:project-plan"] },
      "document.edit.metadata": { target: ["doc:project-plan"] },
    },
    {
      // Project document - post-draft phase (current month but outside current week)
      "document": { 
        target: ["doc:project-plan"],
        dateStart: monthStart,
        dateEnd: monthEnd
      },
      "document.view": { target: ["doc:project-plan"] },
      "document.comment": { target: ["doc:project-plan"] },
      // No edit permissions outside of draft week
    }
  ];

  // Current week tests - Draft phase
  // Act & Assert - Can view document in draft phase
  const viewInDraftPhaseResult = validate(
    documentPermissions,
    states,
    "document.view",
    { 
      from: "user:team-member", 
      target: "doc:project-plan",
      date: new Date(weekStart.getTime() + 1000 * 60 * 60 * 24) // One day after week start
    }
  );
  assertValidationSuccess(viewInDraftPhaseResult);

  // Act & Assert - Can edit document content in draft phase
  const editInDraftPhaseResult = validate(
    documentPermissions,
    states,
    "document.edit.content",
    { 
      from: "user:team-member", 
      target: "doc:project-plan",
      date: new Date(weekStart.getTime() + 1000 * 60 * 60 * 24) // One day after week start
    }
  );
  assertValidationSuccess(editInDraftPhaseResult);

  // Current month but outside current week - Post-draft phase
  // Act & Assert - Can view document in post-draft phase
  const viewInPostDraftPhaseResult = validate(
    documentPermissions,
    states,
    "document.view",
    { 
      from: "user:team-member", 
      target: "doc:project-plan",
      date: new Date(weekEnd.getTime() + 1000 * 60 * 60 * 24 * 2) // Two days after week end
    }
  );
  assertValidationSuccess(viewInPostDraftPhaseResult);

  // Act & Assert - Cannot edit document in post-draft phase
  const editInPostDraftPhaseResult = validate(
    documentPermissions,
    states,
    "document.edit.content",
    { 
      from: "user:team-member", 
      target: "doc:project-plan",
      date: new Date(weekEnd.getTime() + 1000 * 60 * 60 * 24 * 2) // Two days after week end
    }
  );
  assertValidationFailure(editInPostDraftPhaseResult);

  // Owner-only operations
  // Act & Assert - Owner can edit permissions at any time
  const ownerEditPermissionsResult = validate(
    documentPermissions,
    states,
    "document.edit.permissions",
    { 
      from: "user:document-owner", 
      owner: "user:document-owner",
      target: "doc:project-plan",
      date: now
    }
  );
  assertValidationSuccess(ownerEditPermissionsResult);

  // Act & Assert - Non-owner cannot edit permissions
  const nonOwnerEditPermissionsResult = validate(
    documentPermissions,
    states,
    "document.edit.permissions",
    { 
      from: "user:team-member", 
      owner: "user:document-owner",
      target: "doc:project-plan",
      date: now
    }
  );
  assertValidationFailure(nonOwnerEditPermissionsResult);

  // Act & Assert - Owner can delete document
  const ownerDeleteResult = validate(
    documentPermissions,
    states,
    "document.delete",
    { 
      from: "user:document-owner", 
      owner: "user:document-owner",
      target: "doc:project-plan",
      date: now
    }
  );
  assertValidationSuccess(ownerDeleteResult);
});

Deno.test("Complex Integration - Fine-grained role-based permissions", () => {
  // Arrange - Create a permission hierarchy mimicking role-based access control with fine-grained permissions
  const rbacPermissions = hierarchy({
    api: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        user: permission({
          rules: [],
          children: {
            read: permission({
              rules: [allowSelf(), allowTarget({ wildcards: true })], // Users can always read themselves
            }),
            create: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            update: permission({
              rules: [or([allowSelf(), allowTarget({ wildcards: true })])], // Users can update themselves
            }),
            delete: permission({
              rules: [and([not(allowSelf()), allowTarget({ wildcards: true })])], // Users cannot delete themselves
            }),
          }
        }),
        resource: permission({
          rules: [],
          children: {
            read: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            create: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            update: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            delete: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
        settings: permission({
          rules: [],
          children: {
            read: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            update: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
      }
    }),
  });

  // Create states with role-based permissions
  const states = [
    {
      // Admin role - full access
      "api": { target: ["api:*"] },
      "api.user": { target: ["user:*"] },
      "api.user.read": { target: ["user:*"] },
      "api.user.create": { target: ["user:*"] },
      "api.user.update": { target: ["user:*"] },
      "api.user.delete": { target: ["user:*"] },
      "api.resource": { target: ["resource:*"] },
      "api.resource.read": { target: ["resource:*"] },
      "api.resource.create": { target: ["resource:*"] },
      "api.resource.update": { target: ["resource:*"] },
      "api.resource.delete": { target: ["resource:*"] },
      "api.settings": { target: ["settings:*"] },
      "api.settings.read": { target: ["settings:*"] },
      "api.settings.update": { target: ["settings:*"] },
    },
    {
      // Manager role - manage users and resources, read settings
      "api": { target: ["api:users", "api:resources", "api:settings"] },
      "api.user": { target: ["user:*"] },
      "api.user.read": { target: ["user:*"] },
      "api.user.create": { target: ["user:*"] },
      "api.user.update": { target: ["user:*"] },
      "api.user.delete": { target: ["user:*"] },
      "api.resource": { target: ["resource:*"] },
      "api.resource.read": { target: ["resource:*"] },
      "api.resource.create": { target: ["resource:*"] },
      "api.resource.update": { target: ["resource:*"] },
      "api.resource.delete": { target: ["resource:*"] },
      "api.settings": { target: ["settings:*"] },
      "api.settings.read": { target: ["settings:*"] },
    },
    {
      // Editor role - manage resources, read users
      "api": { target: ["api:users", "api:resources"] },
      "api.user": { target: ["user:*"] },
      "api.user.read": { target: ["user:*"] },
      "api.resource": { target: ["resource:*"] },
      "api.resource.read": { target: ["resource:*"] },
      "api.resource.create": { target: ["resource:*"] },
      "api.resource.update": { target: ["resource:*"] },
    },
    {
      // User role - read resources, manage self
      "api": { target: ["api:users", "api:resources"] },
      "api.user.read": { target: ["user:*"] },
      "api.user.update": { target: ["user:current"] }, // Can update self via allowSelf rule
      "api.resource.read": { target: ["resource:*"] },
    }
  ];

  // Admin tests
  // Act & Assert - Admin can update settings
  const adminUpdateSettingsResult = validate(
    rbacPermissions,
    states,
    "api.settings.update",
    { from: "user:admin", target: "settings:system" }
  );
  assertValidationSuccess(adminUpdateSettingsResult);

  // Act & Assert - Admin can delete users
  const adminDeleteUserResult = validate(
    rbacPermissions,
    states,
    "api.user.delete",
    { from: "user:admin", target: "user:regular" }
  );
  assertValidationSuccess(adminDeleteUserResult);

  // Manager tests
  // Act & Assert - Manager can delete users
  const managerDeleteUserResult = validate(
    rbacPermissions,
    states,
    "api.user.delete",
    { from: "user:manager", target: "user:regular" }
  );
  assertValidationSuccess(managerDeleteUserResult);

  // Act & Assert - Manager can read settings
  const managerReadSettingsResult = validate(
    rbacPermissions,
    states,
    "api.settings.read",
    { from: "user:manager", target: "settings:system" }
  );
  assertValidationSuccess(managerReadSettingsResult);

  // Act & Assert - Manager cannot update settings
  const managerUpdateSettingsResult = validate(
    rbacPermissions,
    states,
    "api.settings.update",
    { from: "user:manager", target: "settings:system" }
  );
  assertValidationFailure(managerUpdateSettingsResult);

  // Editor tests
  // Act & Assert - Editor can update resources
  const editorUpdateResourceResult = validate(
    rbacPermissions,
    states,
    "api.resource.update",
    { from: "user:editor", target: "resource:article" }
  );
  assertValidationSuccess(editorUpdateResourceResult);

  // Act & Assert - Editor cannot delete users
  const editorDeleteUserResult = validate(
    rbacPermissions,
    states,
    "api.user.delete",
    { from: "user:editor", target: "user:regular" }
  );
  assertValidationFailure(editorDeleteUserResult);

  // User tests
  // Act & Assert - Regular user can read resources
  const userReadResourceResult = validate(
    rbacPermissions,
    states,
    "api.resource.read",
    { from: "user:regular", target: "resource:article" }
  );
  assertValidationSuccess(userReadResourceResult);

  // Act & Assert - Regular user can update themselves
  const userUpdateSelfResult = validate(
    rbacPermissions,
    states,
    "api.user.update",
    { from: "user:regular", target: "user:regular" }
  );
  assertValidationSuccess(userUpdateSelfResult);

  // Act & Assert - Regular user cannot update other users
  const userUpdateOtherResult = validate(
    rbacPermissions,
    states,
    "api.user.update",
    { from: "user:regular", target: "user:other" }
  );
  assertValidationFailure(userUpdateOtherResult);

  // Act & Assert - Regular user cannot create resources
  const userCreateResourceResult = validate(
    rbacPermissions,
    states,
    "api.resource.create",
    { from: "user:regular", target: "resource:article" }
  );
  assertValidationFailure(userCreateResourceResult);
});