import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreateSubnetCommand, DeleteSubnetCommand, DescribeAvailabilityZonesCommand, ModifySubnetAttributeCommand, type Subnet } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { State, VPC_CRUMB, cidrError, cidrInside, idWithName, listRouteTables, listSubnets, listVpcs, nameOrDash, nameTagSpec, plural, routeTableOf, tagName, vpcOptions } from "./vpcutil";

const ALL: SelectProps.Option = { value: "", label: "All VPCs" };
const NO_ZONE: SelectProps.Option = { value: "", label: "No preference" };

export default function Subnets() {
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const vpcId = params.get("vpc") ?? "";
  const subnets = useLoad(() => listSubnets(vpcId || undefined), [vpcId]);
  const vpcs = useLoad(listVpcs, []);
  // The route table column is extra. The list still shows when this call fails.
  const tables = useLoad(() => listRouteTables().catch(() => []), []);
  const zones = useLoad(async () => (await ec2.send(new DescribeAvailabilityZonesCommand({}))).AvailabilityZones ?? [], []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Subnet[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [name, setName] = useState("");
  const [zone, setZone] = useState<SelectProps.Option>(NO_ZONE);
  const [cidr, setCidr] = useState("");

  const options = vpcOptions(vpcs.data);
  const zoneOptions = [NO_ZONE, ...(zones.data ?? []).map((z) => ({ value: z.ZoneName, label: z.ZoneName, description: z.ZoneId }))];
  const vpcCidr = (id?: string) => vpcs.data?.find((v) => v.VpcId === id)?.CidrBlock;
  const reload = () => (subnets.reload(), tables.reload());
  const one = selected.length === 1 ? selected[0] : undefined;

  const openCreate = () => {
    setVpc(options.find((o) => o.value === vpcId) ?? (options.length === 1 ? options[0] : null));
    setName("");
    setCidr("");
    setZone(NO_ZONE);
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!vpc?.value) return form.setError("Choose a VPC.");
    const problem = cidrError(cidr);
    if (problem) return form.setError(problem);
    const outer = vpcCidr(vpc.value);
    if (outer && !cidrInside(cidr, outer)) return form.setError(`The subnet CIDR block must lie inside the VPC CIDR block ${outer}.`);
    const ok = await form.run(async () => {
      const res = await ec2.send(
        new CreateSubnetCommand({ VpcId: vpc.value, CidrBlock: cidr.trim(), AvailabilityZone: zone.value || undefined, TagSpecifications: nameTagSpec("subnet", name) }),
      );
      notify.success(`You have successfully created 1 subnet: ${res.Subnet?.SubnetId ?? ""}`);
      reload();
    });
    if (ok) setCreating(false);
  };

  const toggleAutoAssign = async (subnet: Subnet) => {
    const next = !subnet.MapPublicIpOnLaunch;
    setBusy(true);
    try {
      await ec2.send(new ModifySubnetAttributeCommand({ SubnetId: subnet.SubnetId, MapPublicIpOnLaunch: { Value: next } }));
      notify.success(`Auto-assign public IPv4 address is now ${next ? "on" : "off"} for ${subnet.SubnetId}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not change the subnet", e);
    }
    setBusy(false);
    subnets.reload(true);
  };

  const remove = async () => {
    let done = 0;
    try {
      for (const s of selected) {
        await ec2.send(new DeleteSubnetCommand({ SubnetId: s.SubnetId }));
        done++;
      }
      notify.success(`Deleted ${plural(done, "subnet")}.`);
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete ${selected[done]?.SubnetId}`, e);
    }
    setDeleting(false);
    reload();
  };

  return (
    <Shell service="vpc" contentType="table" breadcrumbs={[VPC_CRUMB, { text: "Subnets", href: "/vpc/subnets" }]}>
      <ResourceTable
        title="Subnets"
        resourceName="subnets"
        filterPlaceholder="Find subnets by attribute or tag"
        emptyDescription="A subnet is a range of IP addresses in your VPC."
        items={subnets.data}
        loading={subnets.loading}
        error={subnets.error}
        onRefresh={reload}
        trackBy={(s) => s.SubnetId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create subnet</Button>}
        extraFilter={
          <div style={{ minWidth: 260 }}>
            <Select
              ariaLabel="Filter by VPC"
              selectedOption={options.find((o) => o.value === vpcId) ?? ALL}
              options={[ALL, ...options]}
              onChange={(e) => {
                setSelected([]);
                setParams(e.detail.selectedOption.value ? { vpc: e.detail.selectedOption.value } : {}, { replace: true });
              }}
            />
          </div>
        }
        actions={
          <>
            <Button disabled={!one} loading={busy} onClick={() => one && toggleAutoAssign(one)}>
              {one?.MapPublicIpOnLaunch ? "Turn off auto-assign public IPv4" : "Turn on auto-assign public IPv4"}
            </Button>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create subnet
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (s) => nameOrDash(s.Tags), sortingComparator: (a, b) => tagName(a.Tags).localeCompare(tagName(b.Tags)) },
          { id: "id", header: "Subnet ID", cell: (s) => s.SubnetId, sortingField: "SubnetId", isRowHeader: true },
          { id: "state", header: "State", cell: (s) => <State state={s.State} />, sortingField: "State" },
          { id: "vpc", header: "VPC", cell: (s) => <RouterLink to={`/vpc/vpcs/${s.VpcId}`}>{s.VpcId}</RouterLink>, sortingField: "VpcId" },
          { id: "cidr", header: "IPv4 CIDR", cell: (s) => s.CidrBlock ?? "-", sortingField: "CidrBlock" },
          { id: "ips", header: "Available IPv4 addresses", cell: (s) => s.AvailableIpAddressCount ?? "-", sortingField: "AvailableIpAddressCount" },
          { id: "az", header: "Availability Zone", cell: (s) => s.AvailabilityZone ?? "-", sortingField: "AvailabilityZone" },
          { id: "rtb", header: "Route table", cell: (s) => routeTableOf(tables.data, s)?.RouteTableId ?? "-" },
          { id: "public", header: "Auto-assign public IPv4 address", cell: (s) => (s.MapPublicIpOnLaunch ? "Yes" : "No") },
        ]}
      />

      <FormModal visible={creating} header="Create subnet" submitLabel="Create subnet" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="VPC ID" description="Create the subnet in this VPC.">
          <Select selectedOption={vpc} options={options} onChange={(e) => setVpc(e.detail.selectedOption)} placeholder="Select a VPC" statusType={vpcs.loading ? "loading" : "finished"} empty="No VPCs" />
        </FormField>
        <FormField label="Subnet name - optional" description="Creates a tag with a key of 'Name' and a value that you specify.">
          <Input value={name} placeholder="my-subnet-01" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Availability Zone">
          <Select selectedOption={zone} options={zoneOptions} onChange={(e) => setZone(e.detail.selectedOption)} />
        </FormField>
        <FormField label="IPv4 subnet CIDR block" constraintText={vpc?.value && vpcCidr(vpc.value) ? `Must lie inside the VPC CIDR block ${vpcCidr(vpc.value)}. Size /16 to /28.` : "Size /16 to /28."}>
          <Input value={cidr} placeholder="10.0.0.0/24" onChange={(e) => setCidr(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? "Delete subnet" : "Delete subnets"} onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>Delete {selected.map((s) => idWithName(s.SubnetId, s.Tags)).join(", ")}?</Box>
      </ConfirmDelete>
    </Shell>
  );
}
