import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { clientBase } from "../config";

export const apigwv2 = new ApiGatewayV2Client(clientBase);
