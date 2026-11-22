import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { claimPlayback, releasePlayback, stopPlayback } from "../src/components/media-playback";
import { VideoPlayer, type VideoPlayerProps } from "../src/components/VideoPlayer";

afterEach(() => cleanup());

const css = await Bun.file(new URL("../src/styles/components.css", import.meta.url).pathname).text();
/** The declarations of the first rule written exactly as `selector {`. */
const rule = (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

const labels: VideoPlayerProps["labels"] = {
  play: "Tocar",
  pause: "Pausar",
  replay: "Ver de novo",
  seek: "Posição no vídeo",
  volume: "Volume",
  mute: "Tirar o som",
  unmute: "Ligar o som",
  speed: (s) => `Velocidade ${s}×`,
  fullscreen: "Tela cheia",
  exitFullscreen: "Sair da tela cheia",
  open: "Abrir",
};
const player = (props: Partial<VideoPlayerProps> = {}) =>
  render(<VideoPlayer src="/f?version=2" name="abertura.mp4" labels={labels} {...props} />);

describe("VideoPlayer", () => {
  test("stopped: the first frame, a play key named after the file, its length, and the corner group", () => {
    let opened = 0;
    let saved = 0;
    player({
      onOpen: () => opened++,
      actions: (
        <button type="button" onClick={() => saved++}>
          Baixar
        </button>
      ),
    });
    const video = document.querySelector("video");
    // `#t`: the first frame shows before it plays; only its details load until then.
    expect(video?.getAttribute("src")).toBe("/f?version=2#t=0.001");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(screen.getByRole("button", { name: "Tocar: abertura.mp4" })).toBeTruthy();
    // No name over the picture (a picture's tile has none): only its length, once it is known.
    expect(document.querySelector(".ac-video__caption")).toBeNull();
    expect(document.querySelector(".ac-video__length")).toBeNull();
    Object.defineProperty(video, "duration", { configurable: true, value: 161 });
    fireEvent.loadedMetadata(video as HTMLVideoElement);
    expect(document.querySelector(".ac-video__length")?.textContent).toBe("2:41");
    // The bar waits, out of the tab order, until it plays.
    expect(document.querySelector(".ac-video__bar")?.hasAttribute("inert")).toBe(true);
    // The corner group: open in the viewer, then the caller's actions; a click there never plays the video.
    const group = document.querySelector(".ac-video__acts") as HTMLElement;
    expect(
      Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Abrir", "Baixar"]);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar" }));
    expect([opened, saved]).toEqual([1, 1]);
  });

  test("the viewer has no length badge and no corner button", () => {
    player({ variant: "viewer", onOpen: () => undefined });
    expect(document.querySelector(".ac-video__acts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir" })).toBeNull();
  });

  test("a video that can't play here says so to the caller", () => {
    let failed = 0;
    player({ onFailed: () => failed++ });
    const video = document.querySelector("video");
    if (!video) throw new Error("no video");
    fireEvent.error(video);
    expect(failed).toBe(1);
  });

  test("speed goes 1×, 1.5×, 2× and back", () => {
    player();
    const speed = () => screen.getByRole("button", { name: /^Velocidade/, hidden: true });
    expect(speed().textContent).toBe("1×");
    fireEvent.click(speed());
    expect(speed().textContent).toBe("1.5×");
    fireEvent.click(speed());
    fireEvent.click(speed());
    expect(speed().textContent).toBe("1×");
  });
});

describe("a file's comments on the player (ADR 0208)", () => {
  test("onVideo hands over the element; onTime hears where it is and how long it is", () => {
    const heard: [number, number][] = [];
    let element: HTMLVideoElement | null = null;
    player({ variant: "viewer", onTime: (at, length) => heard.push([at, length]), onVideo: (v) => (element = v) });
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(element === video).toBe(true);
    expect(heard.at(-1)).toEqual([0, 0]);
    Object.defineProperty(video, "duration", { configurable: true, value: 161 });
    fireEvent.loadedMetadata(video);
    expect(heard.at(-1)).toEqual([0, 161]);
    Object.defineProperty(video, "currentTime", { configurable: true, value: 42 });
    fireEvent.seeked(video);
    expect(heard.at(-1)).toEqual([42, 161]);
    // Only when something changed.
    const before = heard.length;
    fireEvent.seeked(video);
    expect(heard.length).toBe(before);
  });

  test("marks sit beside the timeline, never inside its slider", () => {
    player({
      variant: "viewer",
      marks: (
        <button type="button" className="mark" style={{ left: "25%" }}>
          1
        </button>
      ),
    });
    const box = document.querySelector(".ac-video__seekbox") as HTMLElement;
    const slider = screen.getByRole("slider", { name: "Posição no vídeo", hidden: true });
    expect(box.contains(slider)).toBe(true);
    const marks = box.querySelector(".ac-video__marks") as HTMLElement;
    expect(marks.querySelector("button.mark")?.textContent).toBe("1");
    expect(slider.contains(marks)).toBe(false);
    expect(marks.contains(slider)).toBe(false);
  });

  test("with no marks, the timeline is as it was", () => {
    player({ variant: "viewer" });
    expect(document.querySelector(".ac-video__seekbox")).toBeNull();
    expect(document.querySelector(".ac-video__marks")).toBeNull();
    expect(screen.getByRole("slider", { name: "Posição no vídeo", hidden: true })).toBeTruthy();
  });
});

describe("full screen", () => {
  const setFull = (el: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: el });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  };

  test("the player marks itself while it is the full screen element", () => {
    player({ onOpen: () => undefined });
    const root = document.querySelector(".ac-video") as HTMLElement;
    try {
      setFull(root);
      expect(root.hasAttribute("data-full")).toBe(true);
      setFull(null);
      expect(root.hasAttribute("data-full")).toBe(false);
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
  });

  test("a chat tile keeps its fixed box only outside full screen, where the video then fills the screen whole", () => {
    expect(rule(".ac-video--tile .ac-video__media")).toBe("");
    const box = rule(".ac-video--tile:not([data-full]) .ac-video__media");
    expect(box).toContain("width: 320px");
    expect(box).toContain("height: 180px");
    const media = rule(".ac-video__media");
    expect(media).toContain("width: 100%");
    expect(media).toContain("height: 100%");
    expect(media).toContain("object-fit: contain");
    // The tile's compact bar and its missing total time stay in the chat too.
    expect(rule(".ac-video--tile .ac-video__bar")).toBe("");
    expect(rule(".ac-video--tile .ac-video__total")).toBe("");
    expect(rule(".ac-video--tile:not([data-full]) .ac-video__total")).toContain("display: none");
    // The viewer and menus the corner opens would land behind the full screen.
    expect(rule(".ac-video[data-full] .ac-video__acts")).toContain("display: none");
    expect(rule(".ac-video[data-full]")).toContain("box-shadow: none");
  });
});

describe("one thing plays at a time", () => {
  test("claiming stops the one before; releasing forgets it", () => {
    const stopped: string[] = [];
    const a = () => stopped.push("a");
    const b = () => stopped.push("b");
    claimPlayback(a);
    claimPlayback(b);
    expect(stopped).toEqual(["a"]);
    releasePlayback(b);
    stopPlayback();
    expect(stopped).toEqual(["a"]);
    claimPlayback(a);
    stopPlayback();
    expect(stopped).toEqual(["a", "a"]);
  });
});
