"use client";

const STEPS = [
  { key: "prime", label: "Prime", icon: "📖" },
  { key: "clue", label: "Clue", icon: "🔍" },
  { key: "navigate", label: "Navigate", icon: "🧭" },
  { key: "challenge", label: "Challenge", icon: "🧩" },
  { key: "capture", label: "Capture", icon: "📸" },
  { key: "feedback", label: "Results", icon: "⭐" },
];

interface StopFlowStepperProps {
  currentStep: string;
}

export default function StopFlowStepper({ currentStep }: StopFlowStepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center justify-between gap-1 mb-6">
      {STEPS.map((step, i) => {
        const isActive = i === currentIndex;
        const isCompleted = i < currentIndex;

        return (
          <div key={step.key} className="flex min-w-0 flex-col items-center flex-1">
            <div
              className={`flex items-center justify-center rounded-full text-lg transition-all`}
              style={{
                width: "var(--touch-target, 40px)",
                height: "var(--touch-target, 40px)",
                ...(isActive
                  ? {
                      backgroundColor: "var(--color-primary-light, #BAE6FD)",
                      boxShadow: "0 0 0 2px var(--color-primary, #0EA5E9)",
                      transform: "scale(1.1)",
                    }
                  : isCompleted
                  ? {
                      backgroundColor: "var(--color-primary, #0EA5E9)",
                      color: "white",
                    }
                  : {
                      backgroundColor: "#F3F4F6",
                      color: "#9CA3AF",
                    }),
              }}
            >
              {isCompleted ? "✓" : step.icon}
            </div>
            <span
              className="text-[11px] sm:text-xs mt-1 max-w-full truncate"
              style={{
                color: isActive
                  ? "var(--color-primary-dark, #0284C7)"
                  : "#9CA3AF",
                fontWeight: isActive ? "var(--font-weight, 500)" : "400",
              }}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
