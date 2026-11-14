import { ECSClient } from "@aws-sdk/client-ecs";
import { clientBase } from "../config";

export const ecs = new ECSClient(clientBase);
