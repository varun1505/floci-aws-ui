import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CreateListenerCommand, DeleteListenerCommand, DeleteLoadBalancerCommand, DescribeListenersCommand, DescribeLoadBalancersCommand, type Listener, type ProtocolEnum } from "@aws-sdk/client-elastic-load-balancing-v2";
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
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ElbState, lbHref, listTargetGroups, tgHref, tgName } from "./elbutil";

export default function LoadBalancerDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const lb = useLoad(async () => (await elb.send(new DescribeLoadBalancersCommand({ LoadBalancerArns: [arn] }))).LoadBalancers?.[0], [arn]);
  const listeners = useLoad(async () => (await elb.send(new DescribeListenersCommand({ LoadBalancerArn: arn }))).Listeners ?? [], [arn]);
  const groups = useLoad(listTargetGroups, []);
  const form = useSubmit();
  const [adding, setAdding] = useState(false);
  const [protocol, setProtocol] = useState("HTTP");
  const [port, setPort] = useState("80");
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<Listener[]>([]);
  const [deleting, setDeleting] = useState<"lb" | "listener" | undefined>(undefined);

  const d = lb.data;
  const name = d?.LoadBalancerName ?? arn.split("/")[2] ?? arn;
  const network = d?.Type === "network";
  const protocols = (network ? ["TCP", "UDP", "TLS"] : ["HTTP", "HTTPS"]).map((value) => ({ value, label: value }));
  const groupOptions = (groups.data ?? []).map((g) => ({ value: g.TargetGroupArn ?? "", label: g.TargetGroupName ?? "", description: `${g.Protocol}:${g.Port}` }));

  const openAdd = () => {
    setProtocol(network ? "TCP" : "HTTP");
    setPort("80");
    setTarget("");
    form.setError("");
    setAdding(true);
  };

  const add = async () => {
    const n = Number(port);
    if (!(n >= 1 && n <= 65535)) return form.setError("Enter a port from 1 to 65535.");
    if (!target) return form.setError("Choose a target group.");
    const ok = await form.run(async () => {
      await elb.send(new CreateListenerCommand({ LoadBalancerArn: arn, Protocol: protocol as ProtocolEnum, Port: n, DefaultActions: [{ Type: "forward", TargetGroupArn: target }] }));
      notify.success(`Listener ${protocol}:${n} created.`);
      listeners.reload(true);
    });
    if (ok) setAdding(false);
  };

  const remove = async () => {
    try {
      if (deleting === "lb") {
        await elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: arn }));
        notify.success(`Deleted ${name}.`);
        return navigate("/ec2/load-balancers");
      }
      for (const l of selected) await elb.send(new DeleteListenerCommand({ ListenerArn: l.ListenerArn }));
      notify.success("Listener deleted.");
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete the ${deleting === "lb" ? "load balancer" : "listener"}`, e);
    }
    setDeleting(undefined);
    listeners.reload(true);
  };

  return (
    <Shell service="ec2" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Load balancers", href: "/ec2/load-balancers" }, { text: name, href: lbHref(arn) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (lb.reload(), listeners.reload())} />
                <Button onClick={() => setDeleting("lb")}>Delete</Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {lb.error ? (
          <Alert type="error" header="Could not load the load balancer">
            {lb.error}
          </Alert>
        ) : !d ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Load balancer type">{d.Type}</Pair>
                <Pair label="Status">
                  <ElbState state={d.State?.Code} />
                </Pair>
                <Pair label="Scheme">{d.Scheme}</Pair>
                <Pair label="DNS name">
                  <Copy text={d.DNSName} />
                </Pair>
                <Pair label="VPC">{d.VpcId}</Pair>
                <Pair label="IP address type">{d.IpAddressType}</Pair>
                <Pair label="Availability Zones">{d.AvailabilityZones?.map((z) => `${z.SubnetId} (${z.ZoneName})`).join(", ")}</Pair>
                <Pair label="Date created">{formatDate(d.CreatedTime)}</Pair>
                <Pair label="Load balancer ARN">
                  <Copy text={d.LoadBalancerArn} />
                </Pair>
              </ColumnLayout>
            </Container>
            <Table
              header={
                <Header
                  variant="h2"
                  counter={`(${listeners.data?.length ?? 0})`}
                  description="A listener checks for connection requests on its port and forwards them to a target group."
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button disabled={selected.length === 0} onClick={() => setDeleting("listener")}>
                        Delete
                      </Button>
                      <Button onClick={openAdd}>Add listener</Button>
                    </SpaceBetween>
                  }
                >
                  Listeners and rules
                </Header>
              }
              loading={listeners.loading}
              loadingText="Loading listeners"
              items={listeners.data ?? []}
              trackBy="ListenerArn"
              selectionType="multi"
              selectedItems={selected}
              onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
              columnDefinitions={[
                { id: "port", header: "Protocol:Port", cell: (l) => `${l.Protocol}:${l.Port}`, isRowHeader: true },
                {
                  id: "action",
                  header: "Default action",
                  cell: (l) => {
                    const a = l.DefaultActions?.[0];
                    const to = a?.TargetGroupArn ?? a?.ForwardConfig?.TargetGroups?.[0]?.TargetGroupArn;
                    return to ? (
                      <>
                        Forward to <RouterLink to={tgHref(to)}>{tgName(to)}</RouterLink>
                      </>
                    ) : (
                      (a?.Type ?? "-")
                    );
                  },
                },
                { id: "arn", header: "ARN", cell: (l) => <Copy text={l.ListenerArn} /> },
              ]}
              empty={
                <Box textAlign="center" color="inherit">
                  <b>No listeners</b>
                  <Box variant="p" color="inherit">
                    The load balancer accepts no traffic until you add a listener.
                  </Box>
                  <Button onClick={openAdd}>Add listener</Button>
                </Box>
              }
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={adding} header="Add listener" submitLabel="Add listener" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={add}>
        <ColumnLayout columns={2}>
          <FormField label="Protocol">
            <Select selectedOption={{ value: protocol, label: protocol }} onChange={(e) => setProtocol(e.detail.selectedOption.value ?? protocol)} options={protocols} />
          </FormField>
          <FormField label="Port" constraintText="1 to 65535">
            <Input type="number" value={port} onChange={(e) => setPort(e.detail.value)} />
          </FormField>
        </ColumnLayout>
        <FormField label="Default action" description="Forward to this target group.">
          <Select
            selectedOption={groupOptions.find((o) => o.value === target) ?? null}
            onChange={(e) => setTarget(e.detail.selectedOption.value ?? "")}
            options={groupOptions}
            placeholder="Choose a target group"
            statusType={groups.loading ? "loading" : "finished"}
            empty="No target groups. Create one on the Target groups page."
          />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting !== undefined}
        title={deleting === "lb" ? `Delete ${name}` : "Delete listener"}
        onCancel={() => setDeleting(undefined)}
        onConfirm={remove}
        warning={deleting === "lb" ? "Deleting a load balancer also deletes its listeners. Its target groups stay." : undefined}
      />
    </Shell>
  );
}
