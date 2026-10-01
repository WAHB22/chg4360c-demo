import React from "react";
import { Composition } from "remotion";
import { DURATION, FPS } from "./config";
import { Mind } from "./Mind";

export const Root: React.FC = () => (
  <Composition id="Mind" component={Mind} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
