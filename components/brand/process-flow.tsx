import { Reveal } from './motion';

interface ProcessStep {
  title: string;
  description: string;
}

interface ProcessFlowProps {
  caption: string;
  accent: string;
  steps: ProcessStep[];
}

/**
 * Responsive column class for the desktop layout. Written as literal strings so
 * Tailwind's scanner emits them (a template literal like `lg:grid-cols-${n}`
 * would be invisible to the JIT and silently drop the class). The horizontal
 * connectors below assume a single row, so flows are meant to be short (2–5
 * steps); longer sequences belong in <Steps>, not a process diagram.
 */
function columnClass(stepCount: number): string {
  if (stepCount === 2) return 'lg:grid-cols-2';
  if (stepCount === 3) return 'lg:grid-cols-3';
  if (stepCount === 4) return 'lg:grid-cols-4';
  return 'lg:grid-cols-5';
}

/**
 * A responsive process diagram that preserves the sequence as an ordered list.
 * The frame and connector track render immediately; each step's number and text
 * then rise into place in sequence (a staggered Reveal) so the path reads as
 * populating along a pre-drawn track — the sequence unfolding, which is the
 * point of a process diagram. The connectors stay outside the Reveal so the
 * track is never hidden, and the grid/connector geometry is untouched.
 */
export function ProcessFlow({ caption, accent, steps }: ProcessFlowProps) {
  // The desktop layout lays steps out in a single row of `columns` tracks. A
  // connector must not follow the last step of a row, or it points into the
  // empty gutter (and a wrapped step breaks the visible sequence). The mobile
  // layout stacks vertically, where every gap takes a connector.
  const columns = Math.min(steps.length, 5);
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-2xl border border-fd-border bg-fd-card">
      <ol className={`grid grid-cols-1 gap-y-8 px-5 py-6 sm:px-6 lg:gap-x-8 lg:gap-y-0 ${columnClass(steps.length)}`}>
        {steps.map((step, index) => (
          <li key={index} className="relative min-w-0">
            <Reveal delay={index * 90}>
              <div className="flex gap-3 lg:block">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold"
                  style={{ borderColor: `${accent}66`, color: accent, backgroundColor: `${accent}14` }}
                >
                  {index + 1}
                </span>
                <div className="pt-1 lg:pt-3">
                  <p className="font-medium leading-5 text-fd-card-foreground">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-fd-muted-foreground">{step.description}</p>
                </div>
              </div>
            </Reveal>
            {index < steps.length - 1 ? (
              <>
                {/* Mobile: vertical connector between stacked steps. */}
                <span
                  aria-hidden="true"
                  className="absolute -bottom-8 left-5 top-10 border-l lg:hidden"
                  style={{ borderColor: `${accent}66` }}
                />
                {/* Desktop: horizontal connector, suppressed at row ends so it
                    never points into an empty track on a wrapped row. */}
                {(index + 1) % columns === 0 ? null : (
                  <span
                    aria-hidden="true"
                    className="absolute left-full top-5 hidden h-px w-8 border-t lg:block"
                    style={{ borderColor: `${accent}66` }}
                  />
                )}
              </>
            ) : null}
          </li>
        ))}
      </ol>
      <figcaption className="border-t border-fd-border px-5 py-3 text-sm leading-6 text-fd-muted-foreground sm:px-6">
        {caption}
      </figcaption>
    </figure>
  );
}
