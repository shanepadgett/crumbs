import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

type DialogTask<T> = () => Promise<T>;

export class SubagentUiQueue {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly parentUi: ExtensionUIContext) {}

  create(agentName: string): ExtensionUIContext {
    const queue = this;
    const prefixTitle = (title: string) => `${agentName} requests approval\n\n${title}`;

    return {
      ...this.parentUi,
      select(title, options, opts) {
        return queue.enqueue(() => queue.parentUi.select(prefixTitle(title), options, opts));
      },
      confirm(title, message, opts) {
        return queue.enqueue(() =>
          queue.parentUi.confirm(`${agentName} requests approval`, `${title}\n\n${message}`, opts),
        );
      },
      input(title, placeholder, opts) {
        return queue.enqueue(() =>
          queue.parentUi.input(`${agentName}: ${title}`, placeholder, opts),
        );
      },
      editor(title, prefill) {
        return queue.enqueue(() => queue.parentUi.editor(`${agentName}: ${title}`, prefill));
      },
      custom(factory, options) {
        return queue.enqueue(() => queue.parentUi.custom(factory, options));
      },
      notify(message, type = "info") {
        if (type === "info") return;
        queue.parentUi.notify(`${agentName}: ${message}`, type);
      },
      setStatus() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setHiddenThinkingLabel() {},
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle() {},
    };
  }

  private enqueue<T>(task: DialogTask<T>): Promise<T> {
    const run = this.pending.then(task, task);
    this.pending = run.catch(() => undefined);
    return run;
  }
}

export type SubagentUiBinding = {
  mode: ExtensionContext["mode"];
  queue: SubagentUiQueue;
};
