import "./index.css";

import { useEffect } from "react";
import {
  Root as OriginalRoot,
  type RootProps,
} from "@rspress/core/theme-original";

export * from "@rspress/core/theme-original";

const ecosystemLinks = [
  {
    mark: "VX",
    name: "vext",
    description: "High-performance API runtime",
    href: "https://github.com/vextjs/vext",
  },
  {
    mark: "S",
    name: "schema-dsl",
    description: "Schema declaration and validation semantics",
    href: "https://vextjs.github.io/schema-dsl/",
  },
  {
    mark: "M",
    name: "monSQLize",
    description: "MongoDB modeling for service projects",
    href: "https://vextjs.github.io/monSQLize/",
  },
  {
    mark: "FR",
    name: "flex-rate-limit",
    description: "Flexible rate limiting for APIs",
    href: "https://vextjs.github.io/flex-rate-limit/",
  },
  {
    mark: "PC",
    name: "permission-core",
    description: "Permission primitives for application guards",
    href: "https://vextjs.github.io/permission-core/",
  },
  {
    mark: "GH",
    name: "GitHub Org",
    description: "Explore the vextjs organization",
    href: "https://github.com/vextjs",
  },
];

function VextMotionLayer() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionMode = () => {
      document.documentElement.dataset.vextMotion = media.matches
        ? "reduced"
        : "active";
    };

    let frame = 0;

    const updatePointer = (event: PointerEvent | MouseEvent) => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        document.documentElement.style.setProperty(
          "--vext-pointer-x",
          `${event.clientX}px`,
        );
        document.documentElement.style.setProperty(
          "--vext-pointer-y",
          `${event.clientY}px`,
        );
        document.documentElement.dataset.vextPointer = "active";
        frame = 0;
      });
    };

    syncMotionMode();
    media.addEventListener("change", syncMotionMode);
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("mousemove", updatePointer, { passive: true });

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      media.removeEventListener("change", syncMotionMode);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("mousemove", updatePointer);
      delete document.documentElement.dataset.vextMotion;
      delete document.documentElement.dataset.vextPointer;
    };
  }, []);

  return (
    <>
      <div className="vext-motion-field" aria-hidden="true" />
      <div className="vext-pointer-field" aria-hidden="true" />
    </>
  );
}

function VextConsoleTypewriter() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers = new Set<number>();
    const animatedConsoles = new Set<HTMLElement>();
    let disposed = false;

    const getConsoles = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".vext-console__body"),
      );

    const clearTimers = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    };

    const renderStatic = () => {
      getConsoles().forEach((consoleBody) => {
        consoleBody.dataset.vextTerminal = "complete";
        getConsoleLines(consoleBody).forEach((line) => {
          line.dataset.vextTerminalState = "visible";
        });

        const target = getTypeTarget(consoleBody);
        if (target) {
          target.textContent = target.dataset.vextTypewriter ?? "";
          target.dataset.vextTyping = "static";
        }
      });
    };

    const getConsoleLines = (consoleBody: HTMLElement) =>
      Array.from(
        consoleBody.querySelectorAll<HTMLElement>(":scope > .vext-console__line"),
      );

    const getTypeTarget = (consoleBody: HTMLElement) =>
      consoleBody.querySelector<HTMLElement>("[data-vext-typewriter]");

    const resetConsole = (consoleBody: HTMLElement) => {
      consoleBody.dataset.vextTerminal = "playing";
      getConsoleLines(consoleBody).forEach((line, index) => {
        line.dataset.vextTerminalState = index === 0 ? "visible" : "hidden";
      });

      const target = getTypeTarget(consoleBody);
      if (target) {
        target.textContent = "";
        target.dataset.vextTyping = "active";
      }
    };

    const revealOutput = (
      consoleBody: HTMLElement,
      lines: HTMLElement[],
      index: number,
      loop: boolean,
    ) => {
      if (disposed || !consoleBody.isConnected) {
        animatedConsoles.delete(consoleBody);
        return;
      }

      if (index >= lines.length) {
        consoleBody.dataset.vextTerminal = "complete";

        if (loop) {
          schedule(() => playConsole(consoleBody, loop), 4200);
        }
        return;
      }

      lines[index].dataset.vextTerminalState = "active";
      schedule(() => {
        lines[index].dataset.vextTerminalState = "visible";
        revealOutput(consoleBody, lines, index + 1, loop);
      }, loop ? 190 : 150);
    };

    const typeCommand = (consoleBody: HTMLElement, loop: boolean) => {
      const target = getTypeTarget(consoleBody);
      if (!target) {
        return;
      }

      const fullText = target.dataset.vextTypewriter ?? "";
      const lines = getConsoleLines(consoleBody);

      let index = 0;
      const tick = () => {
        if (disposed || !consoleBody.isConnected) {
          animatedConsoles.delete(consoleBody);
          return;
        }

        target.dataset.vextTyping = "active";
        target.textContent = fullText.slice(0, index);

        if (index < fullText.length) {
          index += 1;
          schedule(tick, loop ? 56 : 62);
          return;
        }

        target.dataset.vextTyping = "static";
        schedule(() => revealOutput(consoleBody, lines, 1, loop), 220);
      };

      tick();
    };

    function playConsole(consoleBody: HTMLElement, loop: boolean) {
      if (disposed || !consoleBody.isConnected) {
        animatedConsoles.delete(consoleBody);
        return;
      }

      resetConsole(consoleBody);
      schedule(() => typeCommand(consoleBody, loop), loop ? 160 : 420);
    }

    const start = (reset = false) => {
      if (reset) {
        clearTimers();
        animatedConsoles.clear();
      }

      const loop = !media.matches;
      getConsoles().forEach((consoleBody, index) => {
        if (animatedConsoles.has(consoleBody)) {
          return;
        }

        animatedConsoles.add(consoleBody);
        schedule(
          () => playConsole(consoleBody, loop),
          loop ? 140 + index * 100 : 420,
        );
      });
    };

    start();
    const restart = () => start(true);
    const observer = new MutationObserver(() => start());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    media.addEventListener("change", restart);

    return () => {
      disposed = true;
      clearTimers();
      observer.disconnect();
      animatedConsoles.clear();
      media.removeEventListener("change", restart);
      renderStatic();
    };
  }, []);

  return null;
}

function VextEcosystemMenu() {
  return (
    <nav className="vext-ecosystem-menu" aria-label="VextJS ecosystem">
      <button
        className="vext-ecosystem-trigger"
        type="button"
        aria-haspopup="true"
        aria-label="Open VextJS ecosystem navigation"
        title="Ecosystem"
      >
        <span className="vext-ecosystem-trigger__grid" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      </button>
      <div className="vext-ecosystem-panel">
        <div className="vext-ecosystem-panel__header">
          <span className="vext-ecosystem-panel__mark">
            <span>VX</span>
          </span>
          <div>
            <strong>VextJS Ecosystem</strong>
            <span>Docs, packages and integration surface</span>
          </div>
        </div>
        <div className="vext-ecosystem-panel__grid">
          {ecosystemLinks.map((item) => (
            <a
              className="vext-ecosystem-card"
              href={item.href}
              key={item.href}
              rel="noreferrer"
              target="_blank"
            >
              <span className="vext-ecosystem-card__mark">
                <span>{item.mark}</span>
              </span>
              <span className="vext-ecosystem-card__text">
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}

export function Root({ children }: RootProps) {
  return (
    <OriginalRoot>
      <VextMotionLayer />
      <VextConsoleTypewriter />
      <VextEcosystemMenu />
      {children}
    </OriginalRoot>
  );
}
