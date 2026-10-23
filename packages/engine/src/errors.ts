/** Raised by `ctx.fail`; carries a translation key instead of a message. */
export class RuntimeFailure extends Error {
  readonly messageKey: string;
  readonly params: Record<string, string | number>;
  readonly blockId?: string;

  constructor(
    messageKey: string,
    params: Record<string, string | number> = {},
    blockId?: string,
  ) {
    super(messageKey);
    this.name = "RuntimeFailure";
    this.messageKey = messageKey;
    this.params = params;
    this.blockId = blockId;
  }
}

/** Internal control-flow signal for cooperative cancellation. */
export class StopSignal extends Error {
  constructor() {
    super("stopped");
    this.name = "StopSignal";
  }
}
