import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateApiKeyCommand, CreateGraphqlApiCommand, DeleteGraphqlApiCommand, type GraphqlApi } from "@aws-sdk/client-appsync";
import { ListUserPoolsCommand } from "@aws-sdk/client-cognito-identity-provider";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { appsync } from "../../clients/appsync";
import { cognito } from "../../clients/cognito";
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
import { listAllFunctions } from "../lambda/Functions";
import { AUTH_LABEL, authLabel, listApis } from "./appsyncutil";

const AUTH_TYPES = ["API_KEY", "AWS_IAM", "AMAZON_COGNITO_USER_POOLS", "AWS_LAMBDA"];

async function listPools() {
  const out: { value: string; label: string }[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken }));
    out.push(...(res.UserPools ?? []).map((p) => ({ value: p.Id ?? "", label: p.Name ?? p.Id ?? "", description: p.Id })));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

const listFunctionOptions = async () => (await listAllFunctions()).map((f) => ({ value: f.FunctionArn ?? "", label: f.FunctionName ?? "", description: f.FunctionArn }));

export default function Apis() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listApis, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<GraphqlApi[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [auth, setAuth] = useState("API_KEY");
  const [pool, setPool] = useState("");
  const [fn, setFn] = useState("");
  // The pickers load only when the dialog needs them.
  const pools = useLoad(async () => (creating && auth === "AMAZON_COGNITO_USER_POOLS" ? listPools() : []), [creating, auth]);
  const functions = useLoad(async () => (creating && auth === "AWS_LAMBDA" ? listFunctionOptions() : []), [creating, auth]);

  const openCreate = () => {
    setName("");
    setAuth("API_KEY");
    setPool("");
    setFn("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[_A-Za-z0-9 -]{1,65}$/.test(name.trim())) return form.setError("Enter a name of 1 to 65 characters. Use letters, numbers, spaces, hyphens and underscores.");
    if (auth === "AMAZON_COGNITO_USER_POOLS" && !pool) return form.setError("Choose a user pool.");
    if (auth === "AWS_LAMBDA" && !fn) return form.setError("Choose a Lambda function.");
    const ok = await form.run(async () => {
      let api: GraphqlApi | undefined;
      if (auth === "AMAZON_COGNITO_USER_POOLS") {
        api = (await appsync.send(new CreateGraphqlApiCommand({ name: name.trim(), authenticationType: "AMAZON_COGNITO_USER_POOLS", userPoolConfig: { userPoolId: pool, awsRegion: getRegion(), defaultAction: "ALLOW" } }))).graphqlApi;
      } else if (auth === "AWS_LAMBDA") {
        api = (await appsync.send(new CreateGraphqlApiCommand({ name: name.trim(), authenticationType: "AWS_LAMBDA", lambdaAuthorizerConfig: { authorizerUri: fn, authorizerResultTtlInSeconds: 300 } }))).graphqlApi;
      } else if (auth === "AWS_IAM") {
        api = (await appsync.send(new CreateGraphqlApiCommand({ name: name.trim(), authenticationType: "AWS_IAM" }))).graphqlApi;
      } else {
        api = (await appsync.send(new CreateGraphqlApiCommand({ name: name.trim(), authenticationType: "API_KEY" }))).graphqlApi;
      }
      const id = api?.apiId ?? "";
      // An API key API is no use without a key, so make the first one.
      if (auth === "API_KEY") await appsync.send(new CreateApiKeyCommand({ apiId: id }));
      notify.success(`API ${name.trim()} was created.`);
      navigate(`/appsync/apis/${id}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const a of selected) await appsync.send(new DeleteGraphqlApiCommand({ apiId: a.apiId }));
      notify.success(selected.length === 1 ? `API ${selected[0].name} was deleted.` : `Deleted ${selected.length} APIs.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the API", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="appsync" contentType="table" breadcrumbs={[{ text: "AWS AppSync", href: "/appsync/apis" }, { text: "APIs", href: "/appsync/apis" }]}>
      <ResourceTable
        title="APIs"
        resourceName="APIs"
        filterPlaceholder="Find APIs"
        emptyDescription="An AppSync API serves GraphQL. A schema defines the types, and resolvers connect fields to data sources."
        emptyCli="appsync create-graphql-api --name my-api --authentication-type API_KEY"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(a) => a.apiId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create API</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create API
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (a) => <RouterLink to={`/appsync/apis/${a.apiId}`}>{a.name}</RouterLink>, sortingField: "name", isRowHeader: true },
          { id: "id", header: "API ID", cell: (a) => a.apiId, sortingField: "apiId" },
          { id: "type", header: "Type", cell: (a) => (a.apiType === "MERGED" ? "Merged" : "GraphQL") },
          { id: "auth", header: "Primary auth mode", cell: (a) => authLabel(a.authenticationType), sortingField: "authenticationType" },
          { id: "endpoint", header: "Endpoint", cell: (a) => <Copy text={a.uris?.GRAPHQL} /> },
        ]}
      />

      <FormModal visible={creating} header="Create API" submitLabel="Create API" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="API name">
          <Input value={name} placeholder="my-api" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Primary authorization mode" description={auth === "API_KEY" ? "The console also creates a first API key. It expires after 7 days." : undefined}>
          <Select selectedOption={{ value: auth, label: AUTH_LABEL[auth] }} onChange={(e) => setAuth(e.detail.selectedOption.value ?? auth)} options={AUTH_TYPES.map((value) => ({ value, label: AUTH_LABEL[value] }))} />
        </FormField>
        {auth === "AMAZON_COGNITO_USER_POOLS" && (
          <FormField label="User pool">
            <Select
              selectedOption={pools.data?.find((p) => p.value === pool) ?? null}
              onChange={(e) => setPool(e.detail.selectedOption.value ?? "")}
              options={pools.data ?? []}
              placeholder="Choose a user pool"
              statusType={pools.loading ? "loading" : "finished"}
              empty="No user pools. Create one in Cognito first."
              filteringType="auto"
            />
          </FormField>
        )}
        {auth === "AWS_LAMBDA" && (
          <FormField label="Lambda function" description="The function decides if a request is allowed.">
            <Select
              selectedOption={functions.data?.find((f) => f.value === fn) ?? null}
              onChange={(e) => setFn(e.detail.selectedOption.value ?? "")}
              options={functions.data ?? []}
              placeholder="Choose a function"
              statusType={functions.loading ? "loading" : "finished"}
              empty="No functions. Create one in Lambda first."
              filteringType="auto"
            />
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].name}?` : `Delete ${selected.length} APIs?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        This deletes the API with its schema, data sources, resolvers and API keys. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
