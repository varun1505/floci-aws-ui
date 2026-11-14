import { useState } from "react";
import { CreateRouteTableCommand, DeleteRouteTableCommand, type RouteTable } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { RouteTablePanel } from "./RouteTablePanel";
import { VPC_CRUMB, explicitSubnets, idWithName, isMain, listRouteTables, listSubnets, listVpcs, nameOrDash, nameTagSpec, plural, tagName, vpcOptions } from "./vpcutil";

export default function RouteTables() {
  const notify = useNotify();
  const tables = useLoad(() => listRouteTables(), []);
  const subnets = useLoad(() => listSubnets().catch(() => []), []);
  const vpcs = useLoad(listVpcs, []);
  const form = useSubmit();
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);

  // Keep the ID, not the row, so the panel shows fresh data after each reload.
  const selected = tables.data?.find((t) => t.RouteTableId === selectedId);
  const options = vpcOptions(vpcs.data);
  const reload = () => (tables.reload(true), subnets.reload(true));
  const blocked = !selected ? "" : isMain(selected) ? "You can't delete the main route table of a VPC." : explicitSubnets(selected).length ? "Disassociate the subnets of this route table first." : "";

  const openCreate = () => {
    setName("");
    setVpc(options.length === 1 ? options[0] : null);
    form.setError("");
    vpcs.reload(true);
    setCreating(true);
  };

  const create = async () => {
    if (!vpc?.value) return form.setError("Choose a VPC.");
    const ok = await form.run(async () => {
      const res = await ec2.send(new CreateRouteTableCommand({ VpcId: vpc.value, TagSpecifications: nameTagSpec("route-table", name) }));
      const id = res.RouteTable?.RouteTableId ?? "";
      notify.success(`Route table ${id} was created successfully.`);
      setSelectedId(id);
      tables.reload();
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      await ec2.send(new DeleteRouteTableCommand({ RouteTableId: selectedId }));
      notify.success(`Deleted ${plural(1, "route table")}.`);
      setSelectedId("");
    } catch (e) {
      notify.error(`Could not delete ${selectedId}`, e);
    }
    setDeleting(false);
    tables.reload();
  };

  return (
    <Shell service="vpc" contentType="table" breadcrumbs={[VPC_CRUMB, { text: "Route tables", href: "/vpc/route-tables" }]}>
      <SpaceBetween size="l">
        <ResourceTable
          title="Route tables"
          resourceName="route tables"
          filterPlaceholder="Find route tables by attribute or tag"
          description="Select a route table to see its routes and subnet associations."
          emptyDescription="A route table says where the traffic of a subnet goes."
          stickyHeader={false}
          items={tables.data}
          loading={tables.loading}
          error={tables.error}
          onRefresh={() => (tables.reload(), subnets.reload(true))}
          trackBy={(t) => t.RouteTableId ?? ""}
          selectionType="single"
          selected={selected ? [selected] : []}
          onSelect={(items: RouteTable[]) => setSelectedId(items[0]?.RouteTableId ?? "")}
          emptyAction={<Button onClick={openCreate}>Create route table</Button>}
          actions={
            <>
              <Button disabled={!selected || !!blocked} disabledReason={blocked || undefined} onClick={() => setDeleting(true)}>
                Delete
              </Button>
              <Button variant="primary" onClick={openCreate}>
                Create route table
              </Button>
            </>
          }
          columns={[
            { id: "name", header: "Name", cell: (t) => nameOrDash(t.Tags), sortingComparator: (a, b) => tagName(a.Tags).localeCompare(tagName(b.Tags)) },
            { id: "id", header: "Route table ID", cell: (t) => t.RouteTableId, sortingField: "RouteTableId", isRowHeader: true },
            { id: "subnets", header: "Explicit subnet associations", cell: (t) => (explicitSubnets(t).length ? plural(explicitSubnets(t).length, "subnet") : "-") },
            { id: "main", header: "Main", cell: (t) => (isMain(t) ? "Yes" : "No") },
            { id: "vpc", header: "VPC", cell: (t) => <RouterLink to={`/vpc/vpcs/${t.VpcId}`}>{t.VpcId}</RouterLink>, sortingField: "VpcId" },
            { id: "routes", header: "Routes", cell: (t) => t.Routes?.length ?? 0 },
          ]}
        />
        {selected && <RouteTablePanel key={selectedId} table={selected} tables={tables.data ?? []} subnets={subnets.data ?? []} onChange={reload} />}
      </SpaceBetween>

      <FormModal visible={creating} header="Create route table" submitLabel="Create route table" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Name - optional" description="Creates a tag with a key of 'Name' and a value that you specify.">
          <Input value={name} placeholder="my-route-table-01" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="VPC" description="The VPC to use for this route table.">
          <Select selectedOption={vpc} options={options} onChange={(e) => setVpc(e.detail.selectedOption)} placeholder="Select a VPC" statusType={vpcs.loading ? "loading" : "finished"} empty="No VPCs" />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title="Delete route table" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>Delete {selected ? idWithName(selected.RouteTableId, selected.Tags) : ""}?</Box>
      </ConfirmDelete>
    </Shell>
  );
}
