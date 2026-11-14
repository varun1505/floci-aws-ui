import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type AttributeDefinition, CreateTableCommand, type CreateTableCommandInput, type ScalarAttributeType } from "@aws-sdk/client-dynamodb";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { dynamodb } from "../../clients/dynamodb";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { type IndexDraft, IndexFields, KeyField, NAME_HINT, NAME_RULE, addDefinitions, indexAttributes, indexError, indexRequest, newIndex, tableHref } from "./tableutil";

const isUnits = (text: string) => /^[1-9]\d*$/.test(text);

export default function CreateTable() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [name, setName] = useState("");
  const [pk, setPk] = useState("");
  const [pkType, setPkType] = useState("S");
  const [sk, setSk] = useState("");
  const [skType, setSkType] = useState("S");
  const [mode, setMode] = useState("PAY_PER_REQUEST");
  const [read, setRead] = useState("5");
  const [write, setWrite] = useState("5");
  const [indexes, setIndexes] = useState<IndexDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const provisioned = mode === "PROVISIONED";
  const nameError = !NAME_RULE.test(name) ? NAME_HINT : "";
  const pkError = !pk.trim() ? "Enter a partition key name." : "";
  const skError = sk.trim() && sk.trim() === pk.trim() ? "The sort key must differ from the partition key." : "";
  const readError = provisioned && !isUnits(read) ? "Enter a whole number, 1 or more." : "";
  const writeError = provisioned && !isUnits(write) ? "Enter a whole number, 1 or more." : "";

  const setIndex = (i: number, d: IndexDraft) => setIndexes((list) => list.map((x, n) => (n === i ? d : x)));

  const create = async () => {
    setTouched(true);
    setError("");
    if (nameError || pkError || skError || readError || writeError) return;
    const input: CreateTableCommandInput = { TableName: name, AttributeDefinitions: [], KeySchema: [{ AttributeName: pk.trim(), KeyType: "HASH" }] };
    try {
      let defs: AttributeDefinition[] = [{ AttributeName: pk.trim(), AttributeType: pkType as ScalarAttributeType }];
      if (sk.trim()) {
        input.KeySchema?.push({ AttributeName: sk.trim(), KeyType: "RANGE" });
        defs.push({ AttributeName: sk.trim(), AttributeType: skType as ScalarAttributeType });
      }
      const throughput = provisioned ? { ReadCapacityUnits: Number(read), WriteCapacityUnits: Number(write) } : undefined;
      for (const d of indexes) {
        const problem = indexError(d);
        if (problem) throw new Error(problem);
        if (indexes.filter((x) => x.name === d.name).length > 1) throw new Error(`Two indexes are named ${d.name}. Give each index its own name.`);
        if (d.kind === "LOCAL" && !sk.trim()) throw new Error("A local secondary index needs a table with a sort key.");
        defs = addDefinitions(defs, indexAttributes(d));
        // In provisioned mode each global index has its own capacity. It starts with the capacity of the table.
        if (d.kind === "GLOBAL") (input.GlobalSecondaryIndexes ??= []).push({ ...indexRequest(d, pk.trim()), ProvisionedThroughput: throughput });
        else (input.LocalSecondaryIndexes ??= []).push(indexRequest(d, pk.trim()));
      }
      input.AttributeDefinitions = defs;
      input.BillingMode = provisioned ? "PROVISIONED" : "PAY_PER_REQUEST";
      input.ProvisionedThroughput = throughput;
    } catch (e) {
      return setError(errorMessage(e));
    }
    setBusy(true);
    try {
      await dynamodb.send(new CreateTableCommand(input));
      notify.success(`The table ${name} was created.`);
      navigate(tableHref(name));
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const indexButtons = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button onClick={() => setIndexes((list) => [...list, newIndex("GLOBAL")])}>Create global index</Button>
      <Button onClick={() => setIndexes((list) => [...list, newIndex("LOCAL")])}>Create local index</Button>
    </SpaceBetween>
  );

  return (
    <Shell
      service="dynamodb"
      contentType="form"
      breadcrumbs={[
        { text: "DynamoDB", href: "/dynamodb/tables" },
        { text: "Tables", href: "/dynamodb/tables" },
        { text: "Create table", href: "/dynamodb/tables/create" },
      ]}
    >
      <ContentLayout header={<Header variant="h1">Create table</Header>}>
        <Form
          errorText={error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/dynamodb/tables")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create table
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2" description="DynamoDB is a schemaless database that requires only a table name and a primary key when you create the table.">Table details</Header>}>
              <SpaceBetween size="l">
                <FormField label="Table name" description="This will be used to identify your table." constraintText={NAME_HINT} errorText={touched ? nameError : ""}>
                  <Input value={name} placeholder="Enter name for table" onChange={(e) => setName(e.detail.value)} />
                </FormField>
                <KeyField
                  label="Partition key"
                  description="The partition key is part of the table's primary key. It is a hash value that is used to retrieve items from your table."
                  error={touched ? pkError : ""}
                  name={pk}
                  type={pkType}
                  placeholder="Enter the partition key name"
                  onName={setPk}
                  onType={setPkType}
                />
                <KeyField
                  label="Sort key - optional"
                  description="You can use a sort key as the second part of a table's primary key. The sort key allows you to sort or search among all items sharing the same partition key."
                  error={touched ? skError : ""}
                  name={sk}
                  type={skType}
                  placeholder="Enter the sort key name"
                  onName={setSk}
                  onType={setSkType}
                />
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Read/write capacity settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Capacity mode">
                  <Tiles
                    value={mode}
                    columns={2}
                    onChange={(e) => setMode(e.detail.value)}
                    items={[
                      { value: "PAY_PER_REQUEST", label: "On-demand", description: "Simplify billing by paying for the actual reads and writes your application performs." },
                      { value: "PROVISIONED", label: "Provisioned", description: "Manage and optimize your costs by allocating read/write capacity in advance." },
                    ]}
                  />
                </FormField>
                {provisioned && (
                  <ColumnLayout columns={2}>
                    <FormField label="Read capacity units" errorText={touched ? readError : ""}>
                      <Input type="number" value={read} ariaLabel="Read capacity units" onChange={(e) => setRead(e.detail.value)} />
                    </FormField>
                    <FormField label="Write capacity units" errorText={touched ? writeError : ""}>
                      <Input type="number" value={write} ariaLabel="Write capacity units" onChange={(e) => setWrite(e.detail.value)} />
                    </FormField>
                  </ColumnLayout>
                )}
              </SpaceBetween>
            </Container>

            <Container
              header={
                <Header variant="h2" counter={`(${indexes.length})`} description="An index lets you query the table by another key. A local index must be created with the table." actions={indexButtons}>
                  Secondary indexes - optional
                </Header>
              }
            >
              {indexes.length === 0 ? (
                "No indexes."
              ) : (
                <SpaceBetween size="l">
                  {indexes.map((d, i) => (
                    <Container
                      key={i}
                      header={
                        <Header variant="h3" actions={<Button onClick={() => setIndexes((list) => list.filter((_, n) => n !== i))}>Remove</Button>}>
                          {d.kind === "GLOBAL" ? "Global secondary index" : "Local secondary index"}
                        </Header>
                      }
                    >
                      <IndexFields draft={d} tablePk={pk} onChange={(next) => setIndex(i, next)} />
                    </Container>
                  ))}
                </SpaceBetween>
              )}
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
