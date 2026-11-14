/** Sample templates for the create stack page. Each one works on floci, in YAML and in JSON. */
export type Sample = { id: string; label: string; description: string; yaml: string; json: string };

const json = (value: unknown) => JSON.stringify(value, null, 2);

const BUCKET_YAML = `AWSTemplateFormatVersion: "2010-09-09"
Description: An S3 bucket with versioning turned on
Resources:
  Bucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
Outputs:
  BucketName:
    Description: The name of the bucket
    Value: !Ref Bucket
`;

const BUCKET_JSON = json({
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "An S3 bucket with versioning turned on",
  Resources: {
    Bucket: { Type: "AWS::S3::Bucket", Properties: { VersioningConfiguration: { Status: "Enabled" } } },
  },
  Outputs: {
    BucketName: { Description: "The name of the bucket", Value: { Ref: "Bucket" } },
  },
});

const MESSAGING_YAML = `AWSTemplateFormatVersion: "2010-09-09"
Description: An SNS topic that delivers to an SQS queue
Resources:
  Queue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 60
  Topic:
    Type: AWS::SNS::Topic
  Subscription:
    Type: AWS::SNS::Subscription
    Properties:
      TopicArn: !Ref Topic
      Protocol: sqs
      Endpoint: !GetAtt Queue.Arn
Outputs:
  QueueUrl:
    Description: The URL of the queue
    Value: !Ref Queue
  TopicArn:
    Description: The ARN of the topic
    Value: !Ref Topic
`;

const MESSAGING_JSON = json({
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "An SNS topic that delivers to an SQS queue",
  Resources: {
    Queue: { Type: "AWS::SQS::Queue", Properties: { VisibilityTimeout: 60 } },
    Topic: { Type: "AWS::SNS::Topic" },
    Subscription: {
      Type: "AWS::SNS::Subscription",
      Properties: { TopicArn: { Ref: "Topic" }, Protocol: "sqs", Endpoint: { "Fn::GetAtt": ["Queue", "Arn"] } },
    },
  },
  Outputs: {
    QueueUrl: { Description: "The URL of the queue", Value: { Ref: "Queue" } },
    TopicArn: { Description: "The ARN of the topic", Value: { Ref: "Topic" } },
  },
});

const TABLE_YAML = `AWSTemplateFormatVersion: "2010-09-09"
Description: A DynamoDB table with a parameter and an output
Parameters:
  TableName:
    Type: String
    Default: orders
    Description: The name of the table
  KeyName:
    Type: String
    Default: id
    Description: The name of the partition key
Resources:
  Table:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Ref TableName
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: !Ref KeyName
          AttributeType: S
      KeySchema:
        - AttributeName: !Ref KeyName
          KeyType: HASH
Outputs:
  TableArn:
    Description: The ARN of the table
    Value: !GetAtt Table.Arn
`;

const TABLE_JSON = json({
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "A DynamoDB table with a parameter and an output",
  Parameters: {
    TableName: { Type: "String", Default: "orders", Description: "The name of the table" },
    KeyName: { Type: "String", Default: "id", Description: "The name of the partition key" },
  },
  Resources: {
    Table: {
      Type: "AWS::DynamoDB::Table",
      Properties: {
        TableName: { Ref: "TableName" },
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: { Ref: "KeyName" }, AttributeType: "S" }],
        KeySchema: [{ AttributeName: { Ref: "KeyName" }, KeyType: "HASH" }],
      },
    },
  },
  Outputs: {
    TableArn: { Description: "The ARN of the table", Value: { "Fn::GetAtt": ["Table", "Arn"] } },
  },
});

export const SAMPLES: Sample[] = [
  { id: "bucket", label: "S3 bucket", description: "One bucket with versioning", yaml: BUCKET_YAML, json: BUCKET_JSON },
  { id: "messaging", label: "SQS queue and SNS topic", description: "A topic that delivers to a queue", yaml: MESSAGING_YAML, json: MESSAGING_JSON },
  { id: "table", label: "DynamoDB table", description: "A table with two parameters and an output", yaml: TABLE_YAML, json: TABLE_JSON },
];
