# Floci Console

A web console for [floci](https://floci.io), the local AWS emulator. It looks and works like the AWS console, so a team that knows AWS can use an on-prem non-prod environment without learning a new tool.

It is built with [Cloudscape](https://cloudscape.design), the open source design system that the AWS console itself uses.

## What it covers

| Service | What you can do |
|---------|-----------------|
| **Console Home** | See resource counts, service health and the CLI profile for this environment. |
| **Lambda** | Dashboard. List, create and delete functions. Edit code in the browser and deploy. Run test events. Read logs. Change memory, timeout, handler and environment variables. Manage layers and event source mappings. |
| **S3** | Create, empty and delete buckets. Browse folders. Upload, download, open, preview and delete objects. |
| **CloudWatch** | Overview. Browse log groups and streams. Read log events with a time filter and live tail. Create and delete alarms. Graph metrics. |
| **EC2** | Dashboard. Launch, start, stop, reboot and terminate instances. Manage security groups, key pairs, volumes, snapshots and Elastic IPs. List AMIs. |
| **API Gateway** | REST APIs: resources, methods (Lambda, HTTP or mock), deploy to a stage. HTTP APIs: routes, integrations, stages. Send a test request to a stage from the page. |
| **CloudFront** | List, create, enable, disable and delete distributions. See origins and behaviors. Create invalidations. |
| **RDS** | Create, stop, start, reboot and delete databases. Shows the connect command. Snapshots and subnet groups. |
| **Secrets Manager** | Store, read, edit and delete secrets, as key/value pairs or plain text. |
| **IAM** | Users, user groups, roles and policies. Attach and detach policies. Create access keys. Edit trust policies. |
| **Parameter Store** | Create, edit and delete parameters. Version history. Show and hide SecureString values. |
| **SQS** | Create, purge and delete queues, standard and FIFO. Send a message. Poll for messages and read them. |
| **SNS** | Topics and subscriptions. Subscribe a queue, a function, a URL or an email address. Publish a message. |
| **SES** | Verify email addresses and domains. Send a test email. A mailbox page shows every email the environment captured. |
| **ElastiCache** | Create and delete Valkey, Redis OSS and Memcached caches. Shows the connect command. Replication groups. |
| **Load balancers** | Under EC2. Load balancers, listeners, target groups and registered targets. |
| **KMS** | Customer managed and AWS managed keys. Create, enable, disable and schedule deletion. Aliases, key policy, encrypt and decrypt. |

The top bar has a search box for services and pages. Every page has a help panel with the CLI profile.

## Use the AWS CLI through the console

The console's own `/aws` path is a full AWS endpoint. A team needs only one URL:

```ini
# ~/.aws/config
[profile floci]
region = us-east-1
endpoint_url = http://your-console-host:8080/aws
aws_access_key_id = test
aws_secret_access_key = test
```

```sh
aws --profile floci s3 ls
```

## Run it locally

You need Node 22 or newer, pnpm, and a running floci.

```sh
pnpm install
cp .env.example .env.local   # then set FLOCI_ENDPOINT to your floci address
pnpm dev                     # http://localhost:5173
```

## Run it for a team

```sh
pnpm build
FLOCI_ENDPOINT=http://your-floci-host:4566 PORT=8080 pnpm start
```

Or with Docker:

```sh
docker build -t floci-console .
docker run -d -p 8080:8080 -e FLOCI_ENDPOINT=http://your-floci-host:4566 floci-console
```

## How it works

```
browser  ->  this server (/aws/*)  ->  floci (:4566)
```

- The pages use the normal AWS SDK for JavaScript. The SDK points at `/aws` on the same server.
- The server forwards `/aws/*` to floci. This is needed because floci does not answer browser CORS preflight requests.
- floci accepts any credentials. The console sends `test` / `test`. Nothing reaches real AWS.

## Settings

| Variable | Default | Meaning |
|----------|---------|---------|
| `FLOCI_ENDPOINT` | `http://localhost:4566` | Where floci listens. |
| `PORT` | `8080` | Port for the production server. |

## Known limits

- **No login.** Anyone who can open the console can change everything in floci. Keep it on a private network.
- **floci keeps state in memory** unless it was started with `--persist`. A floci restart wipes all resources.
- floci does not write the `START`, `END` and `REPORT` lines to Lambda logs. You only see what your code prints.
- floci does not publish Lambda or EC2 metrics on its own. The Metrics page shows only metrics your apps send.
- EC2 instances run as containers on the floci host. There is no serial console output.
- IAM stores users, roles and policies, but floci does not enforce them. A call that a policy denies still works here.
- SES sends no real email. Read sent messages on the Mailbox page.
- Load balancers are created and listed. Sending traffic through one is not tested.
- An RDS endpoint address is internal to Docker. Connect to the floci host on the port the page shows.
- API Gateway stages answer at `<console>/aws/_aws/execute-api/<api-id>/<stage>/<path>`, not at an `amazonaws.com` URL.
- A CloudFront distribution gets a `cloudfront.net` name, but that name does not resolve on your network. Serving content through a distribution is not tested.

## Add a service

1. Add a client in `src/clients/`.
2. Add pages in `src/pages/<service>/`. `ResourceTable` gives you the standard list page.
3. Add the routes in `src/App.tsx` and the side navigation in `src/components/nav.ts`.

See [docs/STATUS.md](docs/STATUS.md) for what was tested, what floci does differently, and how the code is laid out.

This project is not affiliated with Amazon Web Services.
