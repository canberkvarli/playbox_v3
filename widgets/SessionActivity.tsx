import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
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
 * Static attributes ({ stationName, sport, gate }) + dynamic content
 * ({ plannedEndAt, overrun }). All values are JSON-serialized across the bridge,
 * so `plannedEndAt` is epoch ms and rebuilt to a Date here.
 */
export type SessionActivityProps = {
  stationName: string;
  sport: string; // Turkish sport label (e.g. "basket")
  gate?: number;
  plannedEndAt: number; // epoch ms — startedAt + durationMinutes*60000
  overrun: boolean;
};

const VOLT = '#D6FB3C';
const CORAL = '#FF5C39';
const DIM = '#FFFFFF99';
const WHITE = '#FFFFFF';

// NOTE: everything here must be INLINE expo/ui primitives. The 'widget' directive
// transpiles this body to SwiftUI at build time and only understands expo/ui
// components — a nested custom component (e.g. a <Countdown/> helper) maps to
// nothing and renders EMPTY. So the timer Text is inlined in every region.
const SessionActivity = (props: SessionActivityProps, _env: LiveActivityEnvironment) => {
  'widget';
  const accent = props.overrun ? CORAL : VOLT;
  const stateLabel = props.overrun ? 'GEÇ' : 'KALDI';
  // Countdown (or count-up on overrun) rendered by SwiftUI's own timer text —
  // no per-second JS pushes. Bounds computed once and reused inline.
  const lower = props.overrun
    ? new Date(props.plannedEndAt)
    : new Date(Math.min(Date.now(), props.plannedEndAt));
  const upper = props.overrun
    ? new Date(props.plannedEndAt + 4 * 3600_000) // cap 4h out (system max)
    : new Date(props.plannedEndAt);
  const countsDown = !props.overrun;

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
          <Text
            timerInterval={{ lower, upper }}
            countsDown={countsDown}
            modifiers={[
              font({ weight: 'heavy', size: 26 }),
              monospacedDigit(),
              foregroundStyle(accent),
              multilineTextAlignment('trailing'),
              frame({ width: 92, alignment: 'trailing' }),
            ]}
          />
        </VStack>
      </HStack>
    ),

    // Dynamic Island — compact: brand dot leading, countdown trailing.
    compactLeading: (
      <Text
        modifiers={[
          font({ weight: 'heavy', size: 13 }),
          foregroundStyle(accent),
          padding({ leading: 4 }),
        ]}>
        ●
      </Text>
    ),
    compactTrailing: (
      <Text
        timerInterval={{ lower, upper }}
        countsDown={countsDown}
        modifiers={[
          font({ weight: 'heavy', size: 13 }),
          monospacedDigit(),
          foregroundStyle(accent),
          frame({ width: 54, alignment: 'trailing' }),
        ]}
      />
    ),

    // Minimal — just the countdown.
    minimal: (
      <Text
        timerInterval={{ lower, upper }}
        countsDown={countsDown}
        modifiers={[
          font({ weight: 'heavy', size: 12 }),
          monospacedDigit(),
          foregroundStyle(accent),
          frame({ width: 40, alignment: 'center' }),
        ]}
      />
    ),

    // Expanded — sport on the left, countdown on the right, station below.
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
        <Text
          timerInterval={{ lower, upper }}
          countsDown={countsDown}
          modifiers={[
            font({ weight: 'heavy', size: 20 }),
            monospacedDigit(),
            foregroundStyle(accent),
            frame({ width: 74, alignment: 'trailing' }),
          ]}
        />
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
