import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChangeResourceRecordSetsCommand, GetHostedZoneCommand, type ResourceRecordSet, UpdateHostedZoneCommentCommand } from "@aws-sdk/client-route-53";
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
import { route53 } from "../../clients/route53";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { RecordForm } from "./RecordForm";
import { ZoneVpcs } from "./ZoneVpcs";
import { deleteZone, isApex, listRecords, recordKey, recordName, recordValues, routingPolicy, trimDot, zoneHref } from "./route53util";

type Modal = "record" | "comment" | "deleteRecords" | "deleteZone" | undefined;

export default function HostedZoneDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const zone = useLoad(() => route53.send(new GetHostedZoneCommand({ Id: id })), [id]);
  const records = useLoad(() => listRecords(id), [id]);
  const form = useSubmit();
  const [modal, setModal] = useState<Modal>(undefined);
  const [selected, setSelected] = useState<ResourceRecordSet[]>([]);
  const [editing, setEditing] = useState<ResourceRecordSet | undefined>(undefined);
  const [comment, setComment] = useState("");

  const z = zone.data?.HostedZone;
  const name = trimDot(z?.Name);
  const isPrivate = !!z?.Config?.PrivateZone;
  const reload = () => {
    zone.reload(true);
    records.reload(true);
  };

  const openRecord = (record?: ResourceRecordSet) => {
    setEditing(record);
    setModal("record");
  };

  const saveComment = async () => {
    const ok = await form.run(async () => {
      await route53.send(new UpdateHostedZoneCommentCommand({ Id: id, Comment: comment }));
      notify.success("The hosted zone description was updated.");
      zone.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeRecords = async () => {
    try {
      // One change batch: either every record is deleted or none is.
      await route53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: id, ChangeBatch: { Changes: selected.map((r) => ({ Action: "DELETE", ResourceRecordSet: r })) } }));
      notify.success(`Deleted ${selected.length} record${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the records", e);
    }
    setModal(undefined);
    reload();
  };

  const removeZone = async () => {
    try {
      await deleteZone(id, z?.Name);
      notify.success(`Deleted hosted zone ${name}.`);
      navigate("/route53/hosted-zones");
    } catch (e) {
      notify.error("Could not delete the hosted zone", e);
      setModal(undefined);
      reload();
    }
  };

  const extraRecords = (records.data ?? []).filter((r) => !isApex(r, z?.Name)).length;

  return (
    <Shell
      service="route53"
      breadcrumbs={[
        { text: "Route 53", href: "/route53/hosted-zones" },
        { text: "Hosted zones", href: "/route53/hosted-zones" },
        { text: name || id, href: zoneHref(id) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (zone.reload(), records.reload())} />
                <Button disabled={!z} onClick={() => setModal("deleteZone")}>
                  Delete zone
                </Button>
                <Button
                  disabled={!z}
                  onClick={() => {
                    setComment(z?.Config?.Comment ?? "");
                    form.setError("");
                    setModal("comment");
                  }}
                >
                  Edit hosted zone
                </Button>
              </SpaceBetween>
            }
          >
            {name || id}
          </Header>
        }
      >
        {zone.error ? (
          <Alert type="error" header="Could not load the hosted zone">
            {zone.error}
          </Alert>
        ) : !z ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Hosted zone details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Hosted zone name">{name}</Pair>
                <Pair label="Hosted zone ID">
                  <Copy text={id} />
                </Pair>
                <Pair label="Type">{isPrivate ? "Private hosted zone" : "Public hosted zone"}</Pair>
                <Pair label="Description">{z.Config?.Comment}</Pair>
                <Pair label="Record count">{z.ResourceRecordSetCount}</Pair>
                <Pair label="Name servers">
                  {zone.data?.DelegationSet?.NameServers?.map((ns) => (
                    <div key={ns}>{ns}</div>
                  ))}
                </Pair>
              </ColumnLayout>
            </Container>

            <Alert type="info" header="What resolves in the emulator">
              {isPrivate
                ? "The records of this private zone resolve for containers that use the emulator's DNS. "
                : "In a public zone, the emulator's DNS answers only TXT, NS and SOA records. The records of a private zone resolve for containers that use the emulator's DNS. "}
              Nothing changes for DNS on your own machine.
            </Alert>

            <ResourceTable
              variant="container"
              stickyHeader={false}
              wrapLines
              global
              title="Records"
              resourceName="records"
              filterPlaceholder="Filter records by name or type"
              items={records.data}
              loading={records.loading}
              error={records.error}
              trackBy={recordKey}
              selectionType="multi"
              selected={selected}
              onSelect={setSelected}
              isItemDisabled={(r) => isApex(r, z.Name)}
              actions={
                <>
                  <Button disabled={!selected.length} onClick={() => setModal("deleteRecords")}>
                    Delete record
                  </Button>
                  <Button disabled={selected.length !== 1} onClick={() => openRecord(selected[0])}>
                    Edit record
                  </Button>
                  <Button variant="primary" onClick={() => openRecord()}>
                    Create record
                  </Button>
                </>
              }
              columns={[
                { id: "name", header: "Record name", cell: (r) => recordName(r.Name), sortingField: "Name", isRowHeader: true },
                { id: "type", header: "Type", cell: (r) => r.Type, sortingField: "Type" },
                { id: "policy", header: "Routing policy", cell: routingPolicy },
                { id: "alias", header: "Alias", cell: (r) => (r.AliasTarget ? "Yes" : "No") },
                {
                  id: "value",
                  header: "Value/Route traffic to",
                  cell: (r) => recordValues(r).map((v, i) => <div key={i}>{v}</div>),
                },
                { id: "ttl", header: "TTL (seconds)", cell: (r) => r.TTL ?? "-", sortingField: "TTL" },
              ]}
            />

            {isPrivate && <ZoneVpcs zoneId={id} vpcs={zone.data?.VPCs ?? []} onChange={() => zone.reload(true)} />}
          </SpaceBetween>
        )}
      </ContentLayout>

      <RecordForm visible={modal === "record"} zoneId={id} zoneName={name} record={editing} onDismiss={() => setModal(undefined)} onSaved={() => (setSelected([]), reload())} />

      <FormModal visible={modal === "comment"} header="Edit hosted zone" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveComment}>
        <FormField label="Description - optional">
          <Input value={comment} onChange={(e) => setComment(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "deleteRecords"} title={`Delete ${selected.length} record${selected.length === 1 ? "" : "s"}`} onCancel={() => setModal(undefined)} onConfirm={removeRecords}>
        <Box>{selected.map((r) => `${recordName(r.Name)} (${r.Type})`).join(", ")}</Box>
      </ConfirmDelete>

      <ConfirmDelete
        visible={modal === "deleteZone"}
        title={`Delete hosted zone ${name}`}
        onCancel={() => setModal(undefined)}
        onConfirm={removeZone}
        warning={
          extraRecords
            ? `A hosted zone can be deleted only when it holds no records other than NS and SOA. This also deletes the ${extraRecords} other record${extraRecords === 1 ? "" : "s"}.`
            : "You can't undo this."
        }
      />
    </Shell>
  );
}
