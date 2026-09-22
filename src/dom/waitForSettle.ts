// §13.2 "wait_for_settle(): DOM quiet for 300ms (MutationObserver) or 3s cap".
// Lets a page's own post-action reaction (a re-render, a network-driven DOM
// update) finish before the next observe(), without waiting the full cap on
// a page that's already settled.

const QUIET_MS = 300;
const CAP_MS = 3000;

export async function waitForSettle(root: Node = document.body): Promise<void> {
  await new Promise<void>((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;
    const capTimer = setTimeout(finish, CAP_MS);

    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, QUIET_MS);
    });

    function finish(): void {
      clearTimeout(quietTimer);
      clearTimeout(capTimer);
      observer.disconnect();
      resolve();
    }

    quietTimer = setTimeout(finish, QUIET_MS);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}
