import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateTargetGroupCommand, DeleteTargetGroupCommand, type ProtocolEnum, type TargetGroup, type TargetTypeEnum } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Tiles from "@cloudscape-design/components/tiles";
import { ec2 } from "../../clients/ec2";
import { elb } from "../../clients/elb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listTargetGroups, tgHref, validName } from "./elbutil";

const PROTOCOLS = ["HTTP", "HTTPS", "TCP", "UDP", "TLS"].map((value) => ({ value, label: value }));

export default function TargetGroups() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listTargetGroups, []);
  const vpcs = useLoad(async () => ((await ec2.send(new DescribeVpcsCommand({}))).Vpcs ?? []).map((v) => ({ value: v.VpcId ?? "", label: v.VpcId ?? "", description: v.CidrBlock })), []);
  const form = useSubmit();
  const [selected, setSelected] = useState<TargetGroup[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState("instance");
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState("HTTP");
  const [port, setPort] = useState("80");
  const [vpc, setVpc] = useState("");
  const [path, setPath] = useState("/");
  const http = protocol === "HTTP" || protocol === "HTTPS";

  const openCreate = () => {
    setName("");
    setVpc(vpcs.data?.[0]?.value ?? "");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!validName(name)) return form.setError("Use up to 32 letters, numbers and hyphens. The name can't start or end with a hyphen.");
    const lambda = type === "lambda";
    const n = Number(port);
    if (!lambda && !(n >= 1 && n <= 65535)) return form.setError("Enter a port from 1 to 65535.");
    if (!lambda && !vpc) return form.setError("Choose a VPC.");
    const ok = await form.run(async () => {
      const res = await elb.send(
        new CreateTargetGroupCommand(
          lambda
            ? { Name: name, TargetType: "lambda" }
            : { Name: name, TargetType: type as TargetTypeEnum, Protocol: protocol as ProtocolEnum, Port: n, VpcId: vpc, ...(http ? { HealthCheckPath: path || "/" } : {}) },
        ),
      );
      notify.success(`Successfully created target group ${name}.`);
      navigate(tgHref(res.TargetGroups?.[0]?.TargetGroupArn ?? ""));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const g of selected) await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: g.TargetGroupArn }));
      notify.success(`Deleted ${selected.length} target group${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the target group. Remove it from every listener first.", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Target groups", href: "/ec2/target-groups" }]}>
      <ResourceTable
        title="Target groups"
        resourceName="target groups"
        filterPlaceholder="Filter target groups"
        emptyDescription="A target group routes requests to registered targets, such as EC2 instances."
        emptyCli="elbv2 create-target-group --name my-targets --protocol HTTP --port 80 --vpc-id vpc-default-us-east-1"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(g) => g.TargetGroupArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create target group</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create target group
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (g) => <RouterLink to={tgHref(g.TargetGroupArn ?? "")}>{g.TargetGroupName}</RouterLink>, sortingField: "TargetGroupName", isRowHeader: true },
          { id: "port", header: "Port", cell: (g) => g.Port ?? "-" },
          { id: "protocol", header: "Protocol", cell: (g) => g.Protocol ?? "-" },
          { id: "type", header: "Target type", cell: (g) => g.TargetType ?? "-" },
          { id: "lb", header: "Load balancer", cell: (g) => g.LoadBalancerArns?.map((a) => a.split("/")[2]).join(", ") || "None associated" },
          { id: "vpc", header: "VPC ID", cell: (g) => g.VpcId ?? "-" },
        ]}
      />
      <FormModal visible={creating} size="large" header="Create target group" submitLabel="Create target group" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Choose a target type">
          <Tiles
            value={type}
            onChange={(e) => setType(e.detail.value)}
            columns={3}
            items={[
              { value: "instance", label: "Instances", description: "Route to EC2 instances." },
              { value: "ip", label: "IP addresses", description: "Route to IP addresses." },
              { value: "lambda", label: "Lambda function", description: "Route to one function." },
            ]}
          />
        </FormField>
        <FormField label="Target group name" constraintText="Up to 32 letters, numbers and hyphens.">
          <Input value={name} placeholder="my-targets" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        {type !== "lambda" && (
          <>
            <ColumnLayout columns={2}>
              <FormField label="Protocol">
                <Select selectedOption={{ value: protocol, label: protocol }} onChange={(e) => setProtocol(e.detail.selectedOption.value ?? "HTTP")} options={PROTOCOLS} />
              </FormField>
              <FormField label="Port" constraintText="1 to 65535">
                <Input type="number" value={port} onChange={(e) => setPort(e.detail.value)} />
              </FormField>
            </ColumnLayout>
            <FormField label="VPC">
              <Select selectedOption={vpcs.data?.find((v) => v.value === vpc) ?? null} onChange={(e) => setVpc(e.detail.selectedOption.value ?? "")} options={vpcs.data ?? []} placeholder="Choose a VPC" statusType={vpcs.loading ? "loading" : "finished"} />
            </FormField>
            {http && (
              <FormField label="Health check path">
                <Input value={path} placeholder="/" onChange={(e) => setPath(e.detail.value)} />
              </FormField>
            )}
          </>
        )}
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].TargetGroupName}` : `Delete ${selected.length} target groups`} onCancel={() => setDeleting(false)} onConfirm={remove} />
    </Shell>
  );
}
