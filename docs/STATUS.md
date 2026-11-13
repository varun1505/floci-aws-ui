# Project status and notes

**Summary**

- The console covers **15 AWS services** plus load balancers. All pages build and type-check.
- Everything was checked by hand in a browser against **floci 2.4.0**. There are **no automated tests** yet.
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

## 3. How the code is laid out

```
server.mjs            production server: serves dist/ and proxies /aws/* to floci
vite.config.ts        dev server with the same /aws proxy
src/config.ts         shared SDK client settings (endpoint, region, credentials)
src/clients/          one SDK client per service
src/pages/<service>/  the pages of one service
src/components/       shared parts (Shell, ResourceTable, FormModal, ConfirmDelete)
src/lib/              hooks (useLoad, useSubmit, useNotify) and formatters
src/components/nav.ts the service list and side navigation
src/App.tsx           all routes, loaded lazily per page
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
- **No automated tests and no CI.**
- The product name and CLI profile name are fixed in the code.
