import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateDBInstanceCommand, DescribeDBEngineVersionsCommand, DescribeOrderableDBInstanceOptionsCommand } from "@aws-sdk/client-rds";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { rds } from "../../clients/rds";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { ENGINE_LABEL } from "./rdsutil";

// Aurora needs a cluster as well as an instance. This form creates single instances only.
const ENGINES = ["postgres", "mysql", "mariadb"];
const DEFAULT_USER: Record<string, string> = { postgres: "postgres", mysql: "admin", mariadb: "admin" };

export default function CreateDatabase() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [engine, setEngine] = useState("postgres");
  const [version, setVersion] = useState<SelectProps.Option | null>(null);
  const [dbClass, setDbClass] = useState<SelectProps.Option | null>(null);
  const [id, setId] = useState("database-1");
  const [username, setUsername] = useState(DEFAULT_USER.postgres);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [storage, setStorage] = useState("20");
  const [dbName, setDbName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const engines = useLoad(async () => {
    const res = await rds.send(new DescribeDBEngineVersionsCommand({}));
    const byEngine: Record<string, string[]> = {};
    for (const v of res.DBEngineVersions ?? []) {
      if (v.Engine && v.EngineVersion) (byEngine[v.Engine] ??= []).push(v.EngineVersion);
    }
    for (const list of Object.values(byEngine)) list.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return byEngine;
  }, []);

  const classes = useLoad(async () => {
    const res = await rds.send(new DescribeOrderableDBInstanceOptionsCommand({ Engine: engine }));
    const names = [...new Set((res.OrderableDBInstanceOptions ?? []).map((o) => o.DBInstanceClass).filter(Boolean))] as string[];
    const opts = names.map((n) => ({ value: n, label: n }));
    setDbClass(opts.find((o) => o.value === "db.t3.micro") ?? opts[0] ?? null);
    return opts;
  }, [engine]);

  const available = ENGINES.filter((e) => !engines.data || engines.data[e]);
  const versions = (engines.data?.[engine] ?? []).map((v) => ({ value: v, label: `${ENGINE_LABEL[engine]} ${v}` }));
  const chosenVersion = version && versions.some((v) => v.value === version.value) ? version : (versions[0] ?? null);

  const idError = !/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(id) ? "Must start with a letter and contain only letters, numbers and hyphens." : "";
  const userError = !/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/.test(username) ? "1 to 16 alphanumeric characters. The first character must be a letter." : "";
  const passError = password.length < 8 ? "The password must be at least 8 characters." : "";
  const confirmError = confirm !== password ? "The passwords do not match." : "";
  const storageError = !Number.isInteger(Number(storage)) || Number(storage) < 5 ? "Enter a whole number of GiB, 5 or more." : "";

  const create = async () => {
    setTouched(true);
    if (idError || userError || passError || confirmError || storageError) return;
    setBusy(true);
    setError("");
    try {
      await rds.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: id,
          Engine: engine,
          EngineVersion: chosenVersion?.value,
          DBInstanceClass: dbClass?.value ?? "db.t3.micro",
          AllocatedStorage: Number(storage),
          MasterUsername: username,
          MasterUserPassword: password,
          DBName: dbName || undefined,
        }),
      );
      notify.success(`Creating database ${id}. This can take a minute the first time, while the engine image downloads.`);
      navigate("/rds/databases");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Shell
      service="rds"
      contentType="form"
      breadcrumbs={[
        { text: "RDS", href: "/rds/databases" },
        { text: "Databases", href: "/rds/databases" },
        { text: "Create database", href: "/rds/databases/create" },
      ]}
    >
      <ContentLayout header={<Header variant="h1">Create database</Header>}>
        <Form
          errorText={error || engines.error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/rds/databases")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create database
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Engine options</Header>}>
              <SpaceBetween size="l">
                <FormField label="Engine type">
                  <Tiles
                    value={engine}
                    columns={3}
                    onChange={(e) => {
                      setEngine(e.detail.value);
                      setVersion(null);
                      setUsername(DEFAULT_USER[e.detail.value] ?? "admin");
                    }}
                    items={available.map((e) => ({ value: e, label: ENGINE_LABEL[e] }))}
                  />
                </FormField>
                <FormField label="Engine version">
                  <Select
                    selectedOption={chosenVersion}
                    options={versions}
                    onChange={(e) => setVersion(e.detail.selectedOption)}
                    statusType={engines.loading ? "loading" : "finished"}
                    placeholder="Choose a version"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Settings</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="DB instance identifier"
                  description="Type a name for your DB instance. The name must be unique in this Region."
                  errorText={touched ? idError : ""}
                >
                  <Input value={id} onChange={(e) => setId(e.detail.value)} />
                </FormField>
                <FormField label="Master username" errorText={touched ? userError : ""}>
                  <Input value={username} onChange={(e) => setUsername(e.detail.value)} />
                </FormField>
                <FormField label="Master password" constraintText="Minimum 8 characters." errorText={touched ? passError : ""}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.detail.value)} />
                </FormField>
                <FormField label="Confirm master password" errorText={touched ? confirmError : ""}>
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Instance configuration</Header>}>
              <SpaceBetween size="l">
                <FormField label="DB instance class">
                  <Select
                    selectedOption={dbClass}
                    options={classes.data ?? []}
                    onChange={(e) => setDbClass(e.detail.selectedOption)}
                    statusType={classes.loading ? "loading" : "finished"}
                    placeholder="Choose a class"
                  />
                </FormField>
                <FormField label="Allocated storage" constraintText="In GiB." errorText={touched ? storageError : ""}>
                  <Input type="number" value={storage} onChange={(e) => setStorage(e.detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Additional configuration</Header>}>
              <FormField label="Initial database name - optional" description="If you do not specify a database name, the engine default is used.">
                <Input value={dbName} onChange={(e) => setDbName(e.detail.value)} />
              </FormField>
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
