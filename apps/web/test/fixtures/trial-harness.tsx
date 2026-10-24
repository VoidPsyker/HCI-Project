import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrialRunner, type TrialInstruction } from "../../src/components/TrialRunner";
import { EventLogger } from "../../src/logger";
import type { ColourMapping } from "@meridian/taxonomy";

export interface HarnessConfig {
  spec: TrialInstruction;
  colourMapping: ColourMapping;
  fastMode: boolean;
  participantId: string;
  sessionId: string;
}

declare global {
  interface Window {
    __trialConfig?: HarnessConfig;
    __trialLogger?: EventLogger;
    __trialComplete?: { success: boolean };
  }
}

function HarnessApp() {
  const [config, setConfig] = useState<HarnessConfig | null>(() => window.__trialConfig ?? null);
  const [logger, setLogger] = useState<EventLogger | null>(() => {
    if (window.__trialConfig) {
      const l = new EventLogger(window.__trialConfig.participantId, window.__trialConfig.sessionId);
      window.__trialLogger = l;
      return l;
    }
    return null;
  });

  useEffect(() => {
    if (!config && window.__trialConfig) {
      setConfig(window.__trialConfig);
      const l = new EventLogger(window.__trialConfig.participantId, window.__trialConfig.sessionId);
      window.__trialLogger = l;
      setLogger(l);
    }
  }, [config]);

  if (!config || !logger) {
    return <div data-testid="harness-waiting">Waiting for trial configuration...</div>;
  }

  return (
    <div className="stage-viewport">
      <div className="stage" style={{ transform: "translate(-50%, -50%) scale(1)" }}>
        <TrialRunner
          spec={config.spec}
          colourMapping={config.colourMapping}
          logger={logger}
          fastMode={config.fastMode}
          onComplete={(res) => {
            window.__trialComplete = res;
          }}
        />
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<HarnessApp />);
}
