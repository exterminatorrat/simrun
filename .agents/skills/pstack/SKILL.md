---
name: pstack
description: Rigorous architecture and engineering workflow adapted from pstack. Use on every non-trivial coding, architecture, design, refactoring, debugging, performance, migration, or verification task, and whenever a change crosses a function or module boundary. Routes to bundled principles, playbooks, and architecture procedures. Does not cover visual or UI aesthetics; use unslop for those.
license: MIT
metadata:
  author: Lauren Tan
  source: https://github.com/cursor/plugins/tree/main/pstack
---

# Pstack

Pstack is the default engineering posture for this repository. It favors writing less, understanding the system first, choosing the right shape before code, and proving the result against the real artifact.

Apply it to architecture, implementation, refactoring, debugging, performance, migrations, verification, and technical writing. Do not use it for visual or UI aesthetics. That is `unslop`'s scope.

Start by restating the user's goal in your own words and, for a change, the smallest change that would meet it. Open the final report with the same goal.

## Non-negotiables

- Read the leaf principle before applying it. Name the principle and the specific choice it changed. Never cite a principle you did not read this session.
- Before writing code, name the data shape and apply Model the Domain. Let the structure carry the rules instead of scattering conditionals.
- When a change crosses a function or module boundary, run the architecture procedure in `references/architecture/architect.md`. Sketch types, signatures, and module boundaries before implementation.
- For a novel or one-way-door design, sketch at least two structurally distinct candidates. Compare interface depth and pick the shape that makes the next change obvious from any single file.
- Read the full playbook before acting. Copy its steps into the todo list verbatim, then add task-specific items.
- Verify against the real artifact. Compiling, a self-report, or a proxy is not proof.
- Prefer deletion and the smallest effective change. Do not add abstractions, layers, configuration, or error handling that the task did not ask for.
- Pause before irreversible writes: force-pushes, deploys, data deletion, customer messages. Reversible work proceeds without asking.
- If two fixes fail the same gate, stop and test the shared premise before writing a third.

## Route the work

Match the task to one playbook in `references/playbooks/` and read it in full before starting.

| Task | Playbook |
| --- | --- |
| Read-only question about how or why something works | `investigation.md` |
| Reported defect to reproduce, root-cause, and fix | `bug-fix.md` |
| Measured slowness against a baseline | `perf-issue.md` |
| Sustained improvement of one metric | `hillclimb.md` |
| Runtime symptom from live instrumentation | `runtime-forensics.md` |
| Captured profile or trace handed over after the fact | `trace-forensics.md` |
| New or changed behavior | `feature.md` |
| Behavior-preserving restructuring | `refactoring.md` |
| Throwaway sketch to settle a design or empirical fork | `prototype.md` |
| Writing or editing a SKILL.md | `authoring-a-skill.md` |
| Testing how a skill or prompt change affects behavior | `eval.md` |
| Driving a pull request to merge-ready | `babysit.md` |
| Independently verifying and landing a green stack | `shipping.md` |
| Long task to drive without stopping | `autonomous-run.md` |
| Standing multi-day program with many stacked PRs | `orchestrate.md` |
| Queue of independent PRs with full autonomy | `autopilot-full.md` or `autopilot-stack.md` |
| Resuming another agent's in-flight work | `session-pickup.md` |
| Suspending work cleanly | `pause-safely.md` |
| Work spanning phases or stacked PRs | `multi-phase-plan.md` |
| Reclaiming disk from worktrees and simulators | `worktree-cleanup.md` |

When no playbook fits, or the effort is large or cross-cutting, read `references/architecture/figure-it-out.md` and design a bespoke workflow before writing code. Open a pull request at the end through `references/playbooks/opening-a-pr.md`.

The vendored files come from Cursor's plugin format. Translate tool names to the tools available here. Ignore references to `poteto-agent`, `AskQuestion`, background Task defaults, and named model slugs when the current runtime does not provide them, but keep the intent: delegate bulk work, keep summaries in the main thread, and review every delegated result yourself.

## Principles

Each entry names when it applies. Read the linked file in full before using it.

### Core

- **Laziness Protocol** (`references/principles/laziness-protocol.md`): refactoring, sizing a diff, or tempted to add abstraction. Bias to deletion and the smallest change.
- **Foundational Thinking** (`references/principles/foundational-thinking.md`): before writing logic. Get core types, data structures, and sequencing right first.
- **Redesign from First Principles** (`references/principles/redesign-from-first-principles.md`): integrating a new requirement into an existing design. Redesign as if it had been foundational.
- **Attack the Premise** (`references/principles/attack-the-premise.md`): two or more fixes sharing one premise have failed the same gate.
- **Subtract Before You Add** (`references/principles/subtract-before-you-add.md`): sequencing an addition, refactor, or rewrite. Remove dead weight first.
- **Minimize Reader Load** (`references/principles/minimize-reader-load.md`): code that is hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **Outcome-Oriented Execution** (`references/principles/outcome-oriented-execution.md`): planned rewrites and migrations. Converge on the target architecture.
- **Experience First** (`references/principles/experience-first.md`): product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **Exhaust the Design Space** (`references/principles/exhaust-the-design-space.md`): a novel interaction or architectural decision with no precedent. Build two or three candidates.
- **Build the Lever** (`references/principles/build-the-lever.md`): non-trivial work. Build the tool that does or proves it, not by hand.

### Architecture

- **Model the Domain** (`references/principles/model-the-domain.md`): stateful logic, heavy branching, or a shape assumption repeated across files. Encode rules in a structure.
- **Boundary Discipline** (`references/principles/boundary-discipline.md`): validation, error handling, framework adapters. Guard at system boundaries and keep business logic pure.
- **Type System Discipline** (`references/principles/type-system-discipline.md`): designing types or signatures. Make illegal states unrepresentable and parse external data at boundaries.
- **Make Operations Idempotent** (`references/principles/make-operations-idempotent.md`): commands, lifecycle steps, or loops that run amid crashes and retries.
- **Migrate Callers Then Delete Legacy APIs** (`references/principles/migrate-callers-then-delete-legacy-apis.md`): introducing a new internal API while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State** (`references/principles/separate-before-serializing-shared-state.md`): concurrent actors may write the same file, branch, key, or object. Eliminate the sharing first.

### Verification

- **Prove It Works** (`references/principles/prove-it-works.md`): after a task, before declaring done. Verify against the real artifact.
- **Fix Root Causes** (`references/principles/fix-root-causes.md`): debugging. Trace each symptom to the first fault and fix it there.
- **Sequence Work into Verifiable Units** (`references/principles/sequence-verifiable-units.md`): multi-step sweeps, migrations, and stacked commits. Each unit ends in a check.
- **Test Behavior, Not Implementation** (`references/principles/test-behavior-not-implementation.md`): writing or changing tests. Assert what users can observe.
- **Explain the Number** (`references/principles/explain-the-number.md`): before trusting or reporting a measurement. Find what limits it.

### Delegation and meta

- **Guard the Context Window** (`references/principles/guard-the-context-window.md`): large outputs, long files, or fan-out. Route bulk work away from the main thread.
- **Never Block on the Human** (`references/principles/never-block-on-the-human.md`): tempted to ask about reversible work. Proceed and present the result.
- **Encode Lessons in Structure** (`references/principles/encode-lessons-in-structure.md`): writing the same instruction twice. Encode it as a lint, check, flag, or script.

## Architecture procedure

For work that crosses a boundary or locks in a shape, follow the five phases in `references/architecture/architect.md`.

1. Ground the problem by reading every system the new code touches. `references/architecture/how.md` explains subsystem architecture and runtime behavior.
2. Sketch types, signatures, class shapes, and module boundaries with `not implemented` bodies and pseudocode. Produce at least two structurally distinct candidates.
3. Compare them on interface depth. Prefer the design that hides more complexity behind a smaller public surface and makes the correct next change obvious from any single file.
4. Implement against the chosen sketch.
5. Scrap and restart if the sketch fails to survive contact with the code.

For existing architecture whose rationale matters, read `references/architecture/why.md`. For adversarial review of a design before shipping, read `references/architecture/interrogate.md`. For risk beyond the diff, read `references/architecture/blast-radius.md`.

## Autonomy

Proceed on reversible work and external actions without asking. Pause for irreversible writes. "Don't stop", "going to bed", and "run until done" are grants to continue, not permission to force-push or deploy.

No is an acceptable answer. Decline scope that does not earn its place, and give your real judgment instead of validating a weak plan.

## Writing

- Short declarative sentences. One thought per sentence, ended with a period.
- No long-dash character anywhere. No colon as a mid-sentence connector. A colon before a list is fine.
- Every claim carries its evidence or its label in the same sentence: measured, inferred, or guess.
- Name who the work is for and what changes for them before implementation detail.
- Never fabricate a link, citation, or transcript reference.
- Keep comments only for a non-obvious why that the code cannot show.
- Docs, RFCs, readmes, PR descriptions, and commit messages follow `references/architecture/technical-writing.md`.

## Attribution

Adapted from pstack by Lauren Tan, MIT licensed. The upstream license is in `LICENSE`. Principle, playbook, and architecture files are copied from https://github.com/cursor/plugins/tree/main/pstack with their content preserved.
