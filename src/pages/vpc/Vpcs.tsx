import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateVpcCommand, DeleteVpcCommand, type Tenancy, type Vpc } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { State, VPC_CRUMB, cidrError, idWithName, listRouteTables, listVpcs, mainRouteTable, nameOrDash, nameTagSpec, plural, tagName } from "./vpcutil";

const TENANCY = [
  { value: "default", label: "Default" },
  { value: "dedicated", label: "Dedicated" },
];

export default function Vpcs() {
  const navigate = useNavigate();
  const notify = useNotify();
  const vpcs = useLoad(listVpcs, []);
  // The main route table column is extra. The list still shows when this call fails.
  const tables = useLoad(() => listRouteTables().catch(() => []), []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Vpc[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("10.0.0.0/16");
  const [tenancy, setTenancy] = useState("default");

  const reload = () => (vpcs.reload(), tables.reload());

  const openCreate = () => {
    setName("");
    setCidr("10.0.0.0/16");
    setTenancy("default");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const problem = cidrError(cidr);
    if (problem) return form.setError(problem);
    const ok = await form.run(async () => {
      const res = await ec2.send(new CreateVpcCommand({ CidrBlock: cidr.trim(), InstanceTenancy: tenancy as Tenancy, TagSpecifications: nameTagSpec("vpc", name) }));
      const id = res.Vpc?.VpcId ?? "";
      notify.success(`You successfully created ${idWithName(id, res.Vpc?.Tags)}.`);
      navigate(`/vpc/vpcs/${id}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    let done = 0;
    try {
      for (const v of selected) {
        await ec2.send(new DeleteVpcCommand({ VpcId: v.VpcId }));
        done++;
      }
      notify.success(`Deleted ${plural(done, "VPC")}.`);
      setSelected([]);
    } catch (e) {
      // AWS refuses to delete a VPC that still has subnets, gateways or other resources in it.
      notify.error(`Could not delete ${selected[done]?.VpcId}. Delete its subnets, gateways and other resources first.`, e);
    }
    setDeleting(false);
    reload();
  };

  return (
    <Shell service="vpc" contentType="table" breadcrumbs={[VPC_CRUMB, { text: "Your VPCs", href: "/vpc/vpcs" }]}>
      <ResourceTable
        title="Your VPCs"
        resourceName="VPCs"
        filterPlaceholder="Find VPCs by attribute or tag"
        emptyDescription="A VPC is an isolated network for your resources."
        emptyCli="ec2 create-vpc --cidr-block 10.0.0.0/16"
        items={vpcs.data}
        loading={vpcs.loading}
        error={vpcs.error}
        onRefresh={reload}
        trackBy={(v) => v.VpcId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create VPC</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create VPC
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (v) => nameOrDash(v.Tags), sortingComparator: (a, b) => tagName(a.Tags).localeCompare(tagName(b.Tags)) },
          { id: "id", header: "VPC ID", cell: (v) => <RouterLink to={`/vpc/vpcs/${v.VpcId}`}>{v.VpcId}</RouterLink>, sortingField: "VpcId", isRowHeader: true },
          { id: "state", header: "State", cell: (v) => <State state={v.State} />, sortingField: "State" },
          { id: "cidr", header: "IPv4 CIDR", cell: (v) => v.CidrBlock ?? "-", sortingField: "CidrBlock" },
          { id: "dhcp", header: "DHCP option set", cell: (v) => v.DhcpOptionsId ?? "-" },
          { id: "rtb", header: "Main route table", cell: (v) => mainRouteTable(tables.data, v.VpcId)?.RouteTableId ?? "-" },
          { id: "tenancy", header: "Tenancy", cell: (v) => v.InstanceTenancy ?? "-" },
          { id: "default", header: "Default VPC", cell: (v) => (v.IsDefault ? "Yes" : "No") },
        ]}
      />

      <FormModal visible={creating} header="Create VPC" submitLabel="Create VPC" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Name tag - optional" description="Creates a tag with a key of 'Name' and a value that you specify.">
          <Input value={name} placeholder="my-vpc-01" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="IPv4 CIDR" constraintText="CIDR block size must be between /16 and /28.">
          <Input value={cidr} placeholder="10.0.0.0/16" onChange={(e) => setCidr(e.detail.value)} />
        </FormField>
        <FormField label="Tenancy">
          <Select selectedOption={TENANCY.find((t) => t.value === tenancy) ?? TENANCY[0]} options={TENANCY} onChange={(e) => setTenancy(e.detail.selectedOption.value ?? "default")} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? "Delete VPC" : "Delete VPCs"}
        warning={selected.some((v) => v.IsDefault) ? "You selected the default VPC. Instances launched without a VPC use it." : undefined}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
      >
        <Box>
          Delete {selected.map((v) => idWithName(v.VpcId, v.Tags)).join(", ")}? This also deletes the main route table, the default security group and the default network ACL of the VPC.
        </Box>
      </ConfirmDelete>
    </Shell>
  );
}
