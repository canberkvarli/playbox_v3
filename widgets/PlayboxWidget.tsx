import { HStack, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  multilineTextAlignment,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/**
 * Snapshot props for the home-screen widget. JSON-serialized across the bridge,
 * so dates are epoch ms and rebuilt inside the widget.
 *
 * When `active` is false the widget shows the idle "find a court" prompt; the
 * session fields are only meaningful when `active` is true.
 */
export type PlayboxWidgetProps = {
  active: boolean;
  stationName: string;
  sportLabel: string;
  /** planned end = startedAt + durationMinutes*60000 (epoch ms) */
  plannedEndAt: number;
  overrun: boolean;
};

// Brand palette — kept inline: the 'widget' directive serializes only this
// function body into the widget's separate JS runtime, so module-scope imports
// of app constants would not be available.
const BG = '#17181C';
const VOLT = '#D6FB3C';
const CORAL = '#FF5C39';
const DIM = '#FFFFFF99';
const WHITE = '#FFFFFF';

const PlayboxWidget = (props: PlayboxWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const isSmall = environment.widgetFamily === 'systemSmall';
  const accent = props.overrun ? CORAL : VOLT;

  // Idle state — no active session. Nudge the user to rent.
  if (!props.active) {
    return (
      <ZStack
        alignment="leading"
        modifiers={[containerBackground(BG, 'widget'), clipShape('containerRelativeShape')]}>
        <VStack
          alignment="leading"
          spacing={6}
          modifiers={[
            frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
            padding({ all: 16 }),
          ]}>
          <Text modifiers={[font({ weight: 'heavy', size: 13 }), foregroundStyle(VOLT)]}>
            PLAYBOX
          </Text>
          <Spacer />
          <Text
            modifiers={[font({ weight: 'bold', size: isSmall ? 17 : 20 }), foregroundStyle(WHITE)]}>
            yakınında bir kort bul
          </Text>
          <Text modifiers={[font({ weight: 'medium', size: 12 }), foregroundStyle(DIM)]}>
            ekipmanı kirala, hemen oyna
          </Text>
        </VStack>
      </ZStack>
    );
  }

  // Active session — sport · station + live countdown.
  const end = new Date(props.plannedEndAt);
  const start = new Date(Math.min(Date.now(), props.plannedEndAt));

  return (
    <ZStack
      alignment="leading"
      modifiers={[containerBackground(BG, 'widget'), clipShape('containerRelativeShape')]}>
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
          padding({ all: 16 }),
        ]}>
        <HStack spacing={6}>
          <Text modifiers={[font({ weight: 'heavy', size: 11 }), foregroundStyle(accent)]}>
            SEANS AKTİF
          </Text>
          <Spacer />
        </HStack>

        <Spacer />

        <Text
          modifiers={[
            font({ weight: 'bold', size: isSmall ? 15 : 17 }),
            foregroundStyle(WHITE),
          ]}>
          {props.sportLabel}
        </Text>
        <Text modifiers={[font({ weight: 'medium', size: 12 }), foregroundStyle(DIM)]}>
          {props.stationName}
        </Text>

        <Spacer />

        <HStack spacing={6}>
          <Text modifiers={[font({ weight: 'medium', size: 11 }), foregroundStyle(DIM)]}>
            {props.overrun ? 'GEÇ' : 'KALDI'}
          </Text>
          {props.overrun ? (
            // Overrun: count UP from the planned end so it reads as +mm:ss late.
            <Text
              timerInterval={{ lower: end, upper: new Date(props.plannedEndAt + 4 * 3600_000) }}
              countsDown={false}
              modifiers={[
                font({ weight: 'heavy', size: isSmall ? 22 : 26 }),
                monospacedDigit(),
                foregroundStyle(CORAL),
                multilineTextAlignment('leading'),
              ]}
            />
          ) : (
            // Live countdown to the planned end. Bounded timerInterval clamps at 0.
            <Text
              timerInterval={{ lower: start, upper: end }}
              countsDown
              modifiers={[
                font({ weight: 'heavy', size: isSmall ? 22 : 26 }),
                monospacedDigit(),
                foregroundStyle(VOLT),
                multilineTextAlignment('leading'),
              ]}
            />
          )}
        </HStack>
      </VStack>
    </ZStack>
  );
};

export default createWidget('PlayboxWidget', PlayboxWidget);
