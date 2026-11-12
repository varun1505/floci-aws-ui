import { useState } from "react";
import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
  PutRetentionPolicyCommand,
  type LogGroup,
} from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { logs } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage, formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

export const groupHref = (name: string, stream?: string) =>
  `/cloudwatch/log-group?name=${encodeURIComponent(name)}${stream ? `&stream=${encodeURIComponent(stream)}` : ""}`;

export const RETENTION = [
  { value: "0", label: "Never expire" },
  ...[1, 3, 5, 7, 14, 30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: d === 1 ? "1 day" : `${d} days` })),
];

export function retentionLabel(days?: number) {
  return days ? (days === 1 ? "1 day" : `${days} days`) : "Never expire";
}

export default function LogGroups() {
  const notify = useNotify();
  const groups = useLoad(async () => {
    const out: LogGroup[] = [];
    let nextToken: string | undefined;
    do {
      const res = await logs.send(new DescribeLogGroupsCommand({ nextToken }));
      out.push(...(res.logGroups ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
    return out;
  }, []);
  const [selected, setSelected] = useState<LogGroup[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [retention, setRetention] = useState(RETENTION[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const create = async () => {
    if (!name) return setError("Log group name is required.");
    if (!/^[.\-_/#A-Za-z0-9]{1,512}$/.test(name)) return setError("Use only letters, numbers and the characters . - _ / #");
    setBusy(true);
    try {
      await logs.send(new CreateLogGroupCommand({ logGroupName: name }));
      if (retention.value !== "0") {
        await logs.send(new PutRetentionPolicyCommand({ logGroupName: name, retentionInDays: Number(retention.value) }));
      }
      notify.success(`Log group "${name}" has been created.`);
      setCreating(false);
      setName("");
      groups.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const g of selected) await logs.send(new DeleteLogGroupCommand({ logGroupName: g.logGroupName }));
      notify.success(`Deleted ${selected.length} log group${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the log group", e);
    }
    setDeleting(false);
    groups.reload();
  };

  return (
    <Shell
      service="cloudwatch"
      contentType="table"
      breadcrumbs={[{ text: "CloudWatch", href: "/cloudwatch/log-groups" }, { text: "Log groups", href: "/cloudwatch/log-groups" }]}
    >
      <ResourceTable
        title="Log groups"
        description="By default, we only load up to 10000 log groups."
        resourceName="log groups"
        filterPlaceholder="Filter log groups"
        items={groups.data}
        loading={groups.loading}
        error={groups.error}
        onRefresh={() => groups.reload()}
        trackBy={(g) => g.logGroupName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setCreating(true)}>Create log group</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create log group
            </Button>
          </>
        }
        columns={[
          {
            id: "name",
            header: "Log group",
            cell: (g) => <RouterLink to={groupHref(g.logGroupName ?? "")}>{g.logGroupName}</RouterLink>,
            sortingField: "logGroupName",
            isRowHeader: true,
          },
          { id: "class", header: "Log class", cell: (g) => (g.logGroupClass === "INFREQUENT_ACCESS" ? "Infrequent Access" : "Standard") },
          { id: "retention", header: "Retention", cell: (g) => retentionLabel(g.retentionInDays) },
          { id: "stored", header: "Stored bytes", cell: (g) => formatBytes(g.storedBytes), sortingField: "storedBytes" },
          { id: "created", header: "Creation time", cell: (g) => formatDate(g.creationTime), sortingField: "creationTime" },
        ]}
      />

      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create log group"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Log group name" errorText={error}>
            <Input
              value={name}
              autoFocus
              placeholder="/my-app/production"
              onChange={(e) => {
                setName(e.detail.value);
                setError("");
              }}
              onKeyDown={(e) => e.detail.key === "Enter" && create()}
            />
          </FormField>
          <FormField label="Retention setting">
            <Select selectedOption={retention} options={RETENTION} onChange={(e) => setRetention(e.detail.selectedOption as (typeof RETENTION)[number])} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={deleting}
        title={`Delete log group${selected.length === 1 ? "" : "s"}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a log group permanently deletes all of its log streams and log events."
      >
        <Box>{selected.map((g) => g.logGroupName).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
