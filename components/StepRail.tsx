import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';

export type Step = {
  /** One-line instruction (the action). */
  text: string;
  /** Optional short clarifier under the action. */
  sub?: string;
  /** Render a check instead of the number (e.g. photo captured). */
  done?: boolean;
};

/**
 * Connected numbered rail for a SHORT ordered instruction set — e.g. the
 * return flow (aç → koy → kapat). Replaces the old stack of full-height
 * bordered "blocks": small volt-outlined nodes threaded by a thin line read as
 * a sequence at a glance and leave the CTA in view instead of pushing it off
 * screen. The numbering is real information (the steps are ordered), not
 * decoration. One component, used in both EndSessionModal phases.
 */
export function StepRail({ steps }: { steps: Step[] }) {
  return (
    <View>
      {steps.map((step, idx) => {
        const last = idx === steps.length - 1;
        return (
          <View key={step.text} style={{ flexDirection: 'row' }}>
            {/* Node + connector column. The line uses flex:1 so it stretches to
                the row height (driven by the body's paddingBottom) and meets
                the next node — no fixed heights to keep in sync. */}
            <View style={{ width: 26, alignItems: 'center' }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  borderWidth: 1.5,
                  borderColor: palette.volt,
                  backgroundColor: palette.volt + '1A',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {step.done ? (
                  <Feather name="check" size={14} color={palette.volt} />
                ) : (
                  <Text
                    style={{
                      fontFamily: 'JetBrainsMono_700Bold',
                      color: palette.volt,
                      fontSize: 12,
                    }}
                  >
                    {idx + 1}
                  </Text>
                )}
              </View>
              {!last && (
                <View
                  style={{
                    width: 1.5,
                    flex: 1,
                    backgroundColor: palette.volt + '40',
                    marginVertical: 2,
                  }}
                />
              )}
            </View>

            {/* Body — title carries the action; the light sub-line is optional
                context. Spacing between steps lives here (paddingBottom) so the
                connector line can span it. */}
            <View style={{ flex: 1, paddingLeft: 14, paddingBottom: last ? 0 : 18 }}>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.fg,
                  fontSize: 15,
                  lineHeight: 20,
                }}
              >
                {step.text}
              </Text>
              {step.sub ? (
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    color: palette.muted,
                    fontSize: 12.5,
                    lineHeight: 17,
                    marginTop: 1,
                  }}
                >
                  {step.sub}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
