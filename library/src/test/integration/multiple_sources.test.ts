/**
 * Tests for permission system with multiple sources
 * 
 * These tests demonstrate scenarios with multiple permission sources:
 * - Multiple permission states evaluated with OR logic
 * - Permissions coming from different sources (direct grants, roles, groups)
 * - Combined permissions from different sources
 */
import { hierarchy, permission, validate } from "../../core/permission.ts";
import { allowTarget } from "../../rules/allowTarget/allowTarget.ts";
import { assertEquals } from "jsr:@std/assert";
import { assertValidationSuccess, assertValidationFailure } from "../helpers/test_utils.ts";

Deno.test("Multiple Sources - Permission grants from different sources with OR logic", () => {
  // Arrange - Create a permission hierarchy for resources
  const resourcePermissions = hierarchy({
    resource: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
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
  });

  // Create three different permission sources
  const states = [
    {
      // Source 1: Direct user grants
      "resource": { target: ["resource:document.A"] },
      "resource.view": { target: ["resource:document.A"] },
    },
    {
      // Source 2: Team membership grants
      "resource": { target: ["resource:document.B", "resource:report.*"] },
      "resource.view": { target: ["resource:document.B", "resource:report.*"] },
      "resource.edit": { target: ["resource:report.monthly"] },
    },
    {
      // Source 3: Role-based grants
      "resource": { target: ["resource:document.C", "resource:*.public"] },
      "resource.view": { target: ["resource:document.C", "resource:*.public"] },
      "resource.delete": { target: ["resource:document.C"] },
    }
  ];

  // Test access to document A (granted via Source 1)
  const viewDocumentAResult = validate(
    resourcePermissions,
    states,
    "resource.view",
    { from: "user:alice", target: "resource:document.A" }
  );
  assertValidationSuccess(viewDocumentAResult);

  // Test access to document B (granted via Source 2)
  const viewDocumentBResult = validate(
    resourcePermissions,
    states,
    "resource.view",
    { from: "user:alice", target: "resource:document.B" }
  );
  assertValidationSuccess(viewDocumentBResult);

  // Test access to document C (granted via Source 3)
  const viewDocumentCResult = validate(
    resourcePermissions,
    states,
    "resource.view",
    { from: "user:alice", target: "resource:document.C" }
  );
  assertValidationSuccess(viewDocumentCResult);

  // Test access to document D (not granted by any source)
  const viewDocumentDResult = validate(
    resourcePermissions,
    states,
    "resource.view",
    { from: "user:alice", target: "resource:document.D" }
  );
  assertValidationFailure(viewDocumentDResult);

  // Test edit access to monthly report (granted via Source 2)
  const editMonthlyReportResult = validate(
    resourcePermissions,
    states,
    "resource.edit",
    { from: "user:alice", target: "resource:report.monthly" }
  );
  assertValidationSuccess(editMonthlyReportResult);

  // Test delete access to document C (granted via Source 3)
  const deleteDocumentCResult = validate(
    resourcePermissions,
    states,
    "resource.delete",
    { from: "user:alice", target: "resource:document.C" }
  );
  assertValidationSuccess(deleteDocumentCResult);

  // Test wildcard access to public content (granted via Source 3)
  const viewPublicDocumentResult = validate(
    resourcePermissions,
    states,
    "resource.view",
    { from: "user:alice", target: "resource:document.public" }
  );
  assertValidationSuccess(viewPublicDocumentResult);
});

Deno.test("Multiple Sources - Combining permissions from multiple user contexts", () => {
  // Arrange - Create a permission hierarchy
  const applicationPermissions = hierarchy({
    app: permission({
      rules: [allowTarget({ wildcards: true })],
      children: {
        feature: permission({
          rules: [allowTarget({ wildcards: true })],
          children: {
            use: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
            configure: permission({
              rules: [allowTarget({ wildcards: true })],
            }),
          }
        }),
      }
    }),
  });

  // Create permission sources from different contexts
  const states = [
    {
      // Source 1: User's personal permissions
      "app": { target: ["app:basic"] },
      "app.feature": { target: ["feature:standard"] },
      "app.feature.use": { target: ["feature:standard/*"] },
    },
    {
      // Source 2: User's organizational role
      "app": { target: ["app:premium"] },
      "app.feature": { target: ["feature:premium"] },
      "app.feature.use": { target: ["feature:premium/*"] },
    },
    {
      // Source 3: Special temporary grants
      "app.feature.configure": { target: ["feature:standard/notifications"] },
    }
  ];

  // Test - Can use standard features (from personal permissions)
  const useStandardResult = validate(
    applicationPermissions,
    states,
    "app.feature.use",
    { from: "user:alice", target: "feature:standard/dashboard" }
  );
  assertValidationSuccess(useStandardResult);

  // Test - Can use premium features (from organizational role)
  const usePremiumResult = validate(
    applicationPermissions,
    states,
    "app.feature.use",
    { from: "user:alice", target: "feature:premium/analytics" }
  );
  assertValidationSuccess(usePremiumResult);

  // Test - Can configure specifically granted feature (from special grants)
  const configureNotificationsResult = validate(
    applicationPermissions,
    states,
    "app.feature.configure",
    { from: "user:alice", target: "feature:standard/notifications" }
  );
  assertValidationSuccess(configureNotificationsResult);

  // Test - Cannot configure other features
  const configureAnalyticsResult = validate(
    applicationPermissions,
    states,
    "app.feature.configure",
    { from: "user:alice", target: "feature:premium/analytics" }
  );
  assertValidationFailure(configureAnalyticsResult);
});