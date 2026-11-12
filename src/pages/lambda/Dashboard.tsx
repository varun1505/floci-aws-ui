import { useNavigate } from "react-router-dom";
import { GetAccountSettingsCommand } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { lambda } from "../../clients/lambda";
import { getRegion } from "../../config";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { Stat } from "../../components/Stat";
import { formatBytes, formatDate } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { listAllFunctions } from "./Functions";

export default function LambdaDashboard() {
  const navigate = useNavigate();
  const data = useLoad(async () => {
    const [functions, account] = await Promise.all([listAllFunctions(), lambda.send(new GetAccountSettingsCommand({})).catch(() => undefined)]);
    return { functions, account };
  }, []);

  const functions = data.data?.functions ?? [];
  const limit = data.data?.account?.AccountLimit;
  const used = functions.reduce((sum, f) => sum + (f.CodeSize ?? 0), 0);
  const total = limit?.TotalCodeSize ?? 0;
  const recent = [...functions].sort((a, b) => (b.LastModified ?? "").localeCompare(a.LastModified ?? "")).slice(0, 5);
  const runtimes = Object.entries(
    functions.reduce<Record<string, number>>((acc, f) => {
      const key = f.Runtime ?? f.PackageType ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <Shell service="lambda" breadcrumbs={[{ text: "Lambda", href: "/lambda/home" }, { text: "Dashboard", href: "/lambda/home" }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={`Resources for ${getRegion()}`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => data.reload()} />
                <Button variant="primary" onClick={() => navigate("/lambda/functions/create")}>
                  Create function
                </Button>
              </SpaceBetween>
            }
          >
            Dashboard
          </Header>
        }
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Resources</Header>}>
            <ColumnLayout columns={4} variant="text-grid">
              <Stat label="Lambda function(s)" value={functions.length} to="/lambda/functions" loading={data.loading} />
              <Stat label="Code storage" value={formatBytes(used)} loading={data.loading} hint={total ? `${((used / total) * 100).toFixed(1)}% of ${formatBytes(total)}` : undefined} />
              <Stat label="Full account concurrency" value={limit?.ConcurrentExecutions ?? "-"} loading={data.loading} />
              <Stat label="Unreserved account concurrency" value={limit?.UnreservedConcurrentExecutions ?? "-"} loading={data.loading} />
            </ColumnLayout>
          </Container>

          <ColumnLayout columns={2}>
            <Table
              header={
                <Header variant="h2" counter={`(${recent.length})`} actions={<Button onClick={() => navigate("/lambda/functions")}>View all</Button>}>
                  Recently modified functions
                </Header>
              }
              loading={data.loading}
              loadingText="Loading functions"
              items={recent}
              columnDefinitions={[
                {
                  id: "name",
                  header: "Function name",
                  cell: (f) => <RouterLink to={`/lambda/functions/${f.FunctionName}`}>{f.FunctionName}</RouterLink>,
                  isRowHeader: true,
                },
                { id: "runtime", header: "Runtime", cell: (f) => f.Runtime ?? "-" },
                { id: "modified", header: "Last modified", cell: (f) => formatDate(f.LastModified) },
              ]}
              empty={
                <Box textAlign="center" color="inherit" margin={{ vertical: "s" }}>
                  <SpaceBetween size="s">
                    <div>
                      <b>No functions</b>
                      <Box variant="p" color="inherit">
                        Create your first function to see it here.
                      </Box>
                    </div>
                    <Button onClick={() => navigate("/lambda/functions/create")}>Create function</Button>
                  </SpaceBetween>
                </Box>
              }
            />
            <Container header={<Header variant="h2">Functions by runtime</Header>}>
              {runtimes.length === 0 ? (
                <Box color="text-status-inactive">{data.loading ? "Loading" : "No functions in this Region."}</Box>
              ) : (
                <SpaceBetween size="s">
                  {runtimes.map(([name, count]) => (
                    <ProgressBar key={name} label={name} value={(count / functions.length) * 100} additionalInfo={`${count} function${count === 1 ? "" : "s"}`} />
                  ))}
                </SpaceBetween>
              )}
            </Container>
          </ColumnLayout>
        </SpaceBetween>
      </ContentLayout>
    </Shell>
  );
}
