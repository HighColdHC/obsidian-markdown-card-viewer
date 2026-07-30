export function bindExclusiveMediaPlayback(root: HTMLElement): () => void {
  const onPlay = (event: Event): void => {
    const active = asMediaElement(event.target);
    if (!active || !root.contains(active)) return;
    for (const media of mediaElements(root)) {
      if (media !== active && !media.paused) media.pause();
    }
  };
  root.addEventListener("play", onPlay, true);
  return () => root.removeEventListener("play", onPlay, true);
}

export function pauseMediaOutside(root: HTMLElement, activeContainer: Element | null): void {
  for (const media of mediaElements(root)) {
    if ((!activeContainer || !activeContainer.contains(media)) && !media.paused) media.pause();
  }
}

function mediaElements(root: HTMLElement): HTMLMediaElement[] {
  return [...root.querySelectorAll<HTMLMediaElement>("video, audio")];
}

function asMediaElement(target: EventTarget | null): HTMLMediaElement | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<HTMLMediaElement> & { tagName?: string };
  return (candidate.tagName === "VIDEO" || candidate.tagName === "AUDIO") && typeof candidate.pause === "function"
    ? candidate as HTMLMediaElement
    : null;
}
