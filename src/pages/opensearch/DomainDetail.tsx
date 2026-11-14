import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DeleteDomainCommand, DescribeDomainCommand, type OpenSearchPartitionInstanceType, UpdateDomainConfigCommand } from "@aws-sdk/client-opensearch";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { opensearch } from "../../clients/opensearch";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair, prettyJson } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { flociHost } from "../../config";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { DomainTags } from "./DomainTags";
import { DomainState, FIRST_PORT, LAST_PORT, curlCommand, domainPhase, endpointOf, engineLabel, listInstanceTypes } from "./osutil";

const policyTemplate = (arn: string) => JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: "*" }, Action: "es:*", Resource: `${arn}/*` }] }, null, 2);

export default function DomainDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const domain = useLoad(async () => (await opensearch.send(new DescribeDomainCommand({ DomainName: name }))).DomainStatus, [name]);
  const host = useLoad(flociHost, []);
  const form = useSubmit();
  const [modal, setModal] = useState<"cluster" | "policy" | "delete" | undefined>(undefined);
  const [type, setType] = useState("");
  const [count, setCount] = useState("1");
  const [size, setSize] = useState("10");
  const [policy, setPolicy] = useState("");
  const d = domain.data;
  const version = d?.EngineVersion ?? "";
  const types = useLoad(async () => (version ? listInstanceTypes(version) : []), [version]);
  const phase = d ? domainPhase(d) : undefined;
  const endpoint = d ? endpointOf(d) : "";

  // Keep checking while the domain starts or changes.
  useEffect(() => {
    if (!phase || phase === "Active") return;
    const timer = setInterval(() => domain.reload(true), 5000);
    return () => clearInterval(timer);
  }, [phase, domain.reload]);

  const openCluster = () => {
    setType(d?.ClusterConfig?.InstanceType ?? "");
    setCount(String(d?.ClusterConfig?.InstanceCount ?? 1));
    setSize(String(d?.EBSOptions?.VolumeSize ?? 10));
    form.setError("");
    setModal("cluster");
  };

  const openPolicy = () => {
    setPolicy(d?.AccessPolicies ? prettyJson(d.AccessPolicies) : policyTemplate(d?.ARN ?? ""));
    form.setError("");
    setModal("policy");
  };

  const saveCluster = async () => {
    const instances = Number(count);
    const volume = Number(size);
    if (!(Number.isInteger(instances) && instances >= 1 && instances <= 80)) return form.setError("Enter a number of nodes from 1 to 80.");
    if (!(Number.isInteger(volume) && volume >= 10 && volume <= 3584)) return form.setError("Enter an EBS volume size from 10 to 3584 GiB.");
    const ok = await form.run(async () => {
      await opensearch.send(
        new UpdateDomainConfigCommand({
          DomainName: name,
          ClusterConfig: { InstanceType: type as OpenSearchPartitionInstanceType, InstanceCount: instances },
          EBSOptions: { EBSEnabled: true, VolumeType: d?.EBSOptions?.VolumeType ?? "gp2", VolumeSize: volume },
        }),
      );
      notify.success(`The cluster configuration of ${name} was updated.`);
      domain.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const savePolicy = async () => {
    let compact = "";
    try {
      compact = JSON.stringify(JSON.parse(policy));
    } catch {
      return form.setError("The access policy is not valid JSON.");
    }
    const ok = await form.run(async () => {
      await opensearch.send(new UpdateDomainConfigCommand({ DomainName: name, AccessPolicies: compact }));
      notify.success(`The access policy of ${name} was updated.`);
      domain.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      await opensearch.send(new DeleteDomainCommand({ DomainName: name }));
      notify.success(`Domain ${name} was deleted.`);
      navigate("/opensearch/domains");
    } catch (e) {
      notify.error("Could not delete the domain", e);
      setModal(undefined);
    }
  };

  return (
    <Shell
      service="opensearch"
      breadcrumbs={[
        { text: "Amazon OpenSearch Service", href: "/opensearch/domains" },
        { text: "Domains", href: "/opensearch/domains" },
        { text: name, href: `/opensearch/domains/${name}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => domain.reload()} />
                <Button disabled={!d} onClick={() => setModal("delete")}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {domain.error ? (
          <Alert type="error" header="Could not load the domain">
            {domain.error}
          </Alert>
        ) : !d ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            {phase === "Loading" && <Alert type="info">floci is starting the OpenSearch container of this domain. The page updates when it is ready.</Alert>}
            <Container header={<Header variant="h2">General information</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Name">{d.DomainName}</Pair>
                <Pair label="Domain processing status">
                  <DomainState domain={d} />
                </Pair>
                <Pair label="Version">{engineLabel(d.EngineVersion)}</Pair>
                <Pair label="Domain ARN">
                  <Copy text={d.ARN} />
                </Pair>
                <Pair label="Domain ID">{d.DomainId}</Pair>
                <Pair label="Domain endpoint">
                  <Copy text={endpoint} />
                </Pair>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2" description="Run this from your own machine.">Connect</Header>}>
              <SpaceBetween size="s">
                <Box variant="code">
                  <Copy text={curlCommand(host.data ?? "")} />
                </Box>
                <ColumnLayout columns={3} variant="text-grid">
                  <Pair label="Host for external clients">
                    <Copy text={host.data || undefined} />
                  </Pair>
                  <Pair label="Port">
                    {FIRST_PORT} to {LAST_PORT}
                  </Pair>
                  <Pair label="Security">Plain HTTP. No user name or password.</Pair>
                </ColumnLayout>
                <Box variant="small" color="text-body-secondary">
                  The domain endpoint above is an address inside the floci host. From outside, use the host name and a port. floci gives each domain one port from {FIRST_PORT} to {LAST_PORT}, and the
                  first domain gets {FIRST_PORT}. The API does not say which port a domain has. If you run more than one domain, try the next ports.
                </Box>
              </SpaceBetween>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "cluster",
                  label: "Cluster configuration",
                  content: (
                    <Container
                      header={
                        <Header variant="h2" description="floci stores these values. It still runs one container for the domain." actions={<Button onClick={openCluster}>Edit</Button>}>
                          Cluster configuration
                        </Header>
                      }
                    >
                      <ColumnLayout columns={3} variant="text-grid">
                        <Pair label="Instance type">{d.ClusterConfig?.InstanceType}</Pair>
                        <Pair label="Number of nodes">{String(d.ClusterConfig?.InstanceCount ?? "-")}</Pair>
                        <Pair label="Dedicated master nodes">{d.ClusterConfig?.DedicatedMasterEnabled ? `${d.ClusterConfig.DedicatedMasterCount ?? ""} ${d.ClusterConfig.DedicatedMasterType ?? ""}`.trim() || "Enabled" : "Disabled"}</Pair>
                        <Pair label="Zone awareness">{d.ClusterConfig?.ZoneAwarenessEnabled ? "Enabled" : "Disabled"}</Pair>
                        <Pair label="Storage type">{d.EBSOptions?.EBSEnabled ? "EBS" : "Instance store"}</Pair>
                        <Pair label="EBS volume type">{d.EBSOptions?.VolumeType}</Pair>
                        <Pair label="EBS storage size per node">{d.EBSOptions?.VolumeSize ? `${d.EBSOptions.VolumeSize} GiB` : undefined}</Pair>
                      </ColumnLayout>
                    </Container>
                  ),
                },
                {
                  id: "security",
                  label: "Security configuration",
                  content: (
                    <SpaceBetween size="l">
                      <Alert type="info">floci stores the access policy but does not check it. Anyone who can reach the port can read and write the domain.</Alert>
                      <Container
                        header={
                          <Header variant="h2" actions={<Button onClick={openPolicy}>Edit</Button>}>
                            Access policy
                          </Header>
                        }
                      >
                        {d.AccessPolicies ? <JsonBlock value={d.AccessPolicies} /> : <Box color="text-body-secondary">No access policy.</Box>}
                      </Container>
                    </SpaceBetween>
                  ),
                },
                { id: "tags", label: "Tags", content: <DomainTags arn={d.ARN ?? ""} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "cluster"} header="Edit cluster configuration" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveCluster}>
        <FormField label="Instance type">
          <Select
            selectedOption={type ? { value: type, label: type } : null}
            onChange={(e) => setType(e.detail.selectedOption.value ?? type)}
            options={(types.data?.length ? types.data : [type]).map((t) => ({ value: t, label: t }))}
            statusType={types.loading ? "loading" : "finished"}
            filteringType="auto"
          />
        </FormField>
        <FormField label="Number of nodes">
          <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
        </FormField>
        <FormField label="EBS storage size per node (GiB)" constraintText="From 10 to 3584.">
          <Input type="number" value={size} onChange={(e) => setSize(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "policy"} size="large" header="Edit access policy" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={savePolicy}>
        <FormField label="Access policy" description="A JSON policy document." stretch>
          {modal === "policy" && <Code value={policy} onChange={setPolicy} language="json" height={320} ariaLabel="Access policy" />}
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title={`Delete ${name}?`} onCancel={() => setModal(undefined)} onConfirm={remove}>
        This deletes the domain and all of its data. floci stops the container. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
