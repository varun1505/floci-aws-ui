import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AttachPolicyCommand, DeletePolicyCommand, DescribePolicyCommand, DetachPolicyCommand, type Organization, type PolicyTargetSummary, type Root, UpdatePolicyCommand, paginateListTargetsForPolicy } from "@aws-sdk/client-organizations";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { organizations } from "../../clients/organizations";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair, prettyJson } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { accountName } from "../../lib/accounts";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { OrgGate } from "./OrgGate";
import { checkPolicyJson, loadOrgState, loadTree, policyHref, targetHref } from "./orgutil";
import { TargetTags } from "./TargetParts";

const TARGET_TYPE: Record<string, string> = { ROOT: "Root", ORGANIZATIONAL_UNIT: "Organizational unit", ACCOUNT: "Account" };

function PolicyView({ id, org, root }: { id: string; org: Organization; root: Root }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const policy = useLoad(async () => (await organizations.send(new DescribePolicyCommand({ PolicyId: id }))).Policy, [id]);
  const targets = useLoad(async () => {
    const out: PolicyTargetSummary[] = [];
    for await (const page of paginateListTargetsForPolicy({ client: organizations }, { PolicyId: id })) out.push(...(page.Targets ?? []));
    return out.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
  }, [id]);
  const form = useSubmit();
  const [dialog, setDialog] = useState<"edit" | "attach" | "delete" | undefined>(undefined);
  const [selected, setSelected] = useState<PolicyTargetSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [choices, setChoices] = useState<{ value: string; label: string; description: string }[]>([]);
  const [choice, setChoice] = useState("");
  const p = policy.data;
  const summary = p?.PolicySummary;
  const awsManaged = !!summary?.AwsManaged;

  const openEdit = () => {
    setName(summary?.Name ?? "");
    setDescription(summary?.Description ?? "");
    setContent(prettyJson(p?.Content));
    form.setError("");
    setDialog("edit");
  };

  const save = async () => {
    if (!name.trim()) return form.setError("Enter a policy name.");
    const bad = checkPolicyJson(content);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      await organizations.send(new UpdatePolicyCommand({ PolicyId: id, Name: name.trim(), Description: description, Content: content }));
      notify.success(`Policy ${name.trim()} was saved.`);
      policy.reload(true);
    });
    if (ok) setDialog(undefined);
  };

  const openAttach = async () => {
    form.setError("");
    setChoice("");
    setDialog("attach");
    try {
      const have = new Set((targets.data ?? []).map((t) => t.TargetId));
      const nodes = await loadTree(root, org.MasterAccountId);
      const kind = { root: "Root", ou: "Organizational unit", account: "Account" };
      setChoices(nodes.filter((n) => !have.has(n.id)).map((n) => ({ value: n.id, label: n.name, description: `${kind[n.kind]} ${n.id}` })));
    } catch (e) {
      form.setError(errorMessage(e));
    }
  };

  const attach = async () => {
    if (!choice) return form.setError("Choose where to attach the policy.");
    const ok = await form.run(async () => {
      await organizations.send(new AttachPolicyCommand({ PolicyId: id, TargetId: choice }));
      notify.success("Policy attached.");
      targets.reload(true);
    });
    if (ok) setDialog(undefined);
  };

  const detach = async () => {
    try {
      for (const t of selected) await organizations.send(new DetachPolicyCommand({ PolicyId: id, TargetId: t.TargetId }));
      notify.success(selected.length === 1 ? `Detached from ${selected[0].Name}.` : `Detached from ${selected.length} targets.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not detach the policy", e);
    }
    targets.reload(true);
  };

  const remove = async () => {
    try {
      await organizations.send(new DeletePolicyCommand({ PolicyId: id }));
      notify.success(`Policy ${summary?.Name} was deleted.`);
      navigate("/organizations/policies");
    } catch (e) {
      notify.error("Could not delete the policy. Detach it from every target first", e);
      setDialog(undefined);
    }
  };

  if (policy.error)
    return (
      <Alert type="error" header="Could not load the policy">
        {policy.error}
      </Alert>
    );
  if (!summary)
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={summary.Description}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (policy.reload(), targets.reload())} />
            <Button disabled={awsManaged} onClick={() => setDialog("delete")}>
              Delete
            </Button>
            <Button disabled={awsManaged} onClick={openEdit}>
              Edit policy
            </Button>
          </SpaceBetween>
        }
      >
        {summary.Name}
      </Header>
      {awsManaged && <Alert type="info">AWS manages this policy. You can attach and detach it, but not change or delete it.</Alert>}
      <Container header={<Header variant="h2">Details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="Policy ID">
            <Copy text={summary.Id} />
          </Pair>
          <Pair label="Managed by">{awsManaged ? "AWS" : "Customer"}</Pair>
          <Pair label="ARN">
            <Copy text={summary.Arn} />
          </Pair>
        </ColumnLayout>
      </Container>
      <Tabs
        tabs={[
          {
            id: "content",
            label: "Content",
            content: (
              <Container header={<Header variant="h2">Policy JSON</Header>}>
                <JsonBlock value={p?.Content} />
              </Container>
            ),
          },
          {
            id: "targets",
            label: "Targets",
            content: (
              <ResourceTable
                title="Targets"
                description="The root, organizational units and accounts this policy is attached to."
                variant="container"
                stickyHeader={false}
                global
                resourceName="targets"
                items={targets.data}
                loading={targets.loading}
                error={targets.error}
                onRefresh={() => targets.reload()}
                trackBy={(t) => t.TargetId ?? ""}
                selectionType="multi"
                selected={selected}
                onSelect={setSelected}
                emptyAction={<Button onClick={() => void openAttach()}>Attach</Button>}
                actions={
                  <>
                    <Button disabled={!selected.length} onClick={() => void detach()}>
                      Detach
                    </Button>
                    <Button onClick={() => void openAttach()}>Attach</Button>
                  </>
                }
                columns={[
                  {
                    id: "name",
                    header: "Name",
                    cell: (t) => <RouterLink to={targetHref(t.TargetId ?? "")}>{t.Type === "ACCOUNT" ? accountName(t.Name, t.TargetId === org.MasterAccountId) : t.Type === "ROOT" ? "Root" : t.Name}</RouterLink>,
                    sortingField: "Name",
                    isRowHeader: true,
                  },
                  { id: "id", header: "ID", cell: (t) => t.TargetId },
                  { id: "type", header: "Type", cell: (t) => TARGET_TYPE[t.Type ?? ""] ?? t.Type },
                ]}
              />
            ),
          },
          { id: "tags", label: "Tags", content: <TargetTags resourceId={id} /> },
        ]}
      />

      {dialog === "edit" && (
        <FormModal visible size="large" header={`Edit ${summary.Name}`} submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={save}>
          <FormField label="Name">
            <Input value={name} onChange={(e) => setName(e.detail.value)} />
          </FormField>
          <FormField label="Description" description="Optional.">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
          <FormField label="Policy JSON" stretch>
            <Code value={content} onChange={setContent} language="json" height={300} ariaLabel="Policy JSON" />
          </FormField>
        </FormModal>
      )}

      <FormModal visible={dialog === "attach"} header={`Attach ${summary.Name}`} submitLabel="Attach" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={attach}>
        <FormField label="Target" description="The root, an organizational unit or an account.">
          <Select
            selectedOption={choices.find((c) => c.value === choice) ?? null}
            options={choices}
            onChange={(e) => setChoice(e.detail.selectedOption.value ?? "")}
            filteringType="auto"
            placeholder="Choose a target"
            empty="The policy is attached everywhere already."
          />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={dialog === "delete"} title="Delete policy" warning="floci refuses to delete a policy that is still attached." onCancel={() => setDialog(undefined)} onConfirm={remove}>
        Delete <b>{summary.Name}</b>? This can't be undone.
      </ConfirmDelete>
    </SpaceBetween>
  );
}

export default function PolicyDetail() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const state = useLoad(loadOrgState, []);
  return (
    <Shell
      service="organizations"
      breadcrumbs={[
        { text: "AWS Organizations", href: "/organizations/accounts" },
        { text: "Policies", href: "/organizations/policies" },
        { text: id, href: policyHref(id) },
      ]}
    >
      <OrgGate state={state}>{(org, root) => <PolicyView id={id} org={org} root={root} />}</OrgGate>
    </Shell>
  );
}
