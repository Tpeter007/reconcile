export class QboNotConnectedError extends Error {
  constructor() {
    super("QuickBooks is not connected for this user.");
    this.name = "QboNotConnectedError";
  }
}

export class QboReconnectRequiredError extends Error {
  constructor(message?: string) {
    super(message ?? "QuickBooks connection needs to be reconnected.");
    this.name = "QboReconnectRequiredError";
  }
}
