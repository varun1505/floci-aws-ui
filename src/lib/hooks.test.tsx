import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLoad } from "./useLoad";
import { useSubmit } from "./useSubmit";

describe("useLoad", () => {
  it("loads on mount and gives the data", async () => {
    const { result } = renderHook(() => useLoad(async () => [1, 2], []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeUndefined();
  });

  it("gives the error message when the loader fails", async () => {
    const { result } = renderHook(() => useLoad(async () => Promise.reject({ name: "AccessDenied", message: "no" }), []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("AccessDenied: no");
    expect(result.current.data).toBeUndefined();
  });

  it("loads again on reload, and a silent reload does not show loading", async () => {
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const { result } = renderHook(() => useLoad(loader, []));
    await waitFor(() => expect(result.current.data).toBe("first"));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.reload(true);
    });
    expect(result.current.loading).toBe(false);
    await act(() => pending);
    expect(result.current.data).toBe("second");
  });

  it("loads again when a dependency changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useLoad(async () => `item ${id}`, [id]), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.data).toBe("item 1"));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toBe("item 2"));
  });

  it("ignores the answer of an older load that finishes late", async () => {
    let finishSlow!: (v: string) => void;
    const loader = vi
      .fn()
      .mockReturnValueOnce(new Promise<string>((r) => (finishSlow = r)))
      .mockResolvedValueOnce("new");
    const { result } = renderHook(() => useLoad(loader, []));
    await act(() => result.current.reload());
    expect(result.current.data).toBe("new");
    await act(async () => finishSlow("old"));
    expect(result.current.data).toBe("new");
  });
});

describe("useSubmit", () => {
  it("gives true when the work succeeds", async () => {
    const { result } = renderHook(() => useSubmit());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(async () => {});
    });
    expect(ok).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("gives false and keeps the error when the work fails", async () => {
    const { result } = renderHook(() => useSubmit());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(async () => {
        throw new Error("name taken");
      });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("name taken");
    expect(result.current.busy).toBe(false);
  });

  it("clears an old error on the next run", async () => {
    const { result } = renderHook(() => useSubmit());
    act(() => result.current.setError("old"));
    await act(async () => {
      await result.current.run(async () => {});
    });
    expect(result.current.error).toBe("");
  });
});
