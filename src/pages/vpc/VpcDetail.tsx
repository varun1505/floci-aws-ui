import { type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CreateTagsCommand,
  DeleteTagsCommand,
  DeleteVpcCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcAttributeCommand,
  DescribeVpcsCommand,
  ModifyVpcAttributeCommand,
  type SecurityGroup,
} from "@aws-sdk/client-ec2";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Toggle from "@cloudscape-design/components/toggle";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { State, VPC_CRUMB, explicitSubnets, isMain, listInternetGateways, listRouteTables, listSubnets, nameOrDash, routeTableOf, tagName } from "./vpcutil";

async function listSecurityGroups(vpcId: string): Promise<SecurityGroup[]> {
  const out: SecurityGroup[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }], NextToken }));
    out.push(...(res.SecurityGroups ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** A plain table inside a tab: a header with a count, rows, and an empty line. */
function TabTable<T>({ title, items, loading, error, columns, actions, empty }: { title: string; items?: T[]; loading: boolean; error?: string; columns: TableProps.ColumnDefinition<T>[]; actions?: ReactNode; empty: string }) {
  return (
    <SpaceBetween size="s">
      {error && <Alert type="error">{error}</Alert>}
      <Table
        header={
          <Header variant="h2" counter={`(${items?.length ?? 0})`} actions={actions}>
            {title}
          </Header>
        }
        loading={loading && !items}
        loadingText={`Loading ${title.toLowerCase()}`}
        items={items ?? []}
        columnDefinitions={columns}
        empty={<Box textAlign="center">{empty}</Box>}
      />
    </SpaceBetween>
  );
}

export default function VpcDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const form = useSubmit();
  const vpc = useLoad(async () => {
    const found = (await ec2.send(new DescribeVpcsCommand({ VpcIds: [id] }))).Vpcs?.[0];
    if (!found) throw new Error(`The VPC ${id} does not exist.`);
    return found;
  }, [id]);
  const dns = useLoad(async () => {
    const [hostnames, support] = await Promise.all([
      ec2.send(new DescribeVpcAttributeCommand({ VpcId: id, Attribute: "enableDnsHostnames" })),
      ec2.send(new DescribeVpcAttributeCommand({ VpcId: id, Attribute: "enableDnsSupport" })),
    ]);
    return { hostnames: !!hostnames.EnableDnsHostnames?.Value, support: !!support.EnableDnsSupport?.Value };
  }, [id]);
  const subnets = useLoad(() => listSubnets(id), [id]);
  const tables = useLoad(() => listRouteTables(id), [id]);
  const gateways = useLoad(async () => (await listInternetGateways()).filter((g) => g.Attachments?.some((a) => a.VpcId === id)), [id]);
  const groups = useLoad(() => listSecurityGroups(id), [id]);
  const [modal, setModal] = useState<"tag" | "delete" | undefined>(undefined);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");

  const v = vpc.data;
  const reloadAll = () => (vpc.reload(), dns.reload(), subnets.reload(), tables.reload(), gateways.reload(), groups.reload());

  const setDns = async (which: "hostnames" | "support", on: boolean) => {
    setBusy(which);
    try {
      // AWS takes one attribute per call.
      if (which === "hostnames") await ec2.send(new ModifyVpcAttributeCommand({ VpcId: id, EnableDnsHostnames: { Value: on } }));
      else await ec2.send(new ModifyVpcAttributeCommand({ VpcId: id, EnableDnsSupport: { Value: on } }));
      notify.success(`${which === "hostnames" ? "DNS hostnames" : "DNS resolution"} ${on ? "enabled" : "disabled"} for ${id}.`);
    } catch (e) {
      notify.error("Could not change the VPC", e);
    }
    setBusy("");
    dns.reload(true);
  };

  const addTag = async () => {
    const k = key.trim();
    if (!k) return form.setError("Enter a tag key.");
    if (k.toLowerCase().startsWith("aws:")) return form.setError("Tag keys can't start with aws:");
    if (k.length > 127 || value.length > 255) return form.setError("A key takes up to 127 characters. A value takes up to 255.");
    const ok = await form.run(async () => {
      await ec2.send(new CreateTagsCommand({ Resources: [id], Tags: [{ Key: k, Value: value }] }));
      notify.success(`Tag ${k} saved.`);
      vpc.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeTag = async (tagKey: string) => {
    setBusy(`tag:${tagKey}`);
    try {
      await ec2.send(new DeleteTagsCommand({ Resources: [id], Tags: [{ Key: tagKey }] }));
      notify.success(`Tag ${tagKey} removed.`);
    } catch (e) {
      notify.error("Could not remove the tag", e);
    }
    setBusy("");
    vpc.reload(true);
  };

  const remove = async () => {
    try {
      await ec2.send(new DeleteVpcCommand({ VpcId: id }));
      notify.success(`Deleted ${id}.`);
      navigate("/vpc/vpcs");
    } catch (e) {
      // AWS refuses to delete a VPC that still has subnets, gateways or other resources in it.
      notify.error(`Could not delete ${id}. Delete its subnets, gateways and other resources first.`, e);
      setModal(undefined);
    }
  };

  return (
    <Shell service="vpc" breadcrumbs={[VPC_CRUMB, { text: "Your VPCs", href: "/vpc/vpcs" }, { text: id, href: `/vpc/vpcs/${id}` }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={reloadAll} />
                <Button disabled={!v} onClick={() => setModal("delete")}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {tagName(v?.Tags) ? `${id} / ${tagName(v?.Tags)}` : id}
          </Header>
        }
      >
        {vpc.error ? (
          <Alert type="error" header="Could not load the VPC">
            {vpc.error}
          </Alert>
        ) : !v ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="VPC ID">
                  <Copy text={v.VpcId} />
                </Pair>
                <Pair label="State">
                  <State state={v.State} />
                </Pair>
                <Pair label="IPv4 CIDR">{v.CidrBlock}</Pair>
                <Pair label="Default VPC">{v.IsDefault ? "Yes" : "No"}</Pair>
                <Pair label="DNS hostnames">
                  {dns.data ? (
                    <Toggle checked={dns.data.hostnames} disabled={busy === "hostnames"} onChange={(e) => setDns("hostnames", e.detail.checked)}>
                      {dns.data.hostnames ? "Enabled" : "Disabled"}
                    </Toggle>
                  ) : (
                    dns.error
                  )}
                </Pair>
                <Pair label="DNS resolution">
                  {dns.data ? (
                    <Toggle checked={dns.data.support} disabled={busy === "support"} onChange={(e) => setDns("support", e.detail.checked)}>
                      {dns.data.support ? "Enabled" : "Disabled"}
                    </Toggle>
                  ) : (
                    dns.error
                  )}
                </Pair>
                <Pair label="Tenancy">{v.InstanceTenancy}</Pair>
                <Pair label="DHCP option set">{v.DhcpOptionsId}</Pair>
                <Pair label="Main route table">{tables.data?.find(isMain)?.RouteTableId}</Pair>
                <Pair label="Owner ID">
                  <Copy text={v.OwnerId} />
                </Pair>
                <Pair label="Subnets">{subnets.data ? <RouterLink to={`/vpc/subnets?vpc=${id}`}>{subnets.data.length}</RouterLink> : undefined}</Pair>
                <Pair label="Internet gateway">{gateways.data?.[0]?.InternetGatewayId ?? (gateways.data ? "None" : undefined)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "subnets",
                  label: "Subnets",
                  content: (
                    <TabTable
                      title="Subnets"
                      items={subnets.data}
                      loading={subnets.loading}
                      error={subnets.error}
                      empty="No subnets in this VPC"
                      actions={
                        <Button href={`/vpc/subnets?vpc=${id}`} onFollow={(e) => (e.preventDefault(), navigate(`/vpc/subnets?vpc=${id}`))}>
                          Manage subnets
                        </Button>
                      }
                      columns={[
                        { id: "name", header: "Name", cell: (s) => nameOrDash(s.Tags) },
                        { id: "id", header: "Subnet ID", cell: (s) => s.SubnetId, isRowHeader: true },
                        { id: "state", header: "State", cell: (s) => <State state={s.State} /> },
                        { id: "cidr", header: "IPv4 CIDR", cell: (s) => s.CidrBlock ?? "-" },
                        { id: "az", header: "Availability Zone", cell: (s) => s.AvailabilityZone ?? "-" },
                        { id: "rtb", header: "Route table", cell: (s) => routeTableOf(tables.data, s)?.RouteTableId ?? "-" },
                        { id: "public", header: "Auto-assign public IPv4 address", cell: (s) => (s.MapPublicIpOnLaunch ? "Yes" : "No") },
                      ]}
                    />
                  ),
                },
                {
                  id: "route-tables",
                  label: "Route tables",
                  content: (
                    <TabTable
                      title="Route tables"
                      items={tables.data}
                      loading={tables.loading}
                      error={tables.error}
                      empty="No route tables in this VPC"
                      actions={
                        <Button href="/vpc/route-tables" onFollow={(e) => (e.preventDefault(), navigate("/vpc/route-tables"))}>
                          Manage route tables
                        </Button>
                      }
                      columns={[
                        { id: "name", header: "Name", cell: (t) => nameOrDash(t.Tags) },
                        { id: "id", header: "Route table ID", cell: (t) => t.RouteTableId, isRowHeader: true },
                        { id: "main", header: "Main", cell: (t) => (isMain(t) ? "Yes" : "No") },
                        { id: "subnets", header: "Explicit subnet associations", cell: (t) => explicitSubnets(t).map((a) => a.SubnetId).join(", ") || "-" },
                        { id: "routes", header: "Routes", cell: (t) => t.Routes?.length ?? 0 },
                      ]}
                    />
                  ),
                },
                {
                  id: "gateways",
                  label: "Internet gateways",
                  content: (
                    <TabTable
                      title="Internet gateways"
                      items={gateways.data}
                      loading={gateways.loading}
                      error={gateways.error}
                      empty="No internet gateway is attached to this VPC"
                      actions={
                        <Button href="/vpc/internet-gateways" onFollow={(e) => (e.preventDefault(), navigate("/vpc/internet-gateways"))}>
                          Manage internet gateways
                        </Button>
                      }
                      columns={[
                        { id: "name", header: "Name", cell: (g) => nameOrDash(g.Tags) },
                        { id: "id", header: "Internet gateway ID", cell: (g) => g.InternetGatewayId, isRowHeader: true },
                        { id: "state", header: "State", cell: () => <State state="attached" /> },
                      ]}
                    />
                  ),
                },
                {
                  id: "groups",
                  label: "Security groups",
                  content: (
                    <TabTable
                      title="Security groups"
                      items={groups.data}
                      loading={groups.loading}
                      error={groups.error}
                      empty="No security groups in this VPC"
                      columns={[
                        { id: "name", header: "Security group name", cell: (g) => g.GroupName },
                        { id: "id", header: "Security group ID", cell: (g) => <RouterLink to={`/ec2/security-groups/${g.GroupId}`}>{g.GroupId}</RouterLink>, isRowHeader: true },
                        { id: "description", header: "Description", cell: (g) => g.Description ?? "-" },
                        { id: "in", header: "Inbound rules", cell: (g) => g.IpPermissions?.length ?? 0 },
                        { id: "out", header: "Outbound rules", cell: (g) => g.IpPermissionsEgress?.length ?? 0 },
                      ]}
                    />
                  ),
                },
                {
                  id: "tags",
                  label: "Tags",
                  content: (
                    <TabTable
                      title="Tags"
                      items={v.Tags ?? []}
                      loading={false}
                      empty="No tags"
                      actions={
                        <Button
                          onClick={() => {
                            setKey(tagName(v.Tags) ? "" : "Name");
                            setValue("");
                            form.setError("");
                            setModal("tag");
                          }}
                        >
                          Add tag
                        </Button>
                      }
                      columns={[
                        { id: "key", header: "Key", cell: (t) => t.Key, isRowHeader: true },
                        { id: "value", header: "Value", cell: (t) => t.Value || "-" },
                        {
                          id: "actions",
                          header: "Actions",
                          cell: (t) => (
                            <Button variant="inline-link" loading={busy === `tag:${t.Key}`} ariaLabel={`Remove tag ${t.Key}`} onClick={() => removeTag(t.Key ?? "")}>
                              Remove
                            </Button>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "tag"} header="Add tag" submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={addTag}>
        <FormField label="Key" description="A tag with a key that exists already gets the new value.">
          <Input value={key} placeholder="Name" onChange={(e) => setKey(e.detail.value)} />
        </FormField>
        <FormField label="Value - optional">
          <Input value={value} onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete"}
        title="Delete VPC"
        warning={v?.IsDefault ? "This is the default VPC. Instances launched without a VPC use it." : undefined}
        onCancel={() => setModal(undefined)}
        onConfirm={remove}
      >
        <Box>Delete {id}? This also deletes the main route table, the default security group and the default network ACL of the VPC.</Box>
      </ConfirmDelete>
    </Shell>
  );
}
