import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Route 53 and EC2 clients answer from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/route53", () => ({ route53: { send } }));
vi.mock("../../clients/ec2", () => ({ ec2: { send } }));

import HostedZones from "./HostedZones";

const NS = { Name: "example.com.", Type: "NS", TTL: 172800, ResourceRecords: [{ Value: "ns-1.awsdns-01.org." }] };
const SOA = { Name: "example.com.", Type: "SOA", TTL: 900, ResourceRecords: [{ Value: "ns-1.awsdns-01.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400" }] };
const WWW = { Name: "www.example.com.", Type: "A", TTL: 300, ResourceRecords: [{ Value: "192.0.2.1" }] };
let zones: { Id: string; Name: string; Config: { Comment?: string; PrivateZone: boolean }; ResourceRecordSetCount: number }[];

beforeEach(() => {
  zones = [{ Id: "/hostedzone/Z111", Name: "example.com.", Config: { Comment: "main site", PrivateZone: false }, ResourceRecordSetCount: 3 }];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListHostedZonesCommand":
        return { HostedZones: zones, IsTruncated: false };
      case "DescribeVpcsCommand":
        return { Vpcs: [{ VpcId: "vpc-123", CidrBlock: "10.0.0.0/16" }] };
      case "CreateHostedZoneCommand":
        return { HostedZone: { Id: "/hostedzone/Z222", Name: `${command.input.Name}.` } };
      case "ListResourceRecordSetsCommand":
        return { ResourceRecordSets: [NS, SOA, WWW], IsTruncated: false };
      case "ChangeResourceRecordSetsCommand":
        return { ChangeInfo: { Status: "INSYNC" } };
      case "DeleteHostedZoneCommand":
        zones = zones.filter((z) => z.Id !== `/hostedzone/${command.input.Id}`);
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
    <MemoryRouter initialEntries={["/route53/hosted-zones"]}>
      <NotifyProvider>
        <HostedZones />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("Route 53 hosted zones page", () => {
  it("lists the hosted zones with a link that uses the bare zone ID", async () => {
    open();
    expect(await screen.findByRole("link", { name: "example.com" })).toHaveAttribute("href", "/route53/hosted-zones/Z111");
    const row = within(screen.getByRole("link", { name: "example.com" }).closest("tr")!);
    expect(row.getByText("Public")).toBeInTheDocument();
    expect(row.getByText("3")).toBeInTheDocument();
    expect(row.getByText("main site")).toBeInTheDocument();
  });

  it("creates a public hosted zone with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "example.com" });
    await userEvent.click(pageButton("Create hosted zone"));
    await userEvent.type(await screen.findByPlaceholderText("example.com"), "shop.test.");
    await userEvent.type(screen.getByPlaceholderText("The hosted zone is used for..."), "the shop");
    await userEvent.click(dialogButton("Create hosted zone"));
    await waitFor(() => expect(sent("CreateHostedZoneCommand")).toHaveLength(1));
    const input = sent("CreateHostedZoneCommand")[0].input;
    expect(input).toMatchObject({ Name: "shop.test", HostedZoneConfig: { Comment: "the shop" }, VPC: undefined });
    expect(input.CallerReference).toMatch(/^console-/);
  });

  it("rejects a domain name that is not valid", async () => {
    open();
    await screen.findByRole("link", { name: "example.com" });
    await userEvent.click(pageButton("Create hosted zone"));
    await userEvent.type(await screen.findByPlaceholderText("example.com"), "not a domain");
    await userEvent.click(dialogButton("Create hosted zone"));
    expect(await screen.findByText("Enter a valid domain name, such as example.com.")).toBeInTheDocument();
    expect(sent("CreateHostedZoneCommand")).toHaveLength(0);
  });

  it("asks for a VPC before it creates a private hosted zone", async () => {
    open();
    await screen.findByRole("link", { name: "example.com" });
    await userEvent.click(pageButton("Create hosted zone"));
    await userEvent.type(await screen.findByPlaceholderText("example.com"), "corp.internal");
    await userEvent.click(screen.getByRole("radio", { name: /Private hosted zone/ }));
    await waitFor(() => expect(sent("DescribeVpcsCommand")).toHaveLength(1));
    await userEvent.click(dialogButton("Create hosted zone"));
    expect(await screen.findByText("Choose a VPC for the private hosted zone.")).toBeInTheDocument();
    expect(sent("CreateHostedZoneCommand")).toHaveLength(0);
  });

  it("deletes the zone's other records and then the zone, only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "example.com" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(await screen.findByText(/This also deletes the 1 other record\./)).toBeInTheDocument();
    expect(sent("DeleteHostedZoneCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteHostedZoneCommand")).toHaveLength(1));
    // The NS and SOA records of the zone stay. Only the www record is deleted first.
    expect(sent("ChangeResourceRecordSetsCommand")[0].input).toEqual({ HostedZoneId: "Z111", ChangeBatch: { Changes: [{ Action: "DELETE", ResourceRecordSet: WWW }] } });
    expect(sent("DeleteHostedZoneCommand")[0].input).toEqual({ Id: "Z111" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "example.com" })).not.toBeInTheDocument());
  });
});
