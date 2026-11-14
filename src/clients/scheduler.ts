import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { clientBase } from "../config";

export const scheduler = new SchedulerClient(clientBase);
