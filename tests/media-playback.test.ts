// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindExclusiveMediaPlayback, pauseMediaOutside } from "../src/core/media-playback";

describe("media playback coordination", () => {
  afterEach(() => document.body.replaceChildren());

  it("pauses every other audio or video when one starts playing", () => {
    document.body.innerHTML = "<main><video></video><audio></audio><video></video></main>";
    const root = document.querySelector("main")!;
    const [first, audio, next] = [...root.querySelectorAll<HTMLMediaElement>("video, audio")];
    const firstState = controllableMedia(first!);
    const audioState = controllableMedia(audio!);
    const nextState = controllableMedia(next!);
    const unbind = bindExclusiveMediaPlayback(root);

    firstState.start();
    audioState.start();

    expect(firstState.pause).toHaveBeenCalledOnce();
    expect(audioState.pause).not.toHaveBeenCalled();
    expect(nextState.pause).not.toHaveBeenCalled();
    unbind();
  });

  it("pauses media outside the active card without resetting playback progress", () => {
    document.body.innerHTML = "<main><article data-card='first'><video></video></article><article data-card='current'><video></video></article></main>";
    const root = document.querySelector("main")!;
    const [previous, current] = [...root.querySelectorAll<HTMLVideoElement>("video")];
    const previousState = controllableMedia(previous!);
    const currentState = controllableMedia(current!);
    const currentCard = root.querySelector<HTMLElement>("[data-card='current']")!;
    previous!.currentTime = 18.5;
    current!.currentTime = 4;
    previousState.setPlaying();
    currentState.setPlaying();

    pauseMediaOutside(root, currentCard);

    expect(previousState.pause).toHaveBeenCalledOnce();
    expect(previous!.currentTime).toBe(18.5);
    expect(currentState.pause).not.toHaveBeenCalled();
    expect(current!.currentTime).toBe(4);
  });
});

function controllableMedia(media: HTMLMediaElement): {
  pause: ReturnType<typeof vi.fn>;
  setPlaying: () => void;
  start: () => void;
} {
  let paused = true;
  const pause = vi.fn(() => { paused = true; });
  Object.defineProperty(media, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(media, "pause", { configurable: true, value: pause });
  const setPlaying = (): void => { paused = false; };
  return {
    pause,
    setPlaying,
    start: () => {
      setPlaying();
      media.dispatchEvent(new media.ownerDocument.defaultView!.Event("play"));
    }
  };
}
