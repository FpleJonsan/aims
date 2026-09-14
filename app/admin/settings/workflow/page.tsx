"use client";
import { Alert, Input, Typography } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";
type Workflow = {
  stageModel: string;
  stageCount: number;
  approvalRoutingAuthority: string;
  notificationAuthority: string;
};
const defaults: Workflow = {
  stageModel: "FIXED_12_STAGE",
  stageCount: 12,
  approvalRoutingAuthority: "APPROVAL_MATRIX",
  notificationAuthority: "NOTIFICATION_CONFIGURATION",
};
export default function WorkflowSettingsPage() {
  return (
    <ConfigurationEditor<Workflow>
      category="workflow"
      title="Workflow Configuration"
      description="Authoritative boundaries for the frozen Enterprise workflow. Routing and notification behavior remain governed by their dedicated configuration surfaces."
      defaultValue={defaults}
      readOnly
    >
      {({ value }) => (
        <>
          <Alert tone="info" title="Frozen workflow authority">
            These values are intentionally read-only. Approval routing is
            controlled by Approval Matrix; reminder and escalation rules are
            controlled by Notification Settings.
          </Alert>
          <div className="profileForm">
            <Input label="Workflow model" value={value.stageModel} disabled />
            <Input label="Stages" value={value.stageCount} disabled />
            <Input
              label="Approval routing authority"
              value={value.approvalRoutingAuthority}
              disabled
            />
            <Input
              label="Notification authority"
              value={value.notificationAuthority}
              disabled
            />
          </div>
          <Typography variant="metadata">
            Version history remains available for governance evidence. Any
            future authority change requires a separately approved workflow
            contract.
          </Typography>
        </>
      )}
    </ConfigurationEditor>
  );
}
