import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { clientBase } from "../config";

export const cognitoIdentity = new CognitoIdentityClient(clientBase);
