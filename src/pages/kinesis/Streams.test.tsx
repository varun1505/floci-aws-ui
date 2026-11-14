import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Kinesis client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/kinesis", () => ({ kinesis: { send } }));

import Streams from "./Streams";

let streams: string[];

beforeEach(() => {
  streams = ["orders"];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListStreamsCommand":
        return { StreamNames: streams, HasMoreStreams: false };
      case "DescribeStreamSummaryCommand":
        return {
          StreamDescriptionSummary: {
            StreamName: command.input.StreamName,
            StreamARN: `arn:aws:kinesis:us-east-1:000000000000:stream/${command.input.StreamName}`,
            StreamStatus: "ACTIVE",
            StreamModeDetails: { StreamMode: "PROVISIONED" },
            RetentionPeriodHours: 48,
            OpenShardCount: 3,
            EncryptionType: "NONE",
            StreamCreationTimestamp: new Date(1700000000000),
          },
        };
      case "CreateStreamCommand":
        return {};
      case "DeleteStreamCommand":
        streams = streams.filter((s) => s !== command.input.StreamName);
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
    <MemoryRouter initialEntries={["/kinesis/streams"]}>
      <NotifyProvider>
        <Streams />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("Kinesis data streams page", () => {
  it("lists the streams with their capacity and retention", async () => {
    open();
    expect(await screen.findByRole("link", { name: "orders" })).toHaveAttribute("href", "/kinesis/streams/orders");
    const row = within(screen.getByRole("link", { name: "orders" }).closest("tr")!);
    expect(row.getByText("Active")).toBeInTheDocument();
    expect(row.getByText("Provisioned")).toBeInTheDocument();
    expect(row.getByText("3")).toBeInTheDocument();
    expect(row.getByText("2 days")).toBeInTheDocument();
  });

  it("creates an on-demand stream with the name of the form", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create data stream"));
    await userEvent.type(await screen.findByPlaceholderText("my-stream"), "clicks");
    await userEvent.click(dialogButton("Create data stream"));
    await waitFor(() => expect(sent("CreateStreamCommand")).toHaveLength(1));
    expect(sent("CreateStreamCommand")[0].input).toEqual({ StreamName: "clicks", StreamModeDetails: { StreamMode: "ON_DEMAND" } });
  });

  it("creates a provisioned stream with the shard count", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create data stream"));
    await userEvent.type(await screen.findByPlaceholderText("my-stream"), "clicks");
    await userEvent.click(screen.getByRole("radio", { name: /Provisioned/ }));
    const shards = screen.getByRole("spinbutton");
    await userEvent.clear(shards);
    await userEvent.type(shards, "4");
    await userEvent.click(dialogButton("Create data stream"));
    await waitFor(() => expect(sent("CreateStreamCommand")).toHaveLength(1));
    expect(sent("CreateStreamCommand")[0].input).toEqual({ StreamName: "clicks", StreamModeDetails: { StreamMode: "PROVISIONED" }, ShardCount: 4 });
  });

  it("rejects a stream name with invalid characters", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    await userEvent.click(pageButton("Create data stream"));
    await userEvent.type(await screen.findByPlaceholderText("my-stream"), "bad name!");
    await userEvent.click(dialogButton("Create data stream"));
    expect(await screen.findByText("Use up to 128 letters, numbers, underscores, hyphens and periods.")).toBeInTheDocument();
    expect(sent("CreateStreamCommand")).toHaveLength(0);
  });

  it("deletes the selected stream only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "orders" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteStreamCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteStreamCommand")).toHaveLength(1));
    expect(sent("DeleteStreamCommand")[0].input).toEqual({ StreamName: "orders", EnforceConsumerDeletion: true });
    await waitFor(() => expect(screen.queryByRole("link", { name: "orders" })).not.toBeInTheDocument());
  });
});
