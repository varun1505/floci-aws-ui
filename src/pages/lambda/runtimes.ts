export type RuntimeInfo = {
  value: string;
  label: string;
  /** File and handler the console creates for "Author from scratch". Missing means upload only. */
  starter?: { file: string; handler: string; code: string };
};

const PYTHON = `import json

def lambda_handler(event, context):
    # TODO implement
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda!')
    }
`;

const NODE = `export const handler = async (event) => {
  // TODO implement
  const response = {
    statusCode: 200,
    body: JSON.stringify('Hello from Lambda!'),
  };
  return response;
};
`;

const RUBY = `require 'json'

def lambda_handler(event:, context:)
    # TODO implement
    { statusCode: 200, body: JSON.generate('Hello from Lambda!') }
end
`;

const py = { file: "lambda_function.py", handler: "lambda_function.lambda_handler", code: PYTHON };
const node = { file: "index.mjs", handler: "index.handler", code: NODE };
const ruby = { file: "lambda_function.rb", handler: "lambda_function.lambda_handler", code: RUBY };

export const RUNTIMES: RuntimeInfo[] = [
  { value: "python3.13", label: "Python 3.13", starter: py },
  { value: "python3.12", label: "Python 3.12", starter: py },
  { value: "python3.11", label: "Python 3.11", starter: py },
  { value: "python3.10", label: "Python 3.10", starter: py },
  { value: "nodejs22.x", label: "Node.js 22.x", starter: node },
  { value: "nodejs20.x", label: "Node.js 20.x", starter: node },
  { value: "ruby3.4", label: "Ruby 3.4", starter: ruby },
  { value: "ruby3.3", label: "Ruby 3.3", starter: ruby },
  { value: "java21", label: "Java 21" },
  { value: "java17", label: "Java 17" },
  { value: "dotnet8", label: ".NET 8 (C#/F#/PowerShell)" },
  { value: "provided.al2023", label: "Amazon Linux 2023" },
  { value: "provided.al2", label: "Amazon Linux 2" },
];

export const DEFAULT_ROLE = "arn:aws:iam::000000000000:role/lambda-role";
