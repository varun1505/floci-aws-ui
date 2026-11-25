import { describe, expect, it } from "vitest";
import { PROXY_BASE, accessKeyFor, accountId, clientBase, getRegion, getSelectedAccount, setDefaultAccountId, viaProxy } from "./config";

describe("config", () => {
  it("sends every SDK call to /aws on the same origin", () => {
    expect(PROXY_BASE).toBe(`${window.location.origin}/aws`);
    expect(clientBase.endpoint).toBe(PROXY_BASE);
  });
  it("uses only the fake credentials", () => {
    expect(clientBase.credentials).toEqual({ accessKeyId: "test", secretAccessKey: "test" });
  });
  it("sends a 12-digit account ID as the access key, and test for the default account", () => {
    expect(accessKeyFor("111111111111")).toBe("111111111111");
    expect(accessKeyFor("")).toBe("test");
    expect(accessKeyFor("abc")).toBe("test");
  });
  it("reads a saved account and ignores one that is not 12 digits", () => {
    localStorage.removeItem("account");
    expect(getSelectedAccount()).toBe("");
    expect(accountId()).toBe("000000000000");
    localStorage.setItem("account", "222222222222");
    expect(accountId()).toBe("222222222222");
    localStorage.setItem("account", "12345");
    expect(getSelectedAccount()).toBe("");
    localStorage.removeItem("account");
  });
  it("shows floci's own default account when it has another one", () => {
    setDefaultAccountId("123456789012");
    expect(accountId()).toBe("123456789012");
    setDefaultAccountId("000000000000");
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
