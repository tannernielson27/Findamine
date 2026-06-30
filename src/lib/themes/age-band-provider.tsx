"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { type AgeBand, THEME_TOKENS, tokensToCssVars } from "./tokens";

const VALID_BANDS: AgeBand[] = ["primary", "intermediate", "teen", "adult"];

interface AgeBandContextValue {
  band: AgeBand;
  setBand: (band: AgeBand) => void;
}

const AgeBandContext = createContext<AgeBandContextValue>({
  band: "intermediate",
  setBand: () => {},
});

export function useAgeBand() {
  return useContext(AgeBandContext);
}

export function AgeBandProvider({
  initialBand = "intermediate",
  children,
}: {
  initialBand?: AgeBand;
  children: React.ReactNode;
}) {
  const [band, setBand] = useState<AgeBand>(initialBand);

  // Support ?band= URL parameter for previewing age bands
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("band") as AgeBand | null;
    if (override && VALID_BANDS.includes(override)) {
      setBand(override);
    }
  }, []);

  useEffect(() => {
    // Set data attribute on html element
    document.documentElement.setAttribute("data-age-band", band);

    // Apply CSS custom properties
    const vars = tokensToCssVars(THEME_TOKENS[band]);
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }

    // Set font family only — do NOT set root font-size here.
    document.documentElement.style.fontFamily = THEME_TOKENS[band].fontFamily;
  }, [band]);

  return (
    <AgeBandContext.Provider value={{ band, setBand }}>
      {/* reducedMotion="user" makes every framer-motion animation honor the OS
          prefers-reduced-motion setting (opacity-only, no transforms). Combined
          with the global CSS guard + confetti gating, this completes C4. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </AgeBandContext.Provider>
  );
}
