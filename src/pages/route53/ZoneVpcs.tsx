import { useState } from "react";
import { AssociateVPCWithHostedZoneCommand, DisassociateVPCFromHostedZoneCommand, type VPC, type VPCRegion } from "@aws-sdk/client-route-53";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import Table from "@cloudscape-design/components/table";
import { route53 } from "../../clients/route53";
import { FormModal } from "../../components/FormModal";
import { getRegion } from "../../config";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listVpcs, vpcLabel } from "./route53util";

/** The VPCs of a private hosted zone, with associate and disassociate. */
export function ZoneVpcs({ zoneId, vpcs, onChange }: { zoneId: string; vpcs: VPC[]; onChange: () => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [adding, setAdding] = useState(false);
  const [vpc, setVpc] = useState("");
  const region = getRegion();
  const choices = useLoad(async () => (adding ? listVpcs() : []), [adding]);
  const free = (choices.data ?? []).filter((v) => !vpcs.some((a) => a.VPCId === v.VpcId && a.VPCRegion === region));

  const associate = async () => {
    if (!vpc) return form.setError("Choose a VPC.");
    const ok = await form.run(async () => {
      await route53.send(new AssociateVPCWithHostedZoneCommand({ HostedZoneId: zoneId, VPC: { VPCId: vpc, VPCRegion: region as VPCRegion } }));
      notify.success(`Associated ${vpc} with the hosted zone.`);
      onChange();
    });
    if (ok) setAdding(false);
  };

  const disassociate = async (v: VPC) => {
    try {
      await route53.send(new DisassociateVPCFromHostedZoneCommand({ HostedZoneId: zoneId, VPC: v }));
      notify.success(`Disassociated ${v.VPCId} from the hosted zone.`);
    } catch (e) {
      notify.error("Could not disassociate the VPC", e);
    }
    onChange();
  };

  return (
    <>
      <Table
        header={
          <Header
            variant="h2"
            counter={`(${vpcs.length})`}
            description="A private hosted zone needs at least one VPC."
            actions={
              <Button
                onClick={() => {
                  setVpc("");
                  form.setError("");
                  setAdding(true);
                }}
              >
                Associate VPC
              </Button>
            }
          >
            Associated VPCs
          </Header>
        }
        items={vpcs}
        columnDefinitions={[
          { id: "id", header: "VPC ID", cell: (v) => v.VPCId, isRowHeader: true },
          { id: "region", header: "Region", cell: (v) => v.VPCRegion },
          {
            id: "actions",
            header: "Actions",
            cell: (v) => (
              <Button variant="inline-link" disabled={vpcs.length < 2} onClick={() => disassociate(v)}>
                Disassociate
              </Button>
            ),
          },
        ]}
        empty={<Box textAlign="center">No VPCs</Box>}
      />

      <FormModal visible={adding} header="Associate VPC" submitLabel="Associate VPC" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={associate}>
        <FormField label="VPC" description={`VPCs in the console's Region, ${region}.`} errorText={choices.error}>
          <Select
            selectedOption={vpc ? { value: vpc, label: vpc } : null}
            onChange={(e) => setVpc(e.detail.selectedOption.value ?? "")}
            options={free.map((v) => ({ value: v.VpcId, label: vpcLabel(v), description: v.CidrBlock }))}
            placeholder="Choose a VPC"
            statusType={choices.loading ? "loading" : "finished"}
            loadingText="Loading VPCs"
            empty="No other VPCs in this Region"
          />
        </FormField>
      </FormModal>
    </>
  );
}
