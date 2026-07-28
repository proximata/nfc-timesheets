import { Composition } from "remotion";
import { Demo, DEMO_DURATION, FPS } from "./Video";

export const RemotionRoot = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={DEMO_DURATION}
    fps={FPS}
    width={1080}
    height={1920}
  />
);
