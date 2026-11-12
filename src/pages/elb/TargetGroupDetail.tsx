import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteTargetGroupCommand, DeregisterTargetsCommand, DescribeTargetGroupsCommand, DescribeTargetHealthCommand, RegisterTargetsCommand, type TargetHealthDescription } from "@aws-sdk/client-elastic-load-balancing-v2";
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
import Table from "@cloudscape-design/components/table";
import { elb } from "../../clients/elb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ElbState, tgHref, tgName } from "./elbutil";

export default function TargetGroupDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const name = tgName(arn);
  const navigate = useNavigate();
  const notify = useNotify();
  const group = useLoad(async () => (await elb.send(new DescribeTargetGroupsCommand({ TargetGroupArns: [arn] }))).TargetGroups?.[0], [arn]);
  const health = useLoad(async () => (await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: arn }))).TargetHealthDescriptions ?? [], [arn]);
  const form = useSubmit();
  const [registering, setRegistering] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [port, setPort] = useState("");
  const [selected, setSelected] = useState<TargetHealthDescription[]>([]);
  const [deleting, setDeleting] = useState(false);

  const g = group.data;
  const kind = g?.TargetType ?? "instance";
  // Instances and functions are picked by name. IP targets are typed in.
  const choices = useLoad(async () => {
    if (kind === "instance") {
      const { listInstances, tagName } = await import("../ec2/ec2util");
      return (await listInstances()).filter((i) => i.State?.Name !== "terminated").map((i) => ({ value: i.InstanceId ?? "", label: i.InstanceId ?? "", description: tagName(i.Tags) || i.State?.Name }));
    }
    if (kind === "lambda") {
      const { listAllFunctions } = await import("../lambda/Functions");
      return (await listAllFunctions()).map((f) => ({ value: f.FunctionArn ?? "", label: f.FunctionName ?? "", description: undefined as string | undefined }));
    }
    return undefined;
  }, [kind]);

  const openRegister = () => {
    setTargetId("");
    setPort(g?.Port ? String(g.Port) : "");
    form.setError("");
    setRegistering(true);
  };

  const register = async () => {
    if (!targetId) return form.setError(kind === "ip" ? "Enter an IP address." : "Choose a target.");
    const ok = await form.run(async () => {
      await elb.send(new RegisterTargetsCommand({ TargetGroupArn: arn, Targets: [{ Id: targetId, ...(kind !== "lambda" && port ? { Port: Number(port) } : {}) }] }));
      notify.success("Target registered.");
      health.reload(true);
    });
    if (ok) setRegistering(false);
  };

  const deregister = async () => {
    try {
      await elb.send(new DeregisterTargetsCommand({ TargetGroupArn: arn, Targets: selected.map((t) => ({ Id: t.Target?.Id, Port: t.Target?.Port })) }));
      notify.success(`Deregistered ${selected.length} target${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not deregister the target", e);
    }
    health.reload(true);
  };

  const remove = async () => {
    try {
      await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: arn }));
      notify.success(`Deleted ${name}.`);
      navigate("/ec2/target-groups");
    } catch (e) {
      notify.error("Could not delete the target group. Remove it from every listener first.", e);
      setDeleting(false);
    }
  };

  return (
    <Shell service="ec2" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Target groups", href: "/ec2/target-groups" }, { text: name, href: tgHref(arn) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (group.reload(), health.reload())} />
                <Button onClick={() => setDeleting(true)}>Delete</Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {group.error ? (
          <Alert type="error" header="Could not load the target group">
            {group.error}
          </Alert>
        ) : !g ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Target type">{g.TargetType}</Pair>
                <Pair label="Protocol : Port">{g.Protocol ? `${g.Protocol}: ${g.Port}` : undefined}</Pair>
                <Pair label="VPC">{g.VpcId}</Pair>
                <Pair label="Load balancer">{g.LoadBalancerArns?.map((a) => a.split("/")[2]).join(", ") || "None associated"}</Pair>
                <Pair label="Health check">{g.HealthCheckProtocol ? `${g.HealthCheckProtocol} ${g.HealthCheckPath ?? ""}` : undefined}</Pair>
                <Pair label="Health check interval">{g.HealthCheckIntervalSeconds ? `${g.HealthCheckIntervalSeconds} seconds` : undefined}</Pair>
                <Pair label="ARN">
                  <Copy text={g.TargetGroupArn} />
                </Pair>
              </ColumnLayout>
            </Container>
            <Table
              header={
                <Header
                  variant="h2"
                  counter={`(${health.data?.length ?? 0})`}
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button disabled={selected.length === 0} onClick={deregister}>
                        Deregister
                      </Button>
                      <Button onClick={openRegister}>Register targets</Button>
                    </SpaceBetween>
                  }
                >
                  Registered targets
                </Header>
              }
              loading={health.loading}
              loadingText="Loading targets"
              items={health.data ?? []}
              trackBy={(t) => `${t.Target?.Id}:${t.Target?.Port}`}
              selectionType="multi"
              selectedItems={selected}
              onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
              columnDefinitions={[
                { id: "id", header: kind === "ip" ? "IP address" : kind === "lambda" ? "Function" : "Instance ID", cell: (t) => t.Target?.Id, isRowHeader: true },
                { id: "port", header: "Port", cell: (t) => t.Target?.Port ?? "-" },
                { id: "zone", header: "Zone", cell: (t) => t.Target?.AvailabilityZone ?? "-" },
                { id: "health", header: "Health status", cell: (t) => <ElbState state={t.TargetHealth?.State} /> },
                { id: "reason", header: "Health status details", cell: (t) => t.TargetHealth?.Description ?? "-" },
              ]}
              empty={
                <Box textAlign="center" color="inherit">
                  <b>No registered targets</b>
                  <Box variant="p" color="inherit">
                    Traffic sent to this target group has nowhere to go until you register a target.
                  </Box>
                  <Button onClick={openRegister}>Register targets</Button>
                </Box>
              }
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={registering} header="Register targets" submitLabel="Register target" busy={form.busy} error={form.error} onDismiss={() => setRegistering(false)} onSubmit={register}>
        <FormField label={kind === "ip" ? "IP address" : kind === "lambda" ? "Lambda function" : "Instance"}>
          {choices.data ? (
            <Select
              selectedOption={choices.data.find((o) => o.value === targetId) ?? null}
              onChange={(e) => setTargetId(e.detail.selectedOption.value ?? "")}
              options={choices.data}
              placeholder={kind === "lambda" ? "Choose a function" : "Choose an instance"}
              filteringType="auto"
              empty={kind === "lambda" ? "No functions in this Region" : "No instances in this Region"}
            />
          ) : (
            <Input value={targetId} placeholder={kind === "ip" ? "10.0.1.25" : ""} onChange={(e) => setTargetId(e.detail.value)} />
          )}
        </FormField>
        {kind !== "lambda" && (
          <FormField label="Port" description="The port on the target that receives traffic.">
            <Input type="number" value={port} onChange={(e) => setPort(e.detail.value)} />
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Delete ${name}`} onCancel={() => setDeleting(false)} onConfirm={remove} />
    </Shell>
  );
}
