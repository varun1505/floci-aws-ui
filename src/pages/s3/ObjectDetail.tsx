import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { getRegion, s3 } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { download, formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { bucketHref, objectHref, prefixCrumbs } from "./s3util";

const PREVIEW_LIMIT = 512 * 1024;

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children}</div>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  return <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;
}

export default function ObjectDetail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const bucket = params.get("bucket") ?? "";
  const key = params.get("key") ?? "";
  const name = key.split("/").pop() ?? key;
  const prefix = key.slice(0, key.length - name.length);
  const [deleting, setDeleting] = useState(false);

  const head = useLoad(() => s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })), [bucket, key]);

  const type = head.data?.ContentType ?? "";
  const size = head.data?.ContentLength ?? 0;
  const isImage = type.startsWith("image/");
  const isText = /^text\/|json|xml|yaml|javascript|x-sh|csv/.test(type) || /\.(txt|md|json|ya?ml|csv|log|py|js|ts|html|css|xml|sh|ini|toml|env)$/i.test(name);

  const preview = useLoad(async () => {
    if (!head.data || size > PREVIEW_LIMIT || (!isImage && !isText)) return undefined;
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    if (isImage) return { image: URL.createObjectURL(new Blob([bytes as BlobPart], { type })) };
    return { text: new TextDecoder().decode(bytes) };
  }, [bucket, key, head.data?.ETag]);

  const get = async () => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { bytes: await res.Body!.transformToByteArray(), type: res.ContentType };
  };

  const run = async (kind: "download" | "open") => {
    try {
      const o = await get();
      if (kind === "download") download(o.bytes, name, o.type);
      else window.open(URL.createObjectURL(new Blob([o.bytes as BlobPart], { type: o.type })), "_blank");
    } catch (e) {
      notify.error("Could not read the object", e);
    }
  };

  const remove = async () => {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      notify.success(`Successfully deleted "${name}".`);
      navigate(bucketHref(bucket, prefix));
    } catch (e) {
      notify.error("Could not delete the object", e);
      setDeleting(false);
    }
  };

  const metadata = Object.entries(head.data?.Metadata ?? {});

  return (
    <Shell service="s3" breadcrumbs={[...prefixCrumbs(bucket, prefix), { text: name, href: objectHref(bucket, key) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => navigator.clipboard?.writeText(`s3://${bucket}/${key}`).then(() => notify.info("S3 URI copied."))}>Copy S3 URI</Button>
                <Button onClick={() => run("download")}>Download</Button>
                <Button iconName="external" iconAlign="right" onClick={() => run("open")}>
                  Open
                </Button>
                <Button onClick={() => setDeleting(true)}>Delete</Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {head.error ? (
          <Alert type="error" header="Could not load the object">
            {head.error}
          </Alert>
        ) : !head.data ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Object overview</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <SpaceBetween size="l">
                  <Pair label="Owner">non-prod</Pair>
                  <Pair label="AWS Region">{getRegion()}</Pair>
                  <Pair label="Last modified">{formatDate(head.data.LastModified)}</Pair>
                  <Pair label="Size">{formatBytes(size)}</Pair>
                  <Pair label="Type">{type || "-"}</Pair>
                  <Pair label="Key">
                    <Copy text={key} />
                  </Pair>
                </SpaceBetween>
                <SpaceBetween size="l">
                  <Pair label="S3 URI">
                    <Copy text={`s3://${bucket}/${key}`} />
                  </Pair>
                  <Pair label="Amazon Resource Name (ARN)">
                    <Copy text={`arn:aws:s3:::${bucket}/${key}`} />
                  </Pair>
                  <Pair label="Entity tag (Etag)">
                    <Copy text={(head.data.ETag ?? "").replace(/"/g, "")} />
                  </Pair>
                  <Pair label="Storage class">{head.data.StorageClass ?? "Standard"}</Pair>
                </SpaceBetween>
              </ColumnLayout>
            </Container>
            {metadata.length > 0 && (
              <Container header={<Header variant="h2">Metadata</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  {metadata.map(([k, v]) => (
                    <Pair key={k} label={`x-amz-meta-${k}`}>
                      {v}
                    </Pair>
                  ))}
                </ColumnLayout>
              </Container>
            )}
            <Container header={<Header variant="h2">Preview</Header>}>
              {preview.loading ? (
                <Spinner />
              ) : preview.data?.image ? (
                <img src={preview.data.image} alt={name} style={{ maxWidth: "100%", maxHeight: 480 }} />
              ) : preview.data?.text !== undefined ? (
                <pre style={{ margin: 0, maxHeight: 480, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>{preview.data.text}</pre>
              ) : (
                <Box color="text-status-inactive">
                  {size > PREVIEW_LIMIT ? "This object is too large to preview. Download it instead." : "No preview is available for this file type."}
                </Box>
              )}
            </Container>
          </SpaceBetween>
        )}
      </ContentLayout>
      <ConfirmDelete
        visible={deleting}
        title="Delete object"
        confirmText="permanently delete"
        actionLabel="Delete object"
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting the specified object can't be undone."
      />
    </Shell>
  );
}
