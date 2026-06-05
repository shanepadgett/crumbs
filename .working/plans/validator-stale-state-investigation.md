# Validator stale state / race investigation

- [ ] Investigate validator/check engine stale state after file fix.
  - Symptom: validator reported same lint failure again after file was already fixed.
  - Symptom: end-of-turn check later reported no issues.
  - Suspicion: stale cached file state, delayed watcher state, or race between validation runs.
  - Repro shape: failure repeated on `extensions/subagents/src/runner.ts` unused import after fix had already been applied.
  - Goal: determine whether issue is in task runner, file watcher, validation orchestration, result caching, or UI/reporting layer.
  - It appears to be happening when the Mii's task is failed and then it does something to fix it but it either errors out or it reads a file or something it's like there's something stale being left over about the error and then on top of that I'm also getting my notify that work is done prior to the task failure thing happening. So I I think it's either running at the wrong time or something because I'm also seeing the validation mys task failed notify, which I probably shouldn't even see that because it should just be injecting it into context the failure the only real validation output in the end that I should see is that it's running and if it failed I shouldn't see a failed it should just a meet like with a notify I think that's the problem is it's running a notify it shouldn't notify on failure it should just do the um message to the agent about the failure. Only notify on pass.
  - Also, is it possible to run the checks prior to it putting out its final summary message or does that still count as a tool call because I think it tries to run on the last tool call or whatnot but I'm wondering if we can capture it before like the assistant message.
