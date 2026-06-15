import type { ReactNode } from "react";
import type { StageState } from "./Stage";

/* Inline payload render — mono block in the right column. */
function Payload({ children }: { children: string }) {
  return (
    <pre className="bg-panel border border-hairline rounded-md px-5 py-4 font-mono text-[12px] leading-[1.65] text-ink-2 overflow-x-auto whitespace-pre my-6">
      {children}
    </pre>
  );
}

/**
 * The story: one entry per scroll step. `heading` renders above the step's
 * prose; `stage` is the stage state the step triggers.
 */
export type Step = {
  stage: StageState;
  heading?: string;
  body: ReactNode;
};

export const STEPS: Step[] = [
  /* ---------- the loop ---------- */
  {
    stage: { phase: "loop" },
    heading: "Every turn re-sends everything",
    body: (
      <p>
        Start with the loop. The model does not remember the last turn on its own. Before the next
        tool call, the harness has to send the conversation back in: the prompt, the files, the
        logs, the whole working trail. The counter on the left is not showing "how much we have
        talked." It is showing how much gets uploaded again on the next turn.
      </p>
    ),
  },
  {
    stage: { phase: "loop" },
    body: (
      <p>
        People tend to talk about output tokens because they are expensive. In coding-agent work,
        the bigger pile is usually input. Most of that input is not new; it is yesterday's evidence
        being sent one more time so the model can stay oriented. Add a little context each turn and
        the bill does not grow in a straight line. It bends upward.
      </p>
    ),
  },
  {
    stage: { phase: "loop" },
    body: (
      <p>
        One billing detail matters before the agents start. Vendors do discount repeated prefixes.
        If the beginning of the prompt is byte-for-byte identical, the prompt cache bills it at 10%
        of list price. The middle meter tracks that. For the first run, I am giving the default
        agent a perfect cache hit every time. Real traffic is messier, so this is the generous
        version of the bill.
      </p>
    ),
  },

  /* ---------- run 1: the default agent ---------- */
  {
    stage: { phase: "run1", upto: 1 },
    heading: "The default agent takes the case",
    body: (
      <p>
        The ticket is ordinary, and it is a little underspecified in the way real tickets are.
        Saved-card payments are not retrying. The tests are green, because nobody wrote coverage for
        this path. The conversation starts here. The user's prompt goes out with the system prompt
        and tool schemas, so the run begins with 3,000 tokens of standing overhead before the agent
        has read a single file.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 2 },
    body: (
      <p>
        First move: find the code. <span className="font-mono text-[15px]">grep</span> returns 184
        matching lines for "retry" across the repo. A handful matter. This is not a giant result,
        about 3,400 tokens, and that is the point. The agent is behaving normally. The cost comes
        from the fact that every line now rides along on every later turn, whether it still matters
        or not.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 3 },
    body: (
      <p>
        Next, the likely suspect. The naive read tool has one setting: everything.{" "}
        <span className="font-mono text-[15px]">checkout.ts</span> is 812 lines; the agent needs
        maybe sixty of them, but the tool cannot know that, so the whole file lands in context.
        Watch the meter. That one read costs more than the code change will.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 4 },
    body: (
      <p>
        The charge path runs through <span className="font-mono text-[15px]">gateway.ts</span>.
        Another whole file, another 6,400 tokens. The agent is doing the responsible thing by
        reading before it edits. The problem is lower down: the harness treats "understand this
        area" and "carry every line forever" as the same operation.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 5 },
    body: (
      <p>
        <span className="font-mono text-[15px]">types.ts</span> is small: 210 lines. Reading it
        whole is completely reasonable. Keep this one in mind. The smarter harness should not try to
        be clever everywhere. Sometimes the right answer is to read the small file and move on.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 6 },
    body: (
      <p>
        Before writing a regression test, the agent checks what coverage already exists.{" "}
        <span className="font-mono text-[15px]">checkout.test.ts</span>, all 488 lines of it. The
        context is now past 29,000 tokens, and the agent has not changed a line of code. It is still
        just looking around. Every turn from here starts by buying this whole pile again.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 7 },
    body: (
      <p>
        One more read: the docs it was asked to update. The agent has now found the bug. Saved-card
        charges route through a separate code path that never passes{" "}
        <span className="font-mono text-[15px]">maxRetries</span>, so retries silently default to
        zero. Now it can write the fix.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 8 },
    heading: "Now watch it edit",
    body: (
      <>
        <p>
          The default edit tool is another place where the harness leaks money. To change one line,
          the model has to quote the surrounding code twice: once as the old text and once as the
          new text. The harness uses those strings to find the edit location. Here is the first
          call:
        </p>
        <Payload>{`edit("src/checkout.ts")
oldText:
  retryPayment(attempt: number) {
    const retries = 0;
    if (attempt > retries) {
      throw new PaymentError("retries exhausted");
    }
    this.logger.warn("retrying payment", { attempt });
    return this.gateway.charge(this.cart, attempt);
  }
newText:
  retryPayment(attempt: number) {
    const retries = this.opts.maxRetries ?? 2;
    if (attempt > retries) {
      throw new PaymentError("retries exhausted");
    }
    this.logger.warn("retrying payment", { attempt });
    return this.gateway.charge(this.cart, attempt);
  }`}</Payload>
        <p>
          Sixteen lines retyped to change one. Those quoted lines are output tokens, the most
          expensive tokens in the run, and most of them are not new thought. They are locator text.
        </p>
      </>
    ),
  },
  {
    stage: { phase: "run1", upto: 11 },
    body: (
      <p>
        The next three changes follow the same pattern: gateway fix, regression test, docs update.
        Each one gets its own tool call. Each call gets the whole context uploaded in front of it.
        The actual patch is small. The ceremony around the patch is where the money goes.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 12 },
    body: (
      <p>
        Then the agent does something normal: it re-reads{" "}
        <span className="font-mono text-[15px]">checkout.ts</span> to check the edit it just made.
        The default harness does not know that this read supersedes the first one. It just stacks
        another 812-line copy on top of the old 812-line copy, and both versions now travel forward
        together. This is exactly the shape the second run is going to fix.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 13 },
    heading: "The validation gauntlet",
    body: (
      <p>
        The code is changed. Now the agent has to prove it did not break anything. First the type
        checker. <span className="font-mono text-[15px]">tsc</span> passes and prints almost
        nothing. It still costs a full-context turn, because the agent had to send the whole run in
        order to ask the question.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 15 },
    body: (
      <p>
        Then the linter and formatter. Both pass. The markdown linter also talks about files the
        agent did not touch, so 600 tokens of harmless warnings join the conversation. Nothing is
        wrong, but the context is larger now, and it stays larger.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 16 },
    body: (
      <p>
        Finally, the full test suite. It passes. The fix works, and the regression test is green.
        The problem is the receipt: 4,180 lines of passing test names, timings, and status text.
        That is 24,600 tokens to say one useful thing: yes. And because it is now in the
        conversation, it gets bought again on the final answer.
      </p>
    ),
  },
  {
    stage: { phase: "run1", upto: 17 },
    body: (
      <>
        <p>
          The agent reports back. The answer is correct. The bug is fixed. Final tally for one
          ordinary bug fix: <strong className="text-ink">68,050 tokens</strong> of context re-sent
          on the last turn, <strong className="text-money font-mono text-[16px]">$0.77</strong> of
          session spend, and that's <em>with</em> a perfect cache hit on every single turn.
        </p>
        <p>
          That is what makes this uncomfortable. Nothing broke. The agent was competent. The tools
          did what they were designed to do. The waste is in the shape of the harness, so the bill
          scales with how long the session runs.
        </p>
      </>
    ),
  },
  {
    stage: { phase: "turn" },
    heading: "Same bug, different harness",
    body: (
      <p>
        Now run the afternoon again. Same request, same model, same repo. The difference is the
        harness around the model. This one treats context like a working set. It still stores the
        raw artifacts, but it does not make the model carry every artifact in its head forever.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 1 },
    heading: "The conscious agent starts the case",
    body: (
      <p>
        The first turn looks almost identical. The user prompt still ships with the system prompt
        and tool schemas. The cache is still cold. No trick yet. The savings do not come from asking
        a weaker question or doing less engineering work.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 2 },
    body: (
      <p>
        Search is the first bespoke tool. It gives the agent the useful hits and stores the long
        tail behind a handle. If the model needs more, it can ask for the artifact by id. Until
        then, hundreds of irrelevant lines do not become permanent conversation furniture.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 3 },
    body: (
      <>
        <p>
          The first read is also shaped for context. It returns an outline, the ranges that mention
          retry behavior, and a content hash. The hash matters: later edits can prove which version
          the model saw.
        </p>
        <Payload>{`read.smart("src/checkout.ts")
outline:
  CheckoutService
  retryPayment(attempt)
  chargeSavedCard(cart, opts)
ranges:
  L118-L176 retryPayment
  L402-L468 chargeSavedCard
hash: chk_92fd
artifact: file_chk_92fd`}</Payload>
      </>
    ),
  },
  {
    stage: { phase: "run2", upto: 4 },
    body: (
      <p>
        The next read is smaller because the first read gave the agent a map. It asks for the
        gateway range that matters instead of swallowing the whole file. This is not compression for
        its own sake. It is orientation.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 5 },
    body: (
      <p>
        Then the small file comes back whole. That is important. A context-conscious harness should
        not perform cleverness where cleverness does not buy anything. If the file is small enough,
        read it and move on.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 6 },
    body: (
      <p>
        After the test read, the search result has done its job. The harness rewrites it into a
        capsule: short summary, retrieval handle, full bytes still on disk. Watch the cache meter
        drop to zero for this turn. That is a real cost. The next turns carry a smaller prefix.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 7 },
    body: (
      <p>
        The docs read follows the same rule. The agent gets the retry section and the document hash,
        not the whole markdown file. By now it has enough context to fix the bug, write the test,
        and update the docs without dragging the whole repo behind it.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 8 },
    heading: "The edit is grounded",
    body: (
      <>
        <p>
          The patch is one call. It is anchored to line ranges and hashes, so the harness can reject
          it if the file changed under the agent. The old reads flip to stale because they are no
          longer current truth.
        </p>
        <Payload>{`grounded_patch:
*** Update File: src/checkout.ts
*** Base: chk_92fd
replace 132..132:
+ const retries = this.opts.maxRetries ?? 2;

*** Update File: src/payment/gateway.ts
*** Base: pay_41ac
replace 188..195:
+ return chargeSavedCard(cart, { maxRetries });

*** Update File: src/checkout.test.ts
*** Base: tst_80bf
insert after 274:
+ it("retries failed saved-card charges", async () => { ... });

*** Update File: docs/payments.md
*** Base: doc_7c12
replace 88..94:
+ Saved-card failures use the same retry policy as new-card charges.
*** End Patch`}</Payload>
      </>
    ),
  },
  {
    stage: { phase: "run2", upto: 9 },
    body: (
      <p>
        Here is the shape we planted in the first run. The agent checks{" "}
        <span className="font-mono text-[15px]">checkout.ts</span> after the edit. The default
        harness stacked a second full file. This harness returns the changed ranges and a new hash,
        then marks the older checkout read as superseded.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 10 },
    body: (
      <p>
        Validation still runs. It just runs outside the model's working memory. Typecheck, lint,
        format, and tests all pass, so nothing enters context. If one failed, the harness would send
        the focused failure packet instead of a passing victory lap.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 11 },
    heading: "The cache miss is on purpose",
    body: (
      <p>
        Now the harness curates the working set. Resolved evidence gets tombstoned. Stale and
        superseded reads shrink to pointers. The prefix is rewritten, so the cache meter drops
        again. That is not free. It is a choice to pay once so the next turns are cheaper, smaller,
        and less likely to reason from dead state.
      </p>
    ),
  },
  {
    stage: { phase: "run2", upto: 12 },
    body: (
      <>
        <p>
          Same outcome. The bug is fixed, the regression test is green, and the docs are updated.
          The final turn carries <strong className="text-ink">7,090 tokens</strong>, with a modeled
          session spend of <strong className="text-conscious font-mono text-[16px]">$0.31</strong>.
        </p>
        <p>
          The important part is not only the lower bill. The model is looking at the current working
          set instead of a transcript full of old reads, passing logs, and duplicate files.
        </p>
      </>
    ),
  },
  {
    stage: { phase: "payoff", turns: 3 },
    heading: "Yes, the rewrite breaks the cache",
    body: (
      <p>
        The obvious objection is real. When the harness rewrites old context into capsules and
        tombstones, the prefix is no longer byte-for-byte identical. That turn misses the prompt
        cache, so the provider bills the rewritten prefix at full input price. If the session ends
        right away, the rewrite can lose money.
      </p>
    ),
  },
  {
    stage: { phase: "payoff", turns: 5 },
    body: (
      <p>
        The question is not whether the rewrite is free. It is whether the session has enough turns
        left for the smaller context to pay back the miss. With current list pricing, cutting a 120k
        working set down to 30k breaks even around the fifth turn.
      </p>
    ),
  },
  {
    stage: { phase: "payoff", turns: 12 },
    body: (
      <p>
        Most useful agent sessions do not stop five turns after they get complicated. They keep
        going: follow-up reads, a second bug, review comments, another validation cycle. Once that
        happens, the cache miss stops looking like waste and starts looking like buying down
        principal.
      </p>
    ),
  },
  {
    stage: { phase: "payoff", turns: 30 },
    body: (
      <p>
        The long tail is where this matters. A cache hit is a discount, not a virtue. Getting 90%
        off tokens the model should not be reading is still paying for clutter. Shrink the working
        set first, then cache what remains.
      </p>
    ),
  },
  {
    stage: { phase: "sawtooth" },
    heading: "Full windows make agents worse",
    body: (
      <p>
        Cost is only half the argument. Long sessions also make agents worse. Default harnesses let
        the window fill until they have to compact. A lossy summary replaces the working evidence,
        and the agent spends the next turns rediscovering files, re-running checks, and sometimes
        trying fixes the engineer already ruled out.
      </p>
    ),
  },
  {
    stage: { phase: "sawtooth" },
    body: (
      <p>
        That is the sawtooth on the left. Quality degrades as the window fills, then drops when the
        session compacts. A context-conscious harness tries not to hit that wall. It keeps the
        working set small, and when it does summarize, it writes a dossier with constraints,
        decisions, changed files, failed attempts, and artifact handles.
      </p>
    ),
  },
  {
    stage: { phase: "business" },
    heading: "Eighteen hundred engineers, priced",
    body: (
      <p>
        Now price the harness choice like a platform decision. This uses 1,800 engineers, six agent
        sessions per engineer per day, and 220 workdays. It is deliberately generous to the default
        harness: perfect cache hits, no compaction rework, no solve-rate penalty.
      </p>
    ),
  },
  {
    stage: { phase: "business" },
    body: (
      <p>
        Across GPT-5.5, Opus 4.8, and Fable 5, the annual gap lands in the millions. The exact model
        choice changes the slope, not the shape. If engineers use agents all day, harness design is
        no longer a developer-experience detail. It is spend control, quality control, and leverage
        in the vendor conversation.
      </p>
    ),
  },
];
