import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
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
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ACTION_DONE, Enabled, type UserAction, UserStatus, attr, listGroups, listUserGroups, poolHref, runUserAction, userHref } from "./cognitoutil";
import { SetPassword } from "./SetPassword";

export default function UserDetail() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const username = params.get("username") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const user = useLoad(() => cognito.send(new AdminGetUserCommand({ UserPoolId: id, Username: username })), [id, username]);
  const pool = useLoad(async () => (await cognito.send(new DescribeUserPoolCommand({ UserPoolId: id }))).UserPool, [id]);
  const memberOf = useLoad(() => listUserGroups(id, username), [id, username]);
  const allGroups = useLoad(() => listGroups(id), [id]);
  const form = useSubmit();
  const [modal, setModal] = useState<"attribute" | "group" | "password" | "delete" | undefined>(undefined);
  // The attribute being edited. Empty when the dialog adds a new one.
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [group, setGroup] = useState("");

  const u = user.data;
  const attributes = u?.UserAttributes ?? [];
  const canJoin = (allGroups.data ?? []).filter((g) => !memberOf.data?.some((m) => m.GroupName === g.GroupName));

  const act = async (action: UserAction) => {
    try {
      await runUserAction(id, username, action);
      notify.success(`User ${ACTION_DONE[action]}.`);
    } catch (e) {
      notify.error("Could not update the user", e);
    }
    user.reload(true);
  };

  const openAttribute = (attrName = "") => {
    setEditing(attrName);
    setName(attrName);
    setValue(attr(attributes, attrName) ?? "");
    form.setError("");
    setModal("attribute");
  };

  const saveAttribute = async () => {
    if (!/^[\w:.-]{1,32}$/.test(name)) return form.setError("Enter an attribute name, such as name or custom:team. No spaces.");
    if (name === "sub") return form.setError("The sub attribute can't be changed.");
    if (!editing && attributes.some((a) => a.Name === name)) return form.setError(`The user already has the attribute ${name}. Edit it instead.`);
    if (!value) return form.setError("Enter a value.");
    const ok = await form.run(async () => {
      await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: id, Username: username, UserAttributes: [{ Name: name, Value: value }] }));
      notify.success(`Attribute ${name} was saved.`);
      user.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const deleteAttribute = async (attrName: string) => {
    try {
      await cognito.send(new AdminDeleteUserAttributesCommand({ UserPoolId: id, Username: username, UserAttributeNames: [attrName] }));
      notify.success(`Attribute ${attrName} was deleted.`);
    } catch (e) {
      notify.error("Could not delete the attribute", e);
    }
    user.reload(true);
  };

  const addToGroup = async () => {
    if (!group) return form.setError("Choose a group.");
    const ok = await form.run(async () => {
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: id, Username: username, GroupName: group }));
      notify.success(`User added to group ${group}.`);
      memberOf.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeFromGroup = async (GroupName: string) => {
    try {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: id, Username: username, GroupName }));
      notify.success(`User removed from group ${GroupName}.`);
    } catch (e) {
      notify.error("Could not remove the user from the group", e);
    }
    memberOf.reload(true);
  };

  const remove = async () => {
    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: id, Username: username }));
      notify.success(`User ${username} was deleted.`);
      navigate(poolHref(id));
    } catch (e) {
      notify.error("Could not delete the user", e);
      setModal(undefined);
    }
  };

  return (
    <Shell
      service="cognito"
      breadcrumbs={[
        { text: "Amazon Cognito", href: "/cognito/user-pools" },
        { text: "User pools", href: "/cognito/user-pools" },
        { text: pool.data?.Name ?? id, href: poolHref(id) },
        { text: `User: ${username}`, href: userHref(id, username) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (user.reload(), memberOf.reload(), allGroups.reload())} />
                <ButtonDropdown
                  disabled={!u}
                  onItemClick={(e) => (e.detail.id === "password" ? setModal("password") : act(e.detail.id as UserAction))}
                  items={[
                    { id: "confirm", text: "Confirm account", disabled: u?.UserStatus !== "UNCONFIRMED" },
                    { id: "enable", text: "Enable user access", disabled: !!u?.Enabled },
                    { id: "disable", text: "Disable user access", disabled: !u?.Enabled },
                    { id: "password", text: "Set password" },
                    { id: "reset", text: "Reset password" },
                  ]}
                >
                  Actions
                </ButtonDropdown>
                <Button disabled={!u} onClick={() => setModal("delete")}>
                  Delete user
                </Button>
              </SpaceBetween>
            }
          >
            User: {username}
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
            {u.UserStatus === "RESET_REQUIRED" && <Alert type="warning">This user can't sign in until a new password is set. No reset code is sent here. Choose Actions, then Set password.</Alert>}
            <Container header={<Header variant="h2">User information</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="User name">
                  <Copy text={u.Username} />
                </Pair>
                <Pair label="User ID (sub)">
                  <Copy text={attr(attributes, "sub")} />
                </Pair>
                <Pair label="Email address">{attr(attributes, "email")}</Pair>
                <Pair label="Confirmation status">
                  <UserStatus status={u.UserStatus} />
                </Pair>
                <Pair label="Account status">
                  <Enabled enabled={u.Enabled} />
                </Pair>
                <Pair label="MFA methods">{u.UserMFASettingList?.join(", ")}</Pair>
                <Pair label="Created time">{formatDate(u.UserCreateDate)}</Pair>
                <Pair label="Last updated time">{formatDate(u.UserLastModifiedDate)}</Pair>
              </ColumnLayout>
            </Container>
            <Table
              header={
                <Header variant="h2" counter={`(${attributes.length})`} actions={<Button onClick={() => openAttribute()}>Add attribute</Button>}>
                  User attributes
                </Header>
              }
              items={attributes}
              trackBy={(a) => a.Name ?? ""}
              columnDefinitions={[
                { id: "name", header: "Attribute name", cell: (a) => a.Name, isRowHeader: true },
                { id: "value", header: "Value", cell: (a) => a.Value || "-" },
                {
                  id: "actions",
                  header: "Actions",
                  cell: (a) =>
                    a.Name === "sub" ? (
                      "-"
                    ) : (
                      <SpaceBetween direction="horizontal" size="s">
                        <Button variant="inline-link" ariaLabel={`Edit ${a.Name}`} onClick={() => openAttribute(a.Name ?? "")}>
                          Edit
                        </Button>
                        <Button variant="inline-link" ariaLabel={`Delete ${a.Name}`} onClick={() => deleteAttribute(a.Name ?? "")}>
                          Delete
                        </Button>
                      </SpaceBetween>
                    ),
                },
              ]}
              empty={<Box textAlign="center">No attributes</Box>}
            />
            <Table
              header={
                <Header
                  variant="h2"
                  counter={`(${memberOf.data?.length ?? 0})`}
                  actions={
                    <Button
                      disabled={!canJoin.length}
                      onClick={() => {
                        setGroup(canJoin[0]?.GroupName ?? "");
                        form.setError("");
                        setModal("group");
                      }}
                    >
                      Add user to group
                    </Button>
                  }
                >
                  Group memberships
                </Header>
              }
              loading={memberOf.loading}
              loadingText="Loading groups"
              items={memberOf.data ?? []}
              trackBy={(g) => g.GroupName ?? ""}
              columnDefinitions={[
                { id: "name", header: "Group name", cell: (g) => g.GroupName, isRowHeader: true },
                { id: "description", header: "Description", cell: (g) => g.Description || "-" },
                { id: "precedence", header: "Precedence", cell: (g) => g.Precedence ?? "-" },
                {
                  id: "actions",
                  header: "Actions",
                  cell: (g) => (
                    <Button variant="inline-link" ariaLabel={`Remove from ${g.GroupName}`} onClick={() => removeFromGroup(g.GroupName ?? "")}>
                      Remove user from group
                    </Button>
                  ),
                },
              ]}
              empty={
                <Box textAlign="center">
                  <b>No group memberships</b>
                  <Box variant="p">{allGroups.data?.length ? "This user is in no group." : "This user pool has no groups. Create one on the Groups tab of the user pool."}</Box>
                </Box>
              }
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "attribute"} header={editing ? `Edit ${editing}` : "Add attribute"} submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveAttribute}>
        {!editing && (
          <FormField label="Attribute name" description="A standard attribute such as name or phone_number, or a custom one such as custom:team.">
            <Input value={name} placeholder="name" onChange={(e) => setName(e.detail.value)} />
          </FormField>
        )}
        <FormField label="Value">
          <Input value={value} placeholder="Enter a value" onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "group"} header="Add user to group" submitLabel="Add" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={addToGroup}>
        <FormField label="Group">
          <Select selectedOption={group ? { value: group, label: group } : null} onChange={(e) => setGroup(e.detail.selectedOption.value ?? "")} options={canJoin.map((g) => ({ value: g.GroupName, label: g.GroupName, description: g.Description }))} placeholder="Choose a group" />
        </FormField>
      </FormModal>

      <SetPassword visible={modal === "password"} poolId={id} usernames={[username]} policy={pool.data?.Policies?.PasswordPolicy} onDismiss={() => setModal(undefined)} onDone={() => user.reload(true)} />

      <ConfirmDelete visible={modal === "delete"} title={`Delete user ${username}`} onCancel={() => setModal(undefined)} onConfirm={remove} warning="A deleted user can no longer sign in. You can't undo this." />
    </Shell>
  );
}
