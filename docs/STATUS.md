# Project status and notes

**Summary**

- The console covers **28 AWS services** plus load balancers. All pages build and type-check.
- The first 15 services were checked by hand in a browser against **floci 2.4.0**.
- The 13 newer services had every API call checked with the AWS CLI against floci 2.4.0. In a browser, each page was only opened once with sample data. See section 1.
- **182 automated tests** cover the helpers, the shared components, the navigation, the server, the command line, and the main list page of 14 services.
- This file lists what was tested, what was not, and what floci does differently from AWS.

## 1. What was tested

"Tested" means a person clicked through the flow in a browser and it worked.

| Service | Tested | Not tested |
|---------|--------|------------|
| **Lambda, S3, CloudWatch, EC2, RDS, Secrets Manager** | Main flows were checked while they were built. No record was kept for each action. | Assume any single action may be untested. |
| **API Gateway** | REST API: create, add resource, mock method, deploy, test request (200). HTTP API: create, add route, test request (200). | Lambda integrations. |
| **CloudFront** | Create, disable, invalidate, delete. | Serving content through a distribution. |
| **SQS** | Create queue, send message, poll. | FIFO queues, purge, delete message. |
| **SNS** | Create topic, subscribe a queue, publish. The message arrived in the queue. | Other protocols. Actions on the Subscriptions page. |
| **Parameter Store** | Create SecureString, edit, history. | Delete. |
| **KMS** | Create key with alias, encrypt, decrypt. List AWS managed keys. | Disable, schedule deletion, alias changes. |
| **IAM** | Create policy, role and user. Attach policy. Create access key. | Groups, trust policy edit, policy edit and delete. |
| **SES** | Verify an address, send a test email, read it in the Mailbox. | Domain identities, delete, mailbox delete. |
| **ElastiCache** | Create a Valkey cache, detail page. | Redis OSS and Memcached from the UI. Replication groups. Delete. |
| **Load balancers** | Create target group, load balancer and listener. | Register targets. Traffic through a load balancer. Delete. |

**The 13 newer services**

For these, "Tested" means the API calls behind the page ran against floci with the AWS CLI. In a browser, every list page and detail page was opened once with sample data and showed no error. Only one form was submitted in a browser (create a Route 53 record). Assume every other button is untested in a browser.

| Service | Tested with the CLI | Not tested |
|---------|---------------------|------------|
| **DynamoDB** | Create table (both capacity modes, GSI and LSI), put, get, query, scan with filters, paging, TTL, streams, UpdateTable. | The TTL sweep that deletes expired items. |
| **Cognito** | Pools, app clients, users, passwords, groups, sign-in, identity pools. | Test sign-in in a page. Lists with more than 60 items. |
| **Route 53** | Public and private zones, records, aliases, VPC association, health checks. | Real DNS resolution. |
| **Certificate Manager** | Request, import, describe, tags, export, delete. | A certificate in use by another resource. |
| **ECS** | Clusters, task definitions, run and stop tasks, services, logs. | - |
| **ECR** | Repositories, images, policies, settings. | `docker login` and `docker push` with real Docker. |
| **EventBridge** | Rules deliver to SQS. `rate(1 minute)` rules fire. Schedules fire. Rule to a state machine and to another bus. | Lambda, Kinesis and log group targets. |
| **Step Functions** | Pass, Fail, Wait and stop, Express, update, tags, history, an SQS task. | A Lambda task. |
| **VPC** | VPCs, DNS settings, subnets, route tables, routes, internet gateways, NAT gateways, tags. | A route to an instance. Delete route. Detach internet gateway. |
| **CloudFormation** | Validate, create with a parameter and an output, events, resources, update, a failing template, delete. | - |
| **Kinesis** | Every call the pages use. | - |
| **OpenSearch** | Versions, create, describe, update settings, tags, delete. | A second domain. |
| **AppSync** | All four auth types, keys, schema, data sources, resolvers. Queries return data from a resolver with no data source. | Resolvers on DynamoDB or Lambda. The query box in a page. |

## 2. What floci does differently from AWS

These were found on floci 2.4.0. Check them again on newer versions.

**All services**

- floci has **no CORS preflight**. A browser cannot call it directly. This is why the console has the `/aws` proxy.
- floci accepts any credentials. The console sends `test` / `test`.
- State is in memory unless floci runs with `--persist`.

**By service**

| Service | Difference |
|---------|------------|
| **IAM** | Users, roles and policies are stored. They are **not enforced**. |
| **SES** | No email leaves the machine. Every message is kept at `GET /_aws/ses`. `DELETE /_aws/ses?id=<id>` removes one. Identities verify at once. |
| **SQS** | Queue URLs carry the floci host name. The SDK client sets `useQueueUrlAsEndpoint: false` so calls still go through the proxy. |
| **API Gateway** | REST and HTTP APIs answer at `/_aws/execute-api/<api-id>/<stage>/<path>`. An HTTP API uses the literal stage name `$default`. |
| **CloudFront** | A distribution must be disabled before it can be deleted, as in AWS. The `cloudfront.net` name does not resolve. |
| **ElastiCache** | Caches are real. Redis and Valkey listen on port 6379 of the floci host. Memcached listens on 11211. `DescribeCacheEngineVersions` is not supported. |
| **Load balancers** | Creating one needs two subnets in different zones. The DNS name looks like `<name>-<id>.elb.<floci-host>`. |
| **KMS** | 25 AWS managed keys exist from the start. A key cannot be deleted at once. The shortest wait is 7 days. |
| **Parameter Store** | `GetParameter` returns a SecureString decrypted even without `WithDecryption`. |
| **RDS** | The endpoint address is internal to Docker. Connect to the floci host on the port shown. |
| **Lambda** | Logs have no `START`, `END` or `REPORT` lines. No metrics are published. |
| **EC2** | Instances run as containers on the floci host. There is no serial console output. |
| **DynamoDB** | Table size is always 0 bytes. A new index is active at once. |
| **Cognito** | No email or SMS is sent. Create user always asks for a password. A password reset sends no code. Token issuer and JWKS URLs are floci URLs. Identity pools are stored, but cannot hand out credentials. Test sign-in with a client secret works only on `localhost` or HTTPS. |
| **Route 53** | Records of a private zone resolve only for containers that use floci's DNS. A public zone answers only TXT, NS and SOA records. floci accepts any record value, so the form checks it. Health checks never call the endpoint and always report success. |
| **Certificate Manager** | A certificate is issued at once, with no validation. The issuer is `Floci Local CA`. Export works only for private certificates. |
| **ECS** | Every launch type runs as Docker containers on the floci host. Port mappings bind real ports there. Run task answers only after the image is pulled. Tasks are gone after floci restarts. A deleted task definition stays in `DELETE_IN_PROGRESS`. |
| **ECR** | The repository URI is a `*.localhost:4566` name. Push works only where `localhost:4566` reaches floci. The registry takes any login. There are no scan results. Policies are stored but do nothing. |
| **EventBridge** | Targets that need a role in AWS deliver without one. floci accepts an event pattern that is not JSON, so the form checks it. |
| **Step Functions** | A Wait state ends after 30 seconds at most. Express executions can be listed and opened. |
| **VPC** | No real traffic is routed. floci deletes a route table with subnet associations and an attached internet gateway. AWS refuses both, so the page disables Delete. NAT gateways are available at once. |
| **CloudFormation** | Stacks finish at once. A resource type floci does not know does not fail the stack. It shows `CREATE_COMPLETE` with a note in the event. No stack description is returned. Deleted stacks stay listed for 30 seconds. |
| **Kinesis** | An on-demand stream starts with 1 shard. AWS starts with 4. |
| **OpenSearch** | Each domain is a real container. Create does not answer until it is ready. The first one took about 5 minutes. The endpoint in the API is a container address. Connect to the floci host on a port from 9400 to 9499. Cluster health is always green. The access policy is not enforced. |
| **AppSync** | The first schema save takes about 2 minutes and the first query can time out, because floci starts containers. `ListTypes` is empty, so the page reads types from the schema text. The real-time endpoint is not served. |

## 3. How the code is laid out

```
server.mjs            production server: serves dist/ and proxies /aws/* to floci
bin/cli.mjs           the `floci-aws-ui serve` command; checks its options, then runs server.mjs
vite.config.ts        dev server with the same /aws proxy
src/config.ts         shared SDK client settings (endpoint, region, credentials)
src/clients/          one SDK client per service
src/pages/<service>/  the pages of one service
src/components/       shared parts (Shell, ResourceTable, FormModal, ConfirmDelete)
src/lib/              hooks (useLoad, useSubmit, useNotify) and formatters
src/components/nav.ts the service list and side navigation
src/App.tsx           all routes, loaded lazily per page
test/                 test setup, and the tests of server.mjs
```

**Patterns to follow**

- **List pages** use `ResourceTable`.
- **Loading data** uses `useLoad(loader, deps)`. It returns `data`, `loading`, `error` and `reload`.
- **Create and edit dialogs** use `FormModal` with `useSubmit`.
- **Delete** uses `ConfirmDelete`. The user types the name to confirm.
- **Detail pages** for a resource whose ID has a slash or is an ARN take the ID as a query parameter, not a path part.
- Write `if / else` around two different SDK commands. A ternary inside `client.send()` fails type-checking.

## 4. Known gaps

- **No login.** Anyone who can open the console can change everything.
- **Most pages have no automated test.** The main list page of SQS and of the 13 newer services has one. Detail pages do not. Use `src/pages/sqs/Queues.test.tsx` as the pattern.
- **No test runs against a real floci.** The page tests use a fake SDK client.
- The product name and CLI profile name are constants in `src/config.ts`. They are not settings.

**Left out of the newer services**

| Service | Not built |
|---------|-----------|
| **DynamoDB** | Stream records viewer, backups, point-in-time recovery, PartiQL, tags. |
| **Cognito** | Editing a pool, client or group. Identity providers, triggers, resource servers. |
| **Route 53** | Routing policies other than Simple and Alias in the record form. |
| **ECS** | Capacity providers, container instances, ECS Exec, tags. |
| **EventBridge** | Input path and input transformer in the add target form. Schedule start and end date, retry policy, dead-letter queue. Archives, replays, API destinations. |
| **Step Functions** | A drawn workflow graph. Versions, aliases, activities. |
| **CloudFormation** | Change sets. Converting a template between YAML and JSON. Template upload from a file or S3. |
| **OpenSearch** | Indices and Dev tools. The `/aws` proxy reaches only floci's port 4566, and the OpenSearch API is on another port. |
| **AppSync** | Functions and pipeline resolvers. The query box for APIs without an API key. |
