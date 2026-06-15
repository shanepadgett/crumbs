import { useEffect, useRef, useState } from "react";

/**
 * Scroll-step engine for the scrollytelling layout.
 *
 * Each story step element gets ref(i). The active step is the last step
 * whose trigger line (a third down the viewport, where reading eyes sit)
 * has been crossed. Scrolling up walks the same states backward, so the
 * stage rewinds naturally.
 */
export function useScrollSteps(count: number) {
  const [active, setActive] = useState(-1);
  const els = useRef<(HTMLElement | null)[]>([]);

  const ref = (i: number) => (el: HTMLElement | null) => {
    els.current[i] = el;
  };

  useEffect(() => {
    const onScroll = () => {
      const trigger = window.innerHeight * 0.34;
      let current = -1;
      for (let i = 0; i < count; i++) {
        const el = els.current[i];
        if (el && el.getBoundingClientRect().top < trigger) current = i;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [count]);

  return { active, ref };
}
