import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { ACCOUNT_ID, getRegion } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { STATE_VERB, changeState } from "./Instances";
import { InstanceState, Pair, TRANSITIONAL, listInstances, tagName } from "./ec2util";

export default function InstanceDetail() {
  const { id = "" } = useParams();
  const notify = useNotify();
  const [terminating, setTerminating] = useState(false);
  const instance = useLoad(async () => {
    const found = (await listInstances([id]))[0];
    if (!found) throw new Error(`The instance ID '${id}' does not exist.`);
    return found;
  }, [id]);
  const i = instance.data;
  const state = i?.State?.Name ?? "";

  useEffect(() => {
    if (!TRANSITIONAL.includes(state)) return;
    const timer = setInterval(() => instance.reload(true), 2500);
    return () => clearInterval(timer);
  }, [state, instance.reload]);

  const run = async (action: string) => {
    try {
      await changeState(action, [id]);
      notify.success(`${STATE_VERB[action]} ${id}.`);
    } catch (e) {
      notify.error(`Could not ${action} the instance`, e);
    }
    setTerminating(false);
    instance.reload(true);
    // The emulator can take a moment to report the new state. Check again shortly.
    setTimeout(() => instance.reload(true), 2000);
    setTimeout(() => instance.reload(true), 6000);
  };

  const name = tagName(i?.Tags);
  const arn = `arn:aws:ec2:${getRegion()}:${ACCOUNT_ID}:instance/${id}`;

  return (
    <Shell
      service="ec2"
      breadcrumbs={[
        { text: "EC2", href: "/ec2/instances" },
        { text: "Instances", href: "/ec2/instances" },
        { text: id, href: `/ec2/instances/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => instance.reload()} />
                <ButtonDropdown
                  disabled={!i}
                  items={[
                    { id: "stop", text: "Stop instance", disabled: state !== "running" },
                    { id: "start", text: "Start instance", disabled: state !== "stopped" },
                    { id: "reboot", text: "Reboot instance", disabled: state !== "running" },
                    { id: "terminate", text: "Terminate (delete) instance", disabled: state === "terminated" || state === "shutting-down" },
                  ]}
                  onItemClick={(e) => (e.detail.id === "terminate" ? setTerminating(true) : run(e.detail.id))}
                >
                  Instance state
                </ButtonDropdown>
              </SpaceBetween>
            }
          >
            Instance summary for {id}
            {name ? ` (${name})` : ""}
          </Header>
        }
      >
        {instance.error ? (
          <Alert type="error" header="Could not load the instance">
            {instance.error}
          </Alert>
        ) : !i ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container>
              <ColumnLayout columns={3} variant="text-grid">
                <SpaceBetween size="l">
                  <Pair label="Instance ID">
                    <CopyToClipboard variant="inline" textToCopy={id} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />
                  </Pair>
                  <Pair label="Instance state">
                    <InstanceState state={state} />
                  </Pair>
                  <Pair label="Instance type">{i.InstanceType}</Pair>
                </SpaceBetween>
                <SpaceBetween size="l">
                  <Pair label="Public IPv4 address">{i.PublicIpAddress}</Pair>
                  <Pair label="Private IPv4 addresses">{i.PrivateIpAddress}</Pair>
                  <Pair label="Private IP DNS name (IPv4 only)">{i.PrivateDnsName}</Pair>
                </SpaceBetween>
                <SpaceBetween size="l">
                  <Pair label="VPC ID">{i.VpcId}</Pair>
                  <Pair label="Subnet ID">{i.SubnetId}</Pair>
                  <Pair label="Instance ARN">
                    <CopyToClipboard variant="inline" textToCopy={arn} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />
                  </Pair>
                </SpaceBetween>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "details",
                  label: "Details",
                  content: (
                    <Container header={<Header variant="h2">Instance details</Header>}>
                      <ColumnLayout columns={3} variant="text-grid">
                        <Pair label="Platform details">{i.PlatformDetails}</Pair>
                        <Pair label="AMI ID">{i.ImageId}</Pair>
                        <Pair label="Monitoring">{i.Monitoring?.State}</Pair>
                        <Pair label="Launch time">{formatDate(i.LaunchTime)}</Pair>
                        <Pair label="Key pair assigned at launch">{i.KeyName}</Pair>
                        <Pair label="Architecture">{i.Architecture}</Pair>
                        <Pair label="Availability Zone">{i.Placement?.AvailabilityZone}</Pair>
                        <Pair label="Virtualization type">{i.VirtualizationType}</Pair>
                        <Pair label="Root device name">{i.RootDeviceName}</Pair>
                        <Pair label="Number of vCPUs">{(i.CpuOptions?.CoreCount ?? 0) * (i.CpuOptions?.ThreadsPerCore ?? 1) || undefined}</Pair>
                        <Pair label="Owner">{ACCOUNT_ID}</Pair>
                        <Pair label="State transition reason">{i.StateTransitionReason}</Pair>
                      </ColumnLayout>
                    </Container>
                  ),
                },
                {
                  id: "security",
                  label: "Security",
                  content: (
                    <Table
                      header={<Header variant="h2" counter={`(${i.SecurityGroups?.length ?? 0})`}>Security groups</Header>}
                      items={i.SecurityGroups ?? []}
                      columnDefinitions={[
                        {
                          id: "id",
                          header: "Security group ID",
                          cell: (g) => <RouterLink to={`/ec2/security-groups/${g.GroupId}`}>{g.GroupId}</RouterLink>,
                          isRowHeader: true,
                        },
                        { id: "name", header: "Security group name", cell: (g) => g.GroupName },
                      ]}
                      empty={<Box textAlign="center">No security groups</Box>}
                    />
                  ),
                },
                {
                  id: "networking",
                  label: "Networking",
                  content: (
                    <Container header={<Header variant="h2">Networking details</Header>}>
                      <ColumnLayout columns={3} variant="text-grid">
                        <Pair label="Public IPv4 address">{i.PublicIpAddress}</Pair>
                        <Pair label="Private IPv4 addresses">{i.PrivateIpAddress}</Pair>
                        <Pair label="VPC ID">{i.VpcId}</Pair>
                        <Pair label="Public IPv4 DNS">{i.PublicDnsName}</Pair>
                        <Pair label="Private IP DNS name (IPv4 only)">{i.PrivateDnsName}</Pair>
                        <Pair label="Subnet ID">{i.SubnetId}</Pair>
                        <Pair label="Availability Zone">{i.Placement?.AvailabilityZone}</Pair>
                        <Pair label="Source / destination check">{i.SourceDestCheck === undefined ? undefined : String(i.SourceDestCheck)}</Pair>
                      </ColumnLayout>
                    </Container>
                  ),
                },
                {
                  id: "tags",
                  label: "Tags",
                  content: (
                    <Table
                      header={<Header variant="h2" counter={`(${i.Tags?.length ?? 0})`}>Tags</Header>}
                      items={i.Tags ?? []}
                      columnDefinitions={[
                        { id: "key", header: "Key", cell: (t) => t.Key, isRowHeader: true },
                        { id: "value", header: "Value", cell: (t) => t.Value },
                      ]}
                      empty={<Box textAlign="center">No tags</Box>}
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      <ConfirmDelete
        visible={terminating}
        title="Terminate (delete) instance?"
        confirmText="terminate"
        actionLabel="Terminate (delete)"
        onCancel={() => setTerminating(false)}
        onConfirm={() => run("terminate")}
        warning="Storage on any local drives will be lost."
      >
        <Box>{id}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
