import { useState } from "react";
import { DeleteLayerVersionCommand, ListLayersCommand, PublishLayerVersionCommand, type LayersListItem, type Runtime } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect, { type MultiselectProps } from "@cloudscape-design/components/multiselect";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { lambda } from "../../clients/lambda";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { RUNTIMES } from "./runtimes";

export default function Layers() {
  const notify = useNotify();
  const layers = useLoad(async () => (await lambda.send(new ListLayersCommand({}))).Layers ?? [], []);
  const [selected, setSelected] = useState<LayersListItem[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [runtimes, setRuntimes] = useState<MultiselectProps.Option[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name) return setError("Name is required.");
    if (files.length === 0) return setError("Choose a .zip file.");
    setBusy(true);
    try {
      await lambda.send(
        new PublishLayerVersionCommand({
          LayerName: name,
          Description: description || undefined,
          Content: { ZipFile: new Uint8Array(await files[0].arrayBuffer()) },
          CompatibleRuntimes: runtimes.length ? (runtimes.map((r) => r.value) as Runtime[]) : undefined,
        }),
      );
      notify.success(`Successfully created layer ${name}.`);
      setCreating(false);
      setName("");
      setFiles([]);
      layers.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const l of selected) {
        await lambda.send(new DeleteLayerVersionCommand({ LayerName: l.LayerName, VersionNumber: l.LatestMatchingVersion?.Version }));
      }
      notify.success("Deleted the latest version of the selected layers.");
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the layer version", e);
    }
    setDeleting(false);
    layers.reload();
  };

  return (
    <Shell service="lambda" contentType="table" breadcrumbs={[{ text: "Lambda", href: "/lambda/home" }, { text: "Layers", href: "/lambda/layers" }]}>
      <ResourceTable
        title="Layers"
        description="Layers hold libraries and other dependencies that functions share."
        resourceName="layers"
        items={layers.data}
        loading={layers.loading}
        error={layers.error}
        onRefresh={() => layers.reload()}
        trackBy={(l) => l.LayerName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setCreating(true)}>Create layer</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create layer
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (l) => l.LayerName, sortingField: "LayerName", isRowHeader: true },
          { id: "version", header: "Version", cell: (l) => l.LatestMatchingVersion?.Version ?? "-" },
          { id: "description", header: "Description", cell: (l) => l.LatestMatchingVersion?.Description || "-" },
          { id: "runtimes", header: "Compatible runtimes", cell: (l) => l.LatestMatchingVersion?.CompatibleRuntimes?.join(", ") || "-" },
          { id: "created", header: "Created", cell: (l) => formatDate(l.LatestMatchingVersion?.CreatedDate) },
          { id: "arn", header: "Version ARN", cell: (l) => l.LatestMatchingVersion?.LayerVersionArn ?? "-" },
        ]}
      />
      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create layer"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Name" errorText={error}>
            <Input value={name} autoFocus onChange={(e) => setName(e.detail.value)} />
          </FormField>
          <FormField label="Description - optional">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
          <FormField label="Upload a .zip file">
            <FileUpload
              value={files}
              onChange={(e) => setFiles(e.detail.value)}
              accept=".zip"
              showFileSize
              i18nStrings={{
                uploadButtonText: () => "Upload",
                dropzoneText: () => "Drop file to upload",
                removeFileAriaLabel: (i) => `Remove file ${i + 1}`,
                limitShowFewer: "Show fewer files",
                limitShowMore: "Show more files",
                errorIconAriaLabel: "Error",
              }}
            />
          </FormField>
          <FormField label="Compatible runtimes - optional">
            <Multiselect selectedOptions={runtimes} options={RUNTIMES.map((r) => ({ value: r.value, label: r.label }))} onChange={(e) => setRuntimes([...e.detail.selectedOptions])} placeholder="Runtimes" />
          </FormField>
        </SpaceBetween>
      </Modal>
      <ConfirmDelete visible={deleting} title="Delete layer version" onCancel={() => setDeleting(false)} onConfirm={remove} warning="This deletes the latest version of each selected layer.">
        <Box>{selected.map((l) => l.LayerName).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
