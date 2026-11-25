import { useEffect, useState } from "react";
import {
  CreateAccountCommand,
  CreateOrganizationalUnitCommand,
  DeleteOrganizationCommand,
  DeleteOrganizationalUnitCommand,
  MoveAccountCommand,
  type Organization,
  RemoveAccountFromOrganizationCommand,
  type Root,
  UpdateOrganizationalUnitCommand,
} from "@aws-sdk/client-organizations";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { organizations } from "../../clients/organizations";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { OrgGate, OrgIdInNav } from "./OrgGate";
import { EMAIL_RULE, JOINED, type OrgNode, accountHref, destinations, loadOrgState, loadTree, unitHref, waitForAccount } from "./orgutil";

type Dialog = "account" | "ou" | "move" | "rename" | "deleteOu" | "remove" | "deleteOrg";

const KIND: Record<OrgNode["kind"], string> = { root: "Root", ou: "Organizational unit", account: "Account" };

function OrgTree({ org, root, onOrgDeleted }: { org: Organization; root: Root; onOrgDeleted: () => void }) {
  const notify = useNotify();
  const master = org.MasterAccountId;
  const tree = useLoad(() => loadTree(root, master), [root.Id, master]);
  const form = useSubmit();
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState("");
  const nodes = tree.data ?? [];
  const { items, collectionProps, actions } = useCollection(nodes, {
    expandableRows: { getId: (n) => n.id, getParentId: (n) => n.parentId },
    selection: { trackBy: "id", keepSelection: false },
  });

  // Open every level when the tree loads.
  useEffect(() => {
    if (tree.data) actions.setExpandedItems(tree.data.filter((n) => n.kind !== "account"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.data]);

  const selected = collectionProps.selectedItems?.[0];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const places = destinations(nodes);
  const accountCount = nodes.filter((n) => n.kind === "account").length;
  // A new OU or account goes into the selected OU, or next to the selected account.
  const containerOf = (n?: OrgNode) => (!n ? root.Id ?? "" : n.kind === "account" ? n.parentId ?? root.Id ?? "" : n.id);

  const open = (d: Dialog) => {
    form.setError("");
    setName(d === "rename" ? selected?.name ?? "" : "");
    setEmail("");
    setTarget(d === "move" ? "" : containerOf(selected));
    setDialog(d);
  };

  const done = (message: string) => {
    notify.success(message);
    actions.setSelectedItems([]);
    tree.reload(true);
  };

  const addAccount = async () => {
    if (!name.trim()) return form.setError("Enter an account name.");
    if (!EMAIL_RULE.test(email.trim())) return form.setError("Enter the email address of the account owner, such as storefront@example.com.");
    const ok = await form.run(async () => {
      const s = (await organizations.send(new CreateAccountCommand({ AccountName: name.trim(), Email: email.trim() }))).CreateAccountStatus;
      const id = await waitForAccount(s?.Id ?? "", s?.State, s?.AccountId);
      // New accounts start under the root.
      if (target && target !== root.Id) await organizations.send(new MoveAccountCommand({ AccountId: id, SourceParentId: root.Id, DestinationParentId: target }));
      done(`Account ${name.trim()} (${id}) was created.`);
    });
    if (ok) setDialog(undefined);
  };

  const createOu = async () => {
    if (!name.trim()) return form.setError("Enter a name for the organizational unit.");
    const ok = await form.run(async () => {
      await organizations.send(new CreateOrganizationalUnitCommand({ ParentId: target, Name: name.trim() }));
      done(`Organizational unit ${name.trim()} was created.`);
    });
    if (ok) setDialog(undefined);
  };

  const move = async () => {
    if (!selected || !target) return form.setError("Choose where to move the account.");
    const ok = await form.run(async () => {
      await organizations.send(new MoveAccountCommand({ AccountId: selected.id, SourceParentId: selected.parentId ?? "", DestinationParentId: target }));
      done(`Account ${selected.name} was moved.`);
    });
    if (ok) setDialog(undefined);
  };

  const rename = async () => {
    if (!selected || !name.trim()) return form.setError("Enter a name for the organizational unit.");
    const ok = await form.run(async () => {
      await organizations.send(new UpdateOrganizationalUnitCommand({ OrganizationalUnitId: selected.id, Name: name.trim() }));
      done(`Organizational unit renamed to ${name.trim()}.`);
    });
    if (ok) setDialog(undefined);
  };

  const confirmed = async (work: () => Promise<unknown>, message: string, failure: string) => {
    try {
      await work();
      done(message);
    } catch (e) {
      notify.error(failure, e);
    }
    setDialog(undefined);
  };

  const deleteOrg = async () => {
    try {
      await organizations.send(new DeleteOrganizationCommand({}));
      notify.success("The organization was deleted.");
      onOrgDeleted();
    } catch (e) {
      notify.error("Could not delete the organization", e);
      setDialog(undefined);
    }
  };

  const children = (id: string) => nodes.filter((n) => n.parentId === id).length;

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button disabled={accountCount !== 1} onClick={() => setDialog("deleteOrg")}>
                Delete organization
              </Button>
            }
            description={accountCount > 1 ? "Remove the member accounts before you delete the organization." : undefined}
          >
            Organization
          </Header>
        }
      >
        <ColumnLayout columns={4} variant="text-grid">
          <Pair label="Organization ID">
            <Copy text={org.Id} />
          </Pair>
          <Pair label="Management account">{master ? `${byId.get(master)?.name ?? "management"} (${master})` : "-"}</Pair>
          <Pair label="Feature set">{org.FeatureSet === "ALL" ? "All features" : org.FeatureSet}</Pair>
          <Pair label="ARN">
            <Copy text={org.Arn} />
          </Pair>
        </ColumnLayout>
      </Container>

      <Table
        {...collectionProps}
        variant="container"
        resizableColumns
        items={items}
        trackBy="id"
        selectionType="single"
        loading={tree.loading && !tree.data}
        loadingText="Loading the organization"
        header={
          <SpaceBetween size="s">
            <Header
              variant="h2"
              counter={tree.data ? `(${accountCount} account${accountCount === 1 ? "" : "s"})` : undefined}
              description="Accounts grouped into organizational units. Policies attached to an OU apply to everything under it."
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" ariaLabel="Refresh" loading={tree.loading && !!tree.data} onClick={() => tree.reload()} />
                  <ButtonDropdown
                    items={[
                      { id: "move", text: "Move account", disabled: selected?.kind !== "account" },
                      { id: "remove", text: "Remove account from organization", disabled: selected?.kind !== "account" || selected.id === master },
                      { id: "rename", text: "Rename organizational unit", disabled: selected?.kind !== "ou" },
                      { id: "deleteOu", text: "Delete organizational unit", disabled: selected?.kind !== "ou" },
                    ]}
                    onItemClick={(e) => open(e.detail.id as Dialog)}
                  >
                    Actions
                  </ButtonDropdown>
                  <Button onClick={() => open("ou")}>Create organizational unit</Button>
                  <Button variant="primary" onClick={() => open("account")}>
                    Add an AWS account
                  </Button>
                </SpaceBetween>
              }
            >
              AWS accounts
            </Header>
            {tree.error && (
              <Alert type="error" header="Could not load the organization">
                {tree.error}
              </Alert>
            )}
          </SpaceBetween>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            isRowHeader: true,
            // Room for the tree indent and a project name.
            minWidth: 260,
            cell: (n) => <RouterLink to={n.kind === "account" ? accountHref(n.id) : unitHref(n.id)}>{n.name}</RouterLink>,
          },
          { id: "id", header: "ID", cell: (n) => n.id },
          { id: "type", header: "Type", cell: (n) => (n.id === master ? "Management account" : KIND[n.kind]) },
          { id: "email", header: "Email", cell: (n) => n.account?.Email ?? "-" },
          {
            id: "status",
            header: "Status",
            cell: (n) => (n.account ? <StatusIndicator type={n.account.Status === "ACTIVE" ? "success" : "stopped"}>{n.account.Status === "ACTIVE" ? "Active" : n.account.Status}</StatusIndicator> : "-"),
          },
          { id: "joined", header: "Joined", cell: (n) => (n.account ? `${JOINED[n.account.JoinedMethod ?? ""] ?? n.account.JoinedMethod ?? ""} ${formatDate(n.account.JoinedTimestamp)}` : "-") },
        ]}
      />

      <FormModal visible={dialog === "account"} header="Add an AWS account" submitLabel="Create account" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={addAccount}>
        <FormField label="Account name">
          <Input value={name} placeholder="storefront" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Email address of the account owner" description="floci stores it. It sends no email.">
          <Input value={email} placeholder="storefront@example.com" type="email" onChange={(e) => setEmail(e.detail.value)} />
        </FormField>
        <FormField label="Place it in">
          <Select selectedOption={places.find((p) => p.value === target) ?? null} options={places} onChange={(e) => setTarget(e.detail.selectedOption.value ?? "")} />
        </FormField>
      </FormModal>

      <FormModal visible={dialog === "ou"} header="Create organizational unit" submitLabel="Create" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={createOu}>
        <FormField label="Name">
          <Input value={name} placeholder="Applications" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Parent">
          <Select selectedOption={places.find((p) => p.value === target) ?? null} options={places} onChange={(e) => setTarget(e.detail.selectedOption.value ?? "")} />
        </FormField>
      </FormModal>

      <FormModal visible={dialog === "move"} header={`Move ${selected?.name ?? "account"}`} submitLabel="Move" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={move}>
        <FormField label="Destination" description={selected?.parentId ? `Now in ${places.find((p) => p.value === selected.parentId)?.label ?? selected.parentId}.` : undefined}>
          <Select
            selectedOption={places.find((p) => p.value === target) ?? null}
            options={places.filter((p) => p.value !== selected?.parentId)}
            onChange={(e) => setTarget(e.detail.selectedOption.value ?? "")}
            placeholder="Choose the root or an organizational unit"
          />
        </FormField>
      </FormModal>

      <FormModal visible={dialog === "rename"} header="Rename organizational unit" submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={rename}>
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={dialog === "deleteOu"}
        title="Delete organizational unit"
        warning={selected && children(selected.id) ? "Move or remove what is in it first. floci refuses to delete an organizational unit that is not empty." : undefined}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => confirmed(() => organizations.send(new DeleteOrganizationalUnitCommand({ OrganizationalUnitId: selected?.id })), `Organizational unit ${selected?.name} was deleted.`, "Could not delete the organizational unit")}
      >
        Delete <b>{selected?.name}</b>? This can't be undone.
      </ConfirmDelete>

      <ConfirmDelete
        visible={dialog === "remove"}
        title="Remove account from organization"
        confirmText="remove"
        actionLabel="Remove"
        warning="The account and its resources stay in floci. It is no longer managed by this organization."
        onCancel={() => setDialog(undefined)}
        onConfirm={() => confirmed(() => organizations.send(new RemoveAccountFromOrganizationCommand({ AccountId: selected?.id })), `Account ${selected?.name} was removed from the organization.`, "Could not remove the account")}
      >
        Remove <b>{selected?.name}</b> ({selected?.id}) from the organization?
      </ConfirmDelete>

      <ConfirmDelete visible={dialog === "deleteOrg"} title="Delete organization" warning="Its organizational units and policies are deleted with it." onCancel={() => setDialog(undefined)} onConfirm={deleteOrg}>
        Delete organization <b>{org.Id}</b>? This can't be undone.
      </ConfirmDelete>
    </SpaceBetween>
  );
}

export default function Accounts() {
  const state = useLoad(loadOrgState, []);
  return (
    <Shell service="organizations" navExtra={<OrgIdInNav state={state} />} breadcrumbs={[{ text: "AWS Organizations", href: "/organizations/accounts" }, { text: "AWS accounts", href: "/organizations/accounts" }]}>
      <SpaceBetween size="l">
        <Header variant="h1" description="The accounts of the organization this account manages.">
          AWS accounts
        </Header>
        <OrgGate state={state}>{(org, root) => <OrgTree org={org} root={root} onOrgDeleted={() => state.reload()} />}</OrgGate>
      </SpaceBetween>
    </Shell>
  );
}
