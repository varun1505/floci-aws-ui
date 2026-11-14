import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

export type Service = "home" | "lambda" | "s3" | "cloudwatch" | "ec2" | "apigateway" | "cloudfront" | "rds" | "secretsmanager" | "iam" | "ssm" | "sqs" | "sns" | "ses" | "elasticache" | "kms" | "dynamodb" | "cognito" | "route53" | "acm" | "events" | "states" | "vpc";
export type ServiceId = Exclude<Service, "home">;

export const SERVICES: { id: ServiceId; name: string; fullName: string; href: string; description: string }[] = [
  { id: "apigateway", name: "API Gateway", fullName: "API Gateway", href: "/apigateway/apis", description: "Build, deploy and manage APIs" },
  { id: "acm", name: "Certificate Manager", fullName: "Certificate Manager", href: "/acm/certificates", description: "Provision and manage SSL/TLS certificates" },
  { id: "cloudfront", name: "CloudFront", fullName: "CloudFront", href: "/cloudfront/distributions", description: "Global content delivery network" },
  { id: "cloudwatch", name: "CloudWatch", fullName: "CloudWatch", href: "/cloudwatch/home", description: "Monitor resources and applications" },
  { id: "cognito", name: "Cognito", fullName: "Cognito", href: "/cognito/user-pools", description: "User sign-up, sign-in and access control" },
  { id: "dynamodb", name: "DynamoDB", fullName: "DynamoDB", href: "/dynamodb/tables", description: "Managed NoSQL database" },
  { id: "ec2", name: "EC2", fullName: "EC2", href: "/ec2/home", description: "Virtual servers in the cloud" },
  { id: "elasticache", name: "ElastiCache", fullName: "ElastiCache", href: "/elasticache/caches", description: "In-memory cache with Redis OSS, Valkey and Memcached" },
  { id: "events", name: "EventBridge", fullName: "EventBridge", href: "/events/rules", description: "Event buses, rules and schedules" },
  { id: "iam", name: "IAM", fullName: "IAM", href: "/iam/roles", description: "Manage access to resources" },
  { id: "kms", name: "KMS", fullName: "Key Management Service", href: "/kms/keys", description: "Create and manage encryption keys" },
  { id: "lambda", name: "Lambda", fullName: "Lambda", href: "/lambda/functions", description: "Run code without thinking about servers" },
  { id: "rds", name: "RDS", fullName: "Aurora and RDS", href: "/rds/databases", description: "Managed relational database service" },
  { id: "route53", name: "Route 53", fullName: "Route 53", href: "/route53/hosted-zones", description: "DNS hosted zones and records" },
  { id: "s3", name: "S3", fullName: "Amazon S3", href: "/s3/buckets", description: "Scalable storage in the cloud" },
  { id: "secretsmanager", name: "Secrets Manager", fullName: "Secrets Manager", href: "/secretsmanager/secrets", description: "Rotate, manage and retrieve secrets" },
  { id: "ses", name: "SES", fullName: "Simple Email Service", href: "/ses/identities", description: "Send email from your applications" },
  { id: "sns", name: "SNS", fullName: "Simple Notification Service", href: "/sns/topics", description: "Pub/sub messaging and notifications" },
  { id: "sqs", name: "SQS", fullName: "Simple Queue Service", href: "/sqs/queues", description: "Managed message queues" },
  { id: "states", name: "Step Functions", fullName: "Step Functions", href: "/states/state-machines", description: "Coordinate services with state machines" },
  { id: "ssm", name: "Systems Manager", fullName: "Systems Manager", href: "/ssm/parameters", description: "Parameter Store for configuration data" },
  { id: "vpc", name: "VPC", fullName: "VPC", href: "/vpc/vpcs", description: "Isolated networks, subnets and routing" },
];

const link = (text: string, href: string): SideNavigationProps.Link => ({ type: "link", text, href });
const section = (text: string, items: SideNavigationProps.Item[]): SideNavigationProps.Section => ({ type: "section", text, items });

export const NAV: Record<Service, { header: SideNavigationProps.Header; items: SideNavigationProps.Item[] }> = {
  home: {
    header: { text: "Console Home", href: "/" },
    items: [section("Services", SERVICES.map((s) => link(s.name, s.href)))],
  },
  lambda: {
    header: { text: "Lambda", href: "/lambda/home" },
    items: [
      link("Dashboard", "/lambda/home"),
      link("Functions", "/lambda/functions"),
      section("Additional resources", [link("Event source mappings", "/lambda/event-source-mappings"), link("Layers", "/lambda/layers")]),
      section("Related resources", [link("CloudWatch log groups", "/cloudwatch/log-groups")]),
    ],
  },
  s3: {
    header: { text: "Amazon S3", href: "/s3/buckets" },
    items: [section("Buckets", [link("General purpose buckets", "/s3/buckets")])],
  },
  cloudwatch: {
    header: { text: "CloudWatch", href: "/cloudwatch/home" },
    items: [
      link("Overview", "/cloudwatch/home"),
      section("Alarms", [link("All alarms", "/cloudwatch/alarms")]),
      section("Logs", [link("Log groups", "/cloudwatch/log-groups")]),
      section("Metrics", [link("All metrics", "/cloudwatch/metrics")]),
    ],
  },
  apigateway: {
    header: { text: "API Gateway", href: "/apigateway/apis" },
    items: [link("APIs", "/apigateway/apis")],
  },
  cloudfront: {
    header: { text: "CloudFront", href: "/cloudfront/distributions" },
    items: [link("Distributions", "/cloudfront/distributions")],
  },
  rds: {
    header: { text: "Aurora and RDS", href: "/rds/databases" },
    items: [link("Databases", "/rds/databases"), link("Snapshots", "/rds/snapshots"), link("Subnet groups", "/rds/subnet-groups")],
  },
  secretsmanager: {
    header: { text: "Secrets Manager", href: "/secretsmanager/secrets" },
    items: [link("Secrets", "/secretsmanager/secrets")],
  },
  iam: {
    header: { text: "Identity and Access Management (IAM)", href: "/iam/roles" },
    items: [section("Access management", [link("User groups", "/iam/groups"), link("Users", "/iam/users"), link("Roles", "/iam/roles"), link("Policies", "/iam/policies")])],
  },
  ssm: {
    header: { text: "Systems Manager", href: "/ssm/parameters" },
    items: [section("Application Tools", [link("Parameter Store", "/ssm/parameters")])],
  },
  sqs: {
    header: { text: "Amazon SQS", href: "/sqs/queues" },
    items: [link("Queues", "/sqs/queues")],
  },
  sns: {
    header: { text: "Amazon SNS", href: "/sns/topics" },
    items: [link("Topics", "/sns/topics"), link("Subscriptions", "/sns/subscriptions")],
  },
  ses: {
    header: { text: "Amazon SES", href: "/ses/identities" },
    items: [section("Configuration", [link("Identities", "/ses/identities")]), section("Non-production tools", [link("Mailbox", "/ses/mailbox")])],
  },
  elasticache: {
    header: { text: "ElastiCache", href: "/elasticache/caches" },
    items: [section("Resources", [link("Caches", "/elasticache/caches"), link("Replication groups", "/elasticache/replication-groups")])],
  },
  kms: {
    header: { text: "Key Management Service (KMS)", href: "/kms/keys" },
    items: [link("Customer managed keys", "/kms/keys"), link("AWS managed keys", "/kms/aws-keys")],
  },
  dynamodb: {
    header: { text: "DynamoDB", href: "/dynamodb/tables" },
    items: [link("Tables", "/dynamodb/tables"), link("Explore items", "/dynamodb/items")],
  },
  cognito: {
    header: { text: "Amazon Cognito", href: "/cognito/user-pools" },
    items: [link("User pools", "/cognito/user-pools"), link("Identity pools", "/cognito/identity-pools")],
  },
  route53: {
    header: { text: "Route 53", href: "/route53/hosted-zones" },
    items: [link("Hosted zones", "/route53/hosted-zones"), link("Health checks", "/route53/health-checks")],
  },
  acm: {
    header: { text: "AWS Certificate Manager", href: "/acm/certificates" },
    items: [link("List certificates", "/acm/certificates")],
  },
  events: {
    header: { text: "Amazon EventBridge", href: "/events/rules" },
    items: [section("Buses", [link("Event buses", "/events/buses"), link("Rules", "/events/rules")]), section("Scheduler", [link("Schedules", "/events/schedules")])],
  },
  states: {
    header: { text: "Step Functions", href: "/states/state-machines" },
    items: [link("State machines", "/states/state-machines")],
  },
  vpc: {
    header: { text: "VPC", href: "/vpc/vpcs" },
    items: [
      section("Virtual private cloud", [
        link("Your VPCs", "/vpc/vpcs"),
        link("Subnets", "/vpc/subnets"),
        link("Route tables", "/vpc/route-tables"),
        link("Internet gateways", "/vpc/internet-gateways"),
        link("NAT gateways", "/vpc/nat-gateways"),
      ]),
      section("Security", [link("Security groups", "/ec2/security-groups")]),
    ],
  },
  ec2: {
    header: { text: "EC2", href: "/ec2/home" },
    items: [
      link("Dashboard", "/ec2/home"),
      section("Instances", [link("Instances", "/ec2/instances"), link("Launch an instance", "/ec2/instances/launch")]),
      section("Images", [link("AMIs", "/ec2/images")]),
      section("Elastic Block Store", [link("Volumes", "/ec2/volumes"), link("Snapshots", "/ec2/snapshots")]),
      section("Network & Security", [
        link("Security Groups", "/ec2/security-groups"),
        link("Elastic IPs", "/ec2/elastic-ips"),
        link("Key Pairs", "/ec2/key-pairs"),
      ]),
      section("Load Balancing", [link("Load Balancers", "/ec2/load-balancers"), link("Target Groups", "/ec2/target-groups")]),
    ],
  },
};

/** Every page in the console, for the search box. */
export function searchIndex() {
  return SERVICES.map((s) => ({
    label: s.fullName,
    options: [
      { value: s.href, label: s.fullName, description: s.description },
      ...NAV[s.id].items
        .flatMap((i) => (i.type === "section" ? i.items : [i]))
        .filter((i): i is SideNavigationProps.Link => i.type === "link" && i.href !== s.href && i.href.startsWith(`/${s.id}/`))
        .map((i) => ({ value: i.href, label: i.text, description: `${s.fullName} feature` })),
    ],
  }));
}

const RECENT_KEY = "recent-services";

export function recentServices(): ServiceId[] {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as ServiceId[];
    return ids.filter((id) => SERVICES.some((s) => s.id === id));
  } catch {
    return [];
  }
}

export function markVisited(id: ServiceId) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentServices().filter((x) => x !== id)]));
  } catch {
    /* ignore */
  }
}
