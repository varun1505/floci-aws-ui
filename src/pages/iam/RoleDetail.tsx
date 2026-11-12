import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GetRoleCommand, UpdateAssumeRolePolicyCommand } from "@aws-sdk/client-iam";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair, prettyJson } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { Permissions, deleteRole, jsonError } from "./iamutil";

export default function RoleDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const role = useLoad(async () => (await iam.send(new GetRoleCommand({ RoleName: name }))).Role, [name]);
  const form = useSubmit();
  const [editing, setEditing] = useState(false);
  const [document, setDocument] = useState("");
  const [deleting, setDeleting] = useState(false);
  const r = role.data;

  const save = async () => {
    const bad = jsonError(document);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      await iam.send(new UpdateAssumeRolePolicyCommand({ RoleName: name, PolicyDocument: document }));
      notify.success("Trust policy updated.");
      role.reload(true);
    });
    if (ok) setEditing(false);
  };

  const remove = async () => {
    try {
      await deleteRole(name);
      notify.success(`Deleted ${name}.`);
      navigate("/iam/roles");
    } catch (e) {
      notify.error("Could not delete the role", e);
      setDeleting(false);
    }
  };

  return (
    <Shell service="iam" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Roles", href: "/iam/roles" }, { text: name, href: `/iam/roles/${encodeURIComponent(name)}` }]}>
      <ContentLayout
        header={
          <Header variant="h1" description={r?.Description} actions={<Button onClick={() => setDeleting(true)}>Delete</Button>}>
            {name}
          </Header>
        }
      >
        {role.error ? (
          <Alert type="error" header="Could not load the role">
            {role.error}
          </Alert>
        ) : !r ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Summary</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={r.Arn} />
                </Pair>
                <Pair label="Creation date">{formatDate(r.CreateDate)}</Pair>
                <Pair label="Maximum session duration">{r.MaxSessionDuration ? `${r.MaxSessionDuration / 3600} hour${r.MaxSessionDuration === 3600 ? "" : "s"}` : undefined}</Pair>
                <Pair label="Role ID">{r.RoleId}</Pair>
                <Pair label="Path">{r.Path}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "permissions", label: "Permissions", content: <Permissions kind="role" name={name} /> },
                {
                  id: "trust",
                  label: "Trust relationships",
                  content: (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          description="Entities that can assume this role under specified conditions."
                          actions={
                            <Button
                              onClick={() => {
                                setDocument(prettyJson(r.AssumeRolePolicyDocument));
                                form.setError("");
                                setEditing(true);
                              }}
                            >
                              Edit trust policy
                            </Button>
                          }
                        >
                          Trusted entities
                        </Header>
                      }
                    >
                      <JsonBlock value={r.AssumeRolePolicyDocument} />
                    </Container>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={editing} size="large" header="Edit trust policy" submitLabel="Update policy" busy={form.busy} error={form.error} onDismiss={() => setEditing(false)} onSubmit={save}>
        <FormField label="Trust policy" stretch>
          <Textarea value={document} rows={14} onChange={(e) => setDocument(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={`Delete ${name}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Functions and services that use a deleted role will stop working." />
    </Shell>
  );
}
