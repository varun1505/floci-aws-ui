import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateHostedZoneCommand, type HostedZone, type VPCRegion } from "@aws-sdk/client-route-53";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import { route53 } from "../../clients/route53";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { getRegion } from "../../config";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { callerReference, deleteZone, listVpcs, listZones, trimDot, vpcLabel, zoneHref, zoneId } from "./route53util";

const DOMAIN = /^(?=.{1,253}$)([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?\.)*[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?$/;

export default function HostedZones() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listZones, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<HostedZone[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [type, setType] = useState("public");
  const [vpc, setVpc] = useState("");
  const region = getRegion();
  // The VPC list is only needed for a private zone, so it loads when the user picks that type.
  const wantVpcs = creating && type === "private";
  const vpcs = useLoad(async () => (wantVpcs ? listVpcs() : []), [wantVpcs]);

  const openCreate = () => {
    setName("");
    setComment("");
    setType("public");
    setVpc("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const domain = trimDot(name.trim());
    if (!DOMAIN.test(domain)) return form.setError("Enter a valid domain name, such as example.com.");
    if (type === "private" && !vpc) return form.setError("Choose a VPC for the private hosted zone.");
    const ok = await form.run(async () => {
      const res = await route53.send(
        new CreateHostedZoneCommand({
          Name: domain,
          CallerReference: callerReference(),
          HostedZoneConfig: comment ? { Comment: comment } : undefined,
          VPC: type === "private" ? { VPCId: vpc, VPCRegion: region as VPCRegion } : undefined,
        }),
      );
      notify.success(`${domain} was successfully created.`);
      navigate(zoneHref(res.HostedZone?.Id));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const z of selected) await deleteZone(zoneId(z.Id), z.Name);
      notify.success(selected.length === 1 ? `Deleted hosted zone ${trimDot(selected[0].Name)}.` : `Deleted ${selected.length} hosted zones.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the hosted zone", e);
    }
    setDeleting(false);
    list.reload();
  };

  // Each zone always holds two records of its own: NS and SOA.
  const extraRecords = selected.reduce((n, z) => n + Math.max((z.ResourceRecordSetCount ?? 2) - 2, 0), 0);

  return (
    <Shell service="route53" contentType="table" breadcrumbs={[{ text: "Route 53", href: "/route53/hosted-zones" }, { text: "Hosted zones", href: "/route53/hosted-zones" }]}>
      <ResourceTable
        global
        title="Hosted zones"
        resourceName="hosted zones"
        filterPlaceholder="Filter hosted zones by name or ID"
        emptyDescription="A hosted zone holds the DNS records of one domain."
        emptyCli="route53 create-hosted-zone --name example.com --caller-reference my-zone-1"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(z) => z.Id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create hosted zone</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => navigate(zoneHref(selected[0]?.Id))}>
              View details
            </Button>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create hosted zone
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Hosted zone name", cell: (z) => <RouterLink to={zoneHref(z.Id)}>{trimDot(z.Name)}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "type", header: "Type", cell: (z) => (z.Config?.PrivateZone ? "Private" : "Public"), sortingComparator: (a, b) => Number(!!a.Config?.PrivateZone) - Number(!!b.Config?.PrivateZone) },
          { id: "count", header: "Record count", cell: (z) => z.ResourceRecordSetCount ?? "-", sortingField: "ResourceRecordSetCount" },
          { id: "description", header: "Description", cell: (z) => z.Config?.Comment || "-" },
          { id: "id", header: "Hosted zone ID", cell: (z) => <Copy text={zoneId(z.Id)} /> },
        ]}
      />

      <FormModal visible={creating} header="Create hosted zone" submitLabel="Create hosted zone" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Domain name" description="The name of the domain that the records are for.">
          <Input value={name} placeholder="example.com" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={comment} placeholder="The hosted zone is used for..." onChange={(e) => setComment(e.detail.value)} />
        </FormField>
        <FormField label="Type">
          <RadioGroup
            value={type}
            onChange={(e) => setType(e.detail.value)}
            items={[
              { value: "public", label: "Public hosted zone", description: "On AWS, it routes traffic on the internet. In the emulator, only its TXT, NS and SOA records are answered." },
              { value: "private", label: "Private hosted zone", description: "Its records resolve for containers that use the emulator's DNS." },
            ]}
          />
        </FormField>
        {type === "private" && (
          <FormField label="VPC to associate with the hosted zone" description={`VPCs in the console's Region, ${region}.`} errorText={vpcs.error}>
            <Select
              selectedOption={vpc ? { value: vpc, label: vpcLabel(vpcs.data?.find((v) => v.VpcId === vpc) ?? { VpcId: vpc }) } : null}
              onChange={(e) => setVpc(e.detail.selectedOption.value ?? "")}
              options={(vpcs.data ?? []).map((v) => ({ value: v.VpcId, label: vpcLabel(v), description: v.CidrBlock }))}
              placeholder="Choose a VPC"
              statusType={vpcs.loading ? "loading" : "finished"}
              loadingText="Loading VPCs"
              empty="No VPCs in this Region"
            />
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete hosted zone ${trimDot(selected[0].Name)}` : `Delete ${selected.length} hosted zones`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning={
          extraRecords
            ? `A hosted zone can be deleted only when it holds no records other than NS and SOA. This also deletes the ${extraRecords} other record${extraRecords === 1 ? "" : "s"}.`
            : "You can't undo this."
        }
      />
    </Shell>
  );
}
