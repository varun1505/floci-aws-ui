import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { clientBase } from "../config";

export const logs = new CloudWatchLogsClient(clientBase);
