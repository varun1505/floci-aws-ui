import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CLI_PROFILE } from "../config";
import { ConfirmDelete } from "./ConfirmDelete";
import { ResourceTable } from "./ResourceTable";

describe("ConfirmDelete", () => {
  const open = (onConfirm = vi.fn().mockResolvedValue(undefined), onCancel = vi.fn()) => {
    render(<ConfirmDelete visible title="Delete my-bucket" onCancel={onCancel} onConfirm={onConfirm} />);
    return { onConfirm, onCancel };
  };

  it("keeps Delete disabled until the user types the word", async () => {
    const { onConfirm } = open();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("delete"), "delet");
    expect(del).toBeDisabled();
    await userEvent.click(del);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("deletes after the user types the word", async () => {
    const { onConfirm } = open();
    await userEvent.type(screen.getByPlaceholderText("delete"), "delete");
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeEnabled();
    await userEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not delete on Cancel", async () => {
    const { onConfirm, onCancel } = open();
    await userEvent.type(screen.getByPlaceholderText("delete"), "delete");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("asks for a custom word", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmDelete visible title="Purge queue" confirmText="purge" actionLabel="Purge" onCancel={() => {}} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByPlaceholderText("purge"), "delete");
    expect(screen.getByRole("button", { name: "Purge" })).toBeDisabled();
  });
});

describe("ResourceTable", () => {
  type Row = { id: string; name: string };
  const columns = [{ id: "name", header: "Name", cell: (r: Row) => r.name }];
  const table = (props: Partial<Parameters<typeof ResourceTable<Row>>[0]>) =>
    render(<ResourceTable<Row> title="Buckets" resourceName="buckets" loading={false} items={[]} columns={columns} trackBy={(r) => r.id} variant="container" stickyHeader={false} {...props} />);

  it("shows the rows and the count", () => {
    table({ items: [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }] });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("shows the CLI command when there is nothing yet", () => {
    table({ emptyCli: "s3 mb s3://my-bucket" });
    expect(screen.getByText(`aws --profile ${CLI_PROFILE} s3 mb s3://my-bucket`)).toBeInTheDocument();
  });

  it("shows the error from the service", () => {
    table({ items: undefined, error: "ServiceUnavailable: floci is down" });
    expect(screen.getByText(/ServiceUnavailable: floci is down/)).toBeInTheDocument();
  });

  it("filters rows by text", async () => {
    table({ items: [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }], filterPlaceholder: "Find buckets" });
    await userEvent.type(screen.getByPlaceholderText("Find buckets"), "bet");
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("calls onRefresh", async () => {
    const onRefresh = vi.fn();
    table({ onRefresh });
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
