import { SSMClient } from "@aws-sdk/client-ssm";
import { clientBase } from "../config";

export const ssm = new SSMClient(clientBase);
