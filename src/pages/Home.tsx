import Box from "@cloudscape-design/components/box";
import Cards from "@cloudscape-design/components/cards";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { ACCOUNT_ID, PROXY_BASE, getRegion } from "../config";
import { RouterLink } from "../components/RouterLink";
import { SERVICES, Shell } from "../components/Shell";
import { useLoad } from "../lib/useLoad";

type Health = { version?: string; edition?: string; services?: Record<string, string> };

const HEALTH_KEYS: Record<string, string[]> = {
  ec2: ["ec2"],
  lambda: ["lambda"],
  s3: ["s3"],
  cloudwatch: ["logs", "monitoring"],
};

export default function Home() {
  const health = useLoad<Health>(async () => {
    const res = await fetch(`${PROXY_BASE}/_floci/health`);
    if (!res.ok) throw new Error(`Health check returned ${res.status}`);
    return res.json();
  }, []);

  const status = (id: string) => {
    if (health.loading) return <StatusIndicator type="loading">Checking</StatusIndicator>;
    if (health.error) return <StatusIndicator type="error">Unreachable</StatusIndicator>;
    const up = HEALTH_KEYS[id].every((k) => health.data?.services?.[k] === "running");
    return up ? <StatusIndicator type="success">Running</StatusIndicator> : <StatusIndicator type="warning">Not running</StatusIndicator>;
  };

  return (
    <Shell service="home" breadcrumbs={[]}>
      <ContentLayout header={<Header variant="h1" description="Non-production environments, hosted on-prem.">Console Home</Header>}>
        <SpaceBetween size="l">
          <Cards
            header={<Header variant="h2">Services</Header>}
            cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }, { minWidth: 900, cards: 4 }]}
            items={SERVICES}
            cardDefinition={{
              header: (s) => (
                <RouterLink to={s.href} fontSize="heading-m">
                  {s.name}
                </RouterLink>
              ),
              sections: [
                { id: "description", content: (s) => s.description },
                { id: "status", header: "Status", content: (s) => status(s.id) },
              ],
            }}
          />
          <Container header={<Header variant="h2">Environment</Header>}>
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Account ID</Box>
                <div>{ACCOUNT_ID}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Region</Box>
                <div>{getRegion()}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Emulator version</Box>
                <div>{health.data?.version ?? "-"}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Connection</Box>
                <div>
                  {health.loading ? (
                    <StatusIndicator type="loading">Checking</StatusIndicator>
                  ) : health.error ? (
                    <StatusIndicator type="error">{health.error}</StatusIndicator>
                  ) : (
                    <StatusIndicator type="success">Connected</StatusIndicator>
                  )}
                </div>
              </div>
            </ColumnLayout>
          </Container>
        </SpaceBetween>
      </ContentLayout>
    </Shell>
  );
}
