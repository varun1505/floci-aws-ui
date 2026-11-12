import { useState } from "react";
import { CreateGroupCommand, DeleteGroupCommand, GetGroupCommand, type Group, RemoveUserFromGroupCommand } from "@aws-sdk/client-iam";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listGroups } from "./iamutil";

type Row = Group & { users: string[] };

export default function Groups() {
  const notify = useNotify();
  const list = useLoad(async (): Promise<Row[]> => {
    const groups = await listGroups();
    return Promise.all(
      groups.map(async (g) => ({
        ...g,
        users: await iam
          .send(new GetGroupCommand({ GroupName: g.GroupName }))
          .then((r) => (r.Users ?? []).map((u) => u.UserName ?? ""))
          .catch(() => []),
      })),
    );
  }, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Row[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    if (!/^[\w+=,.@-]{1,128}$/.test(name)) return form.setError("Use letters, numbers and these characters: + = , . @ _ -");
    const ok = await form.run(async () => {
      await iam.send(new CreateGroupCommand({ GroupName: name }));
      notify.success(`User group ${name} created.`);
      list.reload();
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const g of selected) {
        for (const UserName of g.users) await iam.send(new RemoveUserFromGroupCommand({ GroupName: g.GroupName, UserName }));
        await iam.send(new DeleteGroupCommand({ GroupName: g.GroupName }));
      }
      notify.success(`Deleted ${selected.length} user group${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the user group", e);
    }
    setDeleting(false);
    list.reload();
  };

  const openCreate = () => {
    setName("");
    form.setError("");
    setCreating(true);
  };

  return (
    <Shell service="iam" contentType="table" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "User groups", href: "/iam/groups" }]}>
      <ResourceTable
        title="User groups"
        resourceName="user groups"
        global
        filterPlaceholder="Search user groups"
        emptyDescription="A user group is a collection of IAM users. Add users to a group from the user page."
        emptyCli="iam create-group --group-name developers"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(g) => g.GroupName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create group</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create group
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Group name", cell: (g) => g.GroupName, sortingField: "GroupName", isRowHeader: true },
          { id: "users", header: "Users", cell: (g) => g.users.join(", ") || "0" },
          { id: "arn", header: "ARN", cell: (g) => g.Arn },
          { id: "created", header: "Creation time", cell: (g) => formatDate(g.CreateDate) },
        ]}
      />
      <FormModal visible={creating} header="Create user group" submitLabel="Create group" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="User group name">
          <Input value={name} placeholder="developers" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].GroupName}` : `Delete ${selected.length} user groups`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Users in the group stay, but lose what the group gave them." />
    </Shell>
  );
}
