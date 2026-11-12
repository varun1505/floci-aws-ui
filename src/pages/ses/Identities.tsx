import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteIdentityCommand, GetIdentityVerificationAttributesCommand, ListIdentitiesCommand, SendEmailCommand, VerifyDomainIdentityCommand, VerifyEmailIdentityCommand } from "@aws-sdk/client-ses";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Textarea from "@cloudscape-design/components/textarea";
import { ses } from "../../clients/ses";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

type Identity = { name: string; type: "Email address" | "Domain"; status: string };

export async function listIdentities(): Promise<Identity[]> {
  const names: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ses.send(new ListIdentitiesCommand({ NextToken, MaxItems: 100 }));
    names.push(...(res.Identities ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  if (names.length === 0) return [];
  const attrs = (await ses.send(new GetIdentityVerificationAttributesCommand({ Identities: names })).catch(() => undefined))?.VerificationAttributes ?? {};
  return names.map((name) => ({ name, type: name.includes("@") ? "Email address" : "Domain", status: attrs[name]?.VerificationStatus ?? "Pending" }));
}

export default function Identities() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listIdentities, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Identity[]>([]);
  const [modal, setModal] = useState<"create" | "send" | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [type, setType] = useState("email");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("Test email");
  const [body, setBody] = useState("This is a test email sent from the console.");

  const openCreate = () => {
    setValue("");
    form.setError("");
    setModal("create");
  };

  const openSend = () => {
    const id = selected[0];
    setFrom(id.type === "Domain" ? `no-reply@${id.name}` : id.name);
    form.setError("");
    setModal("send");
  };

  const create = async () => {
    const email = type === "email";
    if (email ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) : !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return form.setError(email ? "Enter a valid email address." : "Enter a valid domain name.");
    const ok = await form.run(async () => {
      if (email) await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: value }));
      else await ses.send(new VerifyDomainIdentityCommand({ Domain: value }));
      notify.success(`Identity ${value} created.`);
      list.reload();
    });
    if (ok) setModal(undefined);
  };

  const send = async () => {
    const recipients = to.split(/[,\s]+/).filter(Boolean);
    if (recipients.length === 0) return form.setError("Enter at least one recipient.");
    const ok = await form.run(async () => {
      const res = await ses.send(new SendEmailCommand({ Source: from, Destination: { ToAddresses: recipients }, Message: { Subject: { Data: subject }, Body: { Text: { Data: body } } } }));
      notify.success(
        <>
          Email sent. Message ID: {res.MessageId}.{" "}
          <Button variant="inline-link" onClick={() => navigate("/ses/mailbox")}>
            Open the mailbox
          </Button>
        </>,
      );
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      for (const i of selected) await ses.send(new DeleteIdentityCommand({ Identity: i.name }));
      notify.success(`Deleted ${selected.length} identit${selected.length === 1 ? "y" : "ies"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the identity", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ses" contentType="table" breadcrumbs={[{ text: "Amazon SES", href: "/ses/identities" }, { text: "Identities", href: "/ses/identities" }]}>
      <ResourceTable
        title="Identities"
        resourceName="identities"
        filterPlaceholder="Search identities"
        emptyDescription="An identity is an email address or a domain that you send email from."
        emptyCli="ses verify-email-identity --email-address no-reply@example.com"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(i) => i.name}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create identity</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={openSend}>
              Send test email
            </Button>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create identity
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Identity", cell: (i) => i.name, sortingField: "name", isRowHeader: true },
          { id: "type", header: "Identity type", cell: (i) => i.type, sortingField: "type" },
          {
            id: "status",
            header: "Identity status",
            cell: (i) => <StatusIndicator type={i.status === "Success" ? "success" : i.status === "Failed" ? "error" : "pending"}>{i.status === "Success" ? "Verified" : i.status}</StatusIndicator>,
          },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create identity" submitLabel="Create identity" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        <FormField label="Identity type">
          <RadioGroup
            value={type}
            onChange={(e) => setType(e.detail.value)}
            items={[
              { value: "email", label: "Email address", description: "Send from one address." },
              { value: "domain", label: "Domain", description: "Send from any address at the domain." },
            ]}
          />
        </FormField>
        <FormField label={type === "email" ? "Email address" : "Domain"} description="This environment verifies identities at once. No confirmation email is sent.">
          <Input value={value} placeholder={type === "email" ? "no-reply@example.com" : "example.com"} onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "send"} size="large" header="Send test email" submitLabel="Send test email" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={send}>
        <FormField label="From-address">
          <Input value={from} onChange={(e) => setFrom(e.detail.value)} />
        </FormField>
        <FormField label="Recipient" description="No email leaves this environment. The message goes to the Mailbox page.">
          <Input value={to} placeholder="someone@example.com" onChange={(e) => setTo(e.detail.value)} />
        </FormField>
        <FormField label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.detail.value)} />
        </FormField>
        <FormField label="Body" stretch>
          <Textarea value={body} rows={6} onChange={(e) => setBody(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].name}` : `Delete ${selected.length} identities`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Applications that send from a deleted identity will get errors." />
    </Shell>
  );
}
