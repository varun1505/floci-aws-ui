import { KMSClient } from "@aws-sdk/client-kms";
import { clientBase } from "../config";

export const kms = new KMSClient(clientBase);
