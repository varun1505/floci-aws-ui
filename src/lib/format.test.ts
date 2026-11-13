import { describe, expect, it } from "vitest";
import { errorMessage, formatBytes, formatDate } from "./format";

describe("formatBytes", () => {
  it("shows a dash when there is no size", () => {
    expect(formatBytes(undefined)).toBe("-");
  });
  it("keeps small sizes in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("moves up one unit at each 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });
  it("stops at terabytes", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });
});

describe("formatDate", () => {
  it("shows a dash for empty and invalid values", () => {
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("")).toBe("-");
    expect(formatDate(0)).toBe("-");
    expect(formatDate("not a date")).toBe("-");
  });
  it("accepts a Date, a string and a number", () => {
    const d = new Date(2026, 0, 15, 10, 30, 0);
    expect(formatDate(d)).toContain("2026");
    expect(formatDate(d.toISOString())).toBe(formatDate(d));
    expect(formatDate(d.getTime())).toBe(formatDate(d));
  });
});

describe("errorMessage", () => {
  it("puts the AWS error name before the message", () => {
    expect(errorMessage({ name: "NoSuchBucket", message: "The bucket does not exist" })).toBe("NoSuchBucket: The bucket does not exist");
  });
  it("leaves out the name of a plain Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("turns anything else into a string", () => {
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(null)).toBe("null");
  });
});
