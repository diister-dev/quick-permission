/**
 * Basic integration tests for the permission system
 */
import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowOwner } from "../../rules/allowOwner/allowOwner.ts";
import { allowSelf } from "../../rules/allowSelf/allowSelf.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { denySelf } from "../../rules/denySelf/denySelf.ts";
import { ensureTime } from "../../rules/ensureTime/ensureTime.ts";
import { and, not, or } from "../../operators/operations.ts";
import { assertEquals } from "jsr:@std/assert";
import { assertValidationSuccess, assertValidationFailure } from "../helpers/test_utils.ts";

Deno.test("Integration - user management basic scenario", () => {
  // Arrange - Create a permission hierarchy for user management
  const userPermissions = hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        view: permission({
          rules: [allowSelf(), allowTarget({ wildcards: true })],
        }),
        update: permission({
          rules: [allowSelf()],
        }),
        delete: permission({
          rules: [denySelf(), allowTarget()],
        }),
      }
    }),
  });

  // Create a single state source with permissions for testing
  const states = [
    {
      // A single permission source with all permissions
      "user": { target: ["user:*"] },
      "user.view": { target: ["user:*"] },
      "user.update": { target: ["user:*"] },
      "user.delete": { target: ["user:*"] },
    }
  ];

  // Act & Assert - Admin can view any user
  const viewAnyResult = validate(
    userPermissions,
    states,
    "user.view",
    { from: "user:admin", target: "user:regular" }
  );
  assertValidationSuccess(viewAnyResult);

  // Act & Assert - Admin can delete a user
  const deleteUserResult = validate(
    userPermissions,
    states,
    "user.delete",
    { from: "user:admin", target: "user:regular" }
  );
  assertValidationSuccess(deleteUserResult);

  // Act & Assert - Admin cannot delete themselves (the denySelf rule prevents this)
  const deleteSelfResult = validate(
    userPermissions,
    states,
    "user.delete",
    { from: "user:admin", target: "user:admin" }
  );
  assertValidationFailure(deleteSelfResult, ["rule"], ["denySelf"]);
  
  // Act & Assert - User can view other users (allowTarget rule grants this)
  const regularViewsResult = validate(
    userPermissions,
    states,
    "user.view",
    { from: "user:regular", target: "user:another" }
  );
  assertValidationSuccess(regularViewsResult);

  // Act & Assert - Regular user can update themselves (allowSelf rule grants this)
  const regularUpdatesSelfResult = validate(
    userPermissions,
    states,
    "user.update",
    { from: "user:regular", target: "user:regular" }
  );
  assertValidationSuccess(regularUpdatesSelfResult);
  
  // Test with different permission state (limited permissions)
  const limitedStates = [
    {
      // A permission source with limited permissions
      "user.view": { target: ["user:*"] },
      // No update or delete permissions
    }
  ];

  // Act & Assert - User cannot update others (no explicit permission)
  const regularUpdatesResult = validate(
    userPermissions,
    limitedStates,
    "user.update",
    { from: "user:regular", target: "user:another" }
  );
  assertValidationFailure(regularUpdatesResult);
});

Deno.test("Integration - time-based resource access", () => {
  // Define dates for testing
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);

  // Arrange - Create a permission hierarchy for resource access
  const resourcePermissions = hierarchy({
    resource: permission({
      rules: [ensureTime()],
      children: {
        read: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
        write: permission({
          rules: [allowTarget({ wildcards: true }), allowOwner()],
        })
      }
    }),
  });

  // Test case 1: Reading Project A now (within valid time period)
  const readProjectANowStates = [
    {
      // Permission source: Project A current access period
      "resource": { 
        dateStart: yesterday,
        dateEnd: tomorrow
      },
      "resource.read": { target: ["project:A.*"] }
    }
  ];

  // Act & Assert - Can read project A now (within valid time period)
  const readProjectAResult = validate(
    resourcePermissions,
    readProjectANowStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:A.docs",
      date: now
    }
  );
  assertValidationSuccess(readProjectAResult);

  // Test case 2: Reading Project B now (outside valid time period)
  const readProjectBNowStates = [
    {
      // Permission source: Project B future access period
      "resource": { 
        dateStart: tomorrow,
        dateEnd: nextWeek
      },
      "resource.read": { target: ["project:B.*"] }
    }
  ];

  // Act & Assert - Cannot read project B yet (time constraint fails)
  const readProjectBResult = validate(
    resourcePermissions,
    readProjectBNowStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:B.docs",
      date: now
    }
  );
  assertValidationFailure(readProjectBResult, ["rule"], ["ensureTime"]);

  // Test case 3: Reading Project B tomorrow (within valid time period)
  // Using the same permission source as test case 2
  const readProjectBTomorrowResult = validate(
    resourcePermissions,
    readProjectBNowStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:B.docs",
      date: tomorrow
    }
  );
  assertValidationSuccess(readProjectBTomorrowResult);

  // Test case 4: Reading Project A next week (after permission expires)
  const readProjectANextWeekResult = validate(
    resourcePermissions,
    readProjectANowStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:A.docs",
      date: nextWeek
    }
  );
  assertValidationFailure(readProjectANextWeekResult, ["rule"], ["ensureTime"]);

  // Test case 5: Testing the OR logic with multiple states
  // We'll create two state objects in the array - only one needs to allow access
  const multipleSourcesStates = [
    {
      // Permission source 1: Current access period but for project C (not A or B)
      "resource": { 
        dateStart: yesterday,
        dateEnd: tomorrow
      },
      "resource.read": { target: ["project:C.*"] }  // This won't match our request
    },
    {
      // Permission source 2: Project B with future access period
      "resource": { 
        dateStart: tomorrow,
        dateEnd: nextWeek
      },
      "resource.read": { target: ["project:B.*"] }  // This matches our request
    }
  ];

  // Act & Assert - Tomorrow access should work via source 2
  const readProjectBTomorrowMultiSourceResult = validate(
    resourcePermissions,
    multipleSourcesStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:B.docs",
      date: tomorrow  // Tomorrow is within period for source 2
    }
  );
  assertValidationSuccess(readProjectBTomorrowMultiSourceResult);

  // Act & Assert - Today access should fail for project B (neither source allows it)
  const readProjectBNowMultiSourceResult = validate(
    resourcePermissions,
    multipleSourcesStates,
    "resource.read",
    { 
      from: "user:bob", 
      target: "project:B.docs",
      date: now  // Today is outside period for source 2
    }
  );
  assertValidationFailure(readProjectBNowMultiSourceResult, ["rule"], ["ensureTime"]);
});

Deno.test("Integration - complex rule combinations", () => {
  // Créons une hiérarchie simplifiée pour tester uniquement allowTarget
  const simpleTargetPermissions = hierarchy({
    content: permission({
      rules: [],
      children: {
        delete: permission({
          // Une règle simple : allowTarget
          rules: [allowTarget({ wildcards: true })],
        })
      }
    }),
  });

  // Permission source pour la suppression de contenu par l'admin
  const adminDeleteState = [
    {
      "content.delete": { target: ["content:*"] },
    }
  ];

  // Act & Assert - Admin peut supprimer le contenu avec une règle simple
  const adminDeletesSimpleResult = validate(
    simpleTargetPermissions,
    adminDeleteState,
    "content.delete",
    { 
      from: "user:admin", 
      target: "content:article3"
    }
  );
  assertValidationSuccess(adminDeletesSimpleResult);

  // Testez séparément la règle denySelf
  const selfProtectedPermissions = hierarchy({
    content: permission({
      rules: [],
      children: {
        delete: permission({
          rules: [denySelf()],
        })
      }
    }),
  });

  // Act & Assert - Admin ne peut pas se supprimer lui-même avec la règle denySelf
  const adminDeletesSelfResult = validate(
    selfProtectedPermissions,
    adminDeleteState,
    "content.delete",
    { 
      from: "user:admin", 
      target: "user:admin"  // Cible correspond à from, déclenchant denySelf
    }
  );
  assertValidationFailure(adminDeletesSelfResult, ["rule"], ["denySelf"]);
  
  // Test pour combiner ensureTime avec une règle qui retourne true explicitement
  const workStart = new Date();
  workStart.setHours(9, 0, 0, 0);
  
  const workEnd = new Date();
  workEnd.setHours(17, 0, 0, 0);
  
  const combinedTimePermissions = hierarchy({
    content: permission({
      rules: [],
      children: {
        edit: permission({
          // Combinaison de ensureTime avec allowTarget pour avoir un true explicite
          rules: [
            ensureTime(),
            allowTarget({ wildcards: true })
          ],
        })
      }
    }),
  });
  
  const workHoursEditState = [
    {
      "content.edit": { 
        dateStart: workStart,
        dateEnd: workEnd,
        target: ["content:*"]  // Pour allowTarget
      },
    }
  ];
  
  // Act & Assert - On peut éditer pendant les heures de travail
  const duringWorkHours = new Date();
  duringWorkHours.setHours(12, 0, 0, 0); // Midi
  
  const editDuringWorkHoursResult = validate(
    combinedTimePermissions,
    workHoursEditState,
    "content.edit",
    { 
      from: "user:alice",
      target: "content:article2",
      date: duringWorkHours
    }
  );
  assertValidationSuccess(editDuringWorkHoursResult);
});