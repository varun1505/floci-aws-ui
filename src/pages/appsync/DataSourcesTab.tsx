import { useState } from "react";
import { CreateDataSourceCommand, type DataSource, DeleteDataSourceCommand } from "@aws-sdk/client-appsync";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { ListRolesCommand } from "@aws-sdk/client-iam";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import { appsync } from "../../clients/appsync";
import { dynamodb } from "../../clients/dynamodb";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { getRegion } from "../../config";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listAllFunctions } from "../lambda/Functions";
import { SOURCE_LABEL, listDataSources, sourceResource } from "./appsyncutil";

const TYPES = ["NONE", "AMAZON_DYNAMODB", "AWS_LAMBDA", "HTTP"];

async function listTables(): Promise<SelectProps.Option[]> {
  const out: string[] = [];
  let ExclusiveStartTableName: string | undefined;
  do {
    const res = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName }));
    out.push(...(res.TableNames ?? []));
    ExclusiveStartTableName = res.LastEvaluatedTableName;
  } while (ExclusiveStartTableName);
  return out.map((t) => ({ value: t, label: t }));
}

async function listRoles(): Promise<SelectProps.Option[]> {
  const out: SelectProps.Option[] = [];
  let Marker: string | undefined;
  do {
    const res = await iam.send(new ListRolesCommand({ Marker }));
    out.push(...(res.Roles ?? []).map((r) => ({ value: r.Arn ?? "", label: r.RoleName ?? "", description: r.Arn })));
    Marker = res.IsTruncated ? res.Marker : undefined;
  } while (Marker);
  return out;
}

const listFunctions = async (): Promise<SelectProps.Option[]> => (await listAllFunctions()).map((f) => ({ value: f.FunctionArn ?? "", label: f.FunctionName ?? "", description: f.FunctionArn }));

/** The data sources of an API: list, create and delete. */
export function DataSourcesTab({ apiId }: { apiId: string }) {
  const notify = useNotify();
  const list = useLoad(() => listDataSources(apiId), [apiId]);
  const form = useSubmit();
  const [selected, setSelected] = useState<DataSource[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("NONE");
  const [table, setTable] = useState("");
  const [fn, setFn] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [role, setRole] = useState("");
  const needsRole = type === "AMAZON_DYNAMODB" || type === "AWS_LAMBDA";
  // The pickers load only when the dialog needs them.
  const tables = useLoad(async () => (creating && type === "AMAZON_DYNAMODB" ? listTables() : []), [creating, type]);
  const functions = useLoad(async () => (creating && type === "AWS_LAMBDA" ? listFunctions() : []), [creating, type]);
  const roles = useLoad(async () => (creating && needsRole ? listRoles() : []), [creating, needsRole]);

  const openCreate = () => {
    setName("");
    setType("NONE");
    setTable("");
    setFn("");
    setEndpoint("");
    setRole("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[_A-Za-z][_0-9A-Za-z]{0,64}$/.test(name)) return form.setError("Start the name with a letter or an underscore. Use letters, numbers and underscores only.");
    if (list.data?.some((d) => d.name === name)) return form.setError(`A data source named ${name} already exists.`);
    if (type === "AMAZON_DYNAMODB" && !table) return form.setError("Choose a table.");
    if (type === "AWS_LAMBDA" && !fn) return form.setError("Choose a function.");
    if (type === "HTTP" && !/^https?:\/\/[^\s/]+$/.test(endpoint)) return form.setError("Enter an endpoint such as https://api.example.com, without a path.");
    const serviceRoleArn = role || undefined;
    const ok = await form.run(async () => {
      if (type === "AMAZON_DYNAMODB") {
        await appsync.send(new CreateDataSourceCommand({ apiId, name, type: "AMAZON_DYNAMODB", serviceRoleArn, dynamodbConfig: { tableName: table, awsRegion: getRegion() } }));
      } else if (type === "AWS_LAMBDA") {
        await appsync.send(new CreateDataSourceCommand({ apiId, name, type: "AWS_LAMBDA", serviceRoleArn, lambdaConfig: { lambdaFunctionArn: fn } }));
      } else if (type === "HTTP") {
        await appsync.send(new CreateDataSourceCommand({ apiId, name, type: "HTTP", httpConfig: { endpoint } }));
      } else {
        await appsync.send(new CreateDataSourceCommand({ apiId, name, type: "NONE" }));
      }
      notify.success(`Data source ${name} was created.`);
      list.reload(true);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    const d = selected[0];
    try {
      await appsync.send(new DeleteDataSourceCommand({ apiId, name: d.name }));
      notify.success(`Data source ${d.name} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the data source", e);
    }
    setDeleting(false);
    list.reload(true);
  };

  const picker = (value: string, set: (v: string) => void, load: { data?: SelectProps.Option[]; loading: boolean }, placeholder: string, empty: string) => (
    <Select
      selectedOption={load.data?.find((o) => o.value === value) ?? null}
      onChange={(e) => set(e.detail.selectedOption.value ?? "")}
      options={load.data ?? []}
      placeholder={placeholder}
      statusType={load.loading ? "loading" : "finished"}
      empty={empty}
      filteringType="auto"
    />
  );

  return (
    <>
      <ResourceTable
        title="Data sources"
        description="A data source is where a resolver reads or writes: a table, a function, an HTTP endpoint, or nothing."
        resourceName="data sources"
        variant="container"
        stickyHeader={false}
        global
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(d) => d.name ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create data source</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button onClick={openCreate}>Create data source</Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (d) => d.name, sortingField: "name", isRowHeader: true },
          { id: "type", header: "Type", cell: (d) => SOURCE_LABEL[d.type ?? ""] ?? d.type ?? "-", sortingField: "type" },
          { id: "resource", header: "Resource", cell: (d) => sourceResource(d) || "-" },
          { id: "role", header: "Service role", cell: (d) => d.serviceRoleArn?.split("/").pop() ?? "-" },
        ]}
      />

      <FormModal visible={creating} header="Create data source" submitLabel="Create data source" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Data source name" constraintText="Letters, numbers and underscores. No hyphens.">
          <Input value={name} placeholder="my_data_source" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Data source type" description={type === "NONE" ? "A resolver with this data source builds its answer in its own code." : undefined}>
          <Select selectedOption={{ value: type, label: SOURCE_LABEL[type] }} onChange={(e) => setType(e.detail.selectedOption.value ?? type)} options={TYPES.map((value) => ({ value, label: SOURCE_LABEL[value] }))} />
        </FormField>
        {type === "AMAZON_DYNAMODB" && <FormField label="Table name">{picker(table, setTable, tables, "Choose a table", "No tables. Create one in DynamoDB first.")}</FormField>}
        {type === "AWS_LAMBDA" && <FormField label="Function ARN">{picker(fn, setFn, functions, "Choose a function", "No functions. Create one in Lambda first.")}</FormField>}
        {type === "HTTP" && (
          <FormField label="HTTP endpoint" constraintText="The scheme and the host, without a path.">
            <Input value={endpoint} placeholder="https://api.example.com" onChange={(e) => setEndpoint(e.detail.value)} />
          </FormField>
        )}
        {needsRole && (
          <FormField label="Service role - optional" description="AWS needs a role here. floci needs one only when IAM enforcement is on.">
            {picker(role, setRole, roles, "Choose a role", "No roles")}
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={`Delete ${selected[0]?.name ?? "data source"}?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        Resolvers that use this data source stop working.
      </ConfirmDelete>
    </>
  );
}
