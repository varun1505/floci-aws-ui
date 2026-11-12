import { useState } from "react";
import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-ruby";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/theme-cloud_editor";
import "ace-builds/src-noconflict/theme-cloud_editor_dark";
import "ace-builds/css/ace.css";
import "ace-builds/css/theme/cloud_editor.css";
import "ace-builds/css/theme/cloud_editor_dark.css";
import CodeEditor, { type CodeEditorProps } from "@cloudscape-design/components/code-editor";

// Syntax-check workers need extra worker files. Highlighting works without them.
ace.config.setDefaultValue("session", "useWorker", false);
ace.config.setDefaultValue("renderer", "showPrintMargin", false);

const I18N: CodeEditorProps.I18nStrings = {
  loadingState: "Loading code editor",
  errorState: "There was an error loading the code editor.",
  errorStateRecovery: "Retry",
  editorGroupAriaLabel: "Code editor",
  statusBarGroupAriaLabel: "Status bar",
  cursorPosition: (row, column) => `Ln ${row}, Col ${column}`,
  errorsTab: "Errors",
  warningsTab: "Warnings",
  preferencesButtonAriaLabel: "Preferences",
  paneCloseButtonAriaLabel: "Close",
  preferencesModalHeader: "Preferences",
  preferencesModalCancel: "Cancel",
  preferencesModalConfirm: "Confirm",
  preferencesModalWrapLines: "Wrap lines",
  preferencesModalTheme: "Theme",
  preferencesModalLightThemes: "Light themes",
  preferencesModalDarkThemes: "Dark themes",
};

const BY_EXT: Record<string, CodeEditorProps.Language> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "sh",
  java: "java",
  go: "golang",
  rb: "ruby",
};

export function languageFor(filename: string): CodeEditorProps.Language {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? "text";
}

export function Code({
  value,
  onChange,
  language,
  height = 360,
  ariaLabel = "Code editor",
}: {
  value: string;
  onChange: (value: string) => void;
  language: CodeEditorProps.Language;
  height?: number;
  ariaLabel?: string;
}) {
  const [preferences, setPreferences] = useState<CodeEditorProps.Preferences | undefined>(undefined);
  const [contentHeight, setContentHeight] = useState(height);
  return (
    <CodeEditor
      ace={ace}
      ariaLabel={ariaLabel}
      language={language}
      value={value}
      onDelayedChange={(e) => onChange(e.detail.value)}
      preferences={preferences}
      onPreferencesChange={(e) => setPreferences(e.detail)}
      editorContentHeight={contentHeight}
      onEditorContentResize={(e) => setContentHeight(e.detail.height)}
      i18nStrings={I18N}
      themes={{ light: ["cloud_editor"], dark: ["cloud_editor_dark"] }}
    />
  );
}
