import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";

export interface VextI18nContextValue {
  locale: string;
  messages: Record<string, unknown>;
  allMessages: Record<string, Record<string, unknown>>;
}

const defaultContext: VextI18nContextValue = {
  locale: "",
  messages: {},
  allMessages: {},
};

export const VextRenderContext = createContext(defaultContext);

export function VextRenderProvider(props: {
  context?: VextI18nContextValue;
  children?: ReactNode;
}) {
  return createElement(
    VextRenderContext.Provider,
    { value: props.context ?? defaultContext },
    props.children,
  );
}

export function useVextI18n<
  TMessages extends Record<string, unknown> = Record<string, unknown>,
>(locale?: string): Readonly<TMessages> {
  const context = useContext(VextRenderContext);
  if (locale && context.allMessages[locale]) {
    return context.allMessages[locale] as TMessages;
  }
  return context.messages as TMessages;
}
