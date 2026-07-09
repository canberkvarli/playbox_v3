import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { Sport } from '@/data/stations.seed';

type Props = { sport: Sport; color: string; size?: number };

/**
 * Abstract volt line-art ball per sport (monochrome, single stroke color).
 * Basketball reuses the app-icon mark. Drawn on a 100×100 viewBox.
 */
export function SportBall({ sport, color, size = 56 }: Props) {
  const common = {
    stroke: color,
    strokeWidth: 6,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="40" {...common} />
      {sport === 'basketball' && (
        <>
          <Line x1="50" y1="10" x2="50" y2="90" {...common} />
          <Line x1="10" y1="50" x2="90" y2="50" {...common} />
          <Path d="M28 18 Q47 50 28 82" {...common} />
          <Path d="M72 18 Q53 50 72 82" {...common} />
        </>
      )}
      {sport === 'football' && (
        <>
          <Path d="M50 34 L65 45 L59 63 L41 63 L35 45 Z" {...common} />
          <Line x1="50" y1="34" x2="50" y2="12" {...common} />
          <Line x1="65" y1="45" x2="86" y2="38" {...common} />
          <Line x1="59" y1="63" x2="73" y2="82" {...common} />
          <Line x1="41" y1="63" x2="27" y2="82" {...common} />
          <Line x1="35" y1="45" x2="14" y2="38" {...common} />
        </>
      )}
      {sport === 'volleyball' && (
        // Seams kept inside the r=40 rim: every start/control/end point sits
        // within ~r=34 of centre, so (a quadratic Bézier stays in its points'
        // convex hull) the 6px stroke can't cross the circle edge.
        <>
          <Path d="M50 16 Q27 44 40 80" {...common} />
          <Path d="M50 16 Q73 44 60 80" {...common} />
          <Path d="M18 52 Q50 39 82 58" {...common} />
        </>
      )}
      {sport === 'tennis' && (
        <>
          <Path d="M19 28 Q46 50 19 74" {...common} />
          <Path d="M81 28 Q54 50 81 74" {...common} />
        </>
      )}
    </Svg>
  );
}
