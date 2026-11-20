import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { HEIGHT, WIDTH, reelPropsSchema, type ReelProps } from '../shared/schema';
// written by `reel preview` (falls back to a tiny demo); renders pass their own props
import active from './generated/active.json';
import { Reel } from './Reel';

const calculateMetadata: CalculateMetadataFunction<ReelProps> = ({ props }) => {
  const fps = props.settings.export.fps;
  return {
    fps,
    width: WIDTH,
    height: HEIGHT,
    durationInFrames: Math.max(1, Math.ceil((props.timeline.durationMs / 1000) * fps)),
  };
};

export const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel as unknown as React.FC<Record<string, unknown>>}
    schema={reelPropsSchema}
    defaultProps={active as unknown as ReelProps}
    calculateMetadata={calculateMetadata as never}
    fps={30}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={300}
  />
);
