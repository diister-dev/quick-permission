/**
 * Tests for identity and ownership permission patterns
 *
 * These tests demonstrate the distinction between identity and ownership:
 * - allowSelf() checks if request.from === request.target (identity)
 * - allowOwner() checks if request.from === request.owner (ownership)
 */
import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowOwner } from "../../rules/allowOwner/allowOwner.ts";
import { allowSelf } from "../../rules/allowSelf/allowSelf.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { and, merge, not, or } from "../../operators/operations.ts";
import { assertEquals } from "jsr:@std/assert";
import {
  assertValidationFailure,
  assertValidationSuccess,
} from "../helpers/test_utils.ts";

Deno.test("Identity and Ownership - User profiles with self-reference and ownership", () => {
  // Arrange - Create a permission hierarchy with identity and ownership rules
  const userPermissions = hierarchy({
    user: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        profile: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              // Anyone can view profiles with allowed target
              rules: [allowTarget({ wildcards: true })],
            }),
            edit: permission({
              // User can only edit their own profile (identity check)
              rules: [allowSelf()],
            }),
          },
        }),
        content: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            view: permission({
              // Anyone can view content with allowed target
              rules: [allowTarget({ wildcards: true })],
            }),
            edit: permission({
              // Only content owner can edit (ownership check)
              rules: [allowOwner()],
            }),
            delete: permission({
              // Only content owner can delete (ownership check)
              rules: [allowOwner()],
            }),
          },
        }),
      },
    }),
  });

  // Create permission states
  const states = [
    {
      // Basic permissions for all users
      "user.profile.view": { target: ["user:*"] },
      "user.profile.edit": { target: [] },
      "user.content.view": { target: ["content:*"] },
      "user.content.edit": { target: [] },
      "user.content.delete": { target: [] },
    },
  ];

  // Test - User can view any profile (using allowTarget)
  const viewOtherProfileResult = validate(
    userPermissions,
    states,
    "user.profile.view",
    {
      from: "user:alice",
      target: "user:bob",
    },
  );
  assertValidationSuccess(viewOtherProfileResult);

  // Test - User can edit their own profile (using allowSelf)
  const editOwnProfileResult = validate(
    userPermissions,
    states,
    "user.profile.edit",
    {
      from: "user:alice",
      target: "user:alice", // Identity check - target is the same as from
    },
  );
  assertValidationSuccess(editOwnProfileResult);

  // Test - User cannot edit another user's profile
  const editOtherProfileResult = validate(
    userPermissions,
    states,
    "user.profile.edit",
    {
      from: "user:alice",
      target: "user:bob", // Identity check fails - target is not the same as from
    },
  );
  assertValidationFailure(editOtherProfileResult);

  // Test - User can edit content they own (using allowOwner)
  const editOwnContentResult = validate(
    userPermissions,
    states,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:post-123",
      owner: "user:alice", // Ownership check - owner is the same as from
    },
  );
  assertValidationSuccess(editOwnContentResult);

  // Test - User cannot edit content owned by others
  const editOthersContentResult = validate(
    userPermissions,
    states,
    "user.content.edit",
    {
      from: "user:alice",
      target: "content:post-456",
      owner: "user:bob", // Ownership check fails - owner is not the same as from
    },
  );
  assertValidationFailure(editOthersContentResult);

  // Test - User can delete content they own (using allowOwner)
  const deleteOwnContentResult = validate(
    userPermissions,
    states,
    "user.content.delete",
    {
      from: "user:alice",
      target: "content:post-123",
      owner: "user:alice", // Ownership check - owner is the same as from
    },
  );

  assertValidationSuccess(deleteOwnContentResult);
});

Deno.test("Identity and Ownership - Issue tracker with combined patterns", () => {
  // Arrange - Create a permission hierarchy with complex rule combinations
  const issuePermissions = hierarchy({
    issue: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        view: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
        comment: permission({
          rules: [allowTarget({ wildcards: true })],
        }),
        assign: permission({
          // Can assign issues to themselves or others based on permissions
          // allowSelf() checks if from === target (user assigning to themselves)
          rules: [or([allowSelf(), allowTarget({ wildcards: true })])],
        }),
        resolve: permission({
          // Can resolve issues they're assigned to or have explicit permission
          // allowSelf() checks if from === target (user is assigned to the issue)
          rules: [or([allowSelf(), allowTarget({ wildcards: true })])],
        }),
        reopen: permission({
          // Cannot reopen issues assigned to themselves (to prevent abuse)
          // allowSelf() checks if from === target (user is the assignee)
          rules: [not(allowSelf()), allowTarget({ wildcards: true })],
        }),
        delete: permission({
          // Cannot delete issues they own (to maintain accountability)
          // allowOwner() checks if from === owner (user is the issue creator/owner)
          rules: [not(allowOwner()), allowTarget({ wildcards: true })],
        }),
      },
    }),
  });

  // Create permission states for different permission sources
  const states = [
    {
      // Base permissions that apply to all users
      "issue": { target: ["project:A/*"] },
      "issue.view": { target: ["project:A/*"] },
      "issue.comment": { target: ["project:A/*"] },
      "issue.assign": { target: ["project:A/issue-*"] },
      "issue.resolve": { target: ["project:A/issue-*"] },
      "issue.delete": { target: [] },
    },
    {
      // Additional permissions for project managers
      "issue.reopen": { target: ["project:*"] },
    },
    {
      // Administrative permissions
      "issue.delete": { target: ["project:*"] },
    },
  ];

  // Test user viewing an issue
  const viewIssueResult = validate(
    issuePermissions,
    states,
    "issue.view",
    {
      from: "user:developer",
      target: "project:A/issue-123",
    },
  );
  assertValidationSuccess(viewIssueResult);

  // Test user assigning an issue to themselves (allowSelf case)
  // In this scenario, the target is the user themselves
  const assignToSelfResult = validate(
    issuePermissions,
    states,
    "issue.assign",
    {
      from: "user:developer",
      target: "user:developer", // Self-reference - allowSelf() checks if from === target
    },
  );
  assertValidationSuccess(assignToSelfResult);

  // Test user assigning an issue to someone else (allowTarget case)
  const assignToOtherResult = validate(
    issuePermissions,
    states,
    "issue.assign",
    {
      from: "user:developer",
      target: "project:A/issue-456",
    },
  );
  assertValidationSuccess(assignToOtherResult);

  // Test user resolving an issue assigned to them (allowSelf case)
  // In this scenario, target represents the assignee (the user themselves)
  const resolveSelfAssignedResult = validate(
    issuePermissions,
    states,
    "issue.resolve",
    {
      from: "user:pm",
      target: "user:pm", // Self-assigned issue - allowSelf() checks if from === target
    },
  );
  assertValidationSuccess(resolveSelfAssignedResult);

  // Test PM trying to reopen an issue assigned to them (should be denied by not(allowSelf))
  const reopenSelfAssignedResult = validate(
    issuePermissions,
    states,
    "issue.reopen",
    {
      from: "user:pm",
      target: "user:pm", // Self-assigned issue - not(allowSelf()) prevents reopening own assignments
    },
  );
  assertValidationFailure(reopenSelfAssignedResult);

  // Test PM reopening someone else's issue (should succeed)
  const reopenOtherResult = validate(
    issuePermissions,
    states,
    "issue.reopen",
    {
      from: "user:pm",
      target: "project:A/issue-123",
    },
  );
  assertValidationSuccess(reopenOtherResult);

  // Test admin trying to delete an issue they own (should be denied by not(allowOwner))
  // In this scenario, the owner field explicitly indicates resource ownership
  const deleteOwnIssueResult = validate(
    issuePermissions,
    states,
    "issue.delete",
    {
      from: "user:admin",
      target: "project:A/issue-456",
      owner: "user:admin", // Issue owned by admin - not(allowOwner()) prevents deleting own issues
    },
  );
  assertValidationFailure(deleteOwnIssueResult);

  // Test admin deleting someone else's issue (should succeed)
  const deleteOthersIssueResult = validate(
    issuePermissions,
    states,
    "issue.delete",
    {
      from: "user:admin",
      target: "project:A/issue-123",
      owner: "user:developer", // Issue owned by developer - allowOwner() checks if from === owner
    },
  );
  assertValidationSuccess(deleteOthersIssueResult);
});
