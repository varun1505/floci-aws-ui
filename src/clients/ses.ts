import { SESClient } from "@aws-sdk/client-ses";
import { clientBase } from "../config";

export const ses = new SESClient(clientBase);
