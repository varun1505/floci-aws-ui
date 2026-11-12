import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CreateDeploymentCommand,
  CreateResourceCommand,
  DeleteMethodCommand,
  DeleteResourceCommand,
  DeleteRestApiCommand,
  DeleteStageCommand,
  GetResourcesCommand,
  GetRestApiCommand,
  GetStagesCommand,
  PutIntegrationCommand,
  PutIntegrationResponseCommand,
  PutMethodCommand,
  PutMethodResponseCommand,
  type Resource,
  type Stage,
} from "@aws-sdk/client-api-gateway";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
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
import { apigw } from "../../clients/apigw";
import { getRegion } from "../../config";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { IntegrationFields, TestInvoke, emptyIntegration, integrationError } from "./apiparts";
import { HTTP_METHODS, Pair, integrationTarget, invokeUrl, lambdaUri, listFunctionArns } from "./apiutil";

type MethodRow = { key: string; resourceId: string; path: string; method: string; type: string; target: string; auth: string };

const copy = (text: string) => <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;

export default function RestApiDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const api = useLoad(() => apigw.send(new GetRestApiCommand({ restApiId: id })), [id]);
  const resources = useLoad(
    async () => ((await apigw.send(new GetResourcesCommand({ restApiId: id, embed: ["methods"], limit: 500 }))).items ?? []).sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "")),
    [id],
  );
  const stages = useLoad(async () => (await apigw.send(new GetStagesCommand({ restApiId: id }))).item ?? [], [id]);
  const functions = useLoad(listFunctionArns, []);

  const [modal, setModal] = useState<"resource" | "method" | "deploy" | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parent, setParent] = useState("");
  const [pathPart, setPathPart] = useState("");
  const [methodResource, setMethodResource] = useState("");
  const [method, setMethod] = useState("GET");
  const [integration, setIntegration] = useState(emptyIntegration);
  const [stageName, setStageName] = useState("dev");
  const [selectedResource, setSelectedResource] = useState<Resource[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<MethodRow[]>([]);
  const [selectedStage, setSelectedStage] = useState<Stage[]>([]);
  const [deleting, setDeleting] = useState<"api" | "resource" | "method" | "stage" | undefined>(undefined);

  const name = api.data?.name ?? id;
  const all = resources.data ?? [];
  const root = all.find((r) => r.path === "/");
  const resourceOptions = all.map((r) => ({ value: r.id ?? "", label: r.path ?? "" }));
  const methods: MethodRow[] = all.flatMap((r) =>
    Object.entries(r.resourceMethods ?? {}).map(([m, def]) => ({
      key: `${r.id}:${m}`,
      resourceId: r.id ?? "",
      path: r.path ?? "",
      method: m,
      type: def.methodIntegration?.type ?? "-",
      target: def.methodIntegration?.type === "MOCK" ? "Mock response" : integrationTarget(def.methodIntegration?.uri),
      auth: def.authorizationType ?? "NONE",
    })),
  );
  const stageNames = (stages.data ?? []).map((s) => s.stageName ?? "");

  const open = (which: "resource" | "method" | "deploy") => {
    setError("");
    setPathPart("");
    setParent(selectedResource[0]?.id ?? root?.id ?? "");
    setMethodResource(selectedResource[0]?.id ?? root?.id ?? "");
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

  const createResource = () => {
    if (!/^[a-zA-Z0-9._\-{}+]+$/.test(pathPart)) return setError("Use letters, numbers, hyphens, or a path parameter like {id}.");
    return run(async () => {
      await apigw.send(new CreateResourceCommand({ restApiId: id, parentId: parent, pathPart }));
      resources.reload(true);
      return `Successfully created resource ${pathPart}.`;
    });
  };

  const createMethod = () => {
    const problem = integrationError(integration);
    if (problem) return setError(problem);
    const target = { restApiId: id, resourceId: methodResource, httpMethod: method };
    return run(async () => {
      await apigw.send(new PutMethodCommand({ ...target, authorizationType: "NONE" }));
      if (integration.kind === "lambda") {
        await apigw.send(new PutIntegrationCommand({ ...target, type: "AWS_PROXY", integrationHttpMethod: "POST", uri: lambdaUri(getRegion(), integration.fn) }));
      } else if (integration.kind === "http") {
        await apigw.send(new PutIntegrationCommand({ ...target, type: "HTTP_PROXY", integrationHttpMethod: method, uri: integration.url }));
      } else {
        await apigw.send(new PutIntegrationCommand({ ...target, type: "MOCK", requestTemplates: { "application/json": '{"statusCode": 200}' } }));
        await apigw.send(new PutMethodResponseCommand({ ...target, statusCode: "200" }));
        await apigw.send(new PutIntegrationResponseCommand({ ...target, statusCode: "200", responseTemplates: { "application/json": integration.mockBody } }));
      }
      resources.reload(true);
      return `Successfully created method ${method}. Deploy the API to make it live.`;
    });
  };

  const deploy = () => {
    if (!/^[a-zA-Z0-9_-]+$/.test(stageName)) return setError("Use letters, numbers, hyphens and underscores.");
    return run(async () => {
      await apigw.send(new CreateDeploymentCommand({ restApiId: id, stageName }));
      stages.reload(true);
      return `Successfully deployed ${name} to stage ${stageName}.`;
    });
  };

  const remove = async () => {
    try {
      if (deleting === "api") {
        await apigw.send(new DeleteRestApiCommand({ restApiId: id }));
        notify.success(`Successfully deleted ${name}.`);
        return navigate("/apigateway/apis");
      }
      if (deleting === "resource") for (const r of selectedResource) await apigw.send(new DeleteResourceCommand({ restApiId: id, resourceId: r.id }));
      if (deleting === "method") for (const m of selectedMethod) await apigw.send(new DeleteMethodCommand({ restApiId: id, resourceId: m.resourceId, httpMethod: m.method }));
      if (deleting === "stage") for (const s of selectedStage) await apigw.send(new DeleteStageCommand({ restApiId: id, stageName: s.stageName }));
      notify.success(`Deleted the ${deleting}.`);
      setSelectedResource([]);
      setSelectedMethod([]);
      setSelectedStage([]);
    } catch (e) {
      notify.error(`Could not delete the ${deleting}`, e);
    }
    setDeleting(undefined);
    resources.reload(true);
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

  return (
    <Shell
      service="apigateway"
      breadcrumbs={[
        { text: "API Gateway", href: "/apigateway/apis" },
        { text: "APIs", href: "/apigateway/apis" },
        { text: name, href: `/apigateway/rest/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={api.data?.description}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (api.reload(), resources.reload(), stages.reload())} />
                <Button onClick={() => setDeleting("api")}>Delete</Button>
                <Button variant="primary" onClick={() => open("deploy")}>
                  Deploy API
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
                <Pair label="Protocol">REST</Pair>
                <Pair label="API endpoint type">{api.data.endpointConfiguration?.types?.join(", ") ?? "REGIONAL"}</Pair>
                <Pair label="Created">{formatDate(api.data.createdDate)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "resources",
                  label: "Resources",
                  content: (
                    <SpaceBetween size="l">
                      <Table
                        header={
                          <Header
                            variant="h2"
                            counter={`(${all.length})`}
                            actions={
                              <SpaceBetween direction="horizontal" size="xs">
                                <Button disabled={selectedResource.length === 0 || selectedResource[0].path === "/"} onClick={() => setDeleting("resource")}>
                                  Delete
                                </Button>
                                <Button onClick={() => open("resource")}>Create resource</Button>
                              </SpaceBetween>
                            }
                          >
                            Resources
                          </Header>
                        }
                        loading={resources.loading}
                        loadingText="Loading resources"
                        items={all}
                        trackBy="id"
                        selectionType="single"
                        selectedItems={selectedResource}
                        onSelectionChange={(e) => setSelectedResource(e.detail.selectedItems)}
                        columnDefinitions={[
                          { id: "path", header: "Path", cell: (r) => r.path, isRowHeader: true },
                          { id: "id", header: "Resource ID", cell: (r) => r.id },
                          { id: "methods", header: "Methods", cell: (r) => Object.keys(r.resourceMethods ?? {}).join(", ") || "-" },
                        ]}
                        empty={<Box textAlign="center">No resources</Box>}
                      />
                      <Table
                        header={
                          <Header
                            variant="h2"
                            counter={`(${methods.length})`}
                            actions={
                              <SpaceBetween direction="horizontal" size="xs">
                                <Button disabled={selectedMethod.length === 0} onClick={() => setDeleting("method")}>
                                  Delete
                                </Button>
                                <Button onClick={() => open("method")}>Create method</Button>
                              </SpaceBetween>
                            }
                          >
                            Methods
                          </Header>
                        }
                        items={methods}
                        trackBy="key"
                        selectionType="single"
                        selectedItems={selectedMethod}
                        onSelectionChange={(e) => setSelectedMethod(e.detail.selectedItems)}
                        columnDefinitions={[
                          { id: "method", header: "Method", cell: (m) => m.method, isRowHeader: true },
                          { id: "path", header: "Resource path", cell: (m) => m.path },
                          { id: "type", header: "Integration type", cell: (m) => m.type },
                          { id: "target", header: "Integration target", cell: (m) => m.target },
                          { id: "auth", header: "Authorization", cell: (m) => m.auth },
                        ]}
                        empty={
                          <Box textAlign="center" color="inherit">
                            <b>No methods</b>
                            <Box variant="p" color="inherit">
                              A method connects an HTTP verb on a resource to a Lambda function, an HTTP endpoint or a mock response.
                            </Box>
                            <Button onClick={() => open("method")}>Create method</Button>
                          </Box>
                        }
                      />
                    </SpaceBetween>
                  ),
                },
                {
                  id: "stages",
                  label: "Stages",
                  content: (
                    <SpaceBetween size="l">
                      <Table
                        header={
                          <Header
                            variant="h2"
                            counter={`(${stageNames.length})`}
                            actions={
                              <SpaceBetween direction="horizontal" size="xs">
                                <Button disabled={selectedStage.length === 0} onClick={() => setDeleting("stage")}>
                                  Delete
                                </Button>
                                <Button onClick={() => open("deploy")}>Deploy API</Button>
                              </SpaceBetween>
                            }
                          >
                            Stages
                          </Header>
                        }
                        loading={stages.loading}
                        loadingText="Loading stages"
                        items={stages.data ?? []}
                        trackBy="stageName"
                        selectionType="single"
                        selectedItems={selectedStage}
                        onSelectionChange={(e) => setSelectedStage(e.detail.selectedItems)}
                        columnDefinitions={[
                          { id: "name", header: "Stage name", cell: (s) => s.stageName, isRowHeader: true },
                          { id: "url", header: "Invoke URL", cell: (s) => copy(invokeUrl(id, s.stageName ?? "")) },
                          { id: "deployment", header: "Deployment ID", cell: (s) => s.deploymentId ?? "-" },
                          { id: "updated", header: "Last deployed", cell: (s) => formatDate(s.lastUpdatedDate) },
                        ]}
                        empty={
                          <Box textAlign="center" color="inherit">
                            <b>No stages</b>
                            <Box variant="p" color="inherit">
                              Deploy the API to a stage to get a URL that clients can call.
                            </Box>
                            <Button onClick={() => open("deploy")}>Deploy API</Button>
                          </Box>
                        }
                      />
                      <TestInvoke apiId={id} stages={stageNames} />
                    </SpaceBetween>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <Modal visible={modal === "resource"} onDismiss={() => setModal(undefined)} header="Create resource" footer={footer("Create resource", createResource)}>
        <SpaceBetween size="l">
          <FormField label="Resource path" description="The parent of the new resource.">
            <Select selectedOption={resourceOptions.find((o) => o.value === parent) ?? null} onChange={(e) => setParent(e.detail.selectedOption.value ?? "")} options={resourceOptions} />
          </FormField>
          <FormField label="Resource name" description="For a path parameter, use braces: {id}. For a catch-all, use {proxy+}." errorText={error}>
            <Input value={pathPart} placeholder="users" onChange={(e) => setPathPart(e.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={modal === "method"} size="large" onDismiss={() => setModal(undefined)} header="Create method" footer={footer("Create method", createMethod)}>
        <SpaceBetween size="l">
          <ColumnLayout columns={2}>
            <FormField label="Resource">
              <Select selectedOption={resourceOptions.find((o) => o.value === methodResource) ?? null} onChange={(e) => setMethodResource(e.detail.selectedOption.value ?? "")} options={resourceOptions} />
            </FormField>
            <FormField label="Method type">
              <Select selectedOption={{ value: method, label: method }} onChange={(e) => setMethod(e.detail.selectedOption.value ?? "GET")} options={HTTP_METHODS.map((m) => ({ value: m, label: m }))} />
            </FormField>
          </ColumnLayout>
          <IntegrationFields draft={integration} onChange={setIntegration} functions={functions.data ?? []} functionsLoading={functions.loading} allowMock errorText={error} />
          {integration.kind === "mock" && error && <Alert type="error">{error}</Alert>}
        </SpaceBetween>
      </Modal>

      <Modal visible={modal === "deploy"} onDismiss={() => setModal(undefined)} header="Deploy API" footer={footer("Deploy", deploy)}>
        <SpaceBetween size="l">
          <Box variant="p">A deployment makes the current resources and methods live on a stage.</Box>
          <FormField label="Stage name" description="Deploying to an existing stage replaces what is live there." errorText={error}>
            <Input value={stageName} placeholder="dev" onChange={(e) => setStageName(e.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={deleting !== undefined}
        title={deleting === "api" ? `Delete ${name}` : `Delete ${deleting}`}
        onCancel={() => setDeleting(undefined)}
        onConfirm={remove}
        warning={deleting === "api" ? "Deleting an API removes its resources, methods and stages." : deleting === "resource" ? "Deleting a resource also deletes its methods and child resources." : undefined}
      />
    </Shell>
  );
}
