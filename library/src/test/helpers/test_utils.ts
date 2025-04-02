/**
 * Helper functions and fixtures for permission tests
 */
import { PermissionStateSet, ValidationResult } from "../../types/common.ts";
import {
  bgBlue,
  bgGreen,
  bgRed,
  blue,
  bold,
  cyan,
  green,
  magenta,
  red,
  white,
  yellow,
} from "https://deno.land/std/fmt/colors.ts";
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std/assert/mod.ts";
import { hierarchy, permission } from "../../core/permission.ts";

/**
 * Prints the validation results with colored output for better readability
 *
 * @param result The validation result to display
 */
export function printValidationResults(result: ValidationResult): void {
  console.log(bold("\n======= Validation Results ======="));

  // Show validation result
  const validationStatus = result.valid === true
    ? bgGreen(white(" VALID "))
    : bgRed(white(" INVALID "));
  console.log(`Validation status: ${validationStatus}`);

  // Display reasons if any
  if (result.reasons.length > 0) {
    console.log(bold(red("\nValidation reasons:")));
    result.reasons.forEach((reason, index) => {
      console.log(`\n${bgRed(white(` Reason #${index + 1} `))}:`);
      console.log(`- ${bold("Type")}: ${cyan(reason.type)}`);
      console.log(`- ${bold("Name")}: ${blue(reason.name)}`);
      console.log(
        `- ${bold("Permission key")}: ${magenta(reason.permissionKey)}`,
      );
      console.log(`- ${bold("Message")}: ${red(reason.message)}`);
      if (reason.stateIndex !== undefined) {
        console.log(
          `- ${bold("State index")}: ${yellow(reason.stateIndex.toString())}`,
        );
      }
    });
  } else {
    console.log(`\n${bgGreen(white(" No validation issues "))} ✓`);
  }

  console.log(bold("==================================\n"));
}

/**
 * Prints a test header with the test title
 *
 * @param testNumber The number of the test
 * @param description Description of the test case
 */
export function printTestHeader(testNumber: number, description: string): void {
  console.log(bgBlue(white(` Test #${testNumber} `)) + " " + bold(description));
}

/**
 * Creates a common test fixture with basic permissions hierarchy
 */
export function createTestPermissionHierarchy() {
  return hierarchy({
    user: permission({
      rules: [],
      children: {
        create: permission({
          rules: [],
        }),
        view: permission({
          rules: [],
        }),
        update: permission({
          rules: [],
        }),
        delete: permission({
          rules: [],
        }),
      },
    }),
    resource: permission({
      rules: [],
      children: {
        read: permission({
          rules: [],
        }),
        write: permission({
          rules: [],
        }),
      },
    }),
  });
}

/**
 * Assert that validation succeeded
 */
export function assertValidationSuccess(result: ValidationResult): void {
  assertStrictEquals(result.valid, true);
  assertEquals(result.reasons.length, 0);
}

/**
 * Assert that validation failed
 *
 * @param result The validation result
 * @param expectedReasonTypes Optional list of expected reason types
 * @param expectedReasonNames Optional list of expected reason names
 */
export function assertValidationFailure(
  result: ValidationResult,
  expectedReasonTypes?: string[],
  expectedReasonNames?: string[],
): void {
  assertStrictEquals(result.valid, false);
  if (expectedReasonTypes) {
    const actualReasonTypes = result.reasons.map((reason) => reason.type);
    assertEquals(actualReasonTypes, expectedReasonTypes);
  }
  if (expectedReasonNames) {
    const actualReasonNames = result.reasons.map((reason) => reason.name);
    assertEquals(actualReasonNames, expectedReasonNames);
  }
}
