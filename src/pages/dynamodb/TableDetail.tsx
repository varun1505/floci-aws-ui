import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteTableCommand, DescribeTimeToLiveCommand, type StreamViewType, UpdateTableCommand, UpdateTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { dynamodb } from "../../clients/dynamodb";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { TableIndexes } from "./TableIndexes";
import { TableStatus, capacityLabel, describeTable, isOnDemand, itemsHref, keyLabel, keysOf, tableHref } from "./tableutil";

const VIEW_TYPES = [
  { value: "KEYS_ONLY", label: "Key attributes only", description: "Only the key attributes of the changed item." },
  { value: "NEW_IMAGE", label: "New image", description: "The entire item as it appears after it was changed." },
  { value: "OLD_IMAGE", label: "Old image", description: "The entire item as it appeared before it was changed." },
  { value: "NEW_AND_OLD_IMAGES", label: "New and old images", description: "Both the new and the old images of the changed item." },
];
const isUnits = (text: string) => /^[1-9]\d*$/.test(text);

export default function TableDetail() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const table = useLoad(() => describeTable(name), [name]);
  const ttl = useLoad(async () => (await dynamodb.send(new DescribeTimeToLiveCommand({ TableName: name }))).TimeToLiveDescription, [name]);
  const form = useSubmit();
  const [modal, setModal] = useState<"capacity" | "stream" | "ttl" | "delete" | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("PAY_PER_REQUEST");
  const [read, setRead] = useState("5");
  const [write, setWrite] = useState("5");
  const [viewType, setViewType] = useState("NEW_AND_OLD_IMAGES");
  const [ttlAttribute, setTtlAttribute] = useState("");

  const t = table.data;
  const keys = keysOf(t?.KeySchema, t?.AttributeDefinitions);
  const streamOn = !!t?.StreamSpecification?.StreamEnabled;
  const ttlOn = ttl.data?.TimeToLiveStatus === "ENABLED" || ttl.data?.TimeToLiveStatus === "ENABLING";

  const open = (which: typeof modal) => {
    form.setError("");
    setMode(isOnDemand(t) ? "PAY_PER_REQUEST" : "PROVISIONED");
    setRead(String(t?.ProvisionedThroughput?.ReadCapacityUnits || 5));
    setWrite(String(t?.ProvisionedThroughput?.WriteCapacityUnits || 5));
    setTtlAttribute("");
    setModal(which);
  };

  /** Runs a change from a button that has no dialog. */
  const change = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      notify.success(label);
    } catch (e) {
      notify.error("Could not update the table", e);
    }
    setBusy(false);
    table.reload(true);
    ttl.reload(true);
  };

  /** Runs a change from a dialog. The dialog closes when the change worked. */
  const submit = async (label: string, work: () => Promise<unknown>) => {
    const ok = await form.run(async () => {
      await work();
      notify.success(label);
      table.reload(true);
      ttl.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const saveCapacity = () => {
    if (mode === "PROVISIONED") {
      if (!isUnits(read) || !isUnits(write)) return form.setError("Enter whole numbers, 1 or more, for the read and write capacity units.");
      return submit("The capacity settings were saved.", () => dynamodb.send(new UpdateTableCommand({ TableName: name, BillingMode: "PROVISIONED", ProvisionedThroughput: { ReadCapacityUnits: Number(read), WriteCapacityUnits: Number(write) } })));
    }
    return submit("The capacity settings were saved.", () => dynamodb.send(new UpdateTableCommand({ TableName: name, BillingMode: "PAY_PER_REQUEST" })));
  };

  const turnOnStream = () => submit("The DynamoDB stream was turned on.", () => dynamodb.send(new UpdateTableCommand({ TableName: name, StreamSpecification: { StreamEnabled: true, StreamViewType: viewType as StreamViewType } })));

  const turnOnTtl = () => {
    if (!ttlAttribute.trim()) return form.setError("Enter the name of the attribute that holds the expiry time.");
    return submit("Time to Live was turned on.", () => dynamodb.send(new UpdateTimeToLiveCommand({ TableName: name, TimeToLiveSpecification: { Enabled: true, AttributeName: ttlAttribute.trim() } })));
  };

  const remove = async () => {
    try {
      await dynamodb.send(new DeleteTableCommand({ TableName: name }));
      notify.success(`The table ${name} was deleted.`);
      navigate("/dynamodb/tables");
    } catch (e) {
      notify.error("Could not delete the table", e);
      setModal(undefined);
    }
  };

  const overview = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">General information</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <Pair label="Partition key">{keyLabel(keys.pk)}</Pair>
          <Pair label="Sort key">{keyLabel(keys.sk)}</Pair>
          <Pair label="Capacity mode">{capacityLabel(t)}</Pair>
          <Pair label="Table status">
            <TableStatus status={t?.TableStatus} />
          </Pair>
          <Pair label="Item count">{String(t?.ItemCount ?? 0)}</Pair>
          <Pair label="Table size">{formatBytes(t?.TableSizeBytes ?? 0)}</Pair>
          <Pair label="Table class">{t?.TableClassSummary?.TableClass === "STANDARD_INFREQUENT_ACCESS" ? "DynamoDB Standard-IA" : "DynamoDB Standard"}</Pair>
          <Pair label="Creation date">{formatDate(t?.CreationDateTime)}</Pair>
          <Pair label="DynamoDB stream">{streamOn ? "On" : "Off"}</Pair>
          <Pair label="Time to Live (TTL)">{ttlOn ? `On (${ttl.data?.AttributeName})` : "Off"}</Pair>
          <Pair label="Deletion protection">{t?.DeletionProtectionEnabled ? "On" : "Off"}</Pair>
          <Pair label="Indexes">{String((t?.GlobalSecondaryIndexes?.length ?? 0) + (t?.LocalSecondaryIndexes?.length ?? 0))}</Pair>
        </ColumnLayout>
      </Container>
      <Container header={<Header variant="h2">Additional info</Header>}>
        <ColumnLayout columns={2} variant="text-grid">
          <Pair label="Amazon Resource Name (ARN)">
            <Copy text={t?.TableArn} />
          </Pair>
          <Pair label="Table ID">
            <Copy text={t?.TableId} />
          </Pair>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  );

  const streams = (
    <Container
      header={
        <Header
          variant="h2"
          description="A stream records every change to the items of the table."
          actions={
            streamOn ? (
              <Button loading={busy} onClick={() => change("The DynamoDB stream was turned off.", () => dynamodb.send(new UpdateTableCommand({ TableName: name, StreamSpecification: { StreamEnabled: false } })))}>
                Turn off
              </Button>
            ) : (
              <Button onClick={() => open("stream")}>Turn on</Button>
            )
          }
        >
          DynamoDB stream details
        </Header>
      }
    >
      <ColumnLayout columns={3} variant="text-grid">
        <Pair label="Stream status">{streamOn ? "On" : "Off"}</Pair>
        <Pair label="View type">{streamOn ? (VIEW_TYPES.find((v) => v.value === t?.StreamSpecification?.StreamViewType)?.label ?? t?.StreamSpecification?.StreamViewType) : "-"}</Pair>
        <Pair label="Latest stream ARN">{streamOn ? <Copy text={t?.LatestStreamArn} /> : "-"}</Pair>
      </ColumnLayout>
    </Container>
  );

  const settings = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" actions={<Button onClick={() => open("capacity")}>Edit</Button>}>Read/write capacity</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <Pair label="Capacity mode">{isOnDemand(t) ? "On-demand" : "Provisioned"}</Pair>
          <Pair label="Read capacity units">{isOnDemand(t) ? "-" : String(t?.ProvisionedThroughput?.ReadCapacityUnits ?? 0)}</Pair>
          <Pair label="Write capacity units">{isOnDemand(t) ? "-" : String(t?.ProvisionedThroughput?.WriteCapacityUnits ?? 0)}</Pair>
        </ColumnLayout>
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="DynamoDB deletes an item after the time in its TTL attribute. The time is a number of seconds since 1 January 1970."
            actions={
              ttlOn ? (
                <Button loading={busy} onClick={() => change("Time to Live was turned off.", () => dynamodb.send(new UpdateTimeToLiveCommand({ TableName: name, TimeToLiveSpecification: { Enabled: false, AttributeName: ttl.data?.AttributeName ?? "" } })))}>
                  Turn off
                </Button>
              ) : (
                <Button onClick={() => open("ttl")}>Turn on</Button>
              )
            }
          >
            Time to Live (TTL)
          </Header>
        }
      >
        {ttl.error ? (
          <Alert type="error">{ttl.error}</Alert>
        ) : (
          <ColumnLayout columns={2} variant="text-grid">
            <Pair label="TTL status">{ttlOn ? "On" : "Off"}</Pair>
            <Pair label="TTL attribute">{ttlOn ? ttl.data?.AttributeName : "-"}</Pair>
          </ColumnLayout>
        )}
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="A table with deletion protection can't be deleted."
            actions={
              <Button
                loading={busy}
                onClick={() =>
                  change(`Deletion protection was turned ${t?.DeletionProtectionEnabled ? "off" : "on"}.`, () => dynamodb.send(new UpdateTableCommand({ TableName: name, DeletionProtectionEnabled: !t?.DeletionProtectionEnabled })))
                }
              >
                {t?.DeletionProtectionEnabled ? "Turn off" : "Turn on"}
              </Button>
            }
          >
            Deletion protection
          </Header>
        }
      >
        <Pair label="Deletion protection">{t?.DeletionProtectionEnabled ? "On" : "Off"}</Pair>
      </Container>
    </SpaceBetween>
  );

  return (
    <Shell
      service="dynamodb"
      breadcrumbs={[
        { text: "DynamoDB", href: "/dynamodb/tables" },
        { text: "Tables", href: "/dynamodb/tables" },
        { text: name, href: tableHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (table.reload(), ttl.reload())} />
                <Button disabled={!t} onClick={() => open("delete")}>
                  Delete table
                </Button>
                <Button variant="primary" disabled={!t} onClick={() => navigate(itemsHref(name))}>
                  Explore table items
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {table.error ? (
          <Alert type="error" header="Could not load the table">
            {table.error}
          </Alert>
        ) : !t ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <Tabs
            tabs={[
              { id: "overview", label: "Overview", content: overview },
              { id: "indexes", label: "Indexes", content: <TableIndexes table={t} onChange={() => table.reload(true)} /> },
              { id: "streams", label: "Exports and streams", content: streams },
              { id: "settings", label: "Additional settings", content: settings },
            ]}
          />
        )}
      </ContentLayout>

      <FormModal visible={modal === "capacity"} header="Edit read/write capacity" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveCapacity}>
        <FormField label="Capacity mode">
          <RadioGroup
            value={mode}
            onChange={(e) => setMode(e.detail.value)}
            items={[
              { value: "PAY_PER_REQUEST", label: "On-demand" },
              { value: "PROVISIONED", label: "Provisioned" },
            ]}
          />
        </FormField>
        {mode === "PROVISIONED" && (
          <ColumnLayout columns={2}>
            <FormField label="Read capacity units">
              <Input type="number" value={read} ariaLabel="Read capacity units" onChange={(e) => setRead(e.detail.value)} />
            </FormField>
            <FormField label="Write capacity units">
              <Input type="number" value={write} ariaLabel="Write capacity units" onChange={(e) => setWrite(e.detail.value)} />
            </FormField>
          </ColumnLayout>
        )}
      </FormModal>

      <FormModal visible={modal === "stream"} header="Turn on DynamoDB stream" submitLabel="Turn on stream" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={turnOnStream}>
        <FormField label="View type" description="What the stream records each time an item changes.">
          <RadioGroup value={viewType} onChange={(e) => setViewType(e.detail.value)} items={VIEW_TYPES} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "ttl"} header="Turn on Time to Live (TTL)" submitLabel="Turn on TTL" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={turnOnTtl}>
        <FormField label="TTL attribute name" description="The attribute that holds the expiry time of an item, as a number of seconds since 1 January 1970.">
          <Input value={ttlAttribute} placeholder="expiresAt" onChange={(e) => setTtlAttribute(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title="Delete table" confirmText="confirm" onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete <b>{name}</b> and every item in it? You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
