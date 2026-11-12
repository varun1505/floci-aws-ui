import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import HelpPanel from "@cloudscape-design/components/help-panel";
import { PROXY_BASE, getRegion } from "../config";
import type { Service } from "./nav";

const ABOUT: Record<Service, { title: string; body: ReactNode; docs: { text: string; href: string }[] }> = {
  home: {
    title: "Floci Console",
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
  return `[profile floci]
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
        <pre style={pre}>aws --profile floci {service === "home" ? "s3 ls" : EXAMPLE[service]}</pre>
      </Box>
    </HelpPanel>
  );
}

const EXAMPLE: Record<Exclude<Service, "home">, string> = {
  lambda: "lambda list-functions",
  s3: "s3 ls",
  cloudwatch: "logs describe-log-groups",
  ec2: "ec2 describe-instances",
};
