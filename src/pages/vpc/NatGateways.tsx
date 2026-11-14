import { useState } from "react";
import { AllocateAddressCommand, type ConnectivityType, CreateNatGatewayCommand, DeleteNatGatewayCommand, DescribeAddressesCommand, type NatGateway } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { State, VPC_CRUMB, idWithName, listNatGateways, listSubnets, nameOrDash, nameTagSpec, plural, tagName } from "./vpcutil";

const primary = (n: NatGateway) => n.NatGatewayAddresses?.find((a) => a.IsPrimary) ?? n.NatGatewayAddresses?.[0];

export default function NatGateways() {
  const notify = useNotify();
  const gateways = useLoad(listNatGateways, []);
  const subnets = useLoad(() => listSubnets(), []);
  // Elastic IP addresses that nothing uses yet.
  const addresses = useLoad(async () => ((await ec2.send(new DescribeAddressesCommand({}))).Addresses ?? []).filter((a) => !a.AssociationId), []);
  const form = useSubmit();
  const [selected, setSelected] = useState<NatGateway[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState<SelectProps.Option | null>(null);
  const [connectivity, setConnectivity] = useState("public");
  const [address, setAddress] = useState<SelectProps.Option | null>(null);
  const [allocating, setAllocating] = useState(false);

  const subnetOptions = (subnets.data ?? []).map((s) => ({ value: s.SubnetId, label: idWithName(s.SubnetId, s.Tags), description: `${s.VpcId} | ${s.CidrBlock} | ${s.AvailabilityZone}` }));
  const addressOptions = (addresses.data ?? []).map((a) => ({ value: a.AllocationId, label: a.AllocationId, description: a.PublicIp }));

  const openCreate = () => {
    setName("");
    setSubnet(null);
    setConnectivity("public");
    setAddress(null);
    form.setError("");
    subnets.reload(true);
    addresses.reload(true);
    setCreating(true);
  };

  const allocate = async () => {
    setAllocating(true);
    form.setError("");
    try {
      const res = await ec2.send(new AllocateAddressCommand({ Domain: "vpc" }));
      setAddress({ value: res.AllocationId, label: res.AllocationId, description: res.PublicIp });
      addresses.reload(true);
    } catch (e) {
      form.setError(errorMessage(e));
    }
    setAllocating(false);
  };

  const create = async () => {
    if (!subnet?.value) return form.setError("Choose a subnet.");
    const isPublic = connectivity === "public";
    if (isPublic && !address?.value) return form.setError("Choose an Elastic IP allocation ID, or allocate a new Elastic IP address.");
    const ok = await form.run(async () => {
      const res = await ec2.send(
        new CreateNatGatewayCommand({
          SubnetId: subnet.value,
          ConnectivityType: connectivity as ConnectivityType,
          AllocationId: isPublic ? address?.value : undefined,
          TagSpecifications: nameTagSpec("natgateway", name),
        }),
      );
      notify.success(`NAT gateway ${res.NatGateway?.NatGatewayId ?? ""} was created successfully.`);
      gateways.reload();
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    let done = 0;
    try {
      for (const n of selected) {
        await ec2.send(new DeleteNatGatewayCommand({ NatGatewayId: n.NatGatewayId }));
        done++;
      }
      notify.success(`Deleted ${plural(done, "NAT gateway")}. The Elastic IP address stays allocated until you release it.`);
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete ${selected[done]?.NatGatewayId}`, e);
    }
    setDeleting(false);
    gateways.reload();
  };

  return (
    <Shell service="vpc" contentType="table" breadcrumbs={[VPC_CRUMB, { text: "NAT gateways", href: "/vpc/nat-gateways" }]}>
      <ResourceTable
        title="NAT gateways"
        resourceName="NAT gateways"
        filterPlaceholder="Find NAT gateways by attribute or tag"
        emptyDescription="A NAT gateway lets resources in a private subnet reach the internet."
        items={gateways.data}
        loading={gateways.loading}
        error={gateways.error}
        onRefresh={() => gateways.reload()}
        trackBy={(n) => n.NatGatewayId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create NAT gateway</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create NAT gateway
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (n) => nameOrDash(n.Tags), sortingComparator: (a, b) => tagName(a.Tags).localeCompare(tagName(b.Tags)) },
          { id: "id", header: "NAT gateway ID", cell: (n) => n.NatGatewayId, sortingField: "NatGatewayId", isRowHeader: true },
          { id: "state", header: "State", cell: (n) => <State state={n.State} />, sortingField: "State" },
          { id: "connectivity", header: "Connectivity type", cell: (n) => (n.ConnectivityType === "private" ? "Private" : "Public") },
          { id: "subnet", header: "Subnet", cell: (n) => (n.SubnetId ? <RouterLink to={`/vpc/subnets?vpc=${n.VpcId}`}>{n.SubnetId}</RouterLink> : "-") },
          { id: "vpc", header: "VPC", cell: (n) => (n.VpcId ? <RouterLink to={`/vpc/vpcs/${n.VpcId}`}>{n.VpcId}</RouterLink> : "-") },
          { id: "public", header: "Primary public IPv4 address", cell: (n) => primary(n)?.PublicIp ?? "-" },
          { id: "private", header: "Primary private IPv4 address", cell: (n) => primary(n)?.PrivateIp ?? "-" },
          { id: "created", header: "Created", cell: (n) => formatDate(n.CreateTime), sortingComparator: (a, b) => (a.CreateTime?.getTime() ?? 0) - (b.CreateTime?.getTime() ?? 0) },
        ]}
      />

      <FormModal visible={creating} header="Create NAT gateway" submitLabel="Create NAT gateway" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Name - optional" description="Creates a tag with a key of 'Name' and a value that you specify.">
          <Input value={name} placeholder="my-nat-gateway-01" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Subnet" description="Select a subnet in which to create the NAT gateway.">
          <Select selectedOption={subnet} options={subnetOptions} onChange={(e) => setSubnet(e.detail.selectedOption)} placeholder="Select a subnet" statusType={subnets.loading ? "loading" : "finished"} empty="No subnets" />
        </FormField>
        <FormField label="Connectivity type">
          <RadioGroup
            value={connectivity}
            onChange={(e) => setConnectivity(e.detail.value)}
            items={[
              { value: "public", label: "Public", description: "Needs an Elastic IP address. Gives private subnets a way out to the internet." },
              { value: "private", label: "Private", description: "No Elastic IP address. Routes traffic to other VPCs or your own network." },
            ]}
          />
        </FormField>
        {connectivity === "public" && (
          <FormField label="Elastic IP allocation ID" description="Assign an Elastic IP address to the NAT gateway.">
            <SpaceBetween direction="horizontal" size="xs">
              <div style={{ minWidth: 300 }}>
                <Select selectedOption={address} options={addressOptions} onChange={(e) => setAddress(e.detail.selectedOption)} placeholder="Select an Elastic IP" empty="No free Elastic IP addresses" />
              </div>
              <Button loading={allocating} onClick={allocate}>
                Allocate Elastic IP
              </Button>
            </SpaceBetween>
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? "Delete NAT gateway" : "Delete NAT gateways"} onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>Delete {selected.map((n) => idWithName(n.NatGatewayId, n.Tags)).join(", ")}? Routes that point to it stop working.</Box>
      </ConfirmDelete>
    </Shell>
  );
}
