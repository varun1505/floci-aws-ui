import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { clientBase } from "../config";

export const apigw = new APIGatewayClient(clientBase);
