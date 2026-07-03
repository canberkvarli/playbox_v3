import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/**
 * Live Activity props for an active Playbox rental session.
 *
 * Split conceptually into static attributes ({ stationName, sport, gate }) that
 * do not change over the life of the activity, and dynamic content
 * ({ plannedEndAt, overrun }) pushed on update. All values are JSON-serialized
 * across the bridge, so `plannedEndAt` is epoch ms and rebuilt to a Date here.
 */
export type SessionActivityProps = {
  // static attributes
  stationName: string;
  sport: string; // Turkish sport label (e.g. "basket")
  gate?: number;
  // dynamic content
  plannedEndAt: number; // epoch ms — startedAt + durationMinutes*60000
  overrun: boolean;
};

const BG = '#17181C';
const VOLT = '#D6FB3C';
const CORAL = '#FF5C39';
const DIM = '#FFFFFF99';
const WHITE = '#FFFFFF';

const SessionActivity = (props: SessionActivityProps, _env: LiveActivityEnvironment) => {
  'widget';
  const accent = props.overrun ? CORAL : VOLT;
  const end = new Date(props.plannedEndAt);
  const start = new Date(Math.min(Date.now(), props.plannedEndAt));
  // Overrun counts up from the planned end; cap the interval 4h out (system max).
  const overrunUpper = new Date(props.plannedEndAt + 4 * 3600_000);

  // Live countdown / count-up rendered by SwiftUI itself via timerInterval —
  // no per-second JS pushes. Fixed-width frame + monospacedDigit keep the greedy
  // timer text from overflowing its region.
  const Countdown = ({
    size,
    width,
    align = 'trailing',
  }: {
    size: number;
    width: number;
    align?: 'leading' | 'trailing' | 'center';
  }) =>
    props.overrun ? (
      <Text
        timerInterval={{ lower: end, upper: overrunUpper }}
        countsDown={false}
        modifiers={[
          font({ weight: 'heavy', size }),
          monospacedDigit(),
          foregroundStyle(CORAL),
          multilineTextAlignment(align),
          frame({ width, alignment: align }),
        ]}
      />
    ) : (
      <Text
        timerInterval={{ lower: start, upper: end }}
        countsDown
        modifiers={[
          font({ weight: 'heavy', size }),
          monospacedDigit(),
          foregroundStyle(VOLT),
          multilineTextAlignment(align),
          frame({ width, alignment: align }),
        ]}
      />
    );

  const stateLabel = props.overrun ? 'GEÇ' : 'KALDI';

  return {
    // Lock Screen / Notification Center banner.
    banner: (
      <HStack
        spacing={12}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          padding({ horizontal: 16, vertical: 12 }),
        ]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ weight: 'heavy', size: 11 }), foregroundStyle(accent)]}>
            SEANS AKTİF
          </Text>
          <Text
            modifiers={[font({ weight: 'bold', size: 17 }), foregroundStyle(WHITE), lineLimit(1)]}>
            {props.sport}
          </Text>
          <Text
            modifiers={[font({ weight: 'medium', size: 12 }), foregroundStyle(DIM), lineLimit(1)]}>
            {props.stationName}
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text modifiers={[font({ weight: 'medium', size: 10 }), foregroundStyle(DIM)]}>
            {stateLabel}
          </Text>
          <Countdown size={26} width={90} align="trailing" />
        </VStack>
      </HStack>
    ),

    // Dynamic Island — compact: brand dot leading, countdown trailing.
    compactLeading: (
      <Text
        modifiers={[font({ weight: 'heavy', size: 13 }), foregroundStyle(accent), padding({ leading: 4 })]}>
        ●
      </Text>
    ),
    compactTrailing: <Countdown size={13} width={52} align="trailing" />,

    // Minimal — just the countdown (tiny region).
    minimal: <Countdown size={12} width={40} align="center" />,

    // Expanded — station/sport on the left, countdown on the right, state below.
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 8 })]}>
        <Text modifiers={[font({ weight: 'heavy', size: 10 }), foregroundStyle(accent)]}>
          SEANS AKTİF
        </Text>
        <Text
          modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(WHITE), lineLimit(1)]}>
          {props.sport}
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 8 })]}>
        <Text modifiers={[font({ weight: 'medium', size: 10 }), foregroundStyle(DIM)]}>
          {stateLabel}
        </Text>
        <Countdown size={20} width={72} align="trailing" />
      </VStack>
    ),
    expandedBottom: (
      <Text
        modifiers={[
          font({ weight: 'medium', size: 12 }),
          foregroundStyle(DIM),
          lineLimit(1),
          padding({ horizontal: 8 }),
        ]}>
        {props.stationName}
      </Text>
    ),
  };
};

export default createLiveActivity<SessionActivityProps>('SessionActivity', SessionActivity);
