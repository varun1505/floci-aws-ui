import { useState } from "react";
import { CreateScheduleGroupCommand, DeleteScheduleCommand, DeleteScheduleGroupCommand, type ScheduleGroupSummary } from "@aws-sdk/client-scheduler";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import { scheduler } from "../../clients/scheduler";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ScheduleForm } from "./ScheduleForm";
import { RuleState } from "./eventsutil";
import { type Schedule, listGroups, listSchedules } from "./schedulerutil";

const key = (s: Schedule) => `${s.GroupName}/${s.Name}`;

export default function Schedules() {
  const notify = useNotify();
  const list = useLoad(listSchedules, []);
  const groups = useLoad(listGroups, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Schedule[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<ScheduleGroupSummary[]>([]);
  const [modal, setModal] = useState<"create" | "edit" | "delete" | "group" | "delete-group" | undefined>(undefined);
  const [groupName, setGroupName] = useState("");
  const plural = selected.length === 1 ? "" : "s";
  const groupNames = (groups.data ?? []).map((g) => g.Name ?? "");

  const remove = async () => {
    try {
      for (const s of selected) await scheduler.send(new DeleteScheduleCommand({ Name: s.Name, GroupName: s.GroupName }));
      notify.success(`Deleted ${selected.length} schedule${plural}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the schedule", e);
    }
    setModal(undefined);
    list.reload();
  };

  const createGroup = async () => {
    if (!/^[0-9A-Za-z._-]{1,64}$/.test(groupName)) return form.setError("Use up to 64 letters, numbers, dots, hyphens and underscores.");
    const ok = await form.run(async () => {
      await scheduler.send(new CreateScheduleGroupCommand({ Name: groupName }));
      notify.success(`Schedule group ${groupName} was created.`);
      groups.reload();
    });
    if (ok) setModal(undefined);
  };

  const removeGroups = async () => {
    try {
      for (const g of selectedGroups) await scheduler.send(new DeleteScheduleGroupCommand({ Name: g.Name }));
      notify.success(`Deleted ${selectedGroups.length} schedule group${selectedGroups.length === 1 ? "" : "s"} and the schedules in ${selectedGroups.length === 1 ? "it" : "them"}.`);
      setSelectedGroups([]);
    } catch (e) {
      notify.error("Could not delete the schedule group", e);
    }
    setModal(undefined);
    groups.reload();
    list.reload();
  };

  const schedulesTab = (
    <ResourceTable
      title="Schedules"
      variant="container"
      stickyHeader={false}
      resourceName="schedules"
      filterPlaceholder="Find schedules"
      emptyDescription="A schedule calls a target once, or again and again at a rate or on a cron schedule."
      items={list.data}
      loading={list.loading}
      error={list.error}
      onRefresh={() => list.reload()}
      trackBy={key}
      selectionType="multi"
      selected={selected}
      onSelect={setSelected}
      emptyAction={<Button onClick={() => setModal("create")}>Create schedule</Button>}
      actions={
        <>
          <Button disabled={selected.length !== 1} onClick={() => setModal("edit")}>
            Edit
          </Button>
          <Button disabled={!selected.length} onClick={() => setModal("delete")}>
            Delete
          </Button>
          <Button variant="primary" onClick={() => setModal("create")}>
            Create schedule
          </Button>
        </>
      }
      columns={[
        { id: "name", header: "Schedule name", cell: (s) => s.Name, sortingField: "Name", isRowHeader: true },
        { id: "group", header: "Schedule group", cell: (s) => s.GroupName, sortingField: "GroupName" },
        { id: "state", header: "Status", cell: (s) => <RuleState state={s.State} />, sortingField: "State" },
        { id: "expression", header: "Schedule", cell: (s) => (s.ScheduleExpressionTimezone && s.ScheduleExpressionTimezone !== "UTC" ? `${s.ScheduleExpression} ${s.ScheduleExpressionTimezone}` : s.ScheduleExpression) },
        { id: "target", header: "Target", cell: (s) => <Copy text={s.Target?.Arn} /> },
        { id: "modified", header: "Last modified", cell: (s) => formatDate(s.LastModificationDate), sortingComparator: (a, b) => (a.LastModificationDate?.getTime() ?? 0) - (b.LastModificationDate?.getTime() ?? 0) },
      ]}
    />
  );

  const groupsTab = (
    <ResourceTable
      title="Schedule groups"
      variant="container"
      stickyHeader={false}
      resourceName="schedule groups"
      filterPlaceholder="Find schedule groups"
      items={groups.data}
      loading={groups.loading}
      error={groups.error}
      onRefresh={() => groups.reload()}
      trackBy={(g) => g.Name ?? ""}
      selectionType="multi"
      selected={selectedGroups}
      onSelect={setSelectedGroups}
      isItemDisabled={(g) => g.Name === "default"}
      actions={
        <>
          <Button disabled={!selectedGroups.length} onClick={() => setModal("delete-group")}>
            Delete
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setGroupName("");
              form.setError("");
              setModal("group");
            }}
          >
            Create schedule group
          </Button>
        </>
      }
      columns={[
        { id: "name", header: "Name", cell: (g) => g.Name, sortingField: "Name", isRowHeader: true },
        { id: "state", header: "Status", cell: (g) => <StatusIndicator type={g.State === "ACTIVE" ? "success" : "in-progress"}>{g.State === "ACTIVE" ? "Active" : "Deleting"}</StatusIndicator> },
        { id: "schedules", header: "Schedules", cell: (g) => (list.data ? list.data.filter((s) => s.GroupName === g.Name).length : "-") },
        { id: "arn", header: "ARN", cell: (g) => <Copy text={g.Arn} /> },
        { id: "created", header: "Creation date", cell: (g) => formatDate(g.CreationDate) },
      ]}
    />
  );

  return (
    <Shell service="events" breadcrumbs={[{ text: "Amazon EventBridge", href: "/events/rules" }, { text: "Schedules", href: "/events/schedules" }]}>
      <ContentLayout header={<Header variant="h1" description="EventBridge Scheduler runs a target once or on a repeating schedule.">Schedules</Header>}>
        <Tabs
          tabs={[
            { id: "schedules", label: "Schedules", content: schedulesTab },
            { id: "groups", label: "Schedule groups", content: groupsTab },
          ]}
        />
      </ContentLayout>

      <ScheduleForm
        visible={modal === "create" || modal === "edit"}
        schedule={modal === "edit" ? selected[0] : undefined}
        groups={groupNames.length ? groupNames : ["default"]}
        onDismiss={() => setModal(undefined)}
        onSaved={(name) => {
          notify.success(`Schedule ${name} was ${modal === "edit" ? "updated" : "created"}.`);
          setModal(undefined);
          setSelected([]);
          list.reload();
        }}
      />

      <ConfirmDelete visible={modal === "delete"} title={`Delete schedule${plural}`} onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].Name}</b> : `${selected.length} schedules`} permanently?
      </ConfirmDelete>

      <FormModal visible={modal === "group"} header="Create schedule group" submitLabel="Create schedule group" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={createGroup}>
        <FormField label="Name" constraintText="Up to 64 letters, numbers, dots, hyphens and underscores.">
          <Input value={groupName} placeholder="my-schedule-group" onChange={(e) => setGroupName(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete-group"}
        title={`Delete schedule group${selectedGroups.length === 1 ? "" : "s"}`}
        warning="Every schedule in the group is deleted with it."
        onCancel={() => setModal(undefined)}
        onConfirm={removeGroups}
      >
        Delete {selectedGroups.length === 1 ? <b>{selectedGroups[0].Name}</b> : `${selectedGroups.length} schedule groups`} permanently?
      </ConfirmDelete>
    </Shell>
  );
}
