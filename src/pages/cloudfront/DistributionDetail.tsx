import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CreateInvalidationCommand,
  DeleteDistributionCommand,
  GetDistributionCommand,
  GetDistributionConfigCommand,
  ListInvalidationsCommand,
} from "@aws-sdk/client-cloudfront";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import { cloudfront } from "../../clients/cloudfront";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { EnabledStatus, POLICY_LABEL, Pair, setEnabled } from "./cfutil";

const copy = (text: string) => <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;

export default function DistributionDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const dist = useLoad(async () => (await cloudfront.send(new GetDistributionCommand({ Id: id }))).Distribution, [id]);
  const invalidations = useLoad(async () => (await cloudfront.send(new ListInvalidationsCommand({ DistributionId: id }))).InvalidationList?.Items ?? [], [id]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const [paths, setPaths] = useState("/*");
  const [pathError, setPathError] = useState("");

  const d = dist.data;
  const cfg = d?.DistributionConfig;
  const enabled = cfg?.Enabled;

  const toggle = async () => {
    setBusy(true);
    try {
      await setEnabled(id, !enabled);
      notify.success(`${enabled ? "Disabled" : "Enabled"} ${id}.`);
    } catch (e) {
      notify.error("Could not update the distribution", e);
    }
    setBusy(false);
    dist.reload(true);
  };

  const remove = async () => {
    try {
      const current = await cloudfront.send(new GetDistributionConfigCommand({ Id: id }));
      await cloudfront.send(new DeleteDistributionCommand({ Id: id, IfMatch: current.ETag }));
      notify.success(`Successfully deleted ${id}.`);
      navigate("/cloudfront/distributions");
    } catch (e) {
      notify.error("Could not delete the distribution", e);
      setDeleting(false);
    }
  };

  const invalidate = async () => {
    const items = paths.split("\n").map((p) => p.trim()).filter(Boolean);
    if (items.length === 0) return setPathError("Enter at least one path.");
    if (items.some((p) => !p.startsWith("/"))) return setPathError("Each path must start with a slash (/).");
    setBusy(true);
    try {
      await cloudfront.send(
        new CreateInvalidationCommand({
          DistributionId: id,
          InvalidationBatch: { CallerReference: `console-${Date.now()}`, Paths: { Quantity: items.length, Items: items } },
        }),
      );
      notify.success("Successfully created the invalidation.");
      setInvalidating(false);
      invalidations.reload();
    } catch (e) {
      setPathError(errorMessage(e));
    }
    setBusy(false);
  };

  const behaviors = cfg
    ? [
        { pattern: "Default (*)", ...cfg.DefaultCacheBehavior },
        ...(cfg.CacheBehaviors?.Items ?? []).map((b) => ({ pattern: b.PathPattern ?? "", ...b })),
      ]
    : [];

  return (
    <Shell
      service="cloudfront"
      breadcrumbs={[
        { text: "CloudFront", href: "/cloudfront/distributions" },
        { text: "Distributions", href: "/cloudfront/distributions" },
        { text: id, href: `/cloudfront/distributions/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (dist.reload(), invalidations.reload())} />
                <Button disabled={!d} loading={busy} onClick={toggle}>
                  {enabled ? "Disable" : "Enable"}
                </Button>
                <Button disabled={!d || enabled} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {id}
          </Header>
        }
      >
        {dist.error ? (
          <Alert type="error" header="Could not load the distribution">
            {dist.error}
          </Alert>
        ) : !d || !cfg ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            {enabled && (
              <Alert type="info">To delete this distribution, disable it first.</Alert>
            )}
            <Tabs
              tabs={[
                {
                  id: "general",
                  label: "General",
                  content: (
                    <SpaceBetween size="l">
                      <Container header={<Header variant="h2">Details</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                          <Pair label="Distribution domain name">{d.DomainName && copy(d.DomainName)}</Pair>
                          <Pair label="ARN">{d.ARN && copy(d.ARN)}</Pair>
                          <Pair label="Last modified">{formatDate(d.LastModifiedTime)}</Pair>
                          <Pair label="Status">
                            <EnabledStatus enabled={enabled} />
                          </Pair>
                          <Pair label="Deployment">{d.Status}</Pair>
                        </ColumnLayout>
                      </Container>
                      <Container header={<Header variant="h2">Settings</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                          <Pair label="Description">{cfg.Comment}</Pair>
                          <Pair label="Price class">{cfg.PriceClass}</Pair>
                          <Pair label="Supported HTTP versions">{cfg.HttpVersion}</Pair>
                          <Pair label="Alternate domain names">{cfg.Aliases?.Items?.join(", ")}</Pair>
                          <Pair label="Default root object">{cfg.DefaultRootObject}</Pair>
                          <Pair label="IPv6">{cfg.IsIPV6Enabled === undefined ? undefined : cfg.IsIPV6Enabled ? "On" : "Off"}</Pair>
                        </ColumnLayout>
                      </Container>
                    </SpaceBetween>
                  ),
                },
                {
                  id: "origins",
                  label: "Origins",
                  content: (
                    <Table
                      header={<Header variant="h2" counter={`(${cfg.Origins?.Items?.length ?? 0})`}>Origins</Header>}
                      items={cfg.Origins?.Items ?? []}
                      columnDefinitions={[
                        { id: "name", header: "Origin name", cell: (o) => o.Id, isRowHeader: true },
                        { id: "domain", header: "Origin domain", cell: (o) => o.DomainName },
                        { id: "path", header: "Origin path", cell: (o) => o.OriginPath || "-" },
                        { id: "type", header: "Origin type", cell: (o) => (o.S3OriginConfig ? "S3" : "Custom origin") },
                      ]}
                      empty={<Box textAlign="center">No origins</Box>}
                    />
                  ),
                },
                {
                  id: "behaviors",
                  label: "Behaviors",
                  content: (
                    <Table
                      header={<Header variant="h2" counter={`(${behaviors.length})`}>Behaviors</Header>}
                      items={behaviors}
                      columnDefinitions={[
                        { id: "pattern", header: "Path pattern", cell: (b) => b.pattern, isRowHeader: true },
                        { id: "origin", header: "Origin or origin group", cell: (b) => b.TargetOriginId ?? "-" },
                        { id: "policy", header: "Viewer protocol policy", cell: (b) => POLICY_LABEL[b.ViewerProtocolPolicy ?? ""] ?? b.ViewerProtocolPolicy ?? "-" },
                        { id: "cache", header: "Cache policy ID", cell: (b) => b.CachePolicyId ?? "-" },
                      ]}
                      empty={<Box textAlign="center">No behaviors</Box>}
                    />
                  ),
                },
                {
                  id: "invalidations",
                  label: "Invalidations",
                  content: (
                    <Table
                      header={
                        <Header
                          variant="h2"
                          counter={`(${invalidations.data?.length ?? 0})`}
                          actions={
                            <Button
                              onClick={() => {
                                setPathError("");
                                setInvalidating(true);
                              }}
                            >
                              Create invalidation
                            </Button>
                          }
                        >
                          Invalidations
                        </Header>
                      }
                      loading={invalidations.loading}
                      loadingText="Loading invalidations"
                      items={invalidations.data ?? []}
                      columnDefinitions={[
                        { id: "id", header: "ID", cell: (i) => i.Id, isRowHeader: true },
                        { id: "status", header: "Status", cell: (i) => i.Status ?? "-" },
                        { id: "date", header: "Date", cell: (i) => formatDate(i.CreateTime) },
                      ]}
                      empty={
                        <Box textAlign="center" color="inherit">
                          <b>No invalidations</b>
                          <Box variant="p" color="inherit">
                            An invalidation removes objects from the cache before they expire.
                          </Box>
                        </Box>
                      }
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <Modal
        visible={invalidating}
        onDismiss={() => setInvalidating(false)}
        header="Create invalidation"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setInvalidating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={invalidate}>
                Create invalidation
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label="Object paths" description="One path per line. Use /* to invalidate everything." errorText={pathError}>
          <Textarea value={paths} rows={5} onChange={(e) => setPaths(e.detail.value)} spellcheck={false} />
        </FormField>
      </Modal>

      <ConfirmDelete visible={deleting} title={`Delete ${id}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a distribution cannot be undone." />
    </Shell>
  );
}
