import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { clientBase } from "../config";

export const secrets = new SecretsManagerClient(clientBase);
