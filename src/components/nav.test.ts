import fs from "node:fs";
import { matchPath } from "react-router-dom";
import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";
import { describe, expect, it } from "vitest";
import { NAV, SERVICES, searchIndex } from "./nav";

// The route paths, read from the source of App.tsx.
const routes = [...fs.readFileSync("src/App.tsx", "utf8").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
const hasRoute = (href: string) => routes.some((path) => matchPath(path, href.split("?")[0]));

function links(items: readonly SideNavigationProps.Item[]): string[] {
  return items.flatMap((item) => {
    if (item.type === "link") return item.external ? [] : [item.href];
    if (item.type === "section" || item.type === "section-group" || item.type === "expandable-link-group" || item.type === "link-group") return links(item.items);
    return [];
  });
}

describe("navigation", () => {
  it("finds the routes in App.tsx", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("has a page for every service on the home page", () => {
    expect(SERVICES.filter((s) => !hasRoute(s.href)).map((s) => s.href)).toEqual([]);
  });

  it("has a page for every side navigation link", () => {
    const hrefs = Object.values(NAV).flatMap((nav) => [nav.header.href, ...links(nav.items)]);
    expect(hrefs.length).toBeGreaterThan(40);
    expect([...new Set(hrefs)].filter((h) => !hasRoute(h))).toEqual([]);
  });

  it("has a page for every search result", () => {
    const hrefs = searchIndex().flatMap((group) => group.options.map((o) => o.value));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((h) => !hasRoute(h))).toEqual([]);
  });

  it("has side navigation for every service", () => {
    expect(SERVICES.filter((s) => !NAV[s.id]).map((s) => s.id)).toEqual([]);
  });

  it("lists each service once", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
