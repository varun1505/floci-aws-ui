import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type CertificateSummary, DeleteCertificateCommand, ImportCertificateCommand, type KeyAlgorithm, RequestCertificateCommand, type ValidationMethod } from "@aws-sdk/client-acm";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import Textarea from "@cloudscape-design/components/textarea";
import { acm } from "../../clients/acm";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { CertStatus, KEY_ALGORITHMS, algorithmLabel, certHref, certId, isPem, listCertificates, renewalLabel, toBytes, typeLabel } from "./acmutil";

// A domain name. The first label can be "*" for a wildcard certificate.
const DOMAIN = /^(?=.{1,253}$)(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export default function Certificates() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listCertificates, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<CertificateSummary[]>([]);
  const [modal, setModal] = useState<"request" | "import" | "delete" | undefined>(undefined);
  const [domain, setDomain] = useState("");
  const [more, setMore] = useState("");
  const [method, setMethod] = useState("DNS");
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>("RSA_2048");
  const [body, setBody] = useState("");
  const [key, setKey] = useState("");
  const [chain, setChain] = useState("");

  const open = (which: "request" | "import") => {
    setDomain("");
    setMore("");
    setMethod("DNS");
    setAlgorithm("RSA_2048");
    setBody("");
    setKey("");
    setChain("");
    form.setError("");
    setModal(which);
  };

  const request = async () => {
    const name = domain.trim();
    const names = more
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n && n !== name);
    if (!DOMAIN.test(name)) return form.setError("Enter a fully qualified domain name, such as www.example.com or *.example.com.");
    const bad = names.find((n) => !DOMAIN.test(n));
    if (bad) return form.setError(`${bad} is not a valid domain name.`);
    const ok = await form.run(async () => {
      const res = await acm.send(
        new RequestCertificateCommand({
          DomainName: name,
          // The API refuses an empty list, so leave the field out when there are no more names.
          SubjectAlternativeNames: names.length ? names : undefined,
          ValidationMethod: method as ValidationMethod,
          KeyAlgorithm: algorithm,
        }),
      );
      notify.success(`Successfully requested certificate with ID ${certId(res.CertificateArn)}.`);
      navigate(certHref(res.CertificateArn));
    });
    if (ok) setModal(undefined);
  };

  const importCert = async () => {
    if (!isPem(body, "CERTIFICATE")) return form.setError("Paste the certificate body in PEM format. It starts with -----BEGIN CERTIFICATE-----.");
    if (!isPem(key, "PRIVATE KEY")) return form.setError("Paste the private key in PEM format. It starts with -----BEGIN PRIVATE KEY-----.");
    if (chain.trim() && !isPem(chain, "CERTIFICATE")) return form.setError("Paste the certificate chain in PEM format, or leave it empty.");
    const ok = await form.run(async () => {
      const res = await acm.send(new ImportCertificateCommand({ Certificate: toBytes(body), PrivateKey: toBytes(key), CertificateChain: chain.trim() ? toBytes(chain) : undefined }));
      notify.success(`Successfully imported certificate with ID ${certId(res.CertificateArn)}.`);
      navigate(certHref(res.CertificateArn));
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      for (const c of selected) await acm.send(new DeleteCertificateCommand({ CertificateArn: c.CertificateArn }));
      notify.success(`Deleted ${selected.length} certificate${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the certificate", e);
    }
    setModal(undefined);
    list.reload();
  };

  return (
    <Shell service="acm" contentType="table" breadcrumbs={[{ text: "AWS Certificate Manager", href: "/acm/certificates" }, { text: "Certificates", href: "/acm/certificates" }]}>
      <ResourceTable
        title="Certificates"
        resourceName="certificates"
        filterPlaceholder="Filter certificates by domain name or ARN"
        emptyDescription="A certificate lets a load balancer or a distribution serve your domain over HTTPS."
        emptyCli="acm request-certificate --domain-name example.com --validation-method DNS"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(c) => c.CertificateArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => open("request")}>Request</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button onClick={() => open("import")}>Import</Button>
            <Button variant="primary" onClick={() => open("request")}>
              Request
            </Button>
          </>
        }
        columns={[
          { id: "id", header: "Certificate ID", cell: (c) => <RouterLink to={certHref(c.CertificateArn)}>{certId(c.CertificateArn)}</RouterLink>, sortingField: "CertificateArn", isRowHeader: true },
          { id: "domain", header: "Domain name", cell: (c) => c.DomainName ?? "-", sortingField: "DomainName" },
          { id: "type", header: "Type", cell: (c) => typeLabel(c.Type), sortingField: "Type" },
          { id: "status", header: "Status", cell: (c) => <CertStatus status={c.Status} />, sortingField: "Status" },
          { id: "inuse", header: "In use?", cell: (c) => (c.InUse ? "Yes" : "No") },
          { id: "algorithm", header: "Key algorithm", cell: (c) => algorithmLabel(c.KeyAlgorithm) },
          { id: "requested", header: "Requested at", cell: (c) => formatDate(c.CreatedAt), sortingComparator: (a, b) => (a.CreatedAt?.getTime() ?? 0) - (b.CreatedAt?.getTime() ?? 0) },
          { id: "issued", header: "Issued at", cell: (c) => formatDate(c.IssuedAt ?? c.ImportedAt) },
          { id: "renewal", header: "Renewal eligibility", cell: (c) => renewalLabel(c.RenewalEligibility) },
        ]}
      />

      <FormModal visible={modal === "request"} header="Request public certificate" submitLabel="Request" busy={form.busy} error={modal === "request" ? form.error : ""} onDismiss={() => setModal(undefined)} onSubmit={request}>
        <FormField label="Fully qualified domain name">
          <Input value={domain} placeholder="www.example.com" onChange={(e) => setDomain(e.detail.value)} />
        </FormField>
        <FormField label="More names for this certificate - optional" description="One name per line.">
          <Textarea value={more} rows={3} placeholder="*.example.com" onChange={(e) => setMore(e.detail.value)} spellcheck={false} />
        </FormField>
        <FormField label="Validation method" description="The emulator does not check that you own the domain. It issues the certificate at once.">
          <RadioGroup
            value={method}
            onChange={(e) => setMethod(e.detail.value)}
            items={[
              { value: "DNS", label: "DNS validation - recommended" },
              { value: "EMAIL", label: "Email validation" },
            ]}
          />
        </FormField>
        <FormField label="Key algorithm">
          <Select
            selectedOption={KEY_ALGORITHMS.find((k) => k.value === algorithm) ?? KEY_ALGORITHMS[0]}
            onChange={(e) => setAlgorithm((e.detail.selectedOption.value as KeyAlgorithm) ?? "RSA_2048")}
            options={KEY_ALGORITHMS}
          />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "import"} size="large" header="Import certificate" submitLabel="Import certificate" busy={form.busy} error={modal === "import" ? form.error : ""} onDismiss={() => setModal(undefined)} onSubmit={importCert}>
        <FormField label="Certificate body" description="The certificate in PEM format." stretch>
          <Textarea value={body} rows={5} placeholder="-----BEGIN CERTIFICATE-----" onChange={(e) => setBody(e.detail.value)} spellcheck={false} />
        </FormField>
        <FormField label="Certificate private key" description="The private key that matches the certificate, in PEM format." stretch>
          <Textarea value={key} rows={5} placeholder="-----BEGIN PRIVATE KEY-----" onChange={(e) => setKey(e.detail.value)} spellcheck={false} />
        </FormField>
        <FormField label="Certificate chain - optional" stretch>
          <Textarea value={chain} rows={4} onChange={(e) => setChain(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete"}
        title={selected.length === 1 ? `Delete certificate ${certId(selected[0].CertificateArn)}` : `Delete ${selected.length} certificates`}
        onCancel={() => setModal(undefined)}
        onConfirm={remove}
        warning={selected.some((c) => c.InUse) ? "A certificate that is in use can't be deleted. Remove it from the resources that use it first." : "You can't undo this."}
      />
    </Shell>
  );
}
