# omp-system-reminder

Inject a configurable high-priority reminder before every Oh My Pi model call, including continuation calls after tool results.

OMP receives the reminder as a `developer` message and translates it to the provider's high-priority instruction representation. The XML wrapper itself is only a label:

```xml
<system-reminder>
Your instruction
</system-reminder>
```

## Install

```bash
omp plugin install github:byigitt/omp-system-reminder
```

Restart OMP after installation. Requires OMP 17.2.12 or newer.

## Edit inside OMP

Open the multiline editor:

```text
/system-reminder
```

The explicit form is equivalent:

```text
/system-reminder edit
```

Other operations:

```text
/system-reminder show
/system-reminder off
/system-reminder reload
/system-reminder save project
/system-reminder save global
```

You can also set a session-only reminder inline:

```text
/system-reminder Be concise. Lead with the result and skip narration.
```

`save project` writes `<cwd>/.omp/SYSTEM_REMINDER.md`. `save global` writes `SYSTEM_REMINDER.md` under the active OMP agent directory.

## Other configuration methods

Command-line flag:

```bash
omp --system-reminder "Be concise. Skip preamble and narration."
```

Environment variable:

```bash
OMP_SYSTEM_REMINDER="Be concise. Skip preamble and narration." omp
```

Configuration files:

```text
<cwd>/.omp/SYSTEM_REMINDER.md
~/.omp/agent/SYSTEM_REMINDER.md
```

Precedence, highest first:

1. `--system-reminder`
2. `OMP_SYSTEM_REMINDER`
3. `<cwd>/.omp/SYSTEM_REMINDER.md`
4. The active user agent directory's `SYSTEM_REMINDER.md`

A reminder edited through the slash command overrides these sources for the current session. Use `/system-reminder reload` to discard the session override and reload configuration.

## Development

```bash
bun test
```

## License

MIT
