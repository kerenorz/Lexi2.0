# Conversation Phases

A conversation can be split into **phases**. Each phase runs different prompt text, so the
agents' character changes as the session progresses — friendly and inclusive at the start,
progressively talking past the participant later (or the reverse).

Nothing is shown to the participant. They see one continuous conversation whose nature changes.

---

## How it is configured

The feature is authored in **two places**, and that split is deliberate.

| Where | What | Why there |
|---|---|---|
| **Experiment** → Conversation Phases | **When** each phase starts | One canonical schedule, so two agents in a group cannot drift onto different timelines |
| **Agent** → Conversation Phases | **What that agent says** in each phase | So each agent keeps its own voice, and the same agent can be reused in studies with different pacing |

On both forms this sits behind a checkbox — **Conversation phases** on the experiment,
**Conversation phases (advanced)** on the agent. Tick it and the editors appear; leave it clear and
the form is the ordinary one, because most studies never use phases and should not have to read
past them. The checkbox stores nothing of its own: it is ticked when the experiment or the agent
already has phase content, so an existing study opens with its arc in front of you. Unticking it on
something that *does* have content asks first, and then genuinely deletes it — an invisible phase
schedule that kept running would be worse than the clutter.

The two are combined when a participant starts a conversation, and the result is **frozen onto
that conversation**. Editing the agent or the experiment afterwards does not affect anyone who
is already talking — which is what you want mid-study, and what makes each session auditable.

> **Author the phase text before participants register.** Lexi snapshots the agents onto a
> participant at *registration*, not at conversation start — this is long-standing behaviour that
> applies to every agent field, not something phases introduced. A participant who registered
> before you wrote the phase prompts carries the older agent, so their conversation will advance
> through the schedule while the prompts never change. The experiment's *schedule* is read fresh,
> so only the agent-side text is affected. If you add phase text mid-study, re-check that
> participants recruited earlier are not silently running a no-op arc.

### Phase 1 is the prompts you already have

You never write phase 1 anywhere. It is the agent's existing System Starter Prompt / Before /
After prompts, running from the start. The phase list is the list of **changes**: the first row
you add is Phase 2.

An experiment with no schedule behaves exactly as it did before this feature existed.

### Triggers: whichever comes first

Each phase can declare a time threshold, a participant-message threshold, a **chat block**, or any
combination. With more than one, **the phase starts when the first of them is met.**

```
Phase 2   after 04:00  or   5 participant messages
Phase 3   after 09:00  or  12 participant messages
```

Use both. Time alone can fire while a slow reader has barely engaged; turns alone may never fire
at all, because going quiet is precisely what an excluded participant does.

**The clock starts at the first round of the chat**, not when the conversation record is created.
A participant who spends four minutes on the pre-conversation survey does not lose phase 1.

### Chat blocks, for a study embedded in a survey

If the study runs inside a survey platform (see "Survey-embedded studies" below), the conversation
is split into **chat blocks** with survey pages between them. A phase can start at a block:

```
Phase 2   at chat block 2
Phase 3   at chat block 3
Phase 4   at chat block 4      ← the reinclusion block
```

Leave the time and message fields blank and the arc advances one phase per block, which is the
usual authoring for this design. The three axes obey the same whichever-comes-first rule, so you
can still say "block 3, or after twelve minutes, whichever happens first".

**In a segmented study the clock only runs while a chat block is open.** The minutes a participant
spends answering questionnaire pages are not counted, so `04:00` means four minutes of actual
chatting rather than four minutes of wall clock a survey page may have eaten. The export reports
both figures side by side (`4:12 chat / 11:37 wall`) precisely because they differ.

A survey break is also excellent cover for a phase change. The advice below to write gradients
rather than cliffs still holds, but a four-minute questionnaire hides a seam better than any
gradient can.

### Shared vs Independent

- **Shared** (default) — one timeline for the whole roster. Every agent turns at the same moment.
- **Independent** — a timeline per agent. Use it when one agent should change fast and another
  slowly (e.g. one drifts away after 5 minutes while the other stays warm for 20).

You often do **not** need Independent mode: blank rows inherit (below), so on one shared timeline
Agent A can change at phases 2 and 3 while Agent B changes only at phase 2 and then holds.

### Blank means inherit

- A blank **field** keeps that prompt from the previous phase. Changing only the System Starter
  Prompt in phase 3 does not mean retyping the Before/After prompts.
- A missing **phase row** keeps the whole previous phase. If the schedule has 3 phases and an
  agent writes text for 2, its phase 3 is the same as its phase 2.

A blank field cannot *clear* an inherited prompt — it can only leave it as it was.

---

## Writing the prompts

**Write gradients, not cliffs.** A friendly agent that becomes cold in a single message reads as
a glitch, and a participant who notices the seam starts looking for the experiment. Three phases
that each move a little are far more convincing than two that jump.

**Describe attention, not rules.** "You are absorbed in the thread you and the other person are
building; don't ask anyone a question" produces natural exclusion. "Ignore the participant"
produces an agent that apologises for ignoring them.

**Describe where their attention is, not what to do with the last message.** A phase prompt is
read on every turn, so anything phrased as an operation on the previous message is applied over
and over: "take up the last point and push it further" compounds into escalation within a few
turns. Say where the agents' interest lies and let each turn start from that.

**Put the setting in the experiment's Scene, not in every phase prompt.** A phase replaces the
system prompt wholesale, so a setting written into phase 2's prompt has to be retyped into phases
3 and 4 or it silently disappears. The Scene (below) is sent on every turn of every phase.

**Let them change subject, and let them go quiet.** A phase that says "stay on this topic" removes
the only thing that stops a two-agent exchange spiralling. Thread control (below) provides that
rhythm without you having to write it into a prompt.

**Do not instruct the agents to say each other's names.** Real people in a group chat rarely do,
and an agent that opens every message with a name reads as a bot. It also buys nothing: with two
agents on the Rules policy the speaking order already alternates.

**The After User Sentence Prompt now lands last on every provider.** It used to be folded into the
system block on Anthropic and Google, so the "instructions at the end of the context are followed
best" advantage applied only to OpenAI. It no longer does — the after-prompt, the Scene and any
thread-control note are sent as one block at the true end of the context on all three, so a study
is no longer tied to one provider for this reason.

**Set the group's airtime knobs once, for the whole session.** Agent-to-agent replies and
agent-only follow-up rounds are fixed at conversation start and are not phase-controlled. With
thread control on, Extended plus 2–3 follow-up rounds is a reasonable setting; the phase prompts
then decide whether the agents spend that airtime on the participant or on each other. Without
thread control, that much unanchored airtime is what produced the drift described below.

---

## Scene

*Experiment → Conversation phases → Agent-to-agent behaviour (Group only).*

One or two sentences saying where this conversation is happening and what it is about. The agents
see it at the **end** of their context on every turn, in every phase.

```
A casual three-way group chat between friends about how people spend their free time
and what makes a place good to live in.
```

It is optional and it is never prefilled — the wording is yours. Leave it blank and nothing is
added to any prompt.

Why it exists: sixty messages into a group conversation the system prompt is the weakest signal in
the model's context, and a phase change replaces it entirely. A setting that lives in the Scene
cannot fade and cannot be lost at a phase boundary.

---

## Thread control

*Experiment → Conversation phases → Agent-to-agent behaviour (Group only).*

> **Both start OFF, on new and existing experiments alike, and turning either on is your
> decision.** They live behind the *Conversation phases* checkbox, and a setting that is switched
> on while its controls are hidden is the one thing this platform will not do — so the checkbox
> being clear means the feature is genuinely off, not merely out of sight. A study that is already
> collecting data is never touched either way, and conversations in flight keep the settings they
> started with.

### The problem it solves

To one agent, the other agent's message arrives as if a person had sent it. Two chat-tuned models
therefore agree with each other and build on what was just said, every single turn, and never
disagree, ground themselves, change subject or stop. Across three recorded pilot runs (grok-4.3 at
temperature 0.9, Extended replies plus 2 follow-up rounds), every run left its topic before the
end and none came back:

```
leave the phone in the car -> bury the keys too -> bury keys and phone, skip the car
-> hide the keys off trail, force an overnight loop
```

By the last phase one run was producing "those silences could fold the awakening deeper", and
another had escalated into a scenario nobody would want a participant to read. The phase mechanism
worked correctly throughout; what was missing was anything pulling the conversation back.

### What it does

Before each **agent-to-agent** reply, one move is drawn from the conversation's seed — the same way
Silence chance is drawn — and, unless it is *continue*, one sentence is added at the end of that
agent's context:

| Move | What the agent is told |
|---|---|
| **Ground** | "Keep this concrete: say something a real person in this setting would actually say, tied to a specific detail, rather than extending the previous idea further." |
| **Shift** | "Move the thread on to something else within the setting; do not build on the previous message." |
| **Return** | "Pick the thread back up from something said earlier in the conversation." |
| **Close** | *(nothing — the round ends here)* |
| **Continue** | *(nothing — an ordinary reply)* |

You set the chance of each; 0 means that move is never used. The defaults are Ground 0.20, Shift
0.15, Return 0.05, Close 0.08 — so roughly half of agent-to-agent turns are ordinary replies.

**A reply that answers you is never steered.** Only turns the agents address to each other are, and
none of the four notes says anything about who the agents should talk to. Whether the agents engage
with the participant remains entirely your prompts' business.

### Closing, and "up to N rounds"

Close ends the round there. A direct question left dangling is still answered first, so nothing is
cut off mid-exchange. Because of this, **"Agent-only follow-up rounds" is a ceiling, not a count** —
a follow-up round may now produce nothing at all, which is what it looks like when a conversation
has run its course.

### The degeneration guard

Underneath the draw, a round also closes when the last four agent turns have stopped being a
conversation — near-identical turns, or a run where every turn opens by continuing the previous one
("or…", "yeah…", "sure mm…"). This is measured from the text alone, with fixed thresholds; no model
is asked to judge anything.

The thresholds were calibrated against the recorded pilot transcripts, and doing that produced one
finding worth knowing before you interpret your own data: **a healthy phase-1 round was more
lexically repetitive than either drifting tail.** The agents parrot each other's vocabulary when
they are engaged, and invent new vocabulary when they are drifting. So the guard is deliberately
conservative — it catches the "yes, and" chain and near-verbatim repetition, and it will not catch
a run that stays varied while being about nothing. The moves above are what address that case.

### What a deterministic design cannot do

Everything here is decided from the conversation's seed and its recorded transcript, which is what
keeps a study replayable. The cost of that is honest and worth stating: **the platform cannot
detect that one particular turn has gone wrong.** What it can do is make drift structurally
unlikely — the scene never fades, your words never leave the agents' context, the "yes, and" chain
is broken on a reproducible rhythm, loops close, and threads can go quiet. The remaining lever is
your own After User Sentence Prompt.

**Pilot before you collect.** Run the study yourself first and read the last phase. Drift is a
property of the models and the prompts as much as of the platform.

---

## Memory window

*Experiment → Conversation phases → Agent-to-agent behaviour (Group only).*

After 30 messages the agents keep the opening, everything the participant has ever said, and the
last 30 messages; older agent-to-agent messages drop out of their context, replaced by a note that
earlier messages are not shown.

Nothing is summarised and nothing is invented — messages are only selected — so the conversation
still reproduces exactly, and **the recorded transcript is untouched**. This bounds what the agents
read, never what your export contains.

Worth turning on for any long study, and particularly for a survey-embedded one, where four chat
blocks can reach 200 messages. A participant's answers from block 1 are still in the agents'
context in block 4.

---

## What is recorded

Every agent message stores the phase that **generated** it — not the phase that happened to be
active when it was delivered, which can differ when humanized pacing holds a message back.

Each conversation stores a phase history: when each agent entered each phase, at which message,
and whether the time or the turn threshold fired. If a participant was idle long enough to cross
two boundaries at once, the skipped phase is recorded as skipped — they never experienced it.

All of this reaches the Excel export, along with a **manipulation-check** column: the share of
agent messages that addressed the participant, per phase. Report that as a measured covariate
rather than assuming the assigned condition was delivered — with generative agents, every
participant gets a slightly different conversation.

For a study running thread control the export also carries **Move** on the Messages sheet (which
move steered each agent turn, blank for ordinary replies) and **Scene**, **Thread Control** and
**Thread Closes** on the Conversations sheet, all read from the settings the conversation actually
ran with rather than from the experiment as it stands today.

None of it is ever sent to the participant's browser.

---

## Limitations worth knowing before you design a study

**A phase changes prompt text only.** It cannot change turn-taking. Each agent still takes its
turn in every round, so the participant is conversationally sidelined but never structurally cut
out — there is no "nobody answered at all" condition. For reference, the published chat-room
ostracism paradigm (Donate et al., 2017, *PLOS ONE* 12(9):e0184215) still directed 15% of
messages at the participant in its exclusion condition, so this sits inside the paradigm. If
piloting shows the drop is too weak, per-phase turn-taking is a small addition on top of what
exists.

**Thread control is not phase-controlled either.** Its chances are set once for the whole session,
like the airtime knobs. Its Close move can end a round early, so it does affect how much the agents
say — check *Thread Closes* and the per-phase agent-turn counts in your pilot export before
assuming the airtime is what you configured.

**The exclusion rate is emergent, not set.** You are asking models to behave a certain way, not
dictating a message ratio. Check the realized rate in the export.

---

## Ethical checklist

Ostracism inductions are well established, and they are not harmless.

- **End with a reinclusion phase.** Make the last phase one that warms back up. This costs one
  row and it is the single most useful thing the phase system gives you.
- **Do not rely on debriefing alone.** Miketta & Friese (2024, *J Empirical Research on Human
  Research Ethics*) found a revised outcome debriefing *failed* to counteract experimental
  ostracism, with aftereffects persisting more than a day.
- **Follow up after 24 hours**, for the same reason.
- **Screen participants** — Donate et al. excluded psychiatric/neurological history, substance
  abuse history, and high depression scores, assessed before the task.
- **Measure the manipulation and the believability.** Ask participants what share of messages
  they thought were directed at them (Donate et al. recovered their real 15%/33% almost exactly)
  and whether the chat felt real (their agents scored 81–88%).
