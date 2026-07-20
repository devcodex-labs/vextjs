export interface RequiredOptionValue {
  value: string;
  nextIndex: number;
}

export function readRequiredOptionValue(
  args: string[],
  index: number,
  optionName: string,
  valueLabel: string,
): RequiredOptionValue {
  const value = args[index + 1];

  if (value === undefined || value === "") {
    throw new Error(
      `[vextjs] Option "${optionName}" requires a value: ${valueLabel}`,
    );
  }

  if (value.startsWith("-")) {
    throw new Error(
      `[vextjs] Option "${optionName}" requires a value: ${valueLabel}; received option-like value "${value}"`,
    );
  }

  return {
    value,
    nextIndex: index + 1,
  };
}
