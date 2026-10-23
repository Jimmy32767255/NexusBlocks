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

/** Raised by the throw block; `value` is the exception payload. */
export class ThrowSignal extends Error {
  readonly value: import("@nexus/ir").Value;
  readonly blockId?: string;

  constructor(value: import("@nexus/ir").Value, blockId?: string) {
    super("thrown");
    this.name = "ThrowSignal";
    this.value = value;
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

/** Internal control-flow signal: leaves the innermost loop. */
export class BreakSignal extends Error {
  constructor() {
    super("break");
    this.name = "BreakSignal";
  }
}

/** Raised by `sys.exit`; ends the whole run with an exit code. */
export class ExitSignal extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`exit ${code}`);
    this.name = "ExitSignal";
    this.code = code;
  }
}
