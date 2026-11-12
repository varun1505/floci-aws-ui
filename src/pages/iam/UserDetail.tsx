import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AddUserToGroupCommand, type AccessKey, CreateAccessKeyCommand, DeleteAccessKeyCommand, GetUserCommand, ListAccessKeysCommand, ListGroupsForUserCommand, RemoveUserFromGroupCommand } from "@aws-sdk/client-iam";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { Permissions, deleteUser, listGroups } from "./iamutil";

export default function UserDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const user = useLoad(async () => (await iam.send(new GetUserCommand({ UserName: name }))).User, [name]);
  const keys = useLoad(async () => (await iam.send(new ListAccessKeysCommand({ UserName: name }))).AccessKeyMetadata ?? [], [name]);
  const groups = useLoad(async () => (await iam.send(new ListGroupsForUserCommand({ UserName: name }))).Groups ?? [], [name]);
  const allGroups = useLoad(listGroups, []);
  const form = useSubmit();
  const [newKey, setNewKey] = useState<AccessKey | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [group, setGroup] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const createKey = async () => {
    setBusy(true);
    try {
      setNewKey((await iam.send(new CreateAccessKeyCommand({ UserName: name }))).AccessKey);
      keys.reload(true);
    } catch (e) {
      notify.error("Could not create the access key", e);
    }
    setBusy(false);
  };

  const quiet = async (label: string, work: () => Promise<unknown>, reload: () => void) => {
    try {
      await work();
      notify.success(label);
    } catch (e) {
      notify.error("The request failed", e);
    }
    reload();
  };

  const addToGroup = async () => {
    if (!group) return form.setError("Choose a group.");
    const ok = await form.run(async () => {
      await iam.send(new AddUserToGroupCommand({ UserName: name, GroupName: group }));
      notify.success(`Added ${name} to ${group}.`);
      groups.reload(true);
    });
    if (ok) setAdding(false);
  };

  const remove = async () => {
    try {
      await deleteUser(name);
      notify.success(`Deleted ${name}.`);
      navigate("/iam/users");
    } catch (e) {
      notify.error("Could not delete the user", e);
      setDeleting(false);
    }
  };

  const u = user.data;
  const free = (allGroups.data ?? []).filter((g) => !(groups.data ?? []).some((x) => x.GroupName === g.GroupName)).map((g) => ({ value: g.GroupName ?? "", label: g.GroupName ?? "" }));

  return (
    <Shell service="iam" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Users", href: "/iam/users" }, { text: name, href: `/iam/users/${encodeURIComponent(name)}` }]}>
      <ContentLayout
        header={
          <Header variant="h1" actions={<Button onClick={() => setDeleting(true)}>Delete</Button>}>
            {name}
          </Header>
        }
      >
        {user.error ? (
          <Alert type="error" header="Could not load the user">
            {user.error}
          </Alert>
        ) : !u ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Summary</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={u.Arn} />
                </Pair>
                <Pair label="User ID">{u.UserId}</Pair>
                <Pair label="Created">{formatDate(u.CreateDate)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "permissions", label: "Permissions", content: <Permissions kind="user" name={name} /> },
                {
                  id: "groups",
                  label: "Groups",
                  content: (
                    <Table
                      header={
                        <Header
                          variant="h2"
                          counter={`(${groups.data?.length ?? 0})`}
                          actions={
                            <Button
                              onClick={() => {
                                setGroup("");
                                form.setError("");
                                setAdding(true);
                              }}
                            >
                              Add user to groups
                            </Button>
                          }
                        >
                          User groups membership
                        </Header>
                      }
                      loading={groups.loading}
                      loadingText="Loading groups"
                      items={groups.data ?? []}
                      columnDefinitions={[
                        { id: "name", header: "Group name", cell: (g) => g.GroupName, isRowHeader: true },
                        { id: "arn", header: "ARN", cell: (g) => g.Arn },
                        {
                          id: "actions",
                          header: "Actions",
                          cell: (g) => (
                            <Button variant="inline-link" onClick={() => quiet(`Removed ${name} from ${g.GroupName}.`, () => iam.send(new RemoveUserFromGroupCommand({ UserName: name, GroupName: g.GroupName })), () => groups.reload(true))}>
                              Remove
                            </Button>
                          ),
                        },
                      ]}
                      empty={<Box textAlign="center">This user is not in any group.</Box>}
                    />
                  ),
                },
                {
                  id: "credentials",
                  label: "Security credentials",
                  content: (
                    <Table
                      header={
                        <Header
                          variant="h2"
                          counter={`(${keys.data?.length ?? 0})`}
                          description="Use access keys to send programmatic calls from the AWS CLI or an SDK."
                          actions={
                            <Button loading={busy} onClick={createKey}>
                              Create access key
                            </Button>
                          }
                        >
                          Access keys
                        </Header>
                      }
                      loading={keys.loading}
                      loadingText="Loading access keys"
                      items={keys.data ?? []}
                      columnDefinitions={[
                        { id: "id", header: "Access key ID", cell: (k) => <Copy text={k.AccessKeyId} />, isRowHeader: true },
                        { id: "status", header: "Status", cell: (k) => k.Status ?? "-" },
                        { id: "created", header: "Created", cell: (k) => formatDate(k.CreateDate) },
                        {
                          id: "actions",
                          header: "Actions",
                          cell: (k) => (
                            <Button variant="inline-link" onClick={() => quiet(`Deleted access key ${k.AccessKeyId}.`, () => iam.send(new DeleteAccessKeyCommand({ UserName: name, AccessKeyId: k.AccessKeyId })), () => keys.reload(true))}>
                              Delete
                            </Button>
                          ),
                        },
                      ]}
                      empty={<Box textAlign="center">No access keys</Box>}
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <Modal visible={!!newKey} onDismiss={() => setNewKey(undefined)} header="Retrieve access keys" footer={<Box float="right"><Button variant="primary" onClick={() => setNewKey(undefined)}>Done</Button></Box>}>
        <SpaceBetween size="l">
          <Alert type="warning">This is the only time the secret access key is shown. Copy it now.</Alert>
          <Pair label="Access key">
            <Copy text={newKey?.AccessKeyId} />
          </Pair>
          <Pair label="Secret access key">
            <Copy text={newKey?.SecretAccessKey} />
          </Pair>
        </SpaceBetween>
      </Modal>

      <FormModal visible={adding} header="Add user to group" submitLabel="Add user to group" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={addToGroup}>
        <FormField label="User group">
          <Select selectedOption={free.find((o) => o.value === group) ?? null} onChange={(e) => setGroup(e.detail.selectedOption.value ?? "")} options={free} placeholder="Choose a group" empty="No other groups. Create one on the User groups page." />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Delete ${name}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a user also deletes its access keys and removes it from its groups." />
    </Shell>
  );
}
