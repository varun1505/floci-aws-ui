import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  DeleteApiCommand,
  DeleteIntegrationCommand,
  DeleteRouteCommand,
  DeleteStageCommand,
  GetApiCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  type Integration,
  type Route,
  type Stage,
} from "@aws-sdk/client-apigatewayv2";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { apigwv2 } from "../../clients/apigwv2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { IntegrationFields, TestInvoke, emptyIntegration, integrationError } from "./apiparts";
import { HTTP_METHODS, Pair, integrationTarget, invokeUrl, listFunctionArns } from "./apiutil";

const copy = (text: string) => <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;

export default function HttpApiDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const api = useLoad(() => apigwv2.send(new GetApiCommand({ ApiId: id })), [id]);
  const routes = useLoad(async () => (await apigwv2.send(new GetRoutesCommand({ ApiId: id }))).Items ?? [], [id]);
  const integrations = useLoad(async () => (await apigwv2.send(new GetIntegrationsCommand({ ApiId: id }))).Items ?? [], [id]);
  const stages = useLoad(async () => (await apigwv2.send(new GetStagesCommand({ ApiId: id }))).Items ?? [], [id]);
  const functions = useLoad(listFunctionArns, []);

  const [modal, setModal] = useState<"route" | "stage" | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [integration, setIntegration] = useState(emptyIntegration);
  const [stageName, setStageName] = useState("");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState<Route[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration[]>([]);
  const [selectedStage, setSelectedStage] = useState<Stage[]>([]);
  const [deleting, setDeleting] = useState<"api" | "route" | "integration" | "stage" | undefined>(undefined);

  const name = api.data?.Name ?? id;
  const stageNames = (stages.data ?? []).map((s) => s.StageName ?? "");
  const byId = new Map((integrations.data ?? []).map((i) => [i.IntegrationId, i]));
  const targetOf = (r: Route) => {
    const i = byId.get(r.Target?.replace("integrations/", ""));
    return i ? integrationTarget(i.IntegrationUri) : "-";
  };

  const open = (which: "route" | "stage") => {
    setError("");
    setPath("/");
    setStageName("");
    setIntegration(emptyIntegration());
    setModal(which);
  };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      notify.success(await work());
      setModal(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const createRoute = () => {
    if (!path.startsWith("/")) return setError("The path must start with a slash (/).");
    const problem = integrationError(integration);
    if (problem) return setError(problem);
    return run(async () => {
      const created = await apigwv2.send(
        integration.kind === "lambda"
          ? new CreateIntegrationCommand({ ApiId: id, IntegrationType: "AWS_PROXY", IntegrationUri: integration.fn, PayloadFormatVersion: "2.0" })
          : new CreateIntegrationCommand({ ApiId: id, IntegrationType: "HTTP_PROXY", IntegrationMethod: method, IntegrationUri: integration.url, PayloadFormatVersion: "1.0" }),
      );
      await apigwv2.send(new CreateRouteCommand({ ApiId: id, RouteKey: `${method} ${path}`, Target: `integrations/${created.IntegrationId}` }));
      routes.reload(true);
      integrations.reload(true);
      return `Successfully created route ${method} ${path}.`;
    });
  };

  const createStage = () => {
    if (!/^(\$default|[a-zA-Z0-9_-]+)$/.test(stageName)) return setError("Use letters, numbers, hyphens and underscores, or $default.");
    return run(async () => {
      await apigwv2.send(new CreateStageCommand({ ApiId: id, StageName: stageName, AutoDeploy: autoDeploy }));
      stages.reload(true);
      return `Successfully created stage ${stageName}.`;
    });
  };

  const remove = async () => {
    try {
      if (deleting === "api") {
        await apigwv2.send(new DeleteApiCommand({ ApiId: id }));
        notify.success(`Successfully deleted ${name}.`);
        return navigate("/apigateway/apis");
      }
      if (deleting === "route") for (const r of selectedRoute) await apigwv2.send(new DeleteRouteCommand({ ApiId: id, RouteId: r.RouteId }));
      if (deleting === "integration") for (const i of selectedIntegration) await apigwv2.send(new DeleteIntegrationCommand({ ApiId: id, IntegrationId: i.IntegrationId }));
      if (deleting === "stage") for (const s of selectedStage) await apigwv2.send(new DeleteStageCommand({ ApiId: id, StageName: s.StageName }));
      notify.success(`Deleted the ${deleting}.`);
      setSelectedRoute([]);
      setSelectedIntegration([]);
      setSelectedStage([]);
    } catch (e) {
      notify.error(`Could not delete the ${deleting}`, e);
    }
    setDeleting(undefined);
    routes.reload(true);
    integrations.reload(true);
    stages.reload(true);
  };

  const footer = (label: string, action: () => void) => (
    <Box float="right">
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="link" onClick={() => setModal(undefined)}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={action}>
          {label}
        </Button>
      </SpaceBetween>
    </Box>
  );

  const tableActions = (disabled: boolean, onDelete: () => void, createLabel?: string, onCreate?: () => void) => (
    <SpaceBetween direction="horizontal" size="xs">
      <Button disabled={disabled} onClick={onDelete}>
        Delete
      </Button>
      {createLabel && <Button onClick={onCreate}>{createLabel}</Button>}
    </SpaceBetween>
  );

  return (
    <Shell
      service="apigateway"
      breadcrumbs={[
        { text: "API Gateway", href: "/apigateway/apis" },
        { text: "APIs", href: "/apigateway/apis" },
        { text: name, href: `/apigateway/http/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={api.data?.Description}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (api.reload(), routes.reload(), integrations.reload(), stages.reload())} />
                <Button onClick={() => setDeleting("api")}>Delete</Button>
                <Button variant="primary" onClick={() => open("route")}>
                  Create route
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {api.error ? (
          <Alert type="error" header="Could not load the API">
            {api.error}
          </Alert>
        ) : !api.data ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">API details</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="API ID">{copy(id)}</Pair>
                <Pair label="Protocol">{api.data.ProtocolType}</Pair>
                <Pair label="Created">{formatDate(api.data.CreatedDate)}</Pair>
                <Pair label="Default invoke URL">{stageNames.includes("$default") ? copy(invokeUrl(id, "$default")) : undefined}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "routes",
                  label: "Routes",
                  content: (
                    <SpaceBetween size="l">
                      <Table
                        header={
                          <Header variant="h2" counter={`(${routes.data?.length ?? 0})`} actions={tableActions(selectedRoute.length === 0, () => setDeleting("route"), "Create route", () => open("route"))}>
                            Routes
                          </Header>
                        }
                        loading={routes.loading}
                        loadingText="Loading routes"
                        items={routes.data ?? []}
                        trackBy="RouteId"
                        selectionType="single"
                        selectedItems={selectedRoute}
                        onSelectionChange={(e) => setSelectedRoute(e.detail.selectedItems)}
                        columnDefinitions={[
                          { id: "key", header: "Route", cell: (r) => r.RouteKey, isRowHeader: true },
                          { id: "target", header: "Integration", cell: targetOf },
                          { id: "auth", header: "Authorization", cell: (r) => r.AuthorizationType ?? "NONE" },
                          { id: "id", header: "Route ID", cell: (r) => r.RouteId },
                        ]}
                        empty={
                          <Box textAlign="center" color="inherit">
                            <b>No routes</b>
                            <Box variant="p" color="inherit">
                              A route sends requests for a method and path to a Lambda function or an HTTP endpoint.
                            </Box>
                            <Button onClick={() => open("route")}>Create route</Button>
                          </Box>
                        }
                      />
                      <TestInvoke apiId={id} stages={stageNames} />
                    </SpaceBetween>
                  ),
                },
                {
                  id: "integrations",
                  label: "Integrations",
                  content: (
                    <Table
                      header={
                        <Header variant="h2" counter={`(${integrations.data?.length ?? 0})`} actions={tableActions(selectedIntegration.length === 0, () => setDeleting("integration"))}>
                          Integrations
                        </Header>
                      }
                      loading={integrations.loading}
                      loadingText="Loading integrations"
                      items={integrations.data ?? []}
                      trackBy="IntegrationId"
                      selectionType="single"
                      selectedItems={selectedIntegration}
                      onSelectionChange={(e) => setSelectedIntegration(e.detail.selectedItems)}
                      columnDefinitions={[
                        { id: "id", header: "Integration ID", cell: (i) => i.IntegrationId, isRowHeader: true },
                        { id: "type", header: "Type", cell: (i) => i.IntegrationType ?? "-" },
                        { id: "target", header: "Target", cell: (i) => integrationTarget(i.IntegrationUri) },
                        { id: "method", header: "Method", cell: (i) => i.IntegrationMethod ?? "-" },
                        { id: "payload", header: "Payload format", cell: (i) => i.PayloadFormatVersion ?? "-" },
                      ]}
                      empty={<Box textAlign="center">No integrations. Create a route to add one.</Box>}
                    />
                  ),
                },
                {
                  id: "stages",
                  label: "Stages",
                  content: (
                    <Table
                      header={
                        <Header variant="h2" counter={`(${stageNames.length})`} actions={tableActions(selectedStage.length === 0, () => setDeleting("stage"), "Create stage", () => open("stage"))}>
                          Stages
                        </Header>
                      }
                      loading={stages.loading}
                      loadingText="Loading stages"
                      items={stages.data ?? []}
                      trackBy="StageName"
                      selectionType="single"
                      selectedItems={selectedStage}
                      onSelectionChange={(e) => setSelectedStage(e.detail.selectedItems)}
                      columnDefinitions={[
                        { id: "name", header: "Stage name", cell: (s) => s.StageName, isRowHeader: true },
                        { id: "url", header: "Invoke URL", cell: (s) => copy(invokeUrl(id, s.StageName ?? "")) },
                        { id: "auto", header: "Automatic deployment", cell: (s) => (s.AutoDeploy ? "Enabled" : "Disabled") },
                        { id: "updated", header: "Last updated", cell: (s) => formatDate(s.LastUpdatedDate) },
                      ]}
                      empty={
                        <Box textAlign="center" color="inherit">
                          <b>No stages</b>
                          <Box variant="p" color="inherit">
                            A stage gives the API a URL that clients can call.
                          </Box>
                          <Button onClick={() => open("stage")}>Create stage</Button>
                        </Box>
                      }
                    />
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <Modal visible={modal === "route"} size="large" onDismiss={() => setModal(undefined)} header="Create route" footer={footer("Create route", createRoute)}>
        <SpaceBetween size="l">
          <ColumnLayout columns={2}>
            <FormField label="Method">
              <Select selectedOption={{ value: method, label: method }} onChange={(e) => setMethod(e.detail.selectedOption.value ?? "GET")} options={HTTP_METHODS.map((m) => ({ value: m, label: m }))} />
            </FormField>
            <FormField label="Path" description="For example /users/{id} or /{proxy+}.">
              <Input value={path} placeholder="/users" onChange={(e) => setPath(e.detail.value)} />
            </FormField>
          </ColumnLayout>
          <IntegrationFields draft={integration} onChange={setIntegration} functions={functions.data ?? []} functionsLoading={functions.loading} />
          {error && <Alert type="error">{error}</Alert>}
        </SpaceBetween>
      </Modal>

      <Modal visible={modal === "stage"} onDismiss={() => setModal(undefined)} header="Create stage" footer={footer("Create stage", createStage)}>
        <SpaceBetween size="l">
          <FormField label="Stage name" errorText={error}>
            <Input value={stageName} placeholder="dev" onChange={(e) => setStageName(e.detail.value)} />
          </FormField>
          <Checkbox checked={autoDeploy} onChange={(e) => setAutoDeploy(e.detail.checked)}>
            Deploy route changes automatically
          </Checkbox>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={deleting !== undefined}
        title={deleting === "api" ? `Delete ${name}` : `Delete ${deleting}`}
        onCancel={() => setDeleting(undefined)}
        onConfirm={remove}
        warning={deleting === "api" ? "Deleting an API removes its routes, integrations and stages." : undefined}
      />
    </Shell>
  );
}
