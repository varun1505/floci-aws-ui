import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateRepositoryCommand, DeleteRepositoryCommand, type ImageTagMutability, type Repository } from "@aws-sdk/client-ecr";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import { ecr } from "../../clients/ecr";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { MUTABILITY, REPO_NAME_HINT, REPO_NAME_RULE, listRepositories, repoHref } from "./ecrutil";

export default function Repositories() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listRepositories, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Repository[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [mutability, setMutability] = useState("MUTABLE");
  const [scan, setScan] = useState(false);

  const openCreate = () => {
    setName("");
    setMutability("MUTABLE");
    setScan(false);
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (name.length < 2 || name.length > 256 || !REPO_NAME_RULE.test(name)) return form.setError(REPO_NAME_HINT);
    const ok = await form.run(async () => {
      await ecr.send(new CreateRepositoryCommand({ repositoryName: name, imageTagMutability: mutability as ImageTagMutability, imageScanningConfiguration: { scanOnPush: scan } }));
      notify.success(`Repository ${name} was created.`);
      navigate(repoHref(name));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      // force also deletes the images. Without it ECR refuses a repository that still has images.
      for (const r of selected) await ecr.send(new DeleteRepositoryCommand({ repositoryName: r.repositoryName, force: true }));
      notify.success(selected.length === 1 ? `Repository ${selected[0].repositoryName} was deleted.` : `Deleted ${selected.length} repositories.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the repository", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ecr" contentType="table" breadcrumbs={[{ text: "Amazon ECR", href: "/ecr/repositories" }, { text: "Private registry", href: "/ecr/repositories" }, { text: "Repositories", href: "/ecr/repositories" }]}>
      <ResourceTable
        title="Private repositories"
        resourceName="repositories"
        filterPlaceholder="Search repositories"
        emptyDescription="A repository stores the container images of one application. Push to it with docker push."
        emptyCli="ecr create-repository --repository-name my-app"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(r) => r.repositoryArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create repository</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create repository
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Repository name", cell: (r) => <RouterLink to={repoHref(r.repositoryName ?? "")}>{r.repositoryName}</RouterLink>, sortingField: "repositoryName", isRowHeader: true },
          { id: "uri", header: "URI", cell: (r) => <Copy text={r.repositoryUri} /> },
          { id: "created", header: "Created at", cell: (r) => formatDate(r.createdAt), sortingComparator: (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) },
          { id: "mutability", header: "Tag immutability", cell: (r) => (r.imageTagMutability === "MUTABLE" ? "Mutable" : r.imageTagMutability === "IMMUTABLE" ? "Immutable" : (r.imageTagMutability ?? "-")) },
          { id: "scan", header: "Scan on push", cell: (r) => (r.imageScanningConfiguration?.scanOnPush ? "Enabled" : "Disabled") },
          { id: "encryption", header: "Encryption type", cell: (r) => (r.encryptionConfiguration?.encryptionType === "AES256" ? "AES-256" : (r.encryptionConfiguration?.encryptionType ?? "-")) },
        ]}
      />

      <FormModal visible={creating} header="Create private repository" submitLabel="Create" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Repository name" description="A slash makes a namespace, such as team-a/web-app." constraintText={REPO_NAME_HINT}>
          <Input value={name} placeholder="my-app" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Image tag mutability">
          <RadioGroup value={mutability} items={MUTABILITY} onChange={(e) => setMutability(e.detail.value)} />
        </FormField>
        <Checkbox checked={scan} onChange={(e) => setScan(e.detail.checked)} description="floci stores this setting. It does not scan images.">
          Scan on push
        </Checkbox>
      </FormModal>

      <ConfirmDelete visible={deleting} title="Delete repositories" warning="This also deletes every image in the repository." onCancel={() => setDeleting(false)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].repositoryName}</b> : `${selected.length} repositories`}? This can't be undone.
      </ConfirmDelete>
    </Shell>
  );
}
