import { useEffect, useState } from "react";
import { AdminInitiateAuthCommand, type AuthenticationResultType, InitiateAuthCommand, type UserPoolClientType } from "@aws-sdk/client-cognito-identity-provider";
import Alert from "@cloudscape-design/components/alert";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cognito } from "../../clients/cognito";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { useSubmit } from "../../lib/useSubmit";
import { decodeJwt, secretHash } from "./cognitoutil";

const CHALLENGE: Record<string, string> = {
  NEW_PASSWORD_REQUIRED: "The user has a temporary password. Set a permanent password for the user, then sign in again.",
  SOFTWARE_TOKEN_MFA: "The user signs in with an authenticator app. This dialog can't enter the code.",
  MFA_SETUP: "The user pool requires MFA and the user has not set it up.",
};

/** Signs a user in through an app client and shows the tokens that Cognito returns. */
export function TestSignIn({ client, onDismiss }: { client?: UserPoolClientType; onDismiss: () => void }) {
  const form = useSubmit();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tokens, setTokens] = useState<AuthenticationResultType | undefined>(undefined);
  const [challenge, setChallenge] = useState("");

  useEffect(() => {
    if (!client) return;
    setUsername("");
    setPassword("");
    setTokens(undefined);
    setChallenge("");
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.ClientId]);

  const signIn = async () => {
    if (!client) return;
    const flows = client.ExplicitAuthFlows ?? [];
    const user = flows.includes("ALLOW_USER_PASSWORD_AUTH");
    const admin = flows.includes("ALLOW_ADMIN_USER_PASSWORD_AUTH");
    if (!user && !admin) return form.setError("This app client allows no password sign-in. Create an app client with ALLOW_USER_PASSWORD_AUTH or ALLOW_ADMIN_USER_PASSWORD_AUTH.");
    if (!username || !password) return form.setError("Enter a user name and a password.");
    setTokens(undefined);
    setChallenge("");
    await form.run(async () => {
      const AuthParameters: Record<string, string> = { USERNAME: username, PASSWORD: password };
      if (client.ClientSecret) AuthParameters.SECRET_HASH = await secretHash(username, client.ClientId ?? "", client.ClientSecret);
      let res;
      if (user) res = await cognito.send(new InitiateAuthCommand({ ClientId: client.ClientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters }));
      else res = await cognito.send(new AdminInitiateAuthCommand({ UserPoolId: client.UserPoolId, ClientId: client.ClientId, AuthFlow: "ADMIN_USER_PASSWORD_AUTH", AuthParameters }));
      setTokens(res.AuthenticationResult);
      setChallenge(res.ChallengeName ?? "");
    });
  };

  return (
    <FormModal visible={!!client} size="large" header={`Test sign-in with ${client?.ClientName ?? "app client"}`} submitLabel="Sign in" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={signIn}>
      <FormField label="User name" description="The user name, or the email address in a user pool that signs in by email.">
        <Input value={username} placeholder="jane" onChange={(e) => setUsername(e.detail.value)} />
      </FormField>
      <FormField label="Password">
        <Input type="password" value={password} placeholder="Enter the password" onChange={(e) => setPassword(e.detail.value)} />
      </FormField>
      {challenge && (
        <Alert type="info" header={`Cognito asks for one more step: ${challenge}`}>
          {CHALLENGE[challenge] ?? "This dialog can't answer this challenge."}
        </Alert>
      )}
      {tokens && (
        <SpaceBetween size="m">
          <Alert type="success">
            The user is signed in. The tokens expire in {tokens.ExpiresIn} seconds.
          </Alert>
          <ExpandableSection headerText="ID token claims" defaultExpanded>
            <JsonBlock value={decodeJwt(tokens.IdToken)} />
          </ExpandableSection>
          <ExpandableSection headerText="Access token claims">
            <JsonBlock value={decodeJwt(tokens.AccessToken)} />
          </ExpandableSection>
          <Pair label="ID token">
            <Copy text={tokens.IdToken} />
          </Pair>
          <Pair label="Access token">
            <Copy text={tokens.AccessToken} />
          </Pair>
          <Pair label="Refresh token">
            <Copy text={tokens.RefreshToken} />
          </Pair>
        </SpaceBetween>
      )}
    </FormModal>
  );
}
