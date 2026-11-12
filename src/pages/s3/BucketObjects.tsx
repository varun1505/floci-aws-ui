import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Icon from "@cloudscape-design/components/icon";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { s3 } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { download, errorMessage, formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { bucketHref, deleteKeys, listAllKeys, objectHref, prefixCrumbs } from "./s3util";

type Row = {
  key: string;
  name: string;
  folder: boolean;
  size?: number;
  lastModified?: Date;
  storageClass?: string;
};

const FILE_I18N = {
  uploadButtonText: (multiple: boolean) => (multiple ? "Add files" : "Add file"),
  dropzoneText: (multiple: boolean) => (multiple ? "Drop files to upload" : "Drop file to upload"),
  removeFileAriaLabel: (i: number) => `Remove file ${i + 1}`,
  limitShowFewer: "Show fewer files",
  limitShowMore: "Show more files",
  errorIconAriaLabel: "Error",
};

export default function BucketObjects() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const bucket = params.get("name") ?? "";
  const prefix = params.get("prefix") ?? "";

  const [selected, setSelected] = useState<Row[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [busy, setBusy] = useState(false);

  const objects = useLoad(async () => {
    const rows: Row[] = [];
    let ContinuationToken: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, Delimiter: "/", ContinuationToken }));
      for (const p of res.CommonPrefixes ?? []) {
        if (p.Prefix) rows.push({ key: p.Prefix, name: p.Prefix.slice(prefix.length), folder: true });
      }
      for (const o of res.Contents ?? []) {
        // The folder's own placeholder object has the same key as the prefix. Do not list it.
        if (!o.Key || o.Key === prefix) continue;
        rows.push({ key: o.Key, name: o.Key.slice(prefix.length), folder: false, size: o.Size, lastModified: o.LastModified, storageClass: o.StorageClass });
      }
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
    setSelected([]);
    return rows;
  }, [bucket, prefix]);

  const upload = async () => {
    if (files.length === 0) return;
    setUploadError("");
    setProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: prefix + f.name,
            Body: new Uint8Array(await f.arrayBuffer()),
            ContentType: f.type || "application/octet-stream",
          }),
        );
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      notify.success(`Upload succeeded. ${files.length} file${files.length === 1 ? "" : "s"} uploaded.`);
      setUploading(false);
      setFiles([]);
      objects.reload();
    } catch (e) {
      setUploadError(errorMessage(e));
    }
    setProgress(null);
  };

  const createFolder = async () => {
    const clean = folderName.trim().replace(/\/+$/, "");
    if (!clean) return setFolderError("Folder name is required.");
    if (clean.includes("/")) return setFolderError('Folder names can\'t contain "/".');
    setBusy(true);
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${clean}/`, Body: new Uint8Array(0) }));
      notify.success(`Successfully created folder "${clean}".`);
      setFolderOpen(false);
      setFolderName("");
      objects.reload();
    } catch (e) {
      setFolderError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      const keys: string[] = [];
      for (const row of selected) {
        if (row.folder) keys.push(...(await listAllKeys(bucket, row.key)));
        else keys.push(row.key);
      }
      await deleteKeys(bucket, keys);
      notify.success(`Successfully deleted ${keys.length} object${keys.length === 1 ? "" : "s"}.`);
    } catch (e) {
      notify.error("Could not delete objects", e);
    }
    setDeleting(false);
    objects.reload();
  };

  const fetchObject = async (row: Row) => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.key }));
    return { bytes: await res.Body!.transformToByteArray(), type: res.ContentType };
  };

  const act = async (id: string) => {
    const row = selected[0];
    try {
      if (id === "uri") {
        await navigator.clipboard?.writeText(`s3://${bucket}/${row.key}`);
        notify.info("S3 URI copied.");
      } else if (id === "download") {
        for (const r of selected.filter((s) => !s.folder)) {
          const o = await fetchObject(r);
          download(o.bytes, r.name, o.type);
        }
      } else if (id === "open") {
        const o = await fetchObject(row);
        window.open(URL.createObjectURL(new Blob([o.bytes as BlobPart], { type: o.type })), "_blank");
      } else if (id === "delete") {
        setDeleting(true);
      }
    } catch (e) {
      notify.error("The action failed", e);
    }
  };

  const onlyFiles = selected.length > 0 && selected.every((s) => !s.folder);
  const title = prefix ? prefix.split("/").filter(Boolean).pop() + "/" : bucket;

  return (
    <Shell service="s3" contentType="table" breadcrumbs={prefixCrumbs(bucket, prefix)}>
      <ResourceTable
        title={title}
        description="Objects are the fundamental entities stored in Amazon S3."
        resourceName="objects"
        filterPlaceholder="Find objects by prefix"
        items={objects.data}
        loading={objects.loading}
        error={objects.error}
        onRefresh={() => objects.reload()}
        trackBy={(r) => r.key}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setUploading(true)}>Upload</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => act("uri")}>
              Copy S3 URI
            </Button>
            <Button disabled={!onlyFiles} onClick={() => act("download")}>
              Download
            </Button>
            <Button disabled={selected.length !== 1 || !onlyFiles} iconName="external" iconAlign="right" onClick={() => act("open")}>
              Open
            </Button>
            <Button disabled={selected.length === 0} onClick={() => act("delete")}>
              Delete
            </Button>
            <ButtonDropdown
              items={[{ id: "bucket", text: "View all buckets" }]}
              onItemClick={() => navigate("/s3/buckets")}
            >
              Actions
            </ButtonDropdown>
            <Button onClick={() => setFolderOpen(true)}>Create folder</Button>
            <Button variant="primary" iconName="upload" onClick={() => setUploading(true)}>
              Upload
            </Button>
          </>
        }
        columns={[
          {
            id: "name",
            header: "Name",
            cell: (r) => (
              <SpaceBetween direction="horizontal" size="xxs">
                <Icon name={r.folder ? "folder" : "file"} />
                <RouterLink to={r.folder ? bucketHref(bucket, r.key) : objectHref(bucket, r.key)}>{r.name}</RouterLink>
              </SpaceBetween>
            ),
            sortingField: "name",
            isRowHeader: true,
          },
          { id: "type", header: "Type", cell: (r) => (r.folder ? "Folder" : r.name.includes(".") ? r.name.split(".").pop() : "-") },
          { id: "modified", header: "Last modified", cell: (r) => formatDate(r.lastModified), sortingField: "lastModified" },
          { id: "size", header: "Size", cell: (r) => (r.folder ? "-" : formatBytes(r.size)), sortingField: "size" },
          { id: "class", header: "Storage class", cell: (r) => (r.folder ? "-" : (r.storageClass ?? "Standard")) },
        ]}
      />

      <Modal
        visible={uploading}
        onDismiss={() => progress === null && setUploading(false)}
        header="Upload"
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={progress !== null} onClick={() => setUploading(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={files.length === 0} loading={progress !== null} onClick={upload}>
                Upload
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField
            label="Files"
            description={`Destination: s3://${bucket}/${prefix}`}
            errorText={uploadError}
            stretch
          >
            <FileUpload value={files} onChange={(e) => setFiles(e.detail.value)} multiple showFileSize showFileLastModified tokenLimit={5} i18nStrings={FILE_I18N} />
          </FormField>
          {progress !== null && <ProgressBar value={progress} label="Uploading" />}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={folderOpen}
        onDismiss={() => setFolderOpen(false)}
        header="Create folder"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setFolderOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={createFolder}>
                Create folder
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label="Folder name" constraintText={'Folder names can\'t contain "/".'} errorText={folderError}>
          <Input
            value={folderName}
            placeholder="Enter folder name"
            autoFocus
            onChange={(e) => {
              setFolderName(e.detail.value);
              setFolderError("");
            }}
            onKeyDown={(e) => e.detail.key === "Enter" && createFolder()}
          />
        </FormField>
      </Modal>

      <ConfirmDelete
        visible={deleting}
        title="Delete objects"
        confirmText="permanently delete"
        actionLabel="Delete objects"
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting the specified objects can't be undone. Deleting a folder deletes every object inside it."
      >
        <Box>
          {selected.length} item{selected.length === 1 ? "" : "s"} selected: {selected.slice(0, 5).map((s) => s.name).join(", ")}
          {selected.length > 5 ? ", ..." : ""}
        </Box>
      </ConfirmDelete>
    </Shell>
  );
}
