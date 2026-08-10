import type { ReactNode } from "react";
import { button } from "../styles/button.style";

export function Button(props: {
  intent?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <button className={button({ intent: props.intent ?? "primary" })}>
      {props.children}
    </button>
  );
}
