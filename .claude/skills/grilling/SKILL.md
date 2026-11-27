---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
target: true
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Sort each question before asking it. A **decision** has to be made for the design to exist at all: which of these ways do we do it. An **eventuality** is optional: something that might happen, which the design could handle or ignore. Ignoring it is a legitimate answer, and the default one.

For an eventuality, ask _whether_ to handle it before anything about _how_. The how-questions only exist once the user chooses to handle it. The "yes" rule still holds: when you recommend leaving it out, ask "Leave <eventuality> unhandled?", never "Handle <eventuality>?", so a "yes to all" leaves out everything you recommended leaving out. Put the weighing on one line between the question and your recommendation:

```
⚖️ Likely: <how often, with the evidence> · Ignored: <what happens: loud or silent, recoverable or not> · Cost: <what handling adds: code, tests, concepts> · Later: <cheap or expensive to add once it bites>
```

Likelihood is a fact, so find it (history, logs, issues, the code paths that could trigger it) rather than guess, and say so when there is no evidence either way. Recommend handling only when the eventuality is likely, or fails silently or irreversibly, or would be expensive to retrofit. Otherwise recommend leaving it out.

Eventualities you would leave out and expect no argument about go in one list at the end of the round, one line each, numbered **X1**, **X2**, ... so the user can pull any back in. Never drop one silently: leaving it out is the user's decision too.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited or explicitly declined, nothing left silently assumed. Close with the list of eventualities left out, so whoever builds this knows they are out of scope on purpose. Do not act on it until the user confirms you have reached a shared understanding.
