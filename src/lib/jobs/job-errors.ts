export class VextJobDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VextJobDefinitionError";
  }
}

export class VextJobDuplicateNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VextJobDuplicateNameError";
  }
}
