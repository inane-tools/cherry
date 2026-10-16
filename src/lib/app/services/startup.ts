/** Give initial content a short head start without blocking on slow networks. */
export async function waitForStartup(task: Promise<unknown>, budgetMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task.catch(() => {}),
      new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
