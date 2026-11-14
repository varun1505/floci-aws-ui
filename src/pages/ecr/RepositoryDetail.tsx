import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BatchDeleteImageCommand,
  DeleteLifecyclePolicyCommand,
  DeleteRepositoryCommand,
  DeleteRepositoryPolicyCommand,
  DescribeRepositoriesCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand,
  type ImageDetail,
  type ImageTagMutability,
  PutImageScanningConfigurationCommand,
  PutImageTagMutabilityCommand,
  PutLifecyclePolicyCommand,
  SetRepositoryPolicyCommand,
} from "@aws-sdk/client-ecr";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { ecr } from "../../clients/ecr";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { MUTABILITY, listImages, repoHref, shortDigest } from "./ecrutil";
import { PolicyTab, orNone } from "./PolicyTab";
import { PushCommands } from "./PushCommands";

const LIFECYCLE_SAMPLE = JSON.stringify(
  { rules: [{ rulePriority: 1, description: "Keep the last 10 untagged images", selection: { tagStatus: "untagged", countType: "imageCountMoreThan", countNumber: 10 }, action: { type: "expire" } }] },
  null,
  2,
);
const POLICY_SAMPLE = JSON.stringify(
  { Version: "2012-10-17", Statement: [{ Sid: "AllowPull", Effect: "Allow", Principal: "*", Action: ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability"] }] },
  null,
  2,
);

export default function RepositoryDetail() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const repo = useLoad(async () => (await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [name] }))).repositories?.[0], [name]);
  const images = useLoad(() => listImages(name), [name]);
  const form = useSubmit();
  const [selected, setSelected] = useState<ImageDetail[]>([]);
  const [dialog, setDialog] = useState<"push" | "edit" | "images" | "delete" | undefined>(undefined);
  const [mutability, setMutability] = useState("MUTABLE");
  const [scan, setScan] = useState(false);
  const r = repo.data;

  const openEdit = () => {
    setMutability(r?.imageTagMutability ?? "MUTABLE");
    setScan(!!r?.imageScanningConfiguration?.scanOnPush);
    form.setError("");
    setDialog("edit");
  };

  const save = async () => {
    const ok = await form.run(async () => {
      if (mutability !== r?.imageTagMutability) await ecr.send(new PutImageTagMutabilityCommand({ repositoryName: name, imageTagMutability: mutability as ImageTagMutability }));
      if (scan !== !!r?.imageScanningConfiguration?.scanOnPush) await ecr.send(new PutImageScanningConfigurationCommand({ repositoryName: name, imageScanningConfiguration: { scanOnPush: scan } }));
      notify.success(`Repository ${name} was updated.`);
      repo.reload(true);
    });
    if (ok) setDialog(undefined);
  };

  const removeImages = async () => {
    try {
      // Deleting by digest removes the image with all its tags.
      const res = await ecr.send(new BatchDeleteImageCommand({ repositoryName: name, imageIds: selected.map((i) => ({ imageDigest: i.imageDigest })) }));
      if (res.failures?.length) throw new Error(res.failures.map((f) => f.failureReason ?? f.failureCode ?? "Unknown failure").join(", "));
      notify.success(`Deleted ${selected.length} image${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the images", e);
    }
    setDialog(undefined);
    images.reload();
  };

  const removeRepo = async () => {
    try {
      await ecr.send(new DeleteRepositoryCommand({ repositoryName: name, force: true }));
      notify.success(`Repository ${name} was deleted.`);
      navigate("/ecr/repositories");
    } catch (e) {
      notify.error(`Could not delete repository ${name}`, e);
      setDialog(undefined);
    }
  };

  return (
    <Shell
      service="ecr"
      breadcrumbs={[
        { text: "Amazon ECR", href: "/ecr/repositories" },
        { text: "Private registry", href: "/ecr/repositories" },
        { text: "Repositories", href: "/ecr/repositories" },
        { text: name, href: repoHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (repo.reload(), images.reload())} />
                <Button disabled={!r} onClick={openEdit}>
                  Edit
                </Button>
                <Button disabled={!r} onClick={() => setDialog("delete")}>
                  Delete
                </Button>
                <Button variant="primary" disabled={!r} onClick={() => setDialog("push")}>
                  View push commands
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {repo.error ? (
          <Alert type="error" header="Could not load the repository">
            {repo.error}
          </Alert>
        ) : !r ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Summary</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Repository ARN">
                  <Copy text={r.repositoryArn} />
                </Pair>
                <Pair label="URI">
                  <Copy text={r.repositoryUri} />
                </Pair>
                <Pair label="Created at">{formatDate(r.createdAt)}</Pair>
                <Pair label="Tag immutability">{r.imageTagMutability === "MUTABLE" ? "Mutable" : r.imageTagMutability === "IMMUTABLE" ? "Immutable" : r.imageTagMutability}</Pair>
                <Pair label="Scan on push">{r.imageScanningConfiguration?.scanOnPush ? "Enabled" : "Disabled"}</Pair>
                <Pair label="Encryption type">{r.encryptionConfiguration?.encryptionType === "AES256" ? "AES-256" : r.encryptionConfiguration?.encryptionType}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "images",
                  label: "Images",
                  content: (
                    <ResourceTable
                      title="Images"
                      variant="container"
                      stickyHeader={false}
                      resourceName="images"
                      filterPlaceholder="Search images"
                      emptyDescription="Push an image with docker push. Choose View push commands to see how."
                      items={images.data}
                      loading={images.loading}
                      error={images.error}
                      onRefresh={() => images.reload()}
                      trackBy={(i) => i.imageDigest ?? ""}
                      selectionType="multi"
                      selected={selected}
                      onSelect={setSelected}
                      emptyAction={<Button onClick={() => setDialog("push")}>View push commands</Button>}
                      actions={
                        <Button disabled={!selected.length} onClick={() => setDialog("images")}>
                          Delete
                        </Button>
                      }
                      columns={[
                        { id: "tags", header: "Image tags", cell: (i) => i.imageTags?.join(", ") || "<untagged>", sortingComparator: (a, b) => (a.imageTags?.[0] ?? "").localeCompare(b.imageTags?.[0] ?? ""), isRowHeader: true },
                        { id: "type", header: "Artifact type", cell: (i) => (/index|manifest\.list/.test(i.imageManifestMediaType ?? "") ? "Image Index" : "Image") },
                        { id: "pushed", header: "Pushed at", cell: (i) => formatDate(i.imagePushedAt), sortingComparator: (a, b) => (a.imagePushedAt?.getTime() ?? 0) - (b.imagePushedAt?.getTime() ?? 0) },
                        { id: "size", header: "Size", cell: (i) => formatBytes(i.imageSizeInBytes), sortingField: "imageSizeInBytes" },
                        {
                          id: "uri",
                          header: "Image URI",
                          cell: (i) => {
                            const uri = i.imageTags?.length ? `${r.repositoryUri}:${i.imageTags[0]}` : `${r.repositoryUri}@${i.imageDigest}`;
                            return <CopyToClipboard variant="icon" textToCopy={uri} copyButtonAriaLabel="Copy image URI" copySuccessText="Image URI copied" copyErrorText="Failed to copy" />;
                          },
                        },
                        {
                          id: "digest",
                          header: "Digest",
                          cell: (i) => (
                            <SpaceBetween direction="horizontal" size="xxs">
                              <CopyToClipboard variant="icon" textToCopy={i.imageDigest ?? ""} copyButtonAriaLabel="Copy digest" copySuccessText="Digest copied" copyErrorText="Failed to copy" />
                              <span title={i.imageDigest}>{shortDigest(i.imageDigest)}</span>
                            </SpaceBetween>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  id: "lifecycle",
                  label: "Lifecycle policy",
                  content: (
                    <PolicyTab
                      title="Lifecycle policy"
                      description="Rules that expire old images. floci stores the policy. It does not expire images."
                      sample={LIFECYCLE_SAMPLE}
                      load={() => orNone(async () => (await ecr.send(new GetLifecyclePolicyCommand({ repositoryName: name }))).lifecyclePolicyText)}
                      save={(text) => ecr.send(new PutLifecyclePolicyCommand({ repositoryName: name, lifecyclePolicyText: text }))}
                      remove={() => ecr.send(new DeleteLifecyclePolicyCommand({ repositoryName: name }))}
                    />
                  ),
                },
                {
                  id: "permissions",
                  label: "Permissions",
                  content: (
                    <PolicyTab
                      title="Repository policy"
                      description="Says who can pull from and push to this repository. floci stores the policy. It does not check it."
                      sample={POLICY_SAMPLE}
                      load={() => orNone(async () => (await ecr.send(new GetRepositoryPolicyCommand({ repositoryName: name }))).policyText)}
                      save={(text) => ecr.send(new SetRepositoryPolicyCommand({ repositoryName: name, policyText: text }))}
                      remove={() => ecr.send(new DeleteRepositoryPolicyCommand({ repositoryName: name }))}
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      {dialog === "push" && r && <PushCommands name={name} uri={r.repositoryUri ?? ""} onDismiss={() => setDialog(undefined)} />}

      <FormModal visible={dialog === "edit"} header={`Edit ${name}`} submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={save}>
        <FormField label="Image tag mutability">
          <RadioGroup value={mutability} items={MUTABILITY} onChange={(e) => setMutability(e.detail.value)} />
        </FormField>
        <Checkbox checked={scan} onChange={(e) => setScan(e.detail.checked)} description="floci stores this setting. It does not scan images.">
          Scan on push
        </Checkbox>
      </FormModal>

      <ConfirmDelete visible={dialog === "images"} title="Delete images" warning="Every tag of the selected images is deleted with them." onCancel={() => setDialog(undefined)} onConfirm={removeImages}>
        Delete {selected.length} image{selected.length === 1 ? "" : "s"} from <b>{name}</b>? This can't be undone.
      </ConfirmDelete>
      <ConfirmDelete
        visible={dialog === "delete"}
        title="Delete repository"
        warning={images.data?.length ? `This also deletes the ${images.data.length} image${images.data.length === 1 ? "" : "s"} in the repository.` : undefined}
        onCancel={() => setDialog(undefined)}
        onConfirm={removeRepo}
      >
        Delete <b>{name}</b>? This can't be undone.
      </ConfirmDelete>
    </Shell>
  );
}
