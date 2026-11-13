import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The SQS client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/sqs", () => ({ sqs: { send } }));

import Queues from "./Queues";

const ORDERS = "http://floci:4566/000000000000/orders";
let queues: string[];

beforeEach(() => {
  queues = [ORDERS];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListQueuesCommand":
        return { QueueUrls: queues };
      case "GetQueueAttributesCommand":
        return { Attributes: { QueueArn: "arn:aws:sqs:us-east-1:000000000000:orders", ApproximateNumberOfMessages: "7", CreatedTimestamp: "1700000000" } };
      case "CreateQueueCommand":
        return { QueueUrl: `http://floci:4566/000000000000/${command.input.QueueName}` };
      case "DeleteQueueCommand":
        queues = queues.filter((q) => q !== command.input.QueueUrl);
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);

// The dialogs are in the page even when closed, so a button name can match twice.
// The page's own button comes first. The dialog's button comes last.
const pageButton = (name: string) => screen.getAllByRole("button", { name })[0];
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open() {
  render(
    <MemoryRouter initialEntries={["/sqs/queues"]}>
      <NotifyProvider>
        <Queues />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("SQS queues page", () => {
  it("lists the queues with their message counts", async () => {
    open();
    expect(await screen.findByRole("link", { name: "orders" })).toHaveAttribute("href", `/sqs/queue?url=${encodeURIComponent(ORDERS)}`);
    const row = within(screen.getByRole("link", { name: "orders" }).closest("tr")!);
    expect(row.getByText("Standard")).toBeInTheDocument();
    expect(row.getByText("7")).toBeInTheDocument();
  });

  it("creates a queue with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create queue"));
    await userEvent.type(await screen.findByPlaceholderText("my-queue"), "invoices");
    await userEvent.click(dialogButton("Create queue"));
    await waitFor(() => expect(sent("CreateQueueCommand")).toHaveLength(1));
    expect(sent("CreateQueueCommand")[0].input).toEqual({
      QueueName: "invoices",
      Attributes: { VisibilityTimeout: "30", MessageRetentionPeriod: "345600", DelaySeconds: "0" },
    });
  });

  it("rejects a queue name with invalid characters", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create queue"));
    await userEvent.type(await screen.findByPlaceholderText("my-queue"), "bad name!");
    await userEvent.click(dialogButton("Create queue"));
    expect(await screen.findByText("Use up to 80 letters, numbers, hyphens and underscores.")).toBeInTheDocument();
    expect(sent("CreateQueueCommand")).toHaveLength(0);
  });

  it("deletes the selected queue only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteQueueCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteQueueCommand")).toHaveLength(1));
    expect(sent("DeleteQueueCommand")[0].input).toEqual({ QueueUrl: ORDERS });
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders" })).not.toBeInTheDocument());
  });
});
