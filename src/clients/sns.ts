import { SNSClient } from "@aws-sdk/client-sns";
import { clientBase } from "../config";

export const sns = new SNSClient(clientBase);
