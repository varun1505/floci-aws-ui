import { SQSClient } from "@aws-sdk/client-sqs";
import { clientBase } from "../config";

// floci puts its own address in queue URLs. Keep every call on the proxy instead of following that URL.
export const sqs = new SQSClient({ ...clientBase, useQueueUrlAsEndpoint: false });
