import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DeleteGraphqlApiCommand, GetGraphqlApiCommand } from "@aws-sdk/client-appsync";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { appsync } from "../../clients/appsync";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { DataSourcesTab } from "./DataSourcesTab";
import { QueriesTab } from "./QueriesTab";
import { ResolversTab } from "./ResolversTab";
import { SchemaTab } from "./SchemaTab";
import { SettingsTab } from "./SettingsTab";
import { authLabel } from "./appsyncutil";

export default function ApiDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const api = useLoad(async () => (await appsync.send(new GetGraphqlApiCommand({ apiId: id }))).graphqlApi, [id]);
  const [deleting, setDeleting] = useState(false);
  const a = api.data;
  const title = a?.name ?? id;

  const remove = async () => {
    try {
      await appsync.send(new DeleteGraphqlApiCommand({ apiId: id }));
      notify.success(`API ${title} was deleted.`);
      navigate("/appsync/apis");
    } catch (e) {
      notify.error("Could not delete the API", e);
      setDeleting(false);
    }
  };

  return (
    <Shell
      service="appsync"
      breadcrumbs={[
        { text: "AWS AppSync", href: "/appsync/apis" },
        { text: "APIs", href: "/appsync/apis" },
        { text: title, href: `/appsync/apis/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => api.reload()} />
                <Button disabled={!a} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {title}
          </Header>
        }
      >
        {api.error ? (
          <Alert type="error" header="Could not load the API">
            {api.error}
          </Alert>
        ) : !a ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">API details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="API name">{a.name}</Pair>
                <Pair label="API ID">
                  <Copy text={a.apiId} />
                </Pair>
                <Pair label="Primary authorization mode">{authLabel(a.authenticationType)}</Pair>
                <Pair label="GraphQL endpoint">
                  <Copy text={a.uris?.GRAPHQL} />
                </Pair>
                <Pair label="API ARN">
                  <Copy text={a.arn} />
                </Pair>
                <Pair label="Real-time endpoint">Not served by floci</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "schema", label: "Schema", content: <SchemaTab apiId={id} /> },
                { id: "sources", label: "Data sources", content: <DataSourcesTab apiId={id} /> },
                { id: "resolvers", label: "Resolvers", content: <ResolversTab apiId={id} /> },
                { id: "queries", label: "Queries", content: <QueriesTab api={a} /> },
                { id: "settings", label: "Settings", content: <SettingsTab api={a} onChange={() => api.reload(true)} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <ConfirmDelete visible={deleting} title={`Delete ${title}?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        This deletes the API with its schema, data sources, resolvers and API keys. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
