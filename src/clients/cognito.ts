import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { clientBase } from "../config";

export const cognito = new CognitoIdentityProviderClient(clientBase);
