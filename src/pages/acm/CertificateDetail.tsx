import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteCertificateCommand, DescribeCertificateCommand, ExportCertificateCommand, GetCertificateCommand } from "@aws-sdk/client-acm";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import { acm } from "../../clients/acm";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { download, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { CertificateTags } from "./CertificateTags";
import { CertStatus, algorithmLabel, certHref, certId, renewalLabel, typeLabel } from "./acmutil";

function Pem({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div>
      <SpaceBetween direction="horizontal" size="xs" alignItems="center">
        <Box variant="awsui-key-label">{label}</Box>
        <CopyToClipboard variant="icon" textToCopy={text} copyButtonAriaLabel={`Copy ${label.toLowerCase()}`} copySuccessText="Copied" copyErrorText="Failed to copy" />
      </SpaceBetween>
      <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", fontSize: 12 }}>{text}</pre>
    </div>
  );
}

export default function CertificateDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const id = certId(arn);
  const navigate = useNavigate();
  const notify = useNotify();
  const cert = useLoad(async () => (await acm.send(new DescribeCertificateCommand({ CertificateArn: arn }))).Certificate, [arn]);
  const pem = useLoad(() => acm.send(new GetCertificateCommand({ CertificateArn: arn })), [arn]);
  const form = useSubmit();
  const [modal, setModal] = useState<"delete" | "export" | undefined>(undefined);
  const [passphrase, setPassphrase] = useState("");

  const c = cert.data;
  const inUse = c?.InUseBy ?? [];

  const remove = async () => {
    try {
      await acm.send(new DeleteCertificateCommand({ CertificateArn: arn }));
      notify.success(`Deleted certificate ${id}.`);
      navigate("/acm/certificates");
    } catch (e) {
      notify.error("Could not delete the certificate", e);
      setModal(undefined);
    }
  };

  const exportCert = async () => {
    if (passphrase.length < 4) return form.setError("Enter a passphrase of 4 characters or more.");
    const ok = await form.run(async () => {
      const res = await acm.send(new ExportCertificateCommand({ CertificateArn: arn, Passphrase: new TextEncoder().encode(passphrase) }));
      download([res.Certificate, res.CertificateChain, res.PrivateKey].filter(Boolean).join("\n"), `${id}.pem`, "application/x-pem-file");
      notify.success("The certificate, its chain and its encrypted private key were downloaded as one file.");
    });
    if (ok) setModal(undefined);
  };

  return (
    <Shell
      service="acm"
      breadcrumbs={[
        { text: "AWS Certificate Manager", href: "/acm/certificates" },
        { text: "Certificates", href: "/acm/certificates" },
        { text: id, href: certHref(arn) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (cert.reload(), pem.reload())} />
                {/* The emulator exports only private certificates, as AWS does by default. */}
                {c?.Type === "PRIVATE" && (
                  <Button
                    onClick={() => {
                      setPassphrase("");
                      form.setError("");
                      setModal("export");
                    }}
                  >
                    Export
                  </Button>
                )}
                <Button disabled={!c} onClick={() => setModal("delete")}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {id}
          </Header>
        }
      >
        {cert.error ? (
          <Alert type="error" header="Could not load the certificate">
            {cert.error}
          </Alert>
        ) : !c ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Certificate status</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <Pair label="Identifier">
                  <Copy text={id} />
                </Pair>
                <Pair label="Status">
                  <CertStatus status={c.Status} />
                </Pair>
                <Pair label="ARN">
                  <Copy text={c.CertificateArn} />
                </Pair>
                <Pair label="Type">{typeLabel(c.Type)}</Pair>
              </ColumnLayout>
            </Container>

            <Table
              header={
                <Header variant="h2" counter={`(${c.DomainValidationOptions?.length ?? 0})`} description="The emulator does not check the CNAME records. It marks every domain as validated.">
                  Domains
                </Header>
              }
              wrapLines
              items={c.DomainValidationOptions ?? []}
              columnDefinitions={[
                { id: "domain", header: "Domain", cell: (d) => d.DomainName, isRowHeader: true },
                { id: "status", header: "Status", cell: (d) => <CertStatus status={d.ValidationStatus} /> },
                { id: "method", header: "Validation method", cell: (d) => d.ValidationMethod ?? "-" },
                { id: "type", header: "Type", cell: (d) => d.ResourceRecord?.Type ?? "-" },
                { id: "name", header: "CNAME name", cell: (d) => <Copy text={d.ResourceRecord?.Name} /> },
                { id: "value", header: "CNAME value", cell: (d) => <Copy text={d.ResourceRecord?.Value} /> },
              ]}
              empty={<Box textAlign="center">{c.Type === "IMPORTED" ? "An imported certificate has no domain validation." : "No domains"}</Box>}
            />

            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="In use">{inUse.length ? "Yes" : "No"}</Pair>
                <Pair label="Domain name">{c.DomainName}</Pair>
                <Pair label="Number of additional names">{Math.max((c.SubjectAlternativeNames?.length ?? 1) - 1, 0)}</Pair>
                <Pair label="Serial number">{c.Serial}</Pair>
                <Pair label="Public key info">{algorithmLabel(c.KeyAlgorithm)}</Pair>
                <Pair label="Signature algorithm">{c.SignatureAlgorithm}</Pair>
                <Pair label="Issuer">{c.Issuer}</Pair>
                <Pair label="Requested at">{formatDate(c.CreatedAt)}</Pair>
                <Pair label={c.Type === "IMPORTED" ? "Imported at" : "Issued at"}>{formatDate(c.ImportedAt ?? c.IssuedAt)}</Pair>
                <Pair label="Not before">{formatDate(c.NotBefore)}</Pair>
                <Pair label="Not after">{formatDate(c.NotAfter)}</Pair>
                <Pair label="Renewal eligibility">{renewalLabel(c.RenewalEligibility)}</Pair>
                <Pair label="Associated resources">
                  {inUse.map((r) => (
                    <div key={r}>{r}</div>
                  ))}
                </Pair>
              </ColumnLayout>
            </Container>

            <CertificateTags arn={arn} />

            <ExpandableSection variant="container" headerText="Certificate in PEM format">
              {pem.error ? (
                <Alert type="error">{pem.error}</Alert>
              ) : (
                <SpaceBetween size="l">
                  <Pem label="Certificate body" text={pem.data?.Certificate} />
                  <Pem label="Certificate chain" text={pem.data?.CertificateChain} />
                </SpaceBetween>
              )}
            </ExpandableSection>
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "export"} header="Export certificate" submitLabel="Export" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={exportCert}>
        <FormField label="Passphrase" description="The private key in the file is encrypted with this passphrase.">
          <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={modal === "delete"}
        title={`Delete certificate ${id}`}
        onCancel={() => setModal(undefined)}
        onConfirm={remove}
        warning={inUse.length ? "This certificate is in use and can't be deleted. Remove it from the resources that use it first." : "You can't undo this."}
      />
    </Shell>
  );
}
