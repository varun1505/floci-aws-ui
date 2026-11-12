import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateRestApiCommand, DeleteRestApiCommand } from "@aws-sdk/client-api-gateway";
import { CreateApiCommand, CreateStageCommand, DeleteApiCommand } from "@aws-sdk/client-apigatewayv2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { apigw } from "../../clients/apigw";
import { apigwv2 } from "../../clients/apigwv2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { type ApiRow, apiHref, listApis } from "./apiutil";

export default function Apis() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listApis, []);
  const [selected, setSelected] = useState<ApiRow[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState("REST");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (!name.trim()) return setError("API name is required.");
    setBusy(true);
    setError("");
    try {
      let href: string;
      if (type === "REST") {
        const res = await apigw.send(new CreateRestApiCommand({ name: name.trim(), description: description || undefined, endpointConfiguration: { types: ["REGIONAL"] } }));
        href = apiHref({ id: res.id ?? "", protocol: "REST" });
      } else {
        const res = await apigwv2.send(new CreateApiCommand({ Name: name.trim(), Description: description || undefined, ProtocolType: "HTTP" }));
        // The AWS console adds an auto-deployed $default stage to every new HTTP API.
        await apigwv2.send(new CreateStageCommand({ ApiId: res.ApiId, StageName: "$default", AutoDeploy: true }));
        href = apiHref({ id: res.ApiId ?? "", protocol: "HTTP" });
      }
      notify.success(`Successfully created API ${name.trim()}.`);
      navigate(href);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const api of selected) {
        if (api.protocol === "REST") await apigw.send(new DeleteRestApiCommand({ restApiId: api.id }));
        else await apigwv2.send(new DeleteApiCommand({ ApiId: api.id }));
      }
      notify.success(`Deleted ${selected.length} API${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the API", e);
    }
    setDeleting(false);
    list.reload();
  };

  const openCreate = () => {
    setName("");
    setDescription("");
    setError("");
    setCreating(true);
  };

  return (
    <Shell service="apigateway" contentType="table" breadcrumbs={[{ text: "API Gateway", href: "/apigateway/apis" }, { text: "APIs", href: "/apigateway/apis" }]}>
      <ResourceTable
        title="APIs"
        resourceName="APIs"
        filterPlaceholder="Find APIs"
        emptyDescription="An API gives your Lambda functions and HTTP services a URL that clients can call."
        emptyCli="apigatewayv2 create-api --name my-api --protocol-type HTTP"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(a) => `${a.protocol}:${a.id}`}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create API</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create API
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (a) => <RouterLink to={apiHref(a)}>{a.name}</RouterLink>, sortingField: "name", isRowHeader: true },
          { id: "description", header: "Description", cell: (a) => a.description || "-" },
          { id: "id", header: "ID", cell: (a) => a.id, sortingField: "id" },
          { id: "protocol", header: "Protocol", cell: (a) => a.protocol, sortingField: "protocol" },
          { id: "endpoint", header: "API endpoint type", cell: (a) => a.endpointType },
          { id: "created", header: "Created", cell: (a) => formatDate(a.created), sortingComparator: (a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0) },
        ]}
      />

      <Modal
        visible={creating}
        size="large"
        onDismiss={() => setCreating(false)}
        header="Create API"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create API
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Choose an API type">
            <Tiles
              value={type}
              onChange={(e) => setType(e.detail.value)}
              items={[
                { value: "REST", label: "REST API", description: "Full control over resources, methods, request and response mapping. Supports mock integrations." },
                { value: "HTTP", label: "HTTP API", description: "A simpler and faster API for Lambda functions and HTTP backends. Routes deploy automatically." },
              ]}
            />
          </FormField>
          <FormField label="API name" errorText={error}>
            <Input value={name} placeholder="my-api" onChange={(e) => setName(e.detail.value)} />
          </FormField>
          <FormField label="Description - optional">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete ${selected[0].name}` : `Delete ${selected.length} APIs`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting an API removes its resources, routes and stages. Clients calling it will get errors."
      />
    </Shell>
  );
}
