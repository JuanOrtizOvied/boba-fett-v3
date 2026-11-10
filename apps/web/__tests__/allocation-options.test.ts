import { describe, expect, test } from "vitest";
import {
  GEOGRAPHIC_FOCUS_GROUPS,
  UNDERLYING_GROUPS,
  allocationOptionExists,
} from "@/lib/allocationOptions";

const flat = (groups: { options: string[] }[]) => groups.flatMap((g) => g.options);

describe("allocationOptions", () => {
  test("geographic focus has exactly 5 values", () => {
    expect(flat(GEOGRAPHIC_FOCUS_GROUPS)).toHaveLength(5);
  });

  test("underlying has exactly 28 values", () => {
    expect(flat(UNDERLYING_GROUPS)).toHaveLength(28);
  });

  test("allocationOptionExists matches only catalog values", () => {
    expect(allocationOptionExists(UNDERLYING_GROUPS, "Cash")).toBe(true);
    expect(allocationOptionExists(UNDERLYING_GROUPS, "nope")).toBe(false);
  });
});
