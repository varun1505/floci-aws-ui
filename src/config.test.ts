import { describe, expect, it } from "vitest";
import { PROXY_BASE, clientBase, getRegion, viaProxy } from "./config";

describe("config", () => {
  it("sends every SDK call to /aws on the same origin", () => {
    expect(PROXY_BASE).toBe(`${window.location.origin}/aws`);
    expect(clientBase.endpoint).toBe(PROXY_BASE);
  });
  it("uses only the fake credentials", () => {
    expect(clientBase.credentials).toEqual({ accessKeyId: "test", secretAccessKey: "test" });
  });
  it("defaults to us-east-1 and reads a saved region", () => {
    localStorage.removeItem("region");
    expect(getRegion()).toBe("us-east-1");
    localStorage.setItem("region", "ap-south-1");
    expect(getRegion()).toBe("ap-south-1");
    localStorage.removeItem("region");
  });
  it("rewrites a floci URL to go through the proxy", () => {
    expect(viaProxy("http://floci:4566/my-bucket/a/b.txt?X-Amz-Signature=abc")).toBe(`${PROXY_BASE}/my-bucket/a/b.txt?X-Amz-Signature=abc`);
  });
});
