import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Home from "./pages/Home";

// Each service loads its own code only when it is first opened. The AWS SDK clients are large.
const LambdaDashboard = lazy(() => import("./pages/lambda/Dashboard"));
const Layers = lazy(() => import("./pages/lambda/Layers"));
const EventSourceMappings = lazy(() => import("./pages/lambda/EventSourceMappings"));
const CloudWatchOverview = lazy(() => import("./pages/cloudwatch/Overview"));
const Ec2Dashboard = lazy(() => import("./pages/ec2/Dashboard"));
const Volumes = lazy(() => import("./pages/ec2/Volumes"));
const Snapshots = lazy(() => import("./pages/ec2/Snapshots"));
const ElasticIps = lazy(() => import("./pages/ec2/ElasticIps"));
const Secrets = lazy(() => import("./pages/secretsmanager/Secrets"));
const CreateSecret = lazy(() => import("./pages/secretsmanager/CreateSecret"));
const SecretDetail = lazy(() => import("./pages/secretsmanager/SecretDetail"));
const Databases = lazy(() => import("./pages/rds/Databases"));
const CreateDatabase = lazy(() => import("./pages/rds/CreateDatabase"));
const DatabaseDetail = lazy(() => import("./pages/rds/DatabaseDetail"));
const DbSnapshots = lazy(() => import("./pages/rds/Snapshots"));
const SubnetGroups = lazy(() => import("./pages/rds/SubnetGroups"));
const Distributions = lazy(() => import("./pages/cloudfront/Distributions"));
const CreateDistribution = lazy(() => import("./pages/cloudfront/CreateDistribution"));
const DistributionDetail = lazy(() => import("./pages/cloudfront/DistributionDetail"));
const Apis = lazy(() => import("./pages/apigateway/Apis"));
const RestApiDetail = lazy(() => import("./pages/apigateway/RestApiDetail"));
const HttpApiDetail = lazy(() => import("./pages/apigateway/HttpApiDetail"));
const Queues = lazy(() => import("./pages/sqs/Queues"));
const QueueDetail = lazy(() => import("./pages/sqs/QueueDetail"));
const Topics = lazy(() => import("./pages/sns/Topics"));
const TopicDetail = lazy(() => import("./pages/sns/TopicDetail"));
const Subscriptions = lazy(() => import("./pages/sns/Subscriptions"));
const Parameters = lazy(() => import("./pages/ssm/Parameters"));
const ParameterDetail = lazy(() => import("./pages/ssm/ParameterDetail"));
const Keys = lazy(() => import("./pages/kms/Keys"));
const KeyDetail = lazy(() => import("./pages/kms/KeyDetail"));
const IamUsers = lazy(() => import("./pages/iam/Users"));
const IamUserDetail = lazy(() => import("./pages/iam/UserDetail"));
const IamGroups = lazy(() => import("./pages/iam/Groups"));
const IamRoles = lazy(() => import("./pages/iam/Roles"));
const IamRoleDetail = lazy(() => import("./pages/iam/RoleDetail"));
const IamPolicies = lazy(() => import("./pages/iam/Policies"));
const IamPolicyDetail = lazy(() => import("./pages/iam/PolicyDetail"));
const SesIdentities = lazy(() => import("./pages/ses/Identities"));
const SesMailbox = lazy(() => import("./pages/ses/Mailbox"));
const Caches = lazy(() => import("./pages/elasticache/Caches"));
const CacheDetail = lazy(() => import("./pages/elasticache/CacheDetail"));
const ReplicationGroups = lazy(() => import("./pages/elasticache/ReplicationGroups"));
const LoadBalancers = lazy(() => import("./pages/elb/LoadBalancers"));
const LoadBalancerDetail = lazy(() => import("./pages/elb/LoadBalancerDetail"));
const TargetGroups = lazy(() => import("./pages/elb/TargetGroups"));
const TargetGroupDetail = lazy(() => import("./pages/elb/TargetGroupDetail"));
const Functions = lazy(() => import("./pages/lambda/Functions"));
const CreateFunction = lazy(() => import("./pages/lambda/CreateFunction"));
const FunctionDetail = lazy(() => import("./pages/lambda/FunctionDetail"));
const Buckets = lazy(() => import("./pages/s3/Buckets"));
const BucketObjects = lazy(() => import("./pages/s3/BucketObjects"));
const ObjectDetail = lazy(() => import("./pages/s3/ObjectDetail"));
const LogGroups = lazy(() => import("./pages/cloudwatch/LogGroups"));
const LogGroupDetail = lazy(() => import("./pages/cloudwatch/LogGroupDetail"));
const Alarms = lazy(() => import("./pages/cloudwatch/Alarms"));
const Metrics = lazy(() => import("./pages/cloudwatch/Metrics"));
const Instances = lazy(() => import("./pages/ec2/Instances"));
const LaunchInstance = lazy(() => import("./pages/ec2/LaunchInstance"));
const InstanceDetail = lazy(() => import("./pages/ec2/InstanceDetail"));
const SecurityGroups = lazy(() => import("./pages/ec2/SecurityGroups"));
const SecurityGroupDetail = lazy(() => import("./pages/ec2/SecurityGroupDetail"));
const KeyPairs = lazy(() => import("./pages/ec2/KeyPairs"));
const Images = lazy(() => import("./pages/ec2/Images"));
const DdbTables = lazy(() => import("./pages/dynamodb/Tables"));
const DdbCreateTable = lazy(() => import("./pages/dynamodb/CreateTable"));
const DdbTableDetail = lazy(() => import("./pages/dynamodb/TableDetail"));
const DdbExploreItems = lazy(() => import("./pages/dynamodb/ExploreItems"));
const UserPools = lazy(() => import("./pages/cognito/UserPools"));
const UserPoolDetail = lazy(() => import("./pages/cognito/UserPoolDetail"));
const CognitoUserDetail = lazy(() => import("./pages/cognito/UserDetail"));
const IdentityPools = lazy(() => import("./pages/cognito/IdentityPools"));
const HostedZones = lazy(() => import("./pages/route53/HostedZones"));
const HostedZoneDetail = lazy(() => import("./pages/route53/HostedZoneDetail"));
const HealthChecks = lazy(() => import("./pages/route53/HealthChecks"));
const Certificates = lazy(() => import("./pages/acm/Certificates"));
const CertificateDetail = lazy(() => import("./pages/acm/CertificateDetail"));
const EcsClusters = lazy(() => import("./pages/ecs/Clusters"));
const EcsClusterDetail = lazy(() => import("./pages/ecs/ClusterDetail"));
const EcsTaskDetail = lazy(() => import("./pages/ecs/TaskDetail"));
const EcsTaskDefinitions = lazy(() => import("./pages/ecs/TaskDefinitions"));
const EcsTaskDefinitionDetail = lazy(() => import("./pages/ecs/TaskDefinitionDetail"));
const Repositories = lazy(() => import("./pages/ecr/Repositories"));
const RepositoryDetail = lazy(() => import("./pages/ecr/RepositoryDetail"));
const EventBuses = lazy(() => import("./pages/events/Buses"));
const EventRules = lazy(() => import("./pages/events/Rules"));
const EventRuleDetail = lazy(() => import("./pages/events/RuleDetail"));
const Schedules = lazy(() => import("./pages/events/Schedules"));
const StateMachines = lazy(() => import("./pages/states/StateMachines"));
const StateMachineDetail = lazy(() => import("./pages/states/StateMachineDetail"));
const ExecutionDetail = lazy(() => import("./pages/states/ExecutionDetail"));
const Vpcs = lazy(() => import("./pages/vpc/Vpcs"));
const VpcDetail = lazy(() => import("./pages/vpc/VpcDetail"));
const Subnets = lazy(() => import("./pages/vpc/Subnets"));
const RouteTables = lazy(() => import("./pages/vpc/RouteTables"));
const InternetGateways = lazy(() => import("./pages/vpc/InternetGateways"));
const NatGateways = lazy(() => import("./pages/vpc/NatGateways"));
const Stacks = lazy(() => import("./pages/cloudformation/Stacks"));
const CreateStack = lazy(() => import("./pages/cloudformation/CreateStack"));
const StackDetail = lazy(() => import("./pages/cloudformation/StackDetail"));
const KinesisStreams = lazy(() => import("./pages/kinesis/Streams"));
const KinesisStreamDetail = lazy(() => import("./pages/kinesis/StreamDetail"));
const OsDomains = lazy(() => import("./pages/opensearch/Domains"));
const OsDomainDetail = lazy(() => import("./pages/opensearch/DomainDetail"));
const AppSyncApis = lazy(() => import("./pages/appsync/Apis"));
const AppSyncApiDetail = lazy(() => import("./pages/appsync/ApiDetail"));

const loading = (
  <Box textAlign="center" padding="xxxl">
    <Spinner size="large" />
  </Box>
);

export default function App() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Suspense fallback={loading}>
      <Routes>
        <Route path="/" element={<Home />} />

        <Route path="/lambda" element={<Navigate to="/lambda/home" replace />} />
        <Route path="/lambda/home" element={<LambdaDashboard />} />
        <Route path="/lambda/layers" element={<Layers />} />
        <Route path="/lambda/event-source-mappings" element={<EventSourceMappings />} />
        <Route path="/lambda/functions" element={<Functions />} />
        <Route path="/lambda/functions/create" element={<CreateFunction />} />
        <Route path="/lambda/functions/:name" element={<FunctionDetail />} />

        <Route path="/apigateway" element={<Navigate to="/apigateway/apis" replace />} />
        <Route path="/apigateway/apis" element={<Apis />} />
        <Route path="/apigateway/rest/:id" element={<RestApiDetail />} />
        <Route path="/apigateway/http/:id" element={<HttpApiDetail />} />

        <Route path="/sqs" element={<Navigate to="/sqs/queues" replace />} />
        <Route path="/sqs/queues" element={<Queues />} />
        <Route path="/sqs/queue" element={<QueueDetail />} />

        <Route path="/sns" element={<Navigate to="/sns/topics" replace />} />
        <Route path="/sns/topics" element={<Topics />} />
        <Route path="/sns/topic" element={<TopicDetail />} />
        <Route path="/sns/subscriptions" element={<Subscriptions />} />

        <Route path="/ssm" element={<Navigate to="/ssm/parameters" replace />} />
        <Route path="/ssm/parameters" element={<Parameters />} />
        <Route path="/ssm/parameter" element={<ParameterDetail />} />

        <Route path="/kms" element={<Navigate to="/kms/keys" replace />} />
        <Route path="/kms/keys" element={<Keys manager="CUSTOMER" />} />
        <Route path="/kms/aws-keys" element={<Keys manager="AWS" />} />
        <Route path="/kms/keys/:id" element={<KeyDetail />} />

        <Route path="/iam" element={<Navigate to="/iam/roles" replace />} />
        <Route path="/iam/users" element={<IamUsers />} />
        <Route path="/iam/users/:name" element={<IamUserDetail />} />
        <Route path="/iam/groups" element={<IamGroups />} />
        <Route path="/iam/roles" element={<IamRoles />} />
        <Route path="/iam/roles/:name" element={<IamRoleDetail />} />
        <Route path="/iam/policies" element={<IamPolicies />} />
        <Route path="/iam/policy" element={<IamPolicyDetail />} />

        <Route path="/ses" element={<Navigate to="/ses/identities" replace />} />
        <Route path="/ses/identities" element={<SesIdentities />} />
        <Route path="/ses/mailbox" element={<SesMailbox />} />

        <Route path="/elasticache" element={<Navigate to="/elasticache/caches" replace />} />
        <Route path="/elasticache/caches" element={<Caches />} />
        <Route path="/elasticache/caches/:id" element={<CacheDetail />} />
        <Route path="/elasticache/replication-groups" element={<ReplicationGroups />} />

        <Route path="/ec2/load-balancers" element={<LoadBalancers />} />
        <Route path="/ec2/load-balancer" element={<LoadBalancerDetail />} />
        <Route path="/ec2/target-groups" element={<TargetGroups />} />
        <Route path="/ec2/target-group" element={<TargetGroupDetail />} />

        <Route path="/s3" element={<Navigate to="/s3/buckets" replace />} />
        <Route path="/s3/buckets" element={<Buckets />} />
        <Route path="/s3/bucket" element={<BucketObjects />} />
        <Route path="/s3/object" element={<ObjectDetail />} />

        <Route path="/cloudwatch" element={<Navigate to="/cloudwatch/home" replace />} />
        <Route path="/cloudwatch/home" element={<CloudWatchOverview />} />
        <Route path="/cloudwatch/log-groups" element={<LogGroups />} />
        <Route path="/cloudwatch/log-group" element={<LogGroupDetail />} />
        <Route path="/cloudwatch/alarms" element={<Alarms />} />
        <Route path="/cloudwatch/metrics" element={<Metrics />} />

        <Route path="/ec2" element={<Navigate to="/ec2/home" replace />} />
        <Route path="/ec2/home" element={<Ec2Dashboard />} />
        <Route path="/ec2/volumes" element={<Volumes />} />
        <Route path="/ec2/snapshots" element={<Snapshots />} />
        <Route path="/ec2/elastic-ips" element={<ElasticIps />} />
        <Route path="/ec2/instances" element={<Instances />} />
        <Route path="/ec2/instances/launch" element={<LaunchInstance />} />
        <Route path="/ec2/instances/:id" element={<InstanceDetail />} />
        <Route path="/ec2/security-groups" element={<SecurityGroups />} />
        <Route path="/ec2/security-groups/:id" element={<SecurityGroupDetail />} />
        <Route path="/ec2/key-pairs" element={<KeyPairs />} />
        <Route path="/ec2/images" element={<Images />} />

        <Route path="/secretsmanager" element={<Navigate to="/secretsmanager/secrets" replace />} />
        <Route path="/secretsmanager/secrets" element={<Secrets />} />
        <Route path="/secretsmanager/secrets/create" element={<CreateSecret />} />
        <Route path="/secretsmanager/secret" element={<SecretDetail />} />

        <Route path="/rds" element={<Navigate to="/rds/databases" replace />} />
        <Route path="/rds/databases" element={<Databases />} />
        <Route path="/rds/databases/create" element={<CreateDatabase />} />
        <Route path="/rds/databases/:id" element={<DatabaseDetail />} />
        <Route path="/rds/snapshots" element={<DbSnapshots />} />
        <Route path="/rds/subnet-groups" element={<SubnetGroups />} />

        <Route path="/cloudfront" element={<Navigate to="/cloudfront/distributions" replace />} />
        <Route path="/cloudfront/distributions" element={<Distributions />} />
        <Route path="/cloudfront/distributions/create" element={<CreateDistribution />} />
        <Route path="/cloudfront/distributions/:id" element={<DistributionDetail />} />

        <Route path="/dynamodb" element={<Navigate to="/dynamodb/tables" replace />} />
        <Route path="/dynamodb/tables" element={<DdbTables />} />
        <Route path="/dynamodb/tables/create" element={<DdbCreateTable />} />
        <Route path="/dynamodb/table" element={<DdbTableDetail />} />
        <Route path="/dynamodb/items" element={<DdbExploreItems />} />

        <Route path="/cognito" element={<Navigate to="/cognito/user-pools" replace />} />
        <Route path="/cognito/user-pools" element={<UserPools />} />
        <Route path="/cognito/user-pools/:id" element={<UserPoolDetail />} />
        <Route path="/cognito/user-pools/:id/user" element={<CognitoUserDetail />} />
        <Route path="/cognito/identity-pools" element={<IdentityPools />} />

        <Route path="/route53" element={<Navigate to="/route53/hosted-zones" replace />} />
        <Route path="/route53/hosted-zones" element={<HostedZones />} />
        <Route path="/route53/hosted-zones/:id" element={<HostedZoneDetail />} />
        <Route path="/route53/health-checks" element={<HealthChecks />} />

        <Route path="/acm" element={<Navigate to="/acm/certificates" replace />} />
        <Route path="/acm/certificates" element={<Certificates />} />
        <Route path="/acm/certificate" element={<CertificateDetail />} />

        <Route path="/ecs" element={<Navigate to="/ecs/clusters" replace />} />
        <Route path="/ecs/clusters" element={<EcsClusters />} />
        <Route path="/ecs/clusters/:name" element={<EcsClusterDetail />} />
        <Route path="/ecs/task" element={<EcsTaskDetail />} />
        <Route path="/ecs/task-definitions" element={<EcsTaskDefinitions />} />
        <Route path="/ecs/task-definition" element={<EcsTaskDefinitionDetail />} />

        <Route path="/ecr" element={<Navigate to="/ecr/repositories" replace />} />
        <Route path="/ecr/repositories" element={<Repositories />} />
        <Route path="/ecr/repository" element={<RepositoryDetail />} />

        <Route path="/events" element={<Navigate to="/events/buses" replace />} />
        <Route path="/events/buses" element={<EventBuses />} />
        <Route path="/events/rules" element={<EventRules />} />
        <Route path="/events/rule" element={<EventRuleDetail />} />
        <Route path="/events/schedules" element={<Schedules />} />

        <Route path="/states" element={<Navigate to="/states/state-machines" replace />} />
        <Route path="/states/state-machines" element={<StateMachines />} />
        <Route path="/states/state-machine" element={<StateMachineDetail />} />
        <Route path="/states/execution" element={<ExecutionDetail />} />

        <Route path="/vpc" element={<Navigate to="/vpc/vpcs" replace />} />
        <Route path="/vpc/vpcs" element={<Vpcs />} />
        <Route path="/vpc/vpcs/:id" element={<VpcDetail />} />
        <Route path="/vpc/subnets" element={<Subnets />} />
        <Route path="/vpc/route-tables" element={<RouteTables />} />
        <Route path="/vpc/internet-gateways" element={<InternetGateways />} />
        <Route path="/vpc/nat-gateways" element={<NatGateways />} />

        <Route path="/cloudformation" element={<Navigate to="/cloudformation/stacks" replace />} />
        <Route path="/cloudformation/stacks" element={<Stacks />} />
        <Route path="/cloudformation/stacks/create" element={<CreateStack />} />
        <Route path="/cloudformation/stack" element={<StackDetail />} />

        <Route path="/kinesis" element={<Navigate to="/kinesis/streams" replace />} />
        <Route path="/kinesis/streams" element={<KinesisStreams />} />
        <Route path="/kinesis/streams/:name" element={<KinesisStreamDetail />} />

        <Route path="/opensearch" element={<Navigate to="/opensearch/domains" replace />} />
        <Route path="/opensearch/domains" element={<OsDomains />} />
        <Route path="/opensearch/domains/:name" element={<OsDomainDetail />} />

        <Route path="/appsync" element={<Navigate to="/appsync/apis" replace />} />
        <Route path="/appsync/apis" element={<AppSyncApis />} />
        <Route path="/appsync/apis/:id" element={<AppSyncApiDetail />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
