import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import systemReminderExtension from "../src/index";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

interface TestContext {
	cwd: string;
	ui: {
		editor: () => Promise<string | undefined>;
		notify: (message: string, type?: string) => void;
	};
}

interface ContextResult {
	messages: Array<Record<string, unknown>>;
}

type SessionHandler = (event: Record<string, never>, ctx: TestContext) => Promise<void>;
type ContextHandler = (
	event: { messages: Array<Record<string, unknown>> },
	ctx: TestContext,
) => Promise<ContextResult | undefined>;
type CommandHandler = (args: string, ctx: TestContext) => Promise<void>;

function createHarness(editorResult = "First line\nSecond line", existingCwd?: string) {
	let sessionStartHandler: SessionHandler | undefined;
	let contextHandler: ContextHandler | undefined;
	let commandHandler: CommandHandler | undefined;
	const notifications: Array<{ message: string; type?: string }> = [];
	const cwd = existingCwd ?? mkdtempSync(join(tmpdir(), "omp-system-reminder-"));
	if (!existingCwd) temporaryDirectories.push(cwd);

	const pi = {
		setLabel() {},
		registerFlag() {},
		getFlag() {
			return undefined;
		},
		on(event: string, handler: unknown) {
			// Test boundary: the real API overload narrows each handler by event name.
			if (event === "session_start") sessionStartHandler = handler as SessionHandler;
			if (event === "context") contextHandler = handler as ContextHandler;
		},
		registerCommand(name: string, command: unknown) {
			if (name !== "system-reminder" || !command || typeof command !== "object" || !("handler" in command)) return;
			commandHandler = command.handler as CommandHandler;
		},
	};

	systemReminderExtension(pi as never);

	if (!sessionStartHandler || !contextHandler || !commandHandler) {
		throw new Error("Extension did not register its required handlers");
	}

	const ctx: TestContext = {
		cwd,
		ui: {
			editor: async () => editorResult,
			notify: (message, type) => notifications.push({ message, type }),
		},
	};

	return { commandHandler, contextHandler, ctx, cwd, notifications, sessionStartHandler };
}

describe("system reminder extension", () => {
	test("injects the edited reminder before every model call", async () => {
		const { commandHandler, contextHandler, ctx, sessionStartHandler } = createHarness();
		await sessionStartHandler({}, ctx);
		await commandHandler("edit project", ctx);

		const first = await contextHandler({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }, ctx);
		const second = await contextHandler({ messages: [{ role: "toolResult", content: [], timestamp: 2 }] }, ctx);

		expect(first?.messages.at(-1)).toMatchObject({
			role: "developer",
			content: "<system-reminder>\nFirst line\nSecond line\n</system-reminder>",
		});
		expect(second?.messages.at(-1)).toMatchObject({
			role: "developer",
			content: "<system-reminder>\nFirst line\nSecond line\n</system-reminder>",
		});
	});

	test("persists edited text across sessions", async () => {
		const first = createHarness("Persistent reminder");
		await first.sessionStartHandler({}, first.ctx);
		await first.commandHandler("edit project", first.ctx);

		expect(JSON.parse(readFileSync(join(first.cwd, ".omp", "SYSTEM_REMINDER.json"), "utf8"))).toEqual({
			enabled: true,
			preset: "custom",
			text: "Persistent reminder",
		});

		const resumed = createHarness("", first.cwd);
		await resumed.sessionStartHandler({}, resumed.ctx);
		const context = await resumed.contextHandler({ messages: [{ role: "user", content: "hello" }] }, resumed.ctx);
		expect(context?.messages.at(-1)).toMatchObject({
			role: "developer",
			content: "<system-reminder>\nPersistent reminder\n</system-reminder>",
		});
	});

	test("persists off and on state without losing text", async () => {
		const first = createHarness("Toggle reminder");
		await first.sessionStartHandler({}, first.ctx);
		await first.commandHandler("edit project", first.ctx);
		await first.commandHandler("off project", first.ctx);

		expect(JSON.parse(readFileSync(join(first.cwd, ".omp", "SYSTEM_REMINDER.json"), "utf8"))).toEqual({
			enabled: false,
			preset: "custom",
			text: "Toggle reminder",
		});

		const disabled = createHarness("", first.cwd);
		await disabled.sessionStartHandler({}, disabled.ctx);
		expect(await disabled.contextHandler({ messages: [{ role: "user", content: "hello" }] }, disabled.ctx)).toBeUndefined();

		await disabled.commandHandler("on project", disabled.ctx);
		const enabled = createHarness("", first.cwd);
		await enabled.sessionStartHandler({}, enabled.ctx);
		const context = await enabled.contextHandler({ messages: [{ role: "user", content: "hello" }] }, enabled.ctx);
		expect(context?.messages.at(-1)).toMatchObject({
			role: "developer",
			content: "<system-reminder>\nToggle reminder\n</system-reminder>",
		});
	});

	test("persists and automatically loads a writing-style preset", async () => {
		const first = createHarness();
		await first.sessionStartHandler({}, first.ctx);
		await first.commandHandler("preset plain-language project", first.ctx);

		expect(JSON.parse(readFileSync(join(first.cwd, ".omp", "SYSTEM_REMINDER.json"), "utf8"))).toEqual({
			enabled: true,
			preset: "plain-language",
			text: "",
		});

		const resumed = createHarness("", first.cwd);
		await resumed.sessionStartHandler({}, resumed.ctx);
		const context = await resumed.contextHandler({ messages: [{ role: "user", content: "hello" }] }, resumed.ctx);
		expect(context?.messages.at(-1)).toMatchObject({
			role: "developer",
			content: expect.stringContaining("Write every response in simple, plain language"),
		});
	});
});
