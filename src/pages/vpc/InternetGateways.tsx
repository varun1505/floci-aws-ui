import { useState } from "react";
import {
  AttachInternetGatewayCommand,
  CreateInternetGatewayCommand,
  DeleteInternetGatewayCommand,
  DetachInternetGatewayCommand,
  type InternetGateway,
} from "@aws-sdk/client-ec2";
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
import { State, VPC_CRUMB, idWithName, listInternetGateways, listVpcs, nameOrDash, nameTagSpec, plural, tagName, vpcOptions } from "./vpcutil";

const vpcOf = (g: InternetGateway) => g.Attachments?.[0]?.VpcId;

export default function InternetGateways() {
  const notify = useNotify();
  const gateways = useLoad(listInternetGateways, []);
  const vpcs = useLoad(listVpcs, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<InternetGateway[]>([]);
  const [modal, setModal] = useState<"create" | "attach" | "detach" | "delete" | undefined>(undefined);
  const [name, setName] = useState("");
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);

  const one = selected.length === 1 ? selected[0] : undefined;
  const anyAttached = selected.some((g) => vpcOf(g));
  // A VPC takes one internet gateway. Offer only the VPCs that have none.
  const taken = new Set((gateways.data ?? []).map(vpcOf).filter(Boolean));
  const freeVpcs = vpcOptions((vpcs.data ?? []).filter((v) => !taken.has(v.VpcId)));
  const close = () => setModal(undefined);

  const open = (which: "create" | "attach") => {
    setName("");
    setVpc(null);
    form.setError("");
    setModal(which);
    if (which === "attach") vpcs.reload(true);
  };

  const create = async () => {
    const ok = await form.run(async () => {
      const res = await ec2.send(new CreateInternetGatewayCommand({ TagSpecifications: nameTagSpec("internet-gateway", name) }));
      notify.success(`The internet gateway ${res.InternetGateway?.InternetGatewayId ?? ""} was created. Attach it to a VPC so the VPC can reach the internet.`);
      gateways.reload();
    });
    if (ok) close();
  };

  const attach = async () => {
    if (!one) return;
    if (!vpc?.value) return form.setError("Choose a VPC.");
    const ok = await form.run(async () => {
      await ec2.send(new AttachInternetGatewayCommand({ InternetGatewayId: one.InternetGatewayId, VpcId: vpc.value }));
      notify.success(`Internet gateway ${one.InternetGatewayId} was attached to ${vpc.value}.`);
      setSelected([]);
      gateways.reload();
    });
    if (ok) close();
  };

  const detach = async () => {
    if (!one) return;
    try {
      await ec2.send(new DetachInternetGatewayCommand({ InternetGatewayId: one.InternetGatewayId, VpcId: vpcOf(one) }));
      notify.success(`Internet gateway ${one.InternetGatewayId} was detached from ${vpcOf(one)}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not detach the internet gateway", e);
    }
    close();
    gateways.reload();
  };

  const remove = async () => {
    let done = 0;
    try {
      for (const g of selected) {
        await ec2.send(new DeleteInternetGatewayCommand({ InternetGatewayId: g.InternetGatewayId }));
        done++;
      }
      notify.success(`Deleted ${plural(done, "internet gateway")}.`);
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete ${selected[done]?.InternetGatewayId}`, e);
    }
    close();
    gateways.reload();
  };

  return (
    <Shell service="vpc" contentType="table" breadcrumbs={[VPC_CRUMB, { text: "Internet gateways", href: "/vpc/internet-gateways" }]}>
      <ResourceTable
        title="Internet gateways"
        resourceName="internet gateways"
        filterPlaceholder="Find internet gateways by attribute or tag"
        emptyDescription="An internet gateway connects a VPC to the internet."
        items={gateways.data}
        loading={gateways.loading}
        error={gateways.error}
        onRefresh={() => gateways.reload()}
        trackBy={(g) => g.InternetGatewayId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => open("create")}>Create internet gateway</Button>}
        actions={
          <>
            <Button disabled={!one || !!vpcOf(one)} onClick={() => open("attach")}>
              Attach to VPC
            </Button>
            <Button disabled={!one || !vpcOf(one)} onClick={() => setModal("detach")}>
              Detach from VPC
            </Button>
            <Button disabled={selected.length === 0 || anyAttached} disabledReason={anyAttached ? "Detach the internet gateway from its VPC first." : undefined} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => open("create")}>
              Create internet gateway
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (g) => nameOrDash(g.Tags), sortingComparator: (a, b) => tagName(a.Tags).localeCompare(tagName(b.Tags)) },
          { id: "id", header: "Internet gateway ID", cell: (g) => g.InternetGatewayId, sortingField: "InternetGatewayId", isRowHeader: true },
          { id: "state", header: "State", cell: (g) => <State state={vpcOf(g) ? "attached" : "detached"} /> },
          { id: "vpc", header: "VPC ID", cell: (g) => (vpcOf(g) ? <RouterLink to={`/vpc/vpcs/${vpcOf(g)}`}>{vpcOf(g)}</RouterLink> : "-") },
          { id: "owner", header: "Owner", cell: (g) => g.OwnerId ?? "-" },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create internet gateway" submitLabel="Create internet gateway" busy={form.busy} error={form.error} onDismiss={close} onSubmit={create}>
        <FormField label="Name tag - optional" description="Creates a tag with a key of 'Name' and a value that you specify.">
          <Input value={name} placeholder="my-internet-gateway-01" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "attach"} header={`Attach to VPC (${one?.InternetGatewayId ?? ""})`} submitLabel="Attach internet gateway" busy={form.busy} error={form.error} onDismiss={close} onSubmit={attach}>
        <FormField label="Available VPCs" description="A VPC can have one internet gateway. VPCs that already have one are not listed.">
          <Select selectedOption={vpc} options={freeVpcs} onChange={(e) => setVpc(e.detail.selectedOption)} placeholder="Select a VPC" empty="Every VPC already has an internet gateway." />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "detach"} title="Detach from VPC" confirmText="detach" actionLabel="Detach internet gateway" onCancel={close} onConfirm={detach}>
        <Box>
          Detach {one ? idWithName(one.InternetGatewayId, one.Tags) : ""} from {one ? vpcOf(one) : ""}? Resources in the VPC lose their route to the internet.
        </Box>
      </ConfirmDelete>

      <ConfirmDelete visible={modal === "delete"} title={selected.length === 1 ? "Delete internet gateway" : "Delete internet gateways"} onCancel={close} onConfirm={remove}>
        <Box>Delete {selected.map((g) => idWithName(g.InternetGatewayId, g.Tags)).join(", ")}?</Box>
      </ConfirmDelete>
    </Shell>
  );
}
