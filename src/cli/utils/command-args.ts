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

export function readRequiredOptionValueOrExit(
  args: string[],
  index: number,
  optionName: string,
  valueLabel: string,
): RequiredOptionValue {
  try {
    return readRequiredOptionValue(args, index, optionName, valueLabel);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export function failUnknownCliArgument(
  arg: string,
  printHelp: () => void,
): never {
  const kind = arg.startsWith("-") ? "option" : "argument";
  console.error(`[vextjs] Unknown ${kind}: "${arg}"\n`);
  printHelp();
  process.exit(1);
}
