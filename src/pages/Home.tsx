import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { ACCOUNT_ID, CLI_PROFILE, PROXY_BASE, REGIONS, getRegion } from "../config";
import { cliProfile } from "../components/help";
import { SERVICES, recentServices } from "../components/nav";
import { RouterLink } from "../components/RouterLink";
import { Shell } from "../components/Shell";
import { Stat } from "../components/Stat";
import { useLoad } from "../lib/useLoad";

type Health = { version?: string; edition?: string; services?: Record<string, string> };

const HEALTH_KEYS: Record<string, string[]> = {
  ec2: ["ec2"],
  lambda: ["lambda"],
  s3: ["s3"],
  cloudwatch: ["logs", "monitoring"],
  apigateway: ["apigateway", "apigatewayv2"],
  cloudfront: ["cloudfront"],
  rds: ["rds"],
  secretsmanager: ["secretsmanager"],
  iam: ["iam"],
  ssm: ["ssm"],
  sqs: ["sqs"],
  sns: ["sns"],
  ses: ["email"],
  elasticache: ["elasticache"],
  kms: ["kms"],
  dynamodb: ["dynamodb"],
  cognito: ["cognito-idp", "cognito-identity"],
  route53: ["route53"],
  acm: ["acm"],
  ecs: ["ecs"],
  ecr: ["ecr"],
  events: ["events", "scheduler"],
  states: ["states"],
  vpc: ["ec2"],
  cloudformation: ["cloudformation"],
  kinesis: ["kinesis"],
  opensearch: ["es"],
};

/** One count per service. A failed call gives undefined, shown as "-". */
async function loadCounts() {
  const safe = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };
  // The SDK clients are large. Load them here, not with the page, so the home page opens fast.
  const [functions, buckets, instances, logGroups, alarms, databases, secretCount, apis, distributions, queues, topics, parameters] = await Promise.all([
    safe(async () => (await (await import("./lambda/Functions")).listAllFunctions()).length),
    safe(async () => {
      const [{ s3 }, { ListBucketsCommand }] = await Promise.all([import("../clients/s3"), import("@aws-sdk/client-s3")]);
      return ((await s3.send(new ListBucketsCommand({}))).Buckets ?? []).length;
    }),
    safe(async () => {
      const all = await (await import("./ec2/ec2util")).listInstances();
      const live = all.filter((i) => i.State?.Name !== "terminated");
      return { total: live.length, running: live.filter((i) => i.State?.Name === "running").length };
    }),
    safe(async () => {
      const [{ logs }, { DescribeLogGroupsCommand }] = await Promise.all([import("../clients/logs"), import("@aws-sdk/client-cloudwatch-logs")]);
      return ((await logs.send(new DescribeLogGroupsCommand({}))).logGroups ?? []).length;
    }),
    safe(async () => {
      const [{ cloudwatch }, { DescribeAlarmsCommand }] = await Promise.all([import("../clients/cloudwatch"), import("@aws-sdk/client-cloudwatch")]);
      const list = (await cloudwatch.send(new DescribeAlarmsCommand({}))).MetricAlarms ?? [];
      return { total: list.length, firing: list.filter((a) => a.StateValue === "ALARM").length };
    }),
    safe(async () => (await (await import("./rds/rdsutil")).listDatabases()).length),
    safe(async () => (await (await import("./secretsmanager/Secrets")).listAllSecrets()).length),
    safe(async () => (await (await import("./apigateway/apiutil")).listApis()).length),
    safe(async () => (await (await import("./cloudfront/Distributions")).listDistributions()).length),
    safe(async () => (await (await import("./sqs/sqsutil")).listQueues()).length),
    safe(async () => (await (await import("./sns/snsutil")).listTopics()).length),
    safe(async () => (await (await import("./ssm/Parameters")).listParameters()).length),
  ]);
  return { functions, buckets, instances, logGroups, alarms, databases, secretCount, apis, distributions, queues, topics, parameters };
}

export default function Home() {
  const navigate = useNavigate();
  const region = getRegion();
  const regionLabel = REGIONS.find((r) => r.id === region)?.label ?? region;

  const health = useLoad<Health>(async () => {
    const res = await fetch(`${PROXY_BASE}/_floci/health`);
    if (!res.ok) throw new Error(`Health check returned ${res.status}`);
    return res.json();
  }, []);
  const counts = useLoad(loadCounts, []);
  const c = counts.data;

  const status = (id: string) => {
    if (health.loading) return <StatusIndicator type="loading">Checking</StatusIndicator>;
    if (health.error) return <StatusIndicator type="error">Unreachable</StatusIndicator>;
    const up = (HEALTH_KEYS[id] ?? []).every((k) => health.data?.services?.[k] === "running");
    return up ? <StatusIndicator type="success">Operating normally</StatusIndicator> : <StatusIndicator type="warning">Not running</StatusIndicator>;
  };

  const recent = recentServices();
  const ordered = [...recent.map((id) => SERVICES.find((s) => s.id === id)!), ...SERVICES.filter((s) => !recent.includes(s.id))];

  return (
    <Shell service="home" breadcrumbs={[]}>
      <ContentLayout
        header={
          <Header variant="h1" description="Non-production environments, hosted on-prem.">
            Console Home
          </Header>
        }
      >
        <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">{recent.length ? "Recently visited" : "Services"}</Header>}>
              <ColumnLayout columns={2} borders="horizontal">
                {ordered.map((s) => (
                  <div key={s.id}>
                    <RouterLink to={s.href} fontSize="heading-s">
                      {s.fullName}
                    </RouterLink>
                    <Box variant="small" color="text-body-secondary" display="block">
                      {s.description}
                    </Box>
                  </div>
                ))}
              </ColumnLayout>
            </Container>

            <Container
              header={
                <Header variant="h2" description={`What exists in ${regionLabel} right now.`} actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => counts.reload()} />}>
                  Resources
                </Header>
              }
            >
              <ColumnLayout columns={3} variant="text-grid">
                <Stat label="EC2 instances (running)" value={c?.instances?.running} to="/ec2/instances" loading={counts.loading} hint={c?.instances ? `${c.instances.total} total` : undefined} />
                <Stat label="Lambda functions" value={c?.functions} to="/lambda/functions" loading={counts.loading} />
                <Stat label="S3 buckets" value={c?.buckets} to="/s3/buckets" loading={counts.loading} />
                <Stat label="CloudWatch log groups" value={c?.logGroups} to="/cloudwatch/log-groups" loading={counts.loading} />
                <Stat label="RDS databases" value={c?.databases} to="/rds/databases" loading={counts.loading} />
                <Stat label="API Gateway APIs" value={c?.apis} to="/apigateway/apis" loading={counts.loading} />
                <Stat label="CloudFront distributions" value={c?.distributions} to="/cloudfront/distributions" loading={counts.loading} />
                <Stat label="Secrets" value={c?.secretCount} to="/secretsmanager/secrets" loading={counts.loading} />
                <Stat label="SQS queues" value={c?.queues} to="/sqs/queues" loading={counts.loading} />
                <Stat label="SNS topics" value={c?.topics} to="/sns/topics" loading={counts.loading} />
                <Stat label="Parameters" value={c?.parameters} to="/ssm/parameters" loading={counts.loading} />
                <Stat label="Alarms in alarm" value={c?.alarms?.firing} to="/cloudwatch/alarms" loading={counts.loading} hint={c?.alarms ? `${c.alarms.total} total` : undefined} />
              </ColumnLayout>
            </Container>

            <Container header={<Header variant="h2" description="Start with the most common tasks.">Build a solution</Header>}>
              <ColumnLayout columns={2} borders="horizontal">
                {[
                  { title: "Launch a virtual machine", with: "With EC2", to: "/ec2/instances/launch" },
                  { title: "Run a serverless function", with: "With Lambda", to: "/lambda/functions/create" },
                  { title: "Store and retrieve files", with: "With S3", to: "/s3/buckets" },
                  { title: "Read application logs", with: "With CloudWatch", to: "/cloudwatch/log-groups" },
                  { title: "Create a database", with: "With RDS", to: "/rds/databases/create" },
                  { title: "Publish an API", with: "With API Gateway", to: "/apigateway/apis" },
                ].map((t) => (
                  <div key={t.to}>
                    <RouterLink to={t.to} fontSize="heading-s">
                      {t.title}
                    </RouterLink>
                    <Box variant="small" color="text-body-secondary" display="block">
                      {t.with}
                    </Box>
                  </div>
                ))}
              </ColumnLayout>
            </Container>
          </SpaceBetween>

          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Service health</Header>}>
              <SpaceBetween size="s">
                {SERVICES.map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <RouterLink to={s.href}>{s.fullName}</RouterLink>
                    {status(s.id)}
                  </div>
                ))}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Environment</Header>}>
              <SpaceBetween size="m">
                <div>
                  <Box variant="awsui-key-label">Account ID</Box>
                  <CopyToClipboard variant="inline" textToCopy={ACCOUNT_ID} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />
                </div>
                <div>
                  <Box variant="awsui-key-label">Region</Box>
                  <div>
                    {regionLabel} ({region})
                  </div>
                </div>
                <div>
                  <Box variant="awsui-key-label">API endpoint</Box>
                  <CopyToClipboard variant="inline" textToCopy={PROXY_BASE} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />
                </div>
                <div>
                  <Box variant="awsui-key-label">Emulator version</Box>
                  <div>{health.data?.version ? `floci ${health.data.version}` : "-"}</div>
                </div>
              </SpaceBetween>
            </Container>

            <Container
              header={
                <Header
                  variant="h2"
                  description="Add this to ~/.aws/config. Your existing commands then work unchanged."
                  actions={<CopyToClipboard variant="icon" textToCopy={cliProfile()} copyButtonAriaLabel="Copy profile" copySuccessText="Profile copied" copyErrorText="Failed to copy" />}
                >
                  Use the AWS CLI
                </Header>
              }
            >
              <SpaceBetween size="s">
                <Box variant="code">
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cliProfile()}</pre>
                </Box>
                <Box variant="code">
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>aws --profile {CLI_PROFILE} s3 ls</pre>
                </Box>
                <Button variant="inline-link" onClick={() => navigate("/s3/buckets")}>
                  Or browse S3 in the console
                </Button>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Grid>
      </ContentLayout>
    </Shell>
  );
}
