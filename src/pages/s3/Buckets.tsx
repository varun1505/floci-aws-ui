import { useState } from "react";
import { CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand, type Bucket } from "@aws-sdk/client-s3";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { getRegion } from "../../config";
import { s3 } from "../../clients/s3";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { bucketHref, deleteKeys, listAllKeys } from "./s3util";

export default function Buckets() {
  const notify = useNotify();
  const buckets = useLoad(async () => (await s3.send(new ListBucketsCommand({}))).Buckets ?? [], []);
  const [selected, setSelected] = useState<Bucket[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"delete" | "empty" | null>(null);
  const one = selected[0]?.Name ?? "";

  const nameError = !name
    ? "Bucket name is required."
    : !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)
      ? "Bucket name must be 3 to 63 characters and can contain only lowercase letters, numbers, dots (.), and hyphens (-)."
      : "";

  const create = async () => {
    if (nameError) return setCreateError(nameError);
    setBusy(true);
    try {
      const region = getRegion();
      await s3.send(
        new CreateBucketCommand({
          Bucket: name,
          CreateBucketConfiguration: region === "us-east-1" ? undefined : { LocationConstraint: region as never },
        }),
      );
      notify.success(`Successfully created bucket "${name}".`);
      setCreating(false);
      setName("");
      buckets.reload();
    } catch (e) {
      setCreateError(errorMessage(e));
    }
    setBusy(false);
  };

  const empty = async () => {
    try {
      const keys = await listAllKeys(one);
      await deleteKeys(one, keys);
      notify.success(`Successfully emptied bucket "${one}". Deleted ${keys.length} object${keys.length === 1 ? "" : "s"}.`);
    } catch (e) {
      notify.error("Could not empty the bucket", e);
    }
    setDialog(null);
  };

  const remove = async () => {
    try {
      await s3.send(new DeleteBucketCommand({ Bucket: one }));
      notify.success(`Successfully deleted bucket "${one}".`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the bucket", e);
    }
    setDialog(null);
    buckets.reload();
  };

  return (
    <Shell service="s3" contentType="table" breadcrumbs={[{ text: "Amazon S3", href: "/s3/buckets" }, { text: "Buckets", href: "/s3/buckets" }]}>
      <ResourceTable
        title="General purpose buckets"
        description="Buckets are containers for data stored in S3."
        resourceName="buckets"
        global
        emptyDescription="A bucket is a container for objects. Create one to start storing files."
        emptyCli="s3 mb s3://my-bucket"
        filterPlaceholder="Find buckets by name"
        items={buckets.data}
        loading={buckets.loading}
        error={buckets.error}
        onRefresh={() => buckets.reload()}
        trackBy={(b) => b.Name ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setCreating(true)}>Create bucket</Button>}
        actions={
          <>
            <Button disabled={!one} onClick={() => navigator.clipboard?.writeText(`arn:aws:s3:::${one}`).then(() => notify.info("ARN copied."))}>
              Copy ARN
            </Button>
            <Button disabled={!one} onClick={() => setDialog("empty")}>
              Empty
            </Button>
            <Button disabled={!one} onClick={() => setDialog("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create bucket
            </Button>
          </>
        }
        columns={[
          {
            id: "name",
            header: "Name",
            cell: (b) => <RouterLink to={bucketHref(b.Name ?? "")}>{b.Name}</RouterLink>,
            sortingField: "Name",
            isRowHeader: true,
          },
          { id: "region", header: "AWS Region", cell: (b) => b.BucketRegion ?? getRegion() },
          { id: "created", header: "Creation date", cell: (b) => formatDate(b.CreationDate), sortingField: "CreationDate" },
        ]}
      />

      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create bucket"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create bucket
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="AWS Region">
            <Input value={getRegion()} disabled />
          </FormField>
          <FormField
            label="Bucket name"
            constraintText="Bucket name must be unique and must not contain spaces or uppercase letters."
            errorText={createError}
          >
            <Input
              value={name}
              placeholder="myawsbucket"
              autoFocus
              onChange={(e) => {
                setName(e.detail.value);
                setCreateError("");
              }}
              onKeyDown={(e) => e.detail.key === "Enter" && create()}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={dialog === "empty"}
        title={`Empty bucket "${one}"`}
        confirmText="permanently delete"
        actionLabel="Empty"
        onCancel={() => setDialog(null)}
        onConfirm={empty}
        warning="Emptying the bucket deletes all objects in the bucket and cannot be undone."
      />
      <ConfirmDelete
        visible={dialog === "delete"}
        title={`Delete bucket "${one}"`}
        confirmText={one}
        actionLabel="Delete bucket"
        onCancel={() => setDialog(null)}
        onConfirm={remove}
        warning="Deleting a bucket cannot be undone. The bucket must be empty before you delete it."
      />
    </Shell>
  );
}
