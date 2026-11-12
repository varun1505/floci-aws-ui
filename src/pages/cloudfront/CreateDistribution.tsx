import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateDistributionCommand, type ViewerProtocolPolicy } from "@aws-sdk/client-cloudfront";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cloudfront } from "../../clients/cloudfront";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { POLICY_LABEL } from "./cfutil";

// The managed "CachingOptimized" cache policy. AWS uses the same ID in every account.
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";

export default function CreateDistribution() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [domain, setDomain] = useState("");
  const [originId, setOriginId] = useState("");
  const [policy, setPolicy] = useState("redirect-to-https");
  const [rootObject, setRootObject] = useState("");
  const [comment, setComment] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  // Offer the S3 buckets of this environment as origins, the way the AWS console does.
  const buckets = useLoad(async () => {
    const [{ s3 }, { ListBucketsCommand }] = await Promise.all([import("../../clients/s3"), import("@aws-sdk/client-s3")]);
    return ((await s3.send(new ListBucketsCommand({}))).Buckets ?? []).map((b) => `${b.Name}.s3.amazonaws.com`);
  }, []);

  const domainError = !domain ? "Origin domain is required." : !/^[a-zA-Z0-9.-]+$/.test(domain) ? "Enter a domain name without a protocol or path." : "";

  const create = async () => {
    setTouched(true);
    if (domainError) return;
    setBusy(true);
    setError("");
    const id = originId || domain;
    const isS3 = /\.s3[.-]/.test(domain);
    try {
      const res = await cloudfront.send(
        new CreateDistributionCommand({
          DistributionConfig: {
            CallerReference: `console-${Date.now()}`,
            Comment: comment,
            Enabled: enabled,
            DefaultRootObject: rootObject || undefined,
            Origins: {
              Quantity: 1,
              Items: [
                isS3
                  ? { Id: id, DomainName: domain, S3OriginConfig: { OriginAccessIdentity: "" } }
                  : { Id: id, DomainName: domain, CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only" } },
              ],
            },
            DefaultCacheBehavior: { TargetOriginId: id, ViewerProtocolPolicy: policy as ViewerProtocolPolicy, CachePolicyId: CACHING_OPTIMIZED },
          },
        }),
      );
      const newId = res.Distribution?.Id;
      notify.success(`Successfully created new distribution ${newId}.`);
      navigate(newId ? `/cloudfront/distributions/${newId}` : "/cloudfront/distributions");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Shell
      service="cloudfront"
      contentType="form"
      breadcrumbs={[
        { text: "CloudFront", href: "/cloudfront/distributions" },
        { text: "Distributions", href: "/cloudfront/distributions" },
        { text: "Create distribution", href: "/cloudfront/distributions/create" },
      ]}
    >
      <ContentLayout header={<Header variant="h1">Create distribution</Header>}>
        <Form
          errorText={error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/cloudfront/distributions")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create distribution
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Origin</Header>}>
              <SpaceBetween size="l">
                <FormField label="Origin domain" description="Choose an S3 bucket, or enter the domain name of your origin." errorText={touched ? domainError : ""}>
                  <Autosuggest
                    value={domain}
                    onChange={(e) => setDomain(e.detail.value)}
                    options={(buckets.data ?? []).map((b) => ({ value: b }))}
                    placeholder="Choose origin domain"
                    enteredTextLabel={(v) => `Use: "${v}"`}
                    empty="No S3 buckets found. Type a domain name."
                    statusType={buckets.loading ? "loading" : "finished"}
                  />
                </FormField>
                <FormField label="Name" description="Enter a name for this origin. The default is the origin domain.">
                  <Input value={originId} placeholder={domain || "Origin name"} onChange={(e) => setOriginId(e.detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Default cache behavior</Header>}>
              <FormField label="Viewer protocol policy">
                <RadioGroup
                  value={policy}
                  onChange={(e) => setPolicy(e.detail.value)}
                  items={Object.entries(POLICY_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Default root object - optional" description="The object to return when a viewer requests the root URL (/).">
                  <Input value={rootObject} placeholder="index.html" onChange={(e) => setRootObject(e.detail.value)} />
                </FormField>
                <FormField label="Description - optional">
                  <Input value={comment} onChange={(e) => setComment(e.detail.value)} />
                </FormField>
                <Checkbox checked={enabled} onChange={(e) => setEnabled(e.detail.checked)}>
                  Enable the distribution after it is created
                </Checkbox>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
