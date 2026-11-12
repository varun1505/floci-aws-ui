import { useState } from "react";
import {
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  type SecurityGroup,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

export default function SecurityGroups() {
  const notify = useNotify();
  const groups = useLoad(async () => (await ec2.send(new DescribeSecurityGroupsCommand({}))).SecurityGroups ?? [], []);
  const [selected, setSelected] = useState<SecurityGroup[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const openCreate = async () => {
    setError("");
    setCreating(true);
    try {
      const res = await ec2.send(new DescribeVpcsCommand({}));
      const opts = (res.Vpcs ?? []).map((v) => ({ value: v.VpcId, label: v.VpcId, description: `${v.CidrBlock}${v.IsDefault ? " (default)" : ""}` }));
      setVpcs(opts);
      setVpc((cur) => cur ?? opts[0] ?? null);
    } catch {
      setVpcs([]);
    }
  };

  const create = async () => {
    if (!name || !description) return setError("Security group name and description are required.");
    setBusy(true);
    try {
      await ec2.send(new CreateSecurityGroupCommand({ GroupName: name, Description: description, VpcId: vpc?.value }));
      notify.success(`Security group ${name} was created successfully.`);
      setCreating(false);
      setName("");
      setDescription("");
      groups.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const g of selected) await ec2.send(new DeleteSecurityGroupCommand({ GroupId: g.GroupId }));
      notify.success(`Deleted ${selected.length} security group${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the security group", e);
    }
    setDeleting(false);
    groups.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/instances" }, { text: "Security Groups", href: "/ec2/security-groups" }]}>
      <ResourceTable
        title="Security Groups"
        resourceName="security groups"
        filterPlaceholder="Find resources by attribute or tag"
        items={groups.data}
        loading={groups.loading}
        error={groups.error}
        onRefresh={() => groups.reload()}
        trackBy={(g) => g.GroupId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create security group
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Security group name", cell: (g) => g.GroupName, sortingField: "GroupName" },
          {
            id: "id",
            header: "Security group ID",
            cell: (g) => <RouterLink to={`/ec2/security-groups/${g.GroupId}`}>{g.GroupId}</RouterLink>,
            sortingField: "GroupId",
            isRowHeader: true,
          },
          { id: "vpc", header: "VPC ID", cell: (g) => g.VpcId ?? "-" },
          { id: "description", header: "Description", cell: (g) => g.Description ?? "-" },
          { id: "in", header: "Inbound rules count", cell: (g) => `${g.IpPermissions?.length ?? 0} Permission entries` },
          { id: "out", header: "Outbound rules count", cell: (g) => `${g.IpPermissionsEgress?.length ?? 0} Permission entries` },
        ]}
      />
      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create security group"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create security group
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Security group name" errorText={error}>
            <Input value={name} placeholder="MyWebServerGroup" autoFocus onChange={(e) => setName(e.detail.value)} />
          </FormField>
          <FormField label="Description">
            <Input value={description} placeholder="Allows SSH access to developers" onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
          <FormField label="VPC">
            <Select selectedOption={vpc} options={vpcs} onChange={(e) => setVpc(e.detail.selectedOption)} placeholder="Choose a VPC" />
          </FormField>
        </SpaceBetween>
      </Modal>
      <ConfirmDelete visible={deleting} title="Delete security groups" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((g) => `${g.GroupId} - ${g.GroupName}`).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
