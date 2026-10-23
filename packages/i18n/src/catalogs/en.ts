import type { Catalog } from "../types.ts";

/**
 * English catalog. This file is the reference: every new key is added here
 * first, and `pnpm test` fails when another locale drifts.
 */
export const en: Catalog = {
  "app.title": "Nexus Blocks",
  "app.untitled": "Untitled project",
  "app.projectName": "Project name",

  "toolbar.run": "Run",
  "toolbar.stop": "Stop",
  "toolbar.new": "New project",
  "toolbar.open": "Open project",
  "toolbar.save": "Save a copy",
  "toolbar.undo": "Undo",
  "toolbar.redo": "Redo",
  "toolbar.zoomIn": "Zoom in",
  "toolbar.zoomOut": "Zoom out",
  "toolbar.zoomReset": "Reset view",
  "toolbar.language": "Language",
  "toolbar.help": "Shortcuts",
  "toolbar.docs": "Docs",

  "language.en": "English",
  "language.zh-CN": "简体中文",

  "panel.toolbox": "Blocks",
  "panel.variables": "Variables",
  "panel.console": "Console",
  "panel.problems": "Problems",

  "toolbox.search": "Search blocks",
  "toolbox.noResults": "No blocks match “{query}”",
  "toolbox.dragHint": "Drag a block onto the canvas",
  "toolbox.more": "More blocks are on the way",

  "canvas.emptyTitle": "Start building",
  "canvas.emptyBody": "Drag a block from the toolbox onto the canvas. Programs run from “when program starts”.",

  "variables.add": "New variable",
  "variables.empty": "No variables yet. Create one to store values between blocks.",
  "variables.name": "Name",
  "variables.type": "Type",
  "variables.initial": "Initial value",
  "variables.delete": "Delete variable",
  "variables.promptName": "Variable name",
  "variables.usedBy": "Used by {count} blocks",
  "variables.invalidName": "Use letters, numbers or underscores; the name cannot start with a digit.",
  "variables.duplicateName": "A variable with this name already exists.",
  "variables.confirmDelete": "Delete “{name}”? Blocks that use it will lose their variable.",

  "console.empty": "Run the program to see its output here.",
  "console.clear": "Clear console",
  "console.started": "Program started",
  "console.finished": "Finished in {ms} ms",
  "console.stopped": "Stopped",

  "problems.empty": "No problems found.",
  "problems.count": "{count} problems",
  "problems.none": "No problems",

  "diag.project.format": "Unknown program format.",
  "diag.project.empty": "The program has no scripts yet.",
  "diag.block.duplicateId": "Duplicate block id “{id}”.",
  "diag.block.unknownType": "Unknown block type “{type}”.",
  "diag.block.kindMismatch": "A {actual} block cannot be used here.",
  "diag.block.unknownField": "Unknown field “{field}” on {type}.",
  "diag.block.missingField": "Missing field “{field}”.",
  "diag.block.invalidNumber": "“{field}” must be a number.",
  "diag.block.invalidOption": "“{field}” has an unknown option “{value}”.",
  "diag.block.invalidVariable": "This block points at a variable that no longer exists.",
  "diag.port.unknown": "Unknown port “{port}” on {type}.",
  "diag.port.expectedValue": "Port “{port}” expects a single expression block.",
  "diag.port.expectedStack": "Port “{port}” expects a stack of blocks.",
  "diag.port.typeMismatch": "A {from} value cannot be used where {to} is expected.",
  "diag.variable.duplicateName": "Duplicate variable name “{name}”.",
  "diag.variable.invalidName": "Invalid variable name “{name}”.",

  "runtime.error.unknownBlock": "Unknown block: {type}",
  "runtime.error.missingVariable": "Variable not found: {name}",
  "runtime.error.badNumber": "Cannot convert “{value}” to a number",
  "runtime.error.badType": "Cannot use a {from} value where {to} is expected",
  "runtime.error.expressionAsStatement": "“{type}” returns a value and cannot run on its own",
  "runtime.error.statementAsValue": "“{type}” does not return a value",
  "runtime.error.divisionByZero": "Division by zero",
  "runtime.error.stepLimit": "Step limit exceeded ({limit} steps). Is a loop missing an exit condition?",
  "runtime.error.capability": "Capability “{capability}” is not available in this host",
  "runtime.error.internal": "Internal error: {detail}",

  "capability.console.print": "Write a line to the output console",

  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.none": "None",
  "common.yes": "Yes",
  "common.no": "No",
  "common.true": "true",
  "common.false": "false",

  "toast.saved": "Project downloaded",
  "toast.opened": "Project opened",
  "toast.invalidFile": "Could not read this file: {detail}",
  "toast.newProject": "Started a new project",
  "toast.nothingToRun": "Add a “when program starts” block first",
  "toast.copied": "Copied to clipboard",
  "toast.copyFailed": "Could not copy to clipboard",

  "dialog.newProject.title": "Start a new project?",
  "dialog.newProject.body": "The current program will be replaced. Download it first if you want to keep it.",

  "help.title": "Keyboard shortcuts",
  "help.body":
    "Drag blocks from the toolbox to the canvas.\nDelete / Backspace — delete selection\nCtrl+Z / Ctrl+Shift+Z — undo / redo\nCtrl+S — download the project\nSpace + drag, or middle-drag — pan\nScroll — zoom\nDouble-click a script — place a block at the end",

  "category.control": "Control",
  "category.io": "Output",
  "category.text": "Text",
  "category.math": "Math",
  "category.logic": "Logic",
  "category.variables": "Variables",

  "block.control.start.label": "when program starts",
  "block.control.start.description": "Entry point. Everything under this block runs once when you press Run.",
  "block.control.start.port.body": "do",

  "block.io.print.label": "print",
  "block.io.print.description": "Write a value to the console.",
  "block.io.print.port.text": "value",

  "block.text.literal.label": "text",
  "block.text.literal.description": "A piece of text.",
  "block.text.literal.field.value": "value",

  "block.text.join.label": "join",
  "block.text.join.description": "Join two values into one piece of text.",
  "block.text.join.port.a": "a",
  "block.text.join.port.b": "b",

  "block.math.number.label": "number",
  "block.math.number.description": "A number literal.",
  "block.math.number.field.value": "value",

  "block.math.arithmetic.label": "arithmetic",
  "block.math.arithmetic.description": "Add, subtract, multiply, divide or take the remainder of two numbers.",
  "block.math.arithmetic.field.op": "operator",
  "block.math.arithmetic.port.a": "a",
  "block.math.arithmetic.port.b": "b",

  "block.logic.boolean.label": "true / false",
  "block.logic.boolean.description": "A boolean literal.",
  "block.logic.boolean.field.value": "value",

  "block.logic.compare.label": "compare",
  "block.logic.compare.description": "Compare two values and get true or false.",
  "block.logic.compare.field.op": "operator",
  "block.logic.compare.port.a": "a",
  "block.logic.compare.port.b": "b",

  "block.control.if.label": "if",
  "block.control.if.description": "Run the “then” stack when the condition is true, otherwise the optional “else” stack.",
  "block.control.if.port.condition": "condition",
  "block.control.if.port.then": "then",
  "block.control.if.port.else": "else",

  "block.control.repeat.label": "repeat",
  "block.control.repeat.description": "Run the body a number of times.",
  "block.control.repeat.port.times": "times",
  "block.control.repeat.port.body": "do",

  "block.var.set.label": "set variable",
  "block.var.set.description": "Store a value in a variable.",
  "block.var.set.field.variable": "variable",
  "block.var.set.port.value": "to",

  "block.var.get.label": "variable",
  "block.var.get.description": "Read the current value of a variable.",
  "block.var.get.field.variable": "variable",
};
