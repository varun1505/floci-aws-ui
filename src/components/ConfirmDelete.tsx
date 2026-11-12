import { useEffect, useState, type ReactNode } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

/** Delete dialog. The user types a word to confirm, the same way the AWS console asks. */
export function ConfirmDelete({
  visible,
  title,
  children,
  confirmText = "delete",
  actionLabel = "Delete",
  warning,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  children?: ReactNode;
  confirmText?: string;
  actionLabel?: string;
  warning?: ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setText("");
  }, [visible]);

  const ok = text.trim() === confirmText;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onCancel}
      header={title}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!ok} loading={busy} onClick={submit}>
              {actionLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {children}
        {warning && <Alert type="warning">{warning}</Alert>}
        <FormField label={`To confirm, type "${confirmText}" in the field.`}>
          <Input
            value={text}
            placeholder={confirmText}
            onChange={(e) => setText(e.detail.value)}
            onKeyDown={(e) => e.detail.key === "Enter" && submit()}
            autoFocus
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
