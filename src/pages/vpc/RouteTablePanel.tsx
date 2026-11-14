import { useState } from "react";
import { AssociateRouteTableCommand, CreateRouteCommand, DeleteRouteCommand, DisassociateRouteTableCommand, type Route, type RouteTable, type Subnet } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { ec2 } from "../../clients/ec2";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listInstances } from "../ec2/ec2util";
import { State, explicitSubnets, idWithName, isMain, listInternetGateways, listNatGateways, parseCidr, routeDestination, routeTarget, tagName } from "./vpcutil";

const TARGET_TYPES: SelectProps.Option[] = [
  { value: "igw", label: "Internet gateway" },
  { value: "nat", label: "NAT gateway" },
  { value: "instance", label: "Instance" },
];

/** The routes and subnet associations of one route table. Shown under the list when a row is selected. */
export function RouteTablePanel({ table, tables, subnets, onChange }: { table: RouteTable; tables: RouteTable[]; subnets: Subnet[]; onChange: () => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const id = table.RouteTableId ?? "";
  const [modal, setModal] = useState<"route" | "subnet" | undefined>(undefined);
  const [destination, setDestination] = useState("");
  const [targetType, setTargetType] = useState(TARGET_TYPES[0]);
  const [target, setTarget] = useState<SelectProps.Option | null>(null);
  const [subnet, setSubnet] = useState<SelectProps.Option | null>(null);
  const [busy, setBusy] = useState("");

  // The things in this VPC that a route can point to. Loaded when the dialog opens.
  const targets = useLoad(async (): Promise<Record<string, SelectProps.Option[]>> => {
    if (modal !== "route") return {};
    const [gateways, nats, instances] = await Promise.all([listInternetGateways(), listNatGateways(), listInstances()]);
    return {
      igw: gateways.filter((g) => g.Attachments?.some((a) => a.VpcId === table.VpcId)).map((g) => ({ value: g.InternetGatewayId, label: idWithName(g.InternetGatewayId, g.Tags) })),
      nat: nats.filter((n) => n.VpcId === table.VpcId && n.State !== "deleted").map((n) => ({ value: n.NatGatewayId, label: idWithName(n.NatGatewayId, n.Tags), description: n.SubnetId })),
      instance: instances.filter((i) => i.VpcId === table.VpcId && i.State?.Name !== "terminated").map((i) => ({ value: i.InstanceId, label: idWithName(i.InstanceId, i.Tags), description: i.PrivateIpAddress })),
    };
  }, [modal, table.VpcId]);

  const associations = explicitSubnets(table);
  // A subnet takes one route table. Offer the subnets of this VPC that have no route table of their own.
  const taken = new Set(tables.flatMap((t) => explicitSubnets(t).map((a) => a.SubnetId)));
  const freeSubnets = subnets.filter((s) => s.VpcId === table.VpcId && !taken.has(s.SubnetId)).map((s) => ({ value: s.SubnetId, label: idWithName(s.SubnetId, s.Tags), description: `${s.CidrBlock} | ${s.AvailabilityZone}` }));
  const subnetLabel = (subnetId?: string) => idWithName(subnetId, subnets.find((s) => s.SubnetId === subnetId)?.Tags);

  const open = (which: "route" | "subnet") => {
    setDestination("");
    setTargetType(TARGET_TYPES[0]);
    setTarget(null);
    setSubnet(null);
    form.setError("");
    setModal(which);
  };

  const addRoute = async () => {
    const cidr = destination.trim();
    if (!parseCidr(cidr)) return form.setError("Enter a valid destination CIDR block, such as 0.0.0.0/0.");
    if (table.Routes?.some((r) => r.DestinationCidrBlock === cidr)) return form.setError(`This route table already has a route for ${cidr}.`);
    if (!target?.value) return form.setError("Choose a target.");
    const ok = await form.run(async () => {
      const input = { RouteTableId: id, DestinationCidrBlock: cidr };
      if (targetType.value === "igw") await ec2.send(new CreateRouteCommand({ ...input, GatewayId: target.value }));
      else if (targetType.value === "nat") await ec2.send(new CreateRouteCommand({ ...input, NatGatewayId: target.value }));
      else await ec2.send(new CreateRouteCommand({ ...input, InstanceId: target.value }));
      notify.success(`Added the route ${cidr} to ${id}.`);
      onChange();
    });
    if (ok) setModal(undefined);
  };

  const associate = async () => {
    if (!subnet?.value) return form.setError("Choose a subnet.");
    const ok = await form.run(async () => {
      await ec2.send(new AssociateRouteTableCommand({ RouteTableId: id, SubnetId: subnet.value }));
      notify.success(`Associated ${subnet.value} with ${id}.`);
      onChange();
    });
    if (ok) setModal(undefined);
  };

  const run = async (key: string, done: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      notify.success(done);
    } catch (e) {
      notify.error("Could not change the route table", e);
    }
    setBusy("");
    onChange();
  };

  const removeRoute = (r: Route) => run(routeDestination(r), `Deleted the route ${routeDestination(r)} from ${id}.`, () => ec2.send(new DeleteRouteCommand({ RouteTableId: id, DestinationCidrBlock: r.DestinationCidrBlock })));
  const disassociate = (associationId: string, subnetId: string) => run(associationId, `Removed ${subnetId} from ${id}.`, () => ec2.send(new DisassociateRouteTableCommand({ AssociationId: associationId })));

  return (
    <>
      <Tabs
        variant="container"
        tabs={[
          {
            id: "routes",
            label: "Routes",
            content: (
              <Table
                variant="embedded"
                header={
                  <Header variant="h2" counter={`(${table.Routes?.length ?? 0})`} description={idWithName(id, table.Tags)} actions={<Button onClick={() => open("route")}>Add route</Button>}>
                    Routes
                  </Header>
                }
                items={table.Routes ?? []}
                trackBy={routeDestination}
                columnDefinitions={[
                  { id: "destination", header: "Destination", cell: routeDestination, isRowHeader: true },
                  { id: "target", header: "Target", cell: routeTarget },
                  { id: "status", header: "Status", cell: (r) => <State state={r.State} /> },
                  { id: "propagated", header: "Propagated", cell: (r) => (r.Origin === "EnableVgwRoutePropagation" ? "Yes" : "No") },
                  {
                    id: "actions",
                    header: "Actions",
                    // The local route keeps traffic inside the VPC. AWS does not let you delete it.
                    cell: (r) =>
                      r.GatewayId === "local" || !r.DestinationCidrBlock ? (
                        "-"
                      ) : (
                        <Button variant="inline-link" loading={busy === routeDestination(r)} ariaLabel={`Delete route ${routeDestination(r)}`} onClick={() => removeRoute(r)}>
                          Delete
                        </Button>
                      ),
                  },
                ]}
                empty={<Box textAlign="center">No routes</Box>}
              />
            ),
          },
          {
            id: "subnets",
            label: "Subnet associations",
            content: (
              <Table
                variant="embedded"
                header={
                  <Header
                    variant="h2"
                    counter={`(${associations.length})`}
                    description={isMain(table) ? "This is the main route table. Subnets with no route table of their own use it." : "Subnets that use this route table."}
                    actions={<Button onClick={() => open("subnet")}>Associate subnet</Button>}
                  >
                    Explicit subnet associations
                  </Header>
                }
                items={associations}
                trackBy={(a) => a.RouteTableAssociationId ?? ""}
                columnDefinitions={[
                  { id: "subnet", header: "Subnet ID", cell: (a) => subnetLabel(a.SubnetId), isRowHeader: true },
                  { id: "cidr", header: "IPv4 CIDR", cell: (a) => subnets.find((s) => s.SubnetId === a.SubnetId)?.CidrBlock ?? "-" },
                  { id: "assoc", header: "Association ID", cell: (a) => a.RouteTableAssociationId },
                  {
                    id: "actions",
                    header: "Actions",
                    cell: (a) => (
                      <Button variant="inline-link" loading={busy === a.RouteTableAssociationId} ariaLabel={`Disassociate ${a.SubnetId}`} onClick={() => disassociate(a.RouteTableAssociationId ?? "", a.SubnetId ?? "")}>
                        Disassociate
                      </Button>
                    ),
                  },
                ]}
                empty={<Box textAlign="center">No subnet associations. {tagName(table.Tags) || id} has no subnets of its own.</Box>}
              />
            ),
          },
        ]}
      />

      <FormModal visible={modal === "route"} header="Add route" submitLabel="Add route" busy={form.busy} error={form.error || targets.error} onDismiss={() => setModal(undefined)} onSubmit={addRoute}>
        <FormField label="Destination" description="The range of addresses this route covers. 0.0.0.0/0 covers every address.">
          <Input value={destination} placeholder="0.0.0.0/0" onChange={(e) => setDestination(e.detail.value)} />
        </FormField>
        <FormField label="Target type">
          <Select
            selectedOption={targetType}
            options={TARGET_TYPES}
            onChange={(e) => {
              setTargetType(e.detail.selectedOption);
              setTarget(null);
            }}
          />
        </FormField>
        <FormField label="Target" description="Only the targets in the VPC of this route table are listed.">
          <Select
            selectedOption={target}
            options={targets.data?.[targetType.value ?? ""] ?? []}
            onChange={(e) => setTarget(e.detail.selectedOption)}
            placeholder="Select a target"
            statusType={targets.loading ? "loading" : "finished"}
            empty={`No ${targetType.label?.toLowerCase()}s in ${table.VpcId}`}
          />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "subnet"} header="Associate subnet" submitLabel="Associate subnet" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={associate}>
        <FormField label="Subnet" description="Subnets that already have a route table of their own are not listed.">
          <Select selectedOption={subnet} options={freeSubnets} onChange={(e) => setSubnet(e.detail.selectedOption)} placeholder="Select a subnet" empty="No subnets to associate" />
        </FormField>
      </FormModal>
    </>
  );
}
