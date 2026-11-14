import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { clientBase } from "../config";

export const eventbridge = new EventBridgeClient(clientBase);
