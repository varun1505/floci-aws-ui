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

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
