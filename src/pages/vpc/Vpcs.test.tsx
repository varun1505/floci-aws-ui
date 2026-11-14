import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The EC2 client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/ec2", () => ({ ec2: { send } }));

import Vpcs from "./Vpcs";
import { cidrError, cidrInside, parseCidr } from "./vpcutil";

type FakeVpc = { VpcId: string; CidrBlock: string; State: string; IsDefault: boolean; InstanceTenancy: string; DhcpOptionsId: string; Tags: { Key: string; Value: string }[] };
let vpcs: FakeVpc[];
let failDelete: boolean;

beforeEach(() => {
  vpcs = [
    { VpcId: "vpc-default", CidrBlock: "172.31.0.0/16", State: "available", IsDefault: true, InstanceTenancy: "default", DhcpOptionsId: "dopt-default", Tags: [] },
    { VpcId: "vpc-111", CidrBlock: "10.1.0.0/16", State: "available", IsDefault: false, InstanceTenancy: "default", DhcpOptionsId: "dopt-default", Tags: [{ Key: "Name", Value: "shop" }] },
  ];
  failDelete = false;
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "DescribeVpcsCommand":
        return { Vpcs: vpcs };
      case "DescribeRouteTablesCommand":
        return { RouteTables: [{ RouteTableId: "rtb-main-111", VpcId: "vpc-111", Associations: [{ Main: true }] }] };
      case "CreateVpcCommand":
        return { Vpc: { VpcId: "vpc-new" } };
      case "DeleteVpcCommand":
        if (failDelete) throw Object.assign(new Error("The vpc 'vpc-111' has dependencies and cannot be deleted."), { name: "DependencyViolation" });
        vpcs = vpcs.filter((v) => v.VpcId !== command.input.VpcId);
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
    <MemoryRouter initialEntries={["/vpc/vpcs"]}>
      <NotifyProvider>
        <Vpcs />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("Your VPCs page", () => {
  it("lists the VPCs with their name, CIDR and main route table", async () => {
    open();
    expect(await screen.findByRole("link", { name: "vpc-111" })).toHaveAttribute("href", "/vpc/vpcs/vpc-111");
    const row = within(screen.getByRole("link", { name: "vpc-111" }).closest("tr")!);
    expect(row.getByText("shop")).toBeInTheDocument();
    expect(row.getByText("10.1.0.0/16")).toBeInTheDocument();
    expect(row.getByText("No")).toBeInTheDocument();
    expect(await row.findByText("rtb-main-111")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "vpc-default" }).closest("tr")!).getByText("Yes")).toBeInTheDocument();
  });

  it("creates a VPC with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "vpc-111" });
    await userEvent.click(pageButton("Create VPC"));
    await userEvent.type(await screen.findByPlaceholderText("my-vpc-01"), "orders");
    const cidr = screen.getByPlaceholderText("10.0.0.0/16");
    await userEvent.clear(cidr);
    await userEvent.type(cidr, "10.20.0.0/16");
    await userEvent.click(dialogButton("Create VPC"));
    await waitFor(() => expect(sent("CreateVpcCommand")).toHaveLength(1));
    expect(sent("CreateVpcCommand")[0].input).toEqual({
      CidrBlock: "10.20.0.0/16",
      InstanceTenancy: "default",
      TagSpecifications: [{ ResourceType: "vpc", Tags: [{ Key: "Name", Value: "orders" }] }],
    });
  });

  it("rejects a CIDR block that is not valid", async () => {
    open();
    await screen.findByRole("link", { name: "vpc-111" });
    await userEvent.click(pageButton("Create VPC"));
    const cidr = await screen.findByPlaceholderText("10.0.0.0/16");
    await userEvent.clear(cidr);
    await userEvent.type(cidr, "10.0.0.0/8");
    await userEvent.click(dialogButton("Create VPC"));
    expect(await screen.findByText("The block size must be between /16 and /28.")).toBeInTheDocument();
    expect(sent("CreateVpcCommand")).toHaveLength(0);
  });

  it("deletes the selected VPC only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: "vpc-111" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteVpcCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteVpcCommand")).toHaveLength(1));
    expect(sent("DeleteVpcCommand")[0].input).toEqual({ VpcId: "vpc-111" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "vpc-111" })).not.toBeInTheDocument());
  });

  it("keeps the VPC in the list when AWS refuses to delete it", async () => {
    failDelete = true;
    open();
    await screen.findByRole("link", { name: "vpc-111" });
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(pageButton("Delete"));
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteVpcCommand")).toHaveLength(1));
    expect(screen.getByRole("link", { name: "vpc-111" })).toBeInTheDocument();
  });
});

describe("CIDR checks", () => {
  it("reads a block and refuses text that is not one", () => {
    expect(parseCidr("10.0.0.0/16")).toEqual({ start: 10 * 2 ** 24, bits: 16, size: 65536 });
    expect(parseCidr("0.0.0.0/0")?.size).toBe(2 ** 32);
    expect(parseCidr("10.0.0.5/16")).toBeUndefined();
    expect(parseCidr("300.0.0.0/16")).toBeUndefined();
    expect(parseCidr("10.0.0.0")).toBeUndefined();
  });

  it("limits VPC and subnet blocks to /16 through /28", () => {
    expect(cidrError("10.0.0.0/16")).toBe("");
    expect(cidrError("10.0.0.0/29")).not.toBe("");
    expect(cidrError("nope")).not.toBe("");
  });

  it("knows when a subnet block lies inside a VPC block", () => {
    expect(cidrInside("10.77.1.0/24", "10.77.0.0/16")).toBe(true);
    expect(cidrInside("10.99.1.0/24", "10.77.0.0/16")).toBe(false);
    expect(cidrInside("10.77.0.0/16", "10.77.1.0/24")).toBe(false);
  });
});
