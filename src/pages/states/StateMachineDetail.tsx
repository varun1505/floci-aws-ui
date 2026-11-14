import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteStateMachineCommand, DescribeStateMachineCommand, type ExecutionListItem, type ExecutionStatus, ListTagsForResourceCommand, StopExecutionCommand, TagResourceCommand, UntagResourceCommand, UpdateStateMachineCommand } from "@aws-sdk/client-sfn";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { sfn } from "../../clients/sfn";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair, prettyJson } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { RolePicker, isRoleArn } from "../events/RolePicker";
import { StartExecution } from "./StartExecution";
import { EXECUTION_STATUSES, Status, duration, executionHref, jsonObjectError, listExecutions, machineHref, outline, typeLabel } from "./sfnutil";

const ALL = { value: "", label: "All statuses" };

export default function StateMachineDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const [filter, setFilter] = useState("");
  const machine = useLoad(() => sfn.send(new DescribeStateMachineCommand({ stateMachineArn: arn })), [arn]);
  const executions = useLoad(() => listExecutions(arn, (filter || undefined) as ExecutionStatus | undefined), [arn, filter]);
  const tags = useLoad(async () => (await sfn.send(new ListTagsForResourceCommand({ resourceArn: arn }))).tags ?? [], [arn]);
  const form = useSubmit();
  const [modal, setModal] = useState<"start" | "edit" | "tag" | "delete" | undefined>(undefined);
  const [selected, setSelected] = useState<ExecutionListItem[]>([]);
  const [definition, setDefinition] = useState("");
  const [role, setRole] = useState("");
  const [tagKey, setTagKey] = useState("");
  const [tagValue, setTagValue] = useState("");

  const m = machine.data;
  const name = m?.name ?? arn.split(":").pop() ?? arn;
  const running = selected.filter((e) => e.status === "RUNNING");

  const openEdit = () => {
    setDefinition(prettyJson(m?.definition));
    setRole(m?.roleArn ?? "");
    form.setError("");
    setModal("edit");
  };

  const save = async () => {
    const invalid = jsonObjectError(definition, "The definition");
    if (invalid) return form.setError(invalid);
    if (!isRoleArn(role)) return form.setError("Choose an execution role, or type a role ARN such as arn:aws:iam::000000000000:role/my-role.");
    const ok = await form.run(async () => {
      await sfn.send(new UpdateStateMachineCommand({ stateMachineArn: arn, definition, roleArn: role }));
      notify.success(`State machine ${name} was updated. New executions use the new definition.`);
      machine.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const stop = async () => {
    try {
      for (const e of running) await sfn.send(new StopExecutionCommand({ executionArn: e.executionArn }));
      notify.success(`Stopped ${running.length} execution${running.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not stop the execution", e);
    }
    executions.reload();
  };

  const addTag = async () => {
    if (!tagKey.trim()) return form.setError("Key is required.");
    const ok = await form.run(async () => {
      await sfn.send(new TagResourceCommand({ resourceArn: arn, tags: [{ key: tagKey.trim(), value: tagValue }] }));
      tags.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeTag = async (key: string) => {
    try {
      await sfn.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: [key] }));
    } catch (e) {
      notify.error("Could not remove the tag", e);
    }
    tags.reload(true);
  };

  const remove = async () => {
    try {
      await sfn.send(new DeleteStateMachineCommand({ stateMachineArn: arn }));
      notify.success(`State machine ${name} was deleted.`);
      navigate("/states/state-machines");
    } catch (e) {
      notify.error("Could not delete the state machine", e);
      setModal(undefined);
    }
  };

  const executionsTab = (
    <ResourceTable
      title="Executions"
      variant="container"
      stickyHeader={false}
      resourceName="executions"
      filterPlaceholder="Find executions by name"
      items={executions.data}
      loading={executions.loading}
      error={executions.error}
      onRefresh={() => executions.reload()}
      trackBy={(e) => e.executionArn ?? ""}
      selectionType="multi"
      selected={selected}
      onSelect={setSelected}
      extraFilter={
        <Select
          selectedOption={EXECUTION_STATUSES.find((s) => s.value === filter) ?? ALL}
          onChange={(e) => {
            setSelected([]);
            setFilter(e.detail.selectedOption.value ?? "");
          }}
          options={[ALL, ...EXECUTION_STATUSES]}
          ariaLabel="Filter by status"
        />
      }
      emptyAction={<Button onClick={() => setModal("start")}>Start execution</Button>}
      actions={
        <>
          <Button disabled={!running.length} onClick={stop}>
            Stop execution
          </Button>
          <Button variant="primary" onClick={() => setModal("start")}>
            Start execution
          </Button>
        </>
      }
      columns={[
        { id: "name", header: "Name", cell: (e) => <RouterLink to={executionHref(e.executionArn ?? "")}>{e.name}</RouterLink>, sortingField: "name", isRowHeader: true },
        { id: "status", header: "Status", cell: (e) => <Status status={e.status} />, sortingField: "status" },
        { id: "started", header: "Started", cell: (e) => formatDate(e.startDate), sortingComparator: (a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0) },
        { id: "ended", header: "End time", cell: (e) => formatDate(e.stopDate) },
        { id: "duration", header: "Duration", cell: (e) => duration(e.startDate, e.stopDate) },
      ]}
    />
  );

  const definitionTab = (
    <SpaceBetween size="l">
      <Table
        header={
          <Header variant="h2" description="The states of the workflow, and where each one goes next.">
            States
          </Header>
        }
        items={outline(m?.definition)}
        columnDefinitions={[
          { id: "name", header: "State", cell: (s) => (s.start ? `${s.name} (start)` : s.name), isRowHeader: true },
          { id: "type", header: "Type", cell: (s) => s.type },
          { id: "next", header: "Next", cell: (s) => s.next },
        ]}
        empty={<Box textAlign="center">No states</Box>}
      />
      <Container header={<Header variant="h2" actions={<Button onClick={openEdit}>Edit</Button>}>Definition</Header>}>
        <JsonBlock value={m?.definition} />
      </Container>
    </SpaceBetween>
  );

  const tagsTab = (
    <Table
      header={
        <Header
          variant="h2"
          counter={`(${tags.data?.length ?? 0})`}
          actions={
            <Button
              onClick={() => {
                setTagKey("");
                setTagValue("");
                form.setError("");
                setModal("tag");
              }}
            >
              Add tag
            </Button>
          }
        >
          Tags
        </Header>
      }
      loading={tags.loading && !tags.data}
      loadingText="Loading tags"
      items={tags.data ?? []}
      columnDefinitions={[
        { id: "key", header: "Key", cell: (t) => t.key, isRowHeader: true },
        { id: "value", header: "Value", cell: (t) => t.value || "-" },
        { id: "actions", header: "Actions", cell: (t) => <Button variant="inline-link" onClick={() => removeTag(t.key ?? "")}>Remove</Button> },
      ]}
      empty={<Box textAlign="center">No tags</Box>}
    />
  );

  return (
    <Shell
      service="states"
      breadcrumbs={[
        { text: "Step Functions", href: "/states/state-machines" },
        { text: "State machines", href: "/states/state-machines" },
        { text: name, href: machineHref(arn) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (machine.reload(), executions.reload(), tags.reload())} />
                <Button disabled={!m} onClick={openEdit}>
                  Edit
                </Button>
                <Button disabled={!m} onClick={() => setModal("delete")}>
                  Delete
                </Button>
                <Button variant="primary" disabled={!m} onClick={() => setModal("start")}>
                  Start execution
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {machine.error ? (
          <Alert type="error" header="Could not load the state machine">
            {machine.error}
          </Alert>
        ) : !m ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={m.stateMachineArn} />
                </Pair>
                <Pair label="Type">{typeLabel(m.type)}</Pair>
                <Pair label="Status">
                  <Status status={m.status} />
                </Pair>
                <Pair label="IAM role ARN">
                  <Copy text={m.roleArn} />
                </Pair>
                <Pair label="Creation date">{formatDate(m.creationDate)}</Pair>
                <Pair label="Revision ID">{m.revisionId}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "executions", label: "Executions", content: executionsTab },
                { id: "definition", label: "Definition", content: definitionTab },
                { id: "tags", label: "Tags", content: tagsTab },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <StartExecution visible={modal === "start"} machineArn={arn} onDismiss={() => setModal(undefined)} />

      <FormModal visible={modal === "edit"} header="Edit state machine" submitLabel="Save" size="large" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={save}>
        <FormField label="Definition" description="The workflow in Amazon States Language (JSON). Running executions keep the old definition." stretch>
          {modal === "edit" && <Code value={definition} onChange={setDefinition} language="json" height={320} ariaLabel="Definition" />}
        </FormField>
        <FormField label="Execution role">{modal === "edit" && <RolePicker value={role} onChange={setRole} />}</FormField>
      </FormModal>

      <FormModal visible={modal === "tag"} header="Add tag" submitLabel="Add tag" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={addTag}>
        <FormField label="Key">
          <Input value={tagKey} onChange={(e) => setTagKey(e.detail.value)} />
        </FormField>
        <FormField label="Value - optional">
          <Input value={tagValue} onChange={(e) => setTagValue(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title="Delete state machine" onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete <b>{name}</b> permanently?
      </ConfirmDelete>
    </Shell>
  );
}
