import { useState } from "react";
import { CreateGroupCommand, DeleteGroupCommand, type GroupType } from "@aws-sdk/client-cognito-identity-provider";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import type { Load } from "./cognitoutil";

/** The Groups tab of a user pool: list, create and delete. Users join a group from the user page. */
export function GroupsTab({ poolId, groups }: { poolId: string; groups: Load<GroupType[]> }) {
  const notify = useNotify();
  const form = useSubmit();
  const [selected, setSelected] = useState<GroupType[]>([]);
  const [modal, setModal] = useState<"create" | "delete" | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [precedence, setPrecedence] = useState("");

  const openCreate = () => {
    setName("");
    setDescription("");
    setPrecedence("");
    form.setError("");
    setModal("create");
  };

  const create = async () => {
    if (!/^[\p{L}\p{M}\p{S}\p{N}\p{P}]{1,128}$/u.test(name)) return form.setError("Enter a group name without spaces, up to 128 characters.");
    const order = precedence === "" ? undefined : Number(precedence);
    if (order !== undefined && (!Number.isInteger(order) || order < 0)) return form.setError("Enter a whole number of 0 or more as the precedence.");
    const ok = await form.run(async () => {
      await cognito.send(new CreateGroupCommand({ UserPoolId: poolId, GroupName: name, Description: description || undefined, Precedence: order }));
      notify.success(`Group ${name} was created.`);
      groups.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      for (const g of selected) await cognito.send(new DeleteGroupCommand({ UserPoolId: poolId, GroupName: g.GroupName }));
      notify.success(selected.length === 1 ? `Group ${selected[0].GroupName} was deleted.` : `Deleted ${selected.length} groups.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the group", e);
    }
    setModal(undefined);
    groups.reload();
  };

  return (
    <>
      <ResourceTable
        title="Groups"
        resourceName="groups"
        variant="container"
        stickyHeader={false}
        filterPlaceholder="Search groups by name"
        emptyDescription="A group collects users. Its name appears in the tokens of its members."
        items={groups.data}
        loading={groups.loading}
        error={groups.error}
        onRefresh={() => groups.reload()}
        trackBy={(g) => g.GroupName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create group</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create group
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Group name", cell: (g) => g.GroupName, sortingField: "GroupName", isRowHeader: true },
          { id: "description", header: "Description", cell: (g) => g.Description || "-" },
          { id: "precedence", header: "Precedence", cell: (g) => g.Precedence ?? "-", sortingField: "Precedence" },
          { id: "created", header: "Created time", cell: (g) => formatDate(g.CreationDate) },
          { id: "updated", header: "Last updated time", cell: (g) => formatDate(g.LastModifiedDate) },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create group" submitLabel="Create group" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        <FormField label="Group name">
          <Input value={name} placeholder="admins" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Precedence - optional" description="When a user is in more than one group, the group with the lowest number wins.">
          <Input type="number" value={precedence} onChange={(e) => setPrecedence(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete"}
        title={selected.length === 1 ? `Delete group ${selected[0].GroupName}` : `Delete ${selected.length} groups`}
        onCancel={() => setModal(undefined)}
        onConfirm={remove}
        warning="The users of the group stay in the user pool."
      />
    </>
  );
}
