import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateUserCommand, type User } from "@aws-sdk/client-iam";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { deleteUser, listUsers } from "./iamutil";

export default function Users() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listUsers, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<User[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const openCreate = () => {
    setName("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[\w+=,.@-]{1,64}$/.test(name)) return form.setError("Use up to 64 letters, numbers and these characters: + = , . @ _ -");
    const ok = await form.run(async () => {
      await iam.send(new CreateUserCommand({ UserName: name }));
      notify.success(`User ${name} created successfully.`);
      navigate(`/iam/users/${encodeURIComponent(name)}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const u of selected) await deleteUser(u.UserName ?? "");
      notify.success(`Deleted ${selected.length} user${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the user", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="iam" contentType="table" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Users", href: "/iam/users" }]}>
      <ResourceTable
        title="Users"
        resourceName="users"
        global
        filterPlaceholder="Search users"
        emptyDescription="An IAM user is an identity with long-term credentials for a person or an application."
        emptyCli="iam create-user --user-name my-app"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(u) => u.UserName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create user</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create user
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "User name", cell: (u) => <RouterLink to={`/iam/users/${encodeURIComponent(u.UserName ?? "")}`}>{u.UserName}</RouterLink>, sortingField: "UserName", isRowHeader: true },
          { id: "path", header: "Path", cell: (u) => u.Path ?? "/" },
          { id: "arn", header: "ARN", cell: (u) => u.Arn },
          { id: "created", header: "Creation time", cell: (u) => formatDate(u.CreateDate) },
        ]}
      />
      <FormModal visible={creating} header="Create user" submitLabel="Create user" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="User name" constraintText="Up to 64 characters. Letters, numbers and + = , . @ _ -">
          <Input value={name} placeholder="my-app" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>
      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete ${selected[0].UserName}` : `Delete ${selected.length} users`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a user also deletes its access keys and removes it from its groups."
      />
    </Shell>
  );
}
