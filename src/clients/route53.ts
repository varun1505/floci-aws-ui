import { Route53Client } from "@aws-sdk/client-route-53";
import { clientBase } from "../config";

export const route53 = new Route53Client(clientBase);
