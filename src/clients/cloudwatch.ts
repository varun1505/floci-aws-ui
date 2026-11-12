import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { clientBase } from "../config";

export const cloudwatch = new CloudWatchClient(clientBase);
