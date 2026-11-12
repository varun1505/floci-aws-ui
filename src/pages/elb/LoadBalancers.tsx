import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateLoadBalancerCommand, DeleteLoadBalancerCommand, type LoadBalancer, type LoadBalancerSchemeEnum, type LoadBalancerTypeEnum } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeSubnetsCommand } from "@aws-sdk/client-ec2";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Multiselect from "@cloudscape-design/components/multiselect";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Tiles from "@cloudscape-design/components/tiles";
import { ec2 } from "../../clients/ec2";
import { elb } from "../../clients/elb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { ElbState, LB_TYPES, lbHref, listLoadBalancers, validName } from "./elbutil";

export default function LoadBalancers() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listLoadBalancers, []);
  const subnets = useLoad(
    async () => ((await ec2.send(new DescribeSubnetsCommand({}))).Subnets ?? []).map((s) => ({ value: s.SubnetId ?? "", label: s.SubnetId ?? "", description: `${s.AvailabilityZone} | ${s.VpcId}`, zone: s.AvailabilityZone })),
    [],
  );
  const form = useSubmit();
  const [selected, setSelected] = useState<LoadBalancer[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState("application");
  const [name, setName] = useState("");
  const [scheme, setScheme] = useState("internet-facing");
  const [chosen, setChosen] = useState<string[]>([]);

  const openCreate = () => {
    setName("");
    form.setError("");
    // Start with one subnet in each of the first two zones, the minimum a load balancer needs.
    const firstPerZone = [...new Map((subnets.data ?? []).map((s) => [s.zone, s.value])).values()];
    setChosen(firstPerZone.slice(0, 2));
    setCreating(true);
  };

  const create = async () => {
    if (!validName(name)) return form.setError("Use up to 32 letters, numbers and hyphens. The name can't start or end with a hyphen.");
    if (chosen.length < 2) return form.setError("Choose at least two subnets in two different Availability Zones.");
    const ok = await form.run(async () => {
      const res = await elb.send(new CreateLoadBalancerCommand({ Name: name, Type: type as LoadBalancerTypeEnum, Scheme: scheme as LoadBalancerSchemeEnum, Subnets: chosen }));
      notify.success(`Successfully created load balancer ${name}.`);
      navigate(lbHref(res.LoadBalancers?.[0]?.LoadBalancerArn ?? ""));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const lb of selected) await elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: lb.LoadBalancerArn }));
      notify.success(`Deleted ${selected.length} load balancer${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the load balancer", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Load balancers", href: "/ec2/load-balancers" }]}>
      <ResourceTable
        title="Load balancers"
        resourceName="load balancers"
        filterPlaceholder="Filter load balancers"
        emptyDescription="A load balancer spreads incoming traffic across the targets in its target groups."
        emptyCli="elbv2 create-load-balancer --name my-alb --subnets subnet-default-us-east-1-a subnet-default-us-east-1-b"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(lb) => lb.LoadBalancerArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create load balancer</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create load balancer
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (lb) => <RouterLink to={lbHref(lb.LoadBalancerArn ?? "")}>{lb.LoadBalancerName}</RouterLink>, sortingField: "LoadBalancerName", isRowHeader: true },
          { id: "dns", header: "DNS name", cell: (lb) => lb.DNSName ?? "-" },
          { id: "state", header: "State", cell: (lb) => <ElbState state={lb.State?.Code} /> },
          { id: "vpc", header: "VPC ID", cell: (lb) => lb.VpcId ?? "-" },
          { id: "zones", header: "Availability Zones", cell: (lb) => `${lb.AvailabilityZones?.length ?? 0} Availability Zones` },
          { id: "type", header: "Type", cell: (lb) => lb.Type ?? "-", sortingField: "Type" },
          { id: "created", header: "Date created", cell: (lb) => formatDate(lb.CreatedTime) },
        ]}
      />
      <FormModal visible={creating} size="large" header="Create load balancer" submitLabel="Create load balancer" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Load balancer type">
          <Tiles value={type} onChange={(e) => setType(e.detail.value)} items={LB_TYPES} />
        </FormField>
        <FormField label="Load balancer name" constraintText="Up to 32 letters, numbers and hyphens.">
          <Input value={name} placeholder="my-alb" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Scheme">
          <RadioGroup
            value={scheme}
            onChange={(e) => setScheme(e.detail.value)}
            items={[
              { value: "internet-facing", label: "Internet-facing" },
              { value: "internal", label: "Internal" },
            ]}
          />
        </FormField>
        <FormField label="Subnets" description="Choose at least two subnets in two different Availability Zones.">
          <Multiselect
            selectedOptions={(subnets.data ?? []).filter((s) => chosen.includes(s.value))}
            onChange={(e) => setChosen(e.detail.selectedOptions.map((o) => o.value ?? ""))}
            options={subnets.data ?? []}
            placeholder="Choose subnets"
            statusType={subnets.loading ? "loading" : "finished"}
            empty="No subnets"
          />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].LoadBalancerName}` : `Delete ${selected.length} load balancers`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a load balancer also deletes its listeners. Its target groups stay." />
    </Shell>
  );
}
