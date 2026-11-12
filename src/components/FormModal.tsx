import type { ReactNode } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal, { type ModalProps } from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

/** A dialog with a form in it: fields, an error line, Cancel and one primary button. */
export function FormModal({
  visible,
  header,
  submitLabel,
  busy,
  error,
  size,
  onDismiss,
  onSubmit,
  children,
}: {
  visible: boolean;
  header: string;
  submitLabel: string;
  busy?: boolean;
  error?: string;
  size?: ModalProps.Size;
  onDismiss: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      size={size}
      onDismiss={onDismiss}
      header={header}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={onSubmit}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {children}
        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
