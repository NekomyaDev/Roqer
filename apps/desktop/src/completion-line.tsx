import React from "react";
import type { RunUsage } from "../shared/run-events";
import { completedRunDetailsLabel } from "./activity-model";
import { usageLabel } from "./run-view";

/** Completion mode, elapsed time, and provider usage in one DOM line. */
export function CompletionLine({ metadata, usage }: { metadata: string; usage?: RunUsage }) {
  return <p
    className="run-completion-metadata"
    title={usage === undefined
      ? undefined
      : usage.costUsd === undefined
        ? "As the provider reported it."
        : "As the provider reported it. The price is its estimate at API list prices; on a subscription it is not what you pay."}
  >{completedRunDetailsLabel(metadata, usage === undefined ? null : usageLabel(usage))}</p>;
}
