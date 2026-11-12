import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  RunInstancesCommand,
  type _InstanceType,
} from "@aws-sdk/client-ec2";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Multiselect from "@cloudscape-design/components/multiselect";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { ec2 } from "../../clients/ec2";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

type Option = SelectProps.Option;
const NO_KEY: Option = { value: "", label: "Proceed without a key pair (Not recommended)" };

export default function LaunchInstance() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [name, setName] = useState("");
  const [image, setImage] = useState<Option | null>(null);
  const [type, setType] = useState<Option>({ value: "t2.micro", label: "t2.micro" });
  const [key, setKey] = useState<Option>(NO_KEY);
  const [subnet, setSubnet] = useState<Option | null>(null);
  const [groups, setGroups] = useState<Option[]>([]);
  const [count, setCount] = useState("1");
  const [userData, setUserData] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const options = useLoad(async () => {
    const [images, keys, subnets, sgs] = await Promise.all([
      ec2.send(new DescribeImagesCommand({})),
      ec2.send(new DescribeKeyPairsCommand({})),
      ec2.send(new DescribeSubnetsCommand({})),
      ec2.send(new DescribeSecurityGroupsCommand({})),
    ]);
    const types: string[] = [];
    let NextToken: string | undefined;
    do {
      const res = await ec2.send(new DescribeInstanceTypesCommand({ NextToken }));
      types.push(...(res.InstanceTypes ?? []).map((t) => t.InstanceType as string));
      NextToken = res.NextToken;
    } while (NextToken);

    const imageOptions: Option[] = (images.Images ?? []).map((i) => ({
      value: i.ImageId,
      label: i.Name ?? i.ImageId,
      description: i.Description,
      tags: [i.ImageId ?? "", i.Architecture ?? ""].filter(Boolean),
    }));
    const groupOptions: Option[] = (sgs.SecurityGroups ?? []).map((g) => ({ value: g.GroupId, label: g.GroupName, description: g.GroupId, tags: [g.VpcId ?? ""] }));
    setImage((cur) => cur ?? imageOptions[0] ?? null);
    setGroups((cur) => (cur.length ? cur : groupOptions.filter((g) => g.label === "default")));
    return {
      images: imageOptions,
      types: types.sort().map((t) => ({ value: t, label: t })),
      keys: [NO_KEY, ...(keys.KeyPairs ?? []).map((k) => ({ value: k.KeyName, label: k.KeyName, description: k.KeyType }))],
      subnets: (subnets.Subnets ?? []).map((s) => ({ value: s.SubnetId, label: s.SubnetId, description: `${s.AvailabilityZone} • ${s.CidrBlock}`, tags: [s.VpcId ?? ""] })),
      groups: groupOptions,
    };
  }, []);

  const countNumber = Number(count);
  const countError = !Number.isInteger(countNumber) || countNumber < 1 || countNumber > 20 ? "Enter a whole number from 1 to 20." : "";
  const imageError = !image ? "Choose an Amazon Machine Image." : "";

  const launch = async () => {
    setTouched(true);
    if (countError || imageError) return;
    setBusy(true);
    setError("");
    try {
      const res = await ec2.send(
        new RunInstancesCommand({
          ImageId: image!.value,
          InstanceType: type.value as _InstanceType,
          MinCount: countNumber,
          MaxCount: countNumber,
          KeyName: key.value || undefined,
          SubnetId: subnet?.value || undefined,
          SecurityGroupIds: groups.length ? groups.map((g) => g.value!) : undefined,
          UserData: userData ? btoa(unescape(encodeURIComponent(userData))) : undefined,
          TagSpecifications: name ? [{ ResourceType: "instance", Tags: [{ Key: "Name", Value: name }] }] : undefined,
        }),
      );
      const ids = (res.Instances ?? []).map((i) => i.InstanceId).join(", ");
      notify.success(`Successfully initiated launch of instance (${ids}).`);
      navigate("/ec2/instances");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const loading = options.loading ? "loading" : options.error ? "error" : "finished";

  return (
    <Shell
      service="ec2"
      contentType="form"
      breadcrumbs={[
        { text: "EC2", href: "/ec2/home" },
        { text: "Instances", href: "/ec2/instances" },
        { text: "Launch an instance", href: "/ec2/instances/launch" },
      ]}
    >
      <ContentLayout
        header={
          <Header variant="h1" description="Create virtual machines, or instances, by following the simple steps below.">
            Launch an instance
          </Header>
        }
      >
        <Form
          errorText={error || options.error}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => navigate("/ec2/instances")}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={launch}>
                Launch instance
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Name and tags</Header>}>
              <FormField label="Name">
                <Input value={name} placeholder="e.g. My Web Server" onChange={(e) => setName(e.detail.value)} />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Application and OS Images (Amazon Machine Image)</Header>}>
              <FormField label="Amazon Machine Image (AMI)" errorText={touched ? imageError : ""}>
                <Select
                  selectedOption={image}
                  options={options.data?.images ?? []}
                  onChange={(e) => setImage(e.detail.selectedOption)}
                  statusType={loading}
                  loadingText="Loading images"
                  filteringType="auto"
                  placeholder="Choose an AMI"
                  triggerVariant="option"
                />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Instance type</Header>}>
              <FormField label="Instance type">
                <Select
                  selectedOption={type}
                  options={options.data?.types ?? []}
                  onChange={(e) => setType(e.detail.selectedOption)}
                  statusType={loading}
                  filteringType="auto"
                />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Key pair (login)</Header>}>
              <FormField
                label="Key pair name"
                description="You can use a key pair to securely connect to your instance."
                secondaryControl={
                  <Button iconName="external" iconAlign="right" onClick={() => window.open("/ec2/key-pairs", "_blank")}>
                    Create new key pair
                  </Button>
                }
              >
                <Select selectedOption={key} options={options.data?.keys ?? [NO_KEY]} onChange={(e) => setKey(e.detail.selectedOption)} statusType={loading} />
              </FormField>
            </Container>
            <Container header={<Header variant="h2">Network settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Subnet" description="Leave empty to use the default subnet.">
                  <Select
                    selectedOption={subnet}
                    options={options.data?.subnets ?? []}
                    onChange={(e) => setSubnet(e.detail.selectedOption)}
                    statusType={loading}
                    placeholder="No preference"
                  />
                </FormField>
                <FormField label="Firewall (security groups)">
                  <Multiselect
                    selectedOptions={groups}
                    options={options.data?.groups ?? []}
                    onChange={(e) => setGroups([...e.detail.selectedOptions])}
                    statusType={loading}
                    placeholder="Select security groups"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Advanced details</Header>}>
              <SpaceBetween size="l">
                <FormField label="Number of instances" errorText={touched ? countError : ""}>
                  <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
                </FormField>
                <FormField label="User data - optional" description="A script that runs when the instance starts.">
                  <Textarea value={userData} rows={6} placeholder={"#!/bin/sh\necho hello"} onChange={(e) => setUserData(e.detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </ContentLayout>
    </Shell>
  );
}
