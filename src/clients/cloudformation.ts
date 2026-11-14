import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { clientBase } from "../config";

export const cloudformation = new CloudFormationClient(clientBase);
