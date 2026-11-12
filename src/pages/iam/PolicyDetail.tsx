import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CreatePolicyVersionCommand, DeletePolicyCommand, DeletePolicyVersionCommand, GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand } from "@aws-sdk/client-iam";
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
import { isAwsManaged, jsonError, policyHref } from "./iamutil";

export default function PolicyDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const policy = useLoad(async () => {
    const p = (await iam.send(new GetPolicyCommand({ PolicyArn: arn }))).Policy;
    const version = p?.DefaultVersionId ? await iam.send(new GetPolicyVersionCommand({ PolicyArn: arn, VersionId: p.DefaultVersionId })).catch(() => undefined) : undefined;
    return { ...p, document: version?.PolicyVersion?.Document };
  }, [arn]);
  const form = useSubmit();
  const [editing, setEditing] = useState(false);
  const [document, setDocument] = useState("");
  const [deleting, setDeleting] = useState(false);
  const p = policy.data;
  const name = p?.PolicyName ?? arn.split("/").pop() ?? arn;
  const managed = isAwsManaged(arn);

  const save = async () => {
    const bad = jsonError(document);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      // A policy keeps at most five versions. Drop the oldest one that is not the default to make room.
      const versions = (await iam.send(new ListPolicyVersionsCommand({ PolicyArn: arn }))).Versions ?? [];
      if (versions.length >= 5) {
        const oldest = versions.filter((v) => !v.IsDefaultVersion).sort((a, b) => (a.CreateDate?.getTime() ?? 0) - (b.CreateDate?.getTime() ?? 0))[0];
        if (oldest) await iam.send(new DeletePolicyVersionCommand({ PolicyArn: arn, VersionId: oldest.VersionId }));
      }
      await iam.send(new CreatePolicyVersionCommand({ PolicyArn: arn, PolicyDocument: document, SetAsDefault: true }));
      notify.success(`Policy ${name} updated.`);
      policy.reload(true);
    });
    if (ok) setEditing(false);
  };

  const remove = async () => {
    try {
      await iam.send(new DeletePolicyCommand({ PolicyArn: arn }));
      notify.success(`Deleted ${name}.`);
      navigate("/iam/policies");
    } catch (e) {
      notify.error("Could not delete the policy. Detach it from every user and role first.", e);
      setDeleting(false);
    }
  };

  return (
    <Shell service="iam" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Policies", href: "/iam/policies" }, { text: name, href: policyHref(arn) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={p?.Description}
            actions={
              !managed && (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button onClick={() => setDeleting(true)}>Delete</Button>
                  <Button
                    variant="primary"
                    disabled={!p}
                    onClick={() => {
                      setDocument(prettyJson(p?.document));
                      form.setError("");
                      setEditing(true);
                    }}
                  >
                    Edit
                  </Button>
                </SpaceBetween>
              )
            }
          >
            {name}
          </Header>
        }
      >
        {policy.error ? (
          <Alert type="error" header="Could not load the policy">
            {policy.error}
          </Alert>
        ) : !p ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Policy details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={p.Arn} />
                </Pair>
                <Pair label="Type">{managed ? "AWS managed" : "Customer managed"}</Pair>
                <Pair label="Attached entities">{String(p.AttachmentCount ?? 0)}</Pair>
                <Pair label="Creation time">{formatDate(p.CreateDate)}</Pair>
                <Pair label="Edited time">{formatDate(p.UpdateDate)}</Pair>
                <Pair label="Default version">{p.DefaultVersionId}</Pair>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2">Permissions defined in this policy</Header>}>
              <JsonBlock value={p.document} />
            </Container>
          </SpaceBetween>
        )}
      </ContentLayout>
      <FormModal visible={editing} size="large" header={`Edit ${name}`} submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setEditing(false)} onSubmit={save}>
        <FormField label="Policy document (JSON)" description="Saving creates a new default version." stretch>
          <Textarea value={document} rows={16} onChange={(e) => setDocument(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={`Delete ${name}`} onCancel={() => setDeleting(false)} onConfirm={remove} />
    </Shell>
  );
}
