import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom does not have these browser APIs. Cloudscape layout components call them.
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= Observer as unknown as typeof IntersectionObserver;
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
  window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
