import { useState } from "react";
import { errorMessage } from "./format";

/** Tracks one form submit: a busy flag and the error to show. `run` gives true when the work succeeded. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await work();
      setBusy(false);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return false;
    }
  };
  return { busy, error, setError, run };
}
