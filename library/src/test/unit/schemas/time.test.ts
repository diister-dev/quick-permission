/**
 * Tests for time schema
 */
import { time, TimeState, TimeRequest } from "../../../schemas/time/time.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("time schema - should validate correct state structure", () => {
  // Arrange
  const schema = time();
  
  // Act & Assert - Empty state
  assertEquals(schema.state({}), true);
  
  // Act & Assert - With dateStart only
  const withStart: TimeState = { dateStart: new Date() };
  assertEquals(schema.state(withStart), true);
  
  // Act & Assert - With dateEnd only
  const withEnd: TimeState = { dateEnd: new Date() };
  assertEquals(schema.state(withEnd), true);
  
  // Act & Assert - With both dates
  const withBoth: TimeState = { 
    dateStart: new Date(), 
    dateEnd: new Date() 
  };
  assertEquals(schema.state(withBoth), true);
});

Deno.test("time schema - should invalidate incorrect state structure", () => {
  // Arrange
  const schema = time();
  
  // Act & Assert - Not an object
  assertEquals(schema.state(null), false);
  assertEquals(schema.state(undefined), false);
  assertEquals(schema.state("string"), false);
  
  // Act & Assert - Invalid dateStart
  assertEquals(schema.state({ dateStart: "2023-01-01" }), false);
  assertEquals(schema.state({ dateStart: 1672531200000 }), false); // timestamp as number
  
  // Act & Assert - Invalid dateEnd
  assertEquals(schema.state({ dateEnd: "2023-12-31" }), false);
  assertEquals(schema.state({ dateEnd: 1704067200000 }), false); // timestamp as number
});

Deno.test("time schema - should validate correct request structure", () => {
  // Arrange
  const schema = time();
  
  // Act & Assert - Empty request
  assertEquals(schema.request({}), true);
  
  // Act & Assert - With date
  const withDate: TimeRequest = { date: new Date() };
  assertEquals(schema.request(withDate), true);
});

Deno.test("time schema - should invalidate incorrect request structure", () => {
  // Arrange
  const schema = time();
  
  // Act & Assert - Not an object
  assertEquals(schema.request(null), false);
  assertEquals(schema.request(undefined), false);
  assertEquals(schema.request("string"), false);
  
  // Act & Assert - Invalid date
  assertEquals(schema.request({ date: "2023-01-01" }), false);
  assertEquals(schema.request({ date: 1672531200000 }), false); // timestamp as number
});

Deno.test("time schema - should have correct name", () => {
  // Arrange
  const schema = time();
  
  // Act & Assert
  assertEquals(schema.name, "time");
});