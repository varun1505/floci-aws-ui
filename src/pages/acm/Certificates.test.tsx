import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The ACM client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/acm", () => ({ acm: { send } }));

import Certificates from "./Certificates";

const ARN = "arn:aws:acm:us-east-1:000000000000:certificate/3b426dab-cc4d-4d23-98d5-d25186290d8f";
const NEW_ARN = "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555";
let certs: Record<string, unknown>[];

beforeEach(() => {
  certs = [{ CertificateArn: ARN, DomainName: "example.com", Status: "ISSUED", Type: "AMAZON_ISSUED", KeyAlgorithm: "EC-prime256v1", InUse: false, RenewalEligibility: "INELIGIBLE", CreatedAt: new Date(1700000000000) }];
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListCertificatesCommand":
        return { CertificateSummaryList: certs };
      case "RequestCertificateCommand":
      case "ImportCertificateCommand":
        return { CertificateArn: NEW_ARN };
      case "DeleteCertificateCommand":
        certs = certs.filter((c) => c.CertificateArn !== command.input.CertificateArn);
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);
const ID = "3b426dab-cc4d-4d23-98d5-d25186290d8f";

// The dialogs are in the page even when closed, so a button name can match twice.
// The page's own button comes first. The dialog's button comes last.
const pageButton = (name: string) => screen.getAllByRole("button", { name })[0];
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open() {
  render(
    <MemoryRouter initialEntries={["/acm/certificates"]}>
      <NotifyProvider>
        <Certificates />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("ACM certificates page", () => {
  it("lists the certificates with a link that carries the ARN", async () => {
    open();
    expect(await screen.findByRole("link", { name: ID })).toHaveAttribute("href", `/acm/certificate?arn=${encodeURIComponent(ARN)}`);
    const row = within(screen.getByRole("link", { name: ID }).closest("tr")!);
    expect(row.getByText("example.com")).toBeInTheDocument();
    expect(row.getByText("Amazon Issued")).toBeInTheDocument();
    expect(row.getByText("Issued")).toBeInTheDocument();
    expect(row.getByText("ECDSA P 256")).toBeInTheDocument();
    expect(row.getByText("Ineligible")).toBeInTheDocument();
  });

  it("requests a certificate with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: ID });
    await userEvent.click(pageButton("Request"));
    await userEvent.type(await screen.findByPlaceholderText("www.example.com"), "shop.test");
    await userEvent.type(screen.getByPlaceholderText("*.example.com"), "*.a.test{enter}b.test");
    await userEvent.click(dialogButton("Request"));
    await waitFor(() => expect(sent("RequestCertificateCommand")).toHaveLength(1));
    expect(sent("RequestCertificateCommand")[0].input).toEqual({
      DomainName: "shop.test",
      SubjectAlternativeNames: ["*.a.test", "b.test"],
      ValidationMethod: "DNS",
      KeyAlgorithm: "RSA_2048",
    });
  });

  it("leaves out the list of more names when there are none", async () => {
    open();
    await screen.findByRole("link", { name: ID });
    await userEvent.click(pageButton("Request"));
    await userEvent.type(await screen.findByPlaceholderText("www.example.com"), "shop.test");
    await userEvent.click(dialogButton("Request"));
    await waitFor(() => expect(sent("RequestCertificateCommand")).toHaveLength(1));
    expect(sent("RequestCertificateCommand")[0].input.SubjectAlternativeNames).toBeUndefined();
  });

  it("rejects a domain name that is not valid", async () => {
    open();
    await screen.findByRole("link", { name: ID });
    await userEvent.click(pageButton("Request"));
    await userEvent.type(await screen.findByPlaceholderText("www.example.com"), "not a domain");
    await userEvent.click(dialogButton("Request"));
    expect(await screen.findByText(/Enter a fully qualified domain name/)).toBeInTheDocument();
    expect(sent("RequestCertificateCommand")).toHaveLength(0);
  });

  it("rejects an import whose certificate body is not PEM", async () => {
    open();
    await screen.findByRole("link", { name: ID });
    await userEvent.click(pageButton("Import"));
    await userEvent.type(await screen.findByPlaceholderText("-----BEGIN CERTIFICATE-----"), "hello");
    await userEvent.click(dialogButton("Import certificate"));
    expect(await screen.findByText(/Paste the certificate body in PEM format/)).toBeInTheDocument();
    expect(sent("ImportCertificateCommand")).toHaveLength(0);
  });

  it("deletes the selected certificate only after the user confirms", async () => {
    open();
    await screen.findByRole("link", { name: ID });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    await userEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    await userEvent.click(del);
    expect(sent("DeleteCertificateCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteCertificateCommand")).toHaveLength(1));
    expect(sent("DeleteCertificateCommand")[0].input).toEqual({ CertificateArn: ARN });
    await waitFor(() => expect(screen.queryByRole("link", { name: ID })).not.toBeInTheDocument());
  });
});
