import Stage from "./Stage";
import { STEPS } from "./story";
import { useScrollSteps } from "./useScrollSteps";

export default function App() {
  const { active, ref } = useScrollSteps(STEPS.length);
  const stage = active < 0 ? { phase: "hero" as const } : STEPS[active].stage;

  return (
    <div className="grid grid-cols-[58%_42%]">
      {/* fixed stage */}
      <div className="sticky top-0 h-screen border-r border-hairline">
        <Stage state={stage} />
      </div>

      {/* trigger line — marks the reading position that advances the stage */}
      <div
        aria-hidden
        className="fixed top-[34vh] left-[58%] right-0 pointer-events-none z-10 flex justify-between px-[1.8vw]"
      >
        <span className="block w-[22px] h-px bg-faint/50" />
        <span className="block w-[22px] h-px bg-faint/50" />
      </div>

      {/* scrolling story */}
      <main className="px-[4.5vw]">
        <header className="min-h-[80vh] flex flex-col justify-center max-w-[560px]">
          <h1 className="font-sans font-semibold text-[42px] leading-[1.12] tracking-tight">
            A tale of two agents
          </h1>
          <p className="font-serif text-[19px] leading-[1.65] text-ink-2 mt-7">
            Two agents are about to fix the same bug in the same repo. As we follow them, watch for
            the one thing that changes: the harness. That is the layer between the engineer and the
            model, and it decides what gets sent, what stays in working memory, and what we pay to
            send again.
          </p>
        </header>

        {STEPS.map((step, i) => (
          <div
            key={i}
            ref={ref(i)}
            className={`max-w-[560px] mb-9 transition-opacity duration-300 ${
              i === active ? "opacity-100" : "opacity-55"
            }`}
          >
            {step.heading && (
              <h2 className="font-sans font-semibold text-[25px] leading-[1.25] tracking-tight mt-16 mb-6">
                {step.heading}
              </h2>
            )}
            <div className="font-serif text-[17.5px] leading-[1.7] text-ink-2">{step.body}</div>
          </div>
        ))}

        <footer className="min-h-[110vh] flex items-start pt-10">
          <p className="font-sans text-[13px] text-faint">
            Story ends here. Close: pay the model to think, not to re-read its own inbox.
          </p>
        </footer>
      </main>
    </div>
  );
}
