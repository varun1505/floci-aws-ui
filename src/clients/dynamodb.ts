import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { clientBase } from "../config";

export const dynamodb = new DynamoDBClient(clientBase);
