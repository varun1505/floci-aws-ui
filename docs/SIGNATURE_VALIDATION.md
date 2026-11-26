# Signature validation

The web console works when floci checks request signatures the way AWS does. This page covers how to turn the checks on and what they change for the web console. Developers can read [How it works](#how-it-works).

## Turn it on

Set `FLOCI_AUTH_VALIDATE_SIGNATURES=true` on floci and restart it. Give the web console the same setting, so it knows from the start:

```yaml
services:
  floci:
    image: floci/floci:latest
    environment:
      FLOCI_AUTH_VALIDATE_SIGNATURES: "true"
  console:
    environment:
      FLOCI_AUTH_VALIDATE_SIGNATURES: "true"
```

When floci starts the web console itself (`FLOCI_SERVICES_UI_IMAGE`), pass the setting to it through floci:

```yaml
services:
  floci:
    environment:
      FLOCI_AUTH_VALIDATE_SIGNATURES: "true"
      FLOCI_SERVICES_UI_IMAGE: ghcr.io/varun1505/floci-aws-ui:latest
      FLOCI_SERVICES_UI_EXTRA_ENV: FLOCI_AUTH_VALIDATE_SIGNATURES=true
```

Without the setting, the web console asks floci whether it checks signatures. That works too, but when floci restarts with checks on while the web console runs, the first request can fail once.

## Which accounts open

With checks on, the web console opens an account through its `OrganizationAccountAccessRole` role, the way an AWS organization's management account reaches its member accounts.

| The account | Opens in the account menu |
| --- | --- |
| floci's default account (`000000000000` unless you changed it) | Yes |
| An account created with **Organization > Add an AWS account** from the default account | Yes. floci gives it the role. |
| An account invited into your organization | Only after you create the role in it |
| An account outside any organization | Only if the role already exists in it |
| An account in an organization managed by another account | No |

> [!WARNING]
> With checks on, nobody can sign in to an invited or standalone account to create the role. Create the role while checks are off, or create the account from the default account instead. AWS describes the role in [Creating OrganizationAccountAccessRole for an invited account](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_create-cross-account-role.html).

When an account cannot be opened, the account menu says why and stays in the account you were in.

> [!TIP]
> Create new accounts from floci's default account: select it in the account menu, then choose **Organization > Add an AWS account**.

## Host names

With checks on, the web console works at `localhost`, `127.0.0.1` and the address given with `--host`. To open it under another name or address, such as `http://console.lan:8080`, list those names in `FLOCI_CONSOLE_HOSTS`, separated by commas, without the port:

```yaml
services:
  console:
    environment:
      FLOCI_CONSOLE_HOSTS: console.lan,10.0.0.5
```

This setting does not change who can connect. That is still decided by the address the port is published on.

## When something is refused

| What you see | What to do |
| --- | --- |
| `HostNotAllowed` | Open the web console at `localhost`, or add the name you used to `FLOCI_CONSOLE_HOSTS`. |
| The web console cannot open account ... | The account needs the `OrganizationAccountAccessRole` role. See [Which accounts open](#which-accounts-open). |
| A request fails right after floci restarts with checks on | Try again: the next one works. To avoid it, give the web console the same setting. See [Turn it on](#turn-it-on). |
| Every page fails after you turn checks off or on | The web console's `FLOCI_AUTH_VALIDATE_SIGNATURES` no longer matches floci's. Change it to the same value. |

---

## How it works

This part is for developers. It explains what the console server does, and why.

The signing lives in `aws-signing.mjs`, which both servers use: `server.mjs` for the built web console, and `vite.config.ts` for the dev server (`pnpm dev`). Each passes its `/aws` requests to the module first. A request the module does not sign goes on to the server's own proxy, unchanged. The dev server reads the settings below from the environment or from `.env.local`.

### Why the console server signs

Without checks, the browser signs every request with `test` / `test`, or with the selected account ID as the access key, and the console server forwards it to floci. With checks on, that fails in two ways:

1. **The account ID is not a key floci issued**, so floci refuses it (`InvalidClientTokenId`).
2. **The signature does not match.** The browser signs for the web console's own address, `http://<web console>/aws/...`. The console server forwards to floci's host without `/aws`, and floci checks the signature against the request it receives (`SignatureDoesNotMatch`).

The browser cannot fix either: it has no credentials floci accepts, and it cannot sign for an address it does not call. The console server can. It holds the credentials floci gives every console (the console contract passes `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`), and it is the one that talks to floci.

floci runs unmodified. The console server signs the way any AWS client does, and it reaches other accounts the way AWS documents for an organization's management account ([Accessing a member account](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_access-cross-account-role.html)).

### What floci's setting changes

| A request signed with | Checks off (default) | Checks on |
| --- | --- | --- |
| `test` / `test` | Accepted, as floci's default account | Accepted, as floci's default account |
| A 12-digit account ID as the access key, any secret | Accepted, as that account's root | Refused: `InvalidClientTokenId` |
| An access key floci issued (IAM user key, STS session) | Accepted | Accepted when the secret matches |
| A wrong secret | Accepted | Refused: `SignatureDoesNotMatch` |
| A signature made for another host or path | Accepted | Refused: `SignatureDoesNotMatch` |
| No signature at all | floci's IAM enforcement decides | floci's IAM enforcement decides |

Presigned URLs follow the same rules: floci checks the signature in the query, including the host it was signed for.

### What the console server does

When floci does not check signatures, the console server forwards every request exactly as it came. That is the original behavior, and nothing below happens.

A request goes through the steps below when it carries an `Authorization` header, or when it is a presigned URL made with `test` or an account ID:

1. **Know whether floci checks signatures.** When `FLOCI_AUTH_VALIDATE_SIGNATURES` is set on the console server, it uses that value and never asks: `true` signs every such request again, `false` forwards every request as it came. When it is not set, the console server asks. floci does not report the setting, so the console server sends one `GetCallerIdentity` signed with a key floci never issued. A refusal means checks are on. The answer is kept for 5 minutes, and requests that arrive while it asks share that one request. If floci refuses the credentials of a request forwarded as it came (it restarted with checks on), the console server asks again on a following request, no sooner than one second after it last asked. Only credential errors do this: `InvalidClientTokenId`, `SignatureDoesNotMatch` and the like, read from `x-amzn-errortype` or the error code in the body. Other errors, such as `AccessDenied`, change nothing.
2. **Check the host name.** The console server adds its credentials only for `localhost`, `127.0.0.1`, `::1`, the `HOST` address (unless it is `0.0.0.0` or `::`), and the names in `FLOCI_CONSOLE_HOSTS`, in any case, with any port. Any other name gets `403 HostNotAllowed`. See [Why the host name check](#why-the-host-name-check).
3. **Read the account and region** from the request's credential scope. A 12-digit access key names the account. Any other key means floci's default account (`defaults.account_id` in floci's manifest, `/_floci/info`).
4. **Choose credentials.**
   - floci's default account: the console server's own key pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`; `test` / `test` when not set).
   - Any other account: `sts:AssumeRole` into `arn:<partition>:iam::<account>:role/<FLOCI_CONSOLE_ROLE_NAME>` (default `OrganizationAccountAccessRole`, session name `floci-aws-ui`, one hour), signed with the console server's own key pair. The partition comes from the region: `us-gov-*` is `aws-us-gov`, `cn-*` is `aws-cn`, any other is `aws`. Credentials are kept per partition and account until 5 minutes before they expire, or until floci refuses them.
5. **Sign again.** The console server removes the browser's signing headers (`authorization`, `x-amz-date`, `x-amz-security-token`, `x-amz-content-sha256`), hop-by-hop headers, cookies and `x-forwarded-*`, and signs for floci's host, the path without `/aws`, and the query. The signed headers are `host`, `x-amz-date`, `x-amz-content-sha256`, `content-type` and every other `x-amz-*` header.
   - **S3 bodies** with a known length are streamed to floci as they arrive, signed as `UNSIGNED-PAYLOAD`, which S3 accepts. Memory use does not grow with the upload.
   - **Other bodies** are read whole, up to 1 GiB, and their SHA-256 hash is signed. An `aws-chunked` body (AWS CLI and SDK uploads) is decoded first: the chunks become the plain body, and trailers such as `x-amz-checksum-crc32` become headers.
   - **Presigned URLs** are presigned again for floci's host and path, with only `host` signed. Their other query parameters are kept. The new URL is valid for the time the old one had left, and no longer than the credentials it is signed with. An expired URL gets `403 AccessDenied` (`Request has expired`) without reaching floci.
6. **Forward** the request and stream floci's answer back. When `AssumeRole` is refused, the browser gets STS's error, marked with `x-floci-console-error: assume-role`, and the account menu explains it.

These requests are always forwarded as they came:

- requests without an `Authorization` header;
- presigned URLs made with any other key, such as the ones floci makes itself. A Lambda function's code location, for example, is signed by floci with a key it issued, for the host the console server uses, so it verifies as it is.

### Why the host name check

With checks on, the console server lends its credentials to the requests it signs. A web page on another site cannot send it such a request: the request needs an `Authorization` header, which makes the browser ask the console server first, and the console server never allows it. A page that uses DNS rebinding to point its own name at the console server's address gets past that, because the browser then treats it as the web console's own site. Checking the `Host` header stops it.

Publishing the port on `127.0.0.1` does not stop this, because the page runs in the user's own browser on the same machine. `FLOCI_CONSOLE_HOSTS` only adds names to accept; it does not open the port to anyone.

The check applies only where the console server adds its credentials. Requests forwarded as they came keep the original behavior.

### Limits

- **Request bodies other than plain S3 bodies are read whole**, up to 1 GiB each. A larger one gets `413`. AWS keeps other services' requests small, and the AWS CLI and SDKs send `aws-chunked` uploads in parts of a few MB.
- **IAM and STS keys floci issued are not passed on.** A request signed with such a key through `/aws` is signed again as floci's default account (or the role, for a 12-digit key). A presigned URL made with such a key for the web console's address is forwarded as it came, and floci refuses it.
- **The web console's address has no login.** It lends its credentials to anyone who can reach it, while floci's own address still checks every request.
- **The console server signs with `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.** Do not start it in a shell that holds real AWS credentials: their key ID and session token would be sent to floci.

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLOCI_AUTH_VALIDATE_SIGNATURES` | not set: ask floci | floci's own setting, given to the console server too: `true` or `false`, in any case. The console server does not start with any other value. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | `test` / `test`, no token | The console server's own credentials, used for floci's default account and to assume roles. |
| `FLOCI_CONSOLE_ROLE_NAME` | `OrganizationAccountAccessRole` | The role the console server assumes in accounts other than floci's default one. The console server does not start when this is not a valid role name. |
| `FLOCI_CONSOLE_HOSTS` | not set | More host names the console server signs for, separated by commas. See [Host names](#host-names). |
| `FLOCI_INFO_URL` | `<floci>/_floci/info` | floci's manifest. The console server reads floci's default account there. |
| `FLOCI_DEFAULT_ACCOUNT_ID` | `000000000000` | floci's default account when the manifest does not say. Set it to the value you give floci. |

All settings are listed in the [README](../README.md#settings).
