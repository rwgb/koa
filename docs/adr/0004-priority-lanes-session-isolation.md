# ADR-0004: Priority Lanes for Agent Loop Concurrency

## Status
Accepted

## Context
The agent loop uses a single `isBusy` boolean flag as its concurrency guard. A second request (from a second browser tab, a Telegram message, or a scheduled delegation) while a turn is active receives a 429 and the request is dropped silently.

As Koa runs more autonomous work (delegations, briefings, channel inbound), collisions become frequent. Two approaches were considered:

1. Flat queue — all requests queue behind the active turn in arrival order
2. Priority lanes — separate queues for user-initiated turns (high priority) and autonomous turns (low priority)

A flat queue means a long delegation task (e.g. a research sweep) blocks an interactive user message for minutes.

## Decision
Two-queue scheduling replaces the `isBusy` flag:

- **High-priority lane**: user-initiated turns (web console, CLI, direct channel messages)
- **Low-priority lane**: autonomous turns (delegations, scheduled briefings, proactive alerts)

A high-priority turn preempts the low-priority lane — the autonomous turn is paused (or its slot is not started) until the user's turn completes. Two concurrent high-priority turns still queue in arrival order.

## Consequences
- Interactive use remains responsive regardless of what autonomous work is running.
- Autonomous turns may be delayed if the user is actively chatting; this is the intended behavior for a personal assistant.
- The `isBusy` 429 response is replaced by queue admission — requests are accepted and held, not rejected.
- The delegation 5-minute polling loop must respect the priority system and submit to the low-priority lane.
- Long-running autonomous turns should support cancellation so a high-priority turn doesn't wait indefinitely.
