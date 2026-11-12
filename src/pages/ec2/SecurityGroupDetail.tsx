import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  AuthorizeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  RevokeSecurityGroupEgressCommand,
  RevokeSecurityGroupIngressCommand,
  type IpPermission,
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
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { ec2 } from "../../aws";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { Pair } from "./ec2util";

type Rule = { id: string; protocol: string; ports: string; source: string; description: string; permission: IpPermission };

const TYPES = [
  { value: "ssh", label: "SSH", protocol: "tcp", from: 22, to: 22 },
  { value: "http", label: "HTTP", protocol: "tcp", from: 80, to: 80 },
  { value: "https", label: "HTTPS", protocol: "tcp", from: 443, to: 443 },
  { value: "postgres", label: "PostgreSQL", protocol: "tcp", from: 5432, to: 5432 },
  { value: "mysql", label: "MySQL/Aurora", protocol: "tcp", from: 3306, to: 3306 },
  { value: "tcp", label: "Custom TCP", protocol: "tcp" },
  { value: "udp", label: "Custom UDP", protocol: "udp" },
  { value: "all", label: "All traffic", protocol: "-1" },
];

/** One row per source of each permission. Deleting a row revokes just that source. */
function flatten(perms: IpPermission[] | undefined): Rule[] {
  const rules: Rule[] = [];
  for (const p of perms ?? []) {
    const protocol = p.IpProtocol === "-1" ? "All" : (p.IpProtocol ?? "").toUpperCase();
    const ports = p.IpProtocol === "-1" || p.FromPort === undefined ? "All" : p.FromPort === p.ToPort ? String(p.FromPort) : `${p.FromPort} - ${p.ToPort}`;
    const base = { IpProtocol: p.IpProtocol, FromPort: p.FromPort, ToPort: p.ToPort };
    for (const r of p.IpRanges ?? [])
      rules.push({ id: `${protocol}-${ports}-${r.CidrIp}`, protocol, ports, source: r.CidrIp ?? "", description: r.Description ?? "", permission: { ...base, IpRanges: [r] } });
    for (const r of p.Ipv6Ranges ?? [])
      rules.push({ id: `${protocol}-${ports}-${r.CidrIpv6}`, protocol, ports, source: r.CidrIpv6 ?? "", description: r.Description ?? "", permission: { ...base, Ipv6Ranges: [r] } });
    for (const r of p.UserIdGroupPairs ?? [])
      rules.push({ id: `${protocol}-${ports}-${r.GroupId}`, protocol, ports, source: r.GroupId ?? "", description: r.Description ?? "", permission: { ...base, UserIdGroupPairs: [r] } });
  }
  return rules;
}

export default function SecurityGroupDetail() {
  const { id = "" } = useParams();
  const notify = useNotify();
  const group = useLoad(async () => {
    const res = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [id] }));
    const found = res.SecurityGroups?.[0];
    if (!found) throw new Error(`The security group '${id}' does not exist.`);
    return found;
  }, [id]);
  const g = group.data;

  const [adding, setAdding] = useState<"inbound" | "outbound" | null>(null);
  const [type, setType] = useState(TYPES[0]);
  const [ports, setPorts] = useState("");
  const [cidr, setCidr] = useState("0.0.0.0/0");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedIn, setSelectedIn] = useState<Rule[]>([]);
  const [selectedOut, setSelectedOut] = useState<Rule[]>([]);

  const add = async () => {
    let from = type.from;
    let to = type.to;
    if (type.value === "tcp" || type.value === "udp") {
      const m = ports.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return setError("Enter a port (80) or a port range (8000-8100).");
      from = Number(m[1]);
      to = Number(m[2] ?? m[1]);
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr.trim())) return setError("Enter a CIDR block, such as 10.0.0.0/16.");
    const permission: IpPermission = {
      IpProtocol: type.protocol,
      FromPort: type.protocol === "-1" ? undefined : from,
      ToPort: type.protocol === "-1" ? undefined : to,
      IpRanges: [{ CidrIp: cidr.trim(), Description: description || undefined }],
    };
    setBusy(true);
    try {
      if (adding === "inbound") await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: id, IpPermissions: [permission] }));
      else await ec2.send(new AuthorizeSecurityGroupEgressCommand({ GroupId: id, IpPermissions: [permission] }));
      notify.success(`${adding === "inbound" ? "Inbound" : "Outbound"} security group rule successfully added.`);
      setAdding(null);
      setPorts("");
      setDescription("");
      group.reload(true);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const revoke = async (direction: "inbound" | "outbound", rules: Rule[]) => {
    try {
      const IpPermissions = rules.map((r) => r.permission);
      if (direction === "inbound") await ec2.send(new RevokeSecurityGroupIngressCommand({ GroupId: id, IpPermissions }));
      else await ec2.send(new RevokeSecurityGroupEgressCommand({ GroupId: id, IpPermissions }));
      notify.success(`Deleted ${rules.length} rule${rules.length === 1 ? "" : "s"}.`);
      setSelectedIn([]);
      setSelectedOut([]);
    } catch (e) {
      notify.error("Could not delete the rule", e);
    }
    group.reload(true);
  };

  const rulesTable = (direction: "inbound" | "outbound", rules: Rule[], selected: Rule[], setSelected: (r: Rule[]) => void) => (
    <Table
      header={
        <Header
          variant="h2"
          counter={`(${rules.length})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={selected.length === 0} onClick={() => revoke(direction, selected)}>
                Delete
              </Button>
              <Button
                onClick={() => {
                  setError("");
                  setAdding(direction);
                }}
              >
                Add rule
              </Button>
            </SpaceBetween>
          }
        >
          {direction === "inbound" ? "Inbound rules" : "Outbound rules"}
        </Header>
      }
      items={rules}
      trackBy="id"
      selectionType="multi"
      selectedItems={selected}
      onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
      columnDefinitions={[
        { id: "protocol", header: "Protocol", cell: (r) => r.protocol },
        { id: "ports", header: "Port range", cell: (r) => r.ports },
        { id: "source", header: direction === "inbound" ? "Source" : "Destination", cell: (r) => r.source, isRowHeader: true },
        { id: "description", header: "Description", cell: (r) => r.description || "-" },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <b>No rules</b>
          <Box variant="p" color="inherit">
            This security group has no {direction} rules.
          </Box>
        </Box>
      }
    />
  );

  const custom = type.value === "tcp" || type.value === "udp";

  return (
    <Shell
      service="ec2"
      breadcrumbs={[
        { text: "EC2", href: "/ec2/instances" },
        { text: "Security Groups", href: "/ec2/security-groups" },
        { text: id, href: `/ec2/security-groups/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header variant="h1" actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => group.reload()} />}>
            {id}
            {g?.GroupName ? ` - ${g.GroupName}` : ""}
          </Header>
        }
      >
        {group.error ? (
          <Alert type="error" header="Could not load the security group">
            {group.error}
          </Alert>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="Security group name">{g?.GroupName}</Pair>
                <Pair label="Security group ID">{g?.GroupId}</Pair>
                <Pair label="Description">{g?.Description}</Pair>
                <Pair label="VPC ID">{g?.VpcId}</Pair>
                <Pair label="Owner">{g?.OwnerId}</Pair>
                <Pair label="Inbound rules count">{g ? `${flatten(g.IpPermissions).length} Permission entries` : undefined}</Pair>
                <Pair label="Outbound rules count">{g ? `${flatten(g.IpPermissionsEgress).length} Permission entries` : undefined}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "inbound", label: "Inbound rules", content: rulesTable("inbound", flatten(g?.IpPermissions), selectedIn, setSelectedIn) },
                { id: "outbound", label: "Outbound rules", content: rulesTable("outbound", flatten(g?.IpPermissionsEgress), selectedOut, setSelectedOut) },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      <Modal
        visible={adding !== null}
        onDismiss={() => setAdding(null)}
        header={adding === "inbound" ? "Add inbound rule" : "Add outbound rule"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={add}>
                Save rules
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <FormField label="Type">
            <Select selectedOption={type} options={TYPES} onChange={(e) => setType(TYPES.find((t) => t.value === e.detail.selectedOption.value)!)} />
          </FormField>
          <FormField label="Port range">
            <Input
              value={custom ? ports : type.protocol === "-1" ? "All" : String(type.from)}
              disabled={!custom}
              placeholder="8080 or 8000-8100"
              onChange={(e) => setPorts(e.detail.value)}
            />
          </FormField>
          <FormField label={adding === "inbound" ? "Source" : "Destination"} constraintText="CIDR block. 0.0.0.0/0 means anywhere.">
            <Input value={cidr} onChange={(e) => setCidr(e.detail.value)} />
          </FormField>
          <FormField label="Description - optional">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>
    </Shell>
  );
}
