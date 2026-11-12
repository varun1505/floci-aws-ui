import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

export type Service = "home" | "lambda" | "s3" | "cloudwatch" | "ec2" | "apigateway" | "cloudfront" | "rds" | "secretsmanager";
export type ServiceId = Exclude<Service, "home">;

export const SERVICES: { id: ServiceId; name: string; fullName: string; href: string; description: string }[] = [
  { id: "apigateway", name: "API Gateway", fullName: "API Gateway", href: "/apigateway/apis", description: "Build, deploy and manage APIs" },
  { id: "cloudfront", name: "CloudFront", fullName: "CloudFront", href: "/cloudfront/distributions", description: "Global content delivery network" },
  { id: "cloudwatch", name: "CloudWatch", fullName: "CloudWatch", href: "/cloudwatch/home", description: "Monitor resources and applications" },
  { id: "ec2", name: "EC2", fullName: "EC2", href: "/ec2/home", description: "Virtual servers in the cloud" },
  { id: "lambda", name: "Lambda", fullName: "Lambda", href: "/lambda/functions", description: "Run code without thinking about servers" },
  { id: "rds", name: "RDS", fullName: "Aurora and RDS", href: "/rds/databases", description: "Managed relational database service" },
  { id: "s3", name: "S3", fullName: "Amazon S3", href: "/s3/buckets", description: "Scalable storage in the cloud" },
  { id: "secretsmanager", name: "Secrets Manager", fullName: "Secrets Manager", href: "/secretsmanager/secrets", description: "Rotate, manage and retrieve secrets" },
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
