import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import HelpPanel from "@cloudscape-design/components/help-panel";
import { APP_NAME, CLI_PROFILE, PROXY_BASE, getRegion } from "../config";
import type { Service } from "./nav";

const ABOUT: Record<Service, { title: string; body: ReactNode; docs: { text: string; href: string }[] }> = {
  home: {
    title: APP_NAME,
    body: (
      <p>
        This console manages the on-prem non-production environment. It speaks the same APIs as AWS, so the AWS CLI, the SDKs and Terraform work
        against it without code changes.
      </p>
    ),
    docs: [{ text: "AWS CLI configuration", href: "https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html" }],
  },
  lambda: {
    title: "Lambda",
    body: (
      <>
        <p>Lambda runs your code in response to events. You do not manage servers.</p>
        <p>The first invocation of a function is slow, because the runtime container starts then. Later invocations are fast.</p>
        <p>Anything your function prints goes to its CloudWatch log group.</p>
      </>
    ),
    docs: [{ text: "Lambda developer guide", href: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html" }],
  },
  s3: {
    title: "Amazon S3",
    body: (
      <>
        <p>S3 stores objects in buckets. A folder is a shared key prefix that ends with a slash.</p>
        <p>Use path-style addressing with this environment. The bucket name goes in the URL path, not the hostname.</p>
      </>
    ),
    docs: [{ text: "S3 user guide", href: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html" }],
  },
  cloudwatch: {
    title: "CloudWatch",
    body: (
      <>
        <p>CloudWatch collects logs and metrics, and raises alarms on metrics.</p>
        <p>This environment records only the metrics that your applications send. It does not publish service metrics on its own.</p>
      </>
    ),
    docs: [{ text: "CloudWatch user guide", href: "https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html" }],
  },
  apigateway: {
    title: "API Gateway",
    body: (
      <>
        <p>API Gateway puts an HTTP front door on Lambda functions and other backends.</p>
        <p>REST APIs must be deployed to a stage before they answer requests. Each stage page shows its invoke URL in this environment.</p>
      </>
    ),
    docs: [{ text: "API Gateway developer guide", href: "https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html" }],
  },
  cloudfront: {
    title: "CloudFront",
    body: (
      <>
        <p>CloudFront serves content from origins such as S3 buckets through a content delivery network.</p>
        <p>This environment stores the distribution settings and answers the API. It does not run real edge locations.</p>
        <p>A distribution must be disabled before it can be deleted.</p>
      </>
    ),
    docs: [{ text: "CloudFront developer guide", href: "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html" }],
  },
  rds: {
    title: "Aurora and RDS",
    body: (
      <>
        <p>RDS runs relational databases for you. In this environment each database runs as a real database container on the host.</p>
        <p>The endpoint address that the API returns is internal to the host. From your machine, connect to the host name and the port shown on the database page.</p>
      </>
    ),
    docs: [{ text: "RDS user guide", href: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html" }],
  },
  secretsmanager: {
    title: "Secrets Manager",
    body: (
      <>
        <p>Secrets Manager stores credentials, API keys and other secrets. Applications read them at run time, so secrets stay out of code.</p>
        <p>This is a non-production environment. Do not store production secrets here.</p>
      </>
    ),
    docs: [{ text: "Secrets Manager user guide", href: "https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html" }],
  },
  iam: {
    title: "IAM",
    body: (
      <>
        <p>IAM holds users, groups, roles and policies. Lambda functions and other services need a role to run.</p>
        <p>This environment stores IAM resources but does not block calls that a policy would deny. Test real permissions in AWS.</p>
      </>
    ),
    docs: [{ text: "IAM user guide", href: "https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html" }],
  },
  ssm: {
    title: "Parameter Store",
    body: (
      <>
        <p>Parameter Store holds configuration values and secrets as named parameters. Use a path such as /my-app/dev/db-url to group them.</p>
        <p>SecureString parameters are for passwords and keys.</p>
      </>
    ),
    docs: [{ text: "Parameter Store user guide", href: "https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html" }],
  },
  sqs: {
    title: "Amazon SQS",
    body: (
      <>
        <p>SQS queues hold messages until a consumer reads them. Use them to run work in the background.</p>
        <p>Standard queues deliver at least once. FIFO queues keep order and remove duplicates.</p>
      </>
    ),
    docs: [{ text: "SQS developer guide", href: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html" }],
  },
  sns: {
    title: "Amazon SNS",
    body: (
      <>
        <p>SNS topics send one message to many subscribers. A subscriber can be an SQS queue, a Lambda function, an HTTP endpoint or an email address.</p>
      </>
    ),
    docs: [{ text: "SNS developer guide", href: "https://docs.aws.amazon.com/sns/latest/dg/welcome.html" }],
  },
  ses: {
    title: "Amazon SES",
    body: (
      <>
        <p>SES sends email from your applications. Verify an email address or a domain before you send from it.</p>
        <p>In this environment no email leaves the network. Every message is captured in the Mailbox page so you can read what your application sent.</p>
      </>
    ),
    docs: [{ text: "SES developer guide", href: "https://docs.aws.amazon.com/ses/latest/dg/Welcome.html" }],
  },
  elasticache: {
    title: "ElastiCache",
    body: (
      <>
        <p>ElastiCache runs Redis OSS, Valkey and Memcached. In this environment each cache runs as a container on the host.</p>
        <p>Connect with the host and port shown on the cache page.</p>
      </>
    ),
    docs: [{ text: "ElastiCache user guide", href: "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html" }],
  },
  kms: {
    title: "KMS",
    body: (
      <>
        <p>KMS creates and stores encryption keys. Other services use them to encrypt data, and applications call Encrypt and Decrypt directly.</p>
        <p>Keys here protect test data only. Do not reuse them for production.</p>
      </>
    ),
    docs: [{ text: "KMS developer guide", href: "https://docs.aws.amazon.com/kms/latest/developerguide/overview.html" }],
  },
  dynamodb: {
    title: "DynamoDB",
    body: (
      <>
        <p>DynamoDB stores items in tables. Each item is found by its partition key, and by a sort key if the table has one.</p>
        <p>A query reads items of one partition key. A scan reads the whole table.</p>
      </>
    ),
    docs: [{ text: "DynamoDB developer guide", href: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html" }],
  },
  cognito: {
    title: "Amazon Cognito",
    body: (
      <>
        <p>A user pool is a user directory. Applications sign users in through an app client of the pool.</p>
        <p>In this environment no email or SMS is sent. Confirm users from the user page.</p>
      </>
    ),
    docs: [{ text: "Cognito developer guide", href: "https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html" }],
  },
  route53: {
    title: "Route 53",
    body: (
      <>
        <p>Route 53 holds DNS records in hosted zones.</p>
        <p>In this environment records of a private hosted zone resolve for containers that use the emulator as their DNS server. Records of a public zone are stored, but only TXT, NS and SOA records are answered. Your own machine does not see any of them.</p>
      </>
    ),
    docs: [{ text: "Route 53 developer guide", href: "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html" }],
  },
  acm: {
    title: "Certificate Manager",
    body: (
      <>
        <p>ACM issues and stores TLS certificates for load balancers, CloudFront and API Gateway.</p>
        <p>In this environment a requested certificate is issued at once. No domain validation happens, and no public authority signs it.</p>
      </>
    ),
    docs: [{ text: "ACM user guide", href: "https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html" }],
  },
  ecs: {
    title: "Elastic Container Service",
    body: (
      <>
        <p>ECS runs containers. A task definition describes the containers. A service keeps a number of tasks running in a cluster.</p>
        <p>In this environment each task runs as real containers on the host.</p>
      </>
    ),
    docs: [{ text: "ECS developer guide", href: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html" }],
  },
  ecr: {
    title: "Elastic Container Registry",
    body: (
      <>
        <p>ECR stores container images in repositories.</p>
        <p>In this environment the images live in a registry container on the host. Push and pull with the docker client, using the repository URI.</p>
      </>
    ),
    docs: [{ text: "ECR user guide", href: "https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html" }],
  },
  events: {
    title: "Amazon EventBridge",
    body: (
      <>
        <p>An event bus receives events. A rule matches events with a pattern, or runs on a schedule, and sends them to targets.</p>
        <p>EventBridge Scheduler runs a target once or on a repeating schedule.</p>
      </>
    ),
    docs: [{ text: "EventBridge user guide", href: "https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html" }],
  },
  states: {
    title: "Step Functions",
    body: (
      <>
        <p>A state machine runs a workflow of steps, written in Amazon States Language. Each run is an execution.</p>
        <p>Open an execution to see its input, its output and every step it took.</p>
      </>
    ),
    docs: [{ text: "Step Functions developer guide", href: "https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html" }],
  },
  vpc: {
    title: "VPC",
    body: (
      <>
        <p>A VPC is a private network. Subnets divide it, and route tables decide where traffic goes.</p>
        <p>This environment stores these resources and answers the API. It does not route or filter real traffic.</p>
      </>
    ),
    docs: [{ text: "VPC user guide", href: "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html" }],
  },
  cloudformation: {
    title: "CloudFormation",
    body: (
      <>
        <p>CloudFormation creates resources from a template. The resources of one template form a stack.</p>
        <p>Deleting a stack deletes its resources.</p>
      </>
    ),
    docs: [{ text: "CloudFormation user guide", href: "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html" }],
  },
  kinesis: {
    title: "Kinesis Data Streams",
    body: (
      <>
        <p>A data stream keeps records in order inside shards. Producers put records, and consumers read them with a shard iterator.</p>
      </>
    ),
    docs: [{ text: "Kinesis developer guide", href: "https://docs.aws.amazon.com/streams/latest/dev/introduction.html" }],
  },
  opensearch: {
    title: "OpenSearch Service",
    body: (
      <>
        <p>A domain is an OpenSearch cluster.</p>
        <p>In this environment each domain runs as a real OpenSearch container on the host. The first start takes a while.</p>
      </>
    ),
    docs: [{ text: "OpenSearch Service developer guide", href: "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html" }],
  },
  ec2: {
    title: "EC2",
    body: (
      <>
        <p>EC2 provides virtual servers. In this environment each instance runs as a container on the host.</p>
        <p>Security groups, key pairs, volumes and Elastic IPs behave like their AWS counterparts at the API level.</p>
      </>
    ),
    docs: [{ text: "EC2 user guide", href: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html" }],
  },
};

const pre = { margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" } as const;

/** The CLI profile that points at this environment. Shown in the help panel and on the home page. */
export function cliProfile() {
  return `[profile ${CLI_PROFILE}]
region = ${getRegion()}
endpoint_url = ${PROXY_BASE}
aws_access_key_id = test
aws_secret_access_key = test`;
}

export function ServiceHelp({ service }: { service: Service }) {
  const about = ABOUT[service];
  return (
    <HelpPanel
      header={<h2>{about.title}</h2>}
      footer={
        <>
          <h3>Learn more</h3>
          <ul>
            {about.docs.map((d) => (
              <li key={d.href}>
                <a href={d.href} target="_blank" rel="noreferrer">
                  {d.text}
                </a>
              </li>
            ))}
          </ul>
        </>
      }
    >
      {about.body}
      <h3>Use the AWS CLI</h3>
      <p>
        Add this profile to <code>~/.aws/config</code>:
      </p>
      <Box variant="code">
        <pre style={pre}>{cliProfile()}</pre>
      </Box>
      <p>Then run your usual commands with the profile:</p>
      <Box variant="code">
        <pre style={pre}>aws --profile {CLI_PROFILE} {service === "home" ? "s3 ls" : EXAMPLE[service]}</pre>
      </Box>
    </HelpPanel>
  );
}

const EXAMPLE: Record<Exclude<Service, "home">, string> = {
  lambda: "lambda list-functions",
  s3: "s3 ls",
  cloudwatch: "logs describe-log-groups",
  ec2: "ec2 describe-instances",
  apigateway: "apigateway get-rest-apis",
  cloudfront: "cloudfront list-distributions",
  rds: "rds describe-db-instances",
  secretsmanager: "secretsmanager list-secrets",
  iam: "iam list-roles",
  ssm: "ssm describe-parameters",
  sqs: "sqs list-queues",
  sns: "sns list-topics",
  ses: "ses list-identities",
  elasticache: "elasticache describe-cache-clusters",
  kms: "kms list-keys",
  dynamodb: "dynamodb list-tables",
  cognito: "cognito-idp list-user-pools --max-results 20",
  route53: "route53 list-hosted-zones",
  acm: "acm list-certificates",
  ecs: "ecs list-clusters",
  ecr: "ecr describe-repositories",
  events: "events list-rules",
  states: "stepfunctions list-state-machines",
  vpc: "ec2 describe-vpcs",
  cloudformation: "cloudformation describe-stacks",
  kinesis: "kinesis list-streams",
  opensearch: "opensearch list-domain-names",
};
