import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The OpenSearch client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/opensearch", () => ({ opensearch: { send } }));

import Domains from "./Domains";

let domains: string[];

beforeEach(() => {
  domains = ["logs"];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListDomainNamesCommand":
        return { DomainNames: domains.map((DomainName) => ({ DomainName, EngineType: "OpenSearch" })) };
      case "DescribeDomainsCommand":
        return {
          DomainStatusList: (command.input.DomainNames as string[]).map((DomainName) => ({
            DomainName,
            DomainId: `000000000000/${DomainName}`,
            ARN: `arn:aws:es:us-east-1:000000000000:domain/${DomainName}`,
            Created: true,
            Deleted: false,
            Processing: false,
            Endpoint: "http://172.18.0.8:9200",
            EngineVersion: "OpenSearch_2.19",
            ClusterConfig: { InstanceType: "t3.small.search", InstanceCount: 2 },
          })),
        };
      case "ListVersionsCommand":
        return { Versions: ["OpenSearch_3.6", "OpenSearch_2.19"] };
      case "ListInstanceTypeDetailsCommand":
        return { InstanceTypeDetails: [{ InstanceType: "t3.small.search" }, { InstanceType: "m5.large.search" }] };
      case "CreateDomainCommand":
        return { DomainStatus: { DomainName: command.input.DomainName } };
      case "DeleteDomainCommand":
        domains = domains.filter((d) => d !== command.input.DomainName);
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
    <MemoryRouter initialEntries={["/opensearch/domains"]}>
      <NotifyProvider>
        <Domains />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("OpenSearch domains page", () => {
  it("lists the domains with their status and version", async () => {
    open();
    expect(await screen.findByRole("link", { name: "logs" })).toHaveAttribute("href", "/opensearch/domains/logs");
    const row = within(screen.getByRole("link", { name: "logs" }).closest("tr")!);
    expect(row.getByText("Active")).toBeInTheDocument();
    expect(row.getByText("OpenSearch 2.19")).toBeInTheDocument();
    expect(row.getByText("t3.small.search")).toBeInTheDocument();
    expect(row.getByText("http://172.18.0.8:9200")).toBeInTheDocument();
  });

  it("creates a domain with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "logs" });
    await userEvent.click(pageButton("Create domain"));
    await userEvent.type(await screen.findByPlaceholderText("my-domain"), "search");
    await userEvent.click(dialogButton("Create domain"));
    await waitFor(() => expect(sent("CreateDomainCommand")).toHaveLength(1));
    expect(sent("CreateDomainCommand")[0].input).toEqual({
      DomainName: "search",
      EngineVersion: "OpenSearch_2.19",
      ClusterConfig: { InstanceType: "m5.large.search", InstanceCount: 1 },
      EBSOptions: { EBSEnabled: true, VolumeType: "gp2", VolumeSize: 10 },
    });
  });

  it("rejects a domain name that breaks the naming rules", async () => {
    open();
    await screen.findByRole("link", { name: "logs" });
    await userEvent.click(pageButton("Create domain"));
    await userEvent.type(await screen.findByPlaceholderText("my-domain"), "Bad_Name");
    await userEvent.click(dialogButton("Create domain"));
    expect(await screen.findByText("Use 3 to 28 characters. Start with a lowercase letter. Use lowercase letters, numbers and hyphens.")).toBeInTheDocument();
    expect(sent("CreateDomainCommand")).toHaveLength(0);
  });

  it("deletes the selected domain only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "logs" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteDomainCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteDomainCommand")).toHaveLength(1));
    expect(sent("DeleteDomainCommand")[0].input).toEqual({ DomainName: "logs" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "logs" })).not.toBeInTheDocument());
  });
});
