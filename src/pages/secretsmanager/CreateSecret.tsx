import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateSecretCommand } from "@aws-sdk/client-secrets-manager";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { secrets } from "../../clients/secrets";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { secretHref } from "./Secrets";
import { SecretValueEditor, draftError, draftToString, type SecretDraft } from "./SecretValueEditor";

export default function CreateSecret() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [draft, setDraft] = useState<SecretDraft>({ mode: "pairs", pairs: [{ key: "", value: "" }], plain: "" });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const nameError = !name ? "Secret name is required." : !/^[A-Za-z0-9/_+=.@-]{1,512}$/.test(name) ? "Use only letters, numbers and the characters /_+=.@-" : "";
  const valueError = draftError(draft);

  const create = async () => {
    setTouched(true);
    if (nameError || valueError) return;
    setBusy(true);
    setError("");
    try {
      await secrets.send(new CreateSecretCommand({ Name: name, Description: description || undefined, SecretString: draftToString(draft) }));
      notify.success(`You successfully stored the secret ${name}.`);
      navigate(secretHref(name));
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Shell
      service="secretsmanager"
      contentType="form"
      breadcrumbs={[
        { text: "Secrets Manager", href: "/secretsmanager/secrets" },
        { text: "Secrets", href: "/secretsmanager/secrets" },
        { text: "Store a new secret", href: "/secretsmanager/secrets/create" },
      ]}
    >
      <ContentLayout header={<Header variant="h1">Store a new secret</Header>}>
        <Form
          errorText={error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/secretsmanager/secrets")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Store
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2" description="Enter the secret as key/value pairs or as plain text.">Secret value</Header>}>
              <FormField errorText={touched ? valueError : ""} stretch>
                <SecretValueEditor draft={draft} onChange={setDraft} />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Secret name and description</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Secret name"
                  description="A descriptive name that helps you find your secret later."
                  constraintText="Secret name must contain only alphanumeric characters and the characters /_+=.@-"
                  errorText={touched ? nameError : ""}
                >
                  <Input value={name} placeholder="prod/AppBeta/Mysql" onChange={(e) => setName(e.detail.value)} />
                </FormField>
                <FormField label="Description - optional">
                  <Input value={description} placeholder="Access to MYSQL prod database for my AppBeta" onChange={(e) => setDescription(e.detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
